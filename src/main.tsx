#!/usr/bin/env bun
// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import { program } from 'commander'
import chalk from 'chalk'
import { detect } from './env/EnvDetector.ts'
import { DictManager } from './codec/dictionary/DictManager.ts'
import { HexCodec } from './codec/HexCodec.ts'
import { scan } from './scanner/FileScanner.ts'
import { BudgetTracker } from './budget/BudgetTracker.ts'
import { LoopDetector } from './budget/LoopDetector.ts'
import { buildSystemPrompt } from './agent/prompts.ts'
import { runAgent } from './agent/AgentLoop.ts'
import { runSwarm } from './swarm/Swarm.ts'
import { HexManifest } from './inspector/Manifest.ts'
import { injectDirectory } from './inspector/Injector.ts'
import { HexDevServer } from './inspector/DevServer.ts'
import { ProviderRegistry } from './providers/registry.ts'
import { resolveProvider, instantiate } from './providers/resolver.ts'
import { runSetupWizard } from './providers/setup.ts'

function collect(val: string, acc: string[]): string[] {
  acc.push(val)
  return acc
}

program
  .name('hex')
  .description('The queen bee of AI coding agents')
  .version('0.1.0')

// Default command: hex "do something"
program
  .argument('[prompt]', 'What to do')
  .option('--budget <usd>', 'Max spend in USD', parseFloat)
  .option('--max-turns <n>', 'Max agent turns', parseInt, 50)
  .option('--provider <id>', 'Provider to use (overrides default)')
  .option('--model <model>', 'Model to use (overrides provider default)')
  .option('--no-scan', 'Skip dictionary scan on startup')
  .option('--no-tests', 'Skip sandbox test runner')
  .action(async (prompt: string | undefined, opts: { budget?: number; maxTurns: number; provider?: string; model?: string; scan: boolean }) => {
    const { render } = await import('ink')
    const React = await import('react')
    const { HexRepl } = await import('./repl/HexRepl.tsx')

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
    }

    const instance = render(
      React.createElement(HexRepl, {
        initialPrompt: prompt,
        budgetUsd: opts.budget,
        maxTurns: opts.maxTurns,
        cwd: process.cwd(),
      }),
      { stdin: process.stdin, stdout: process.stdout },
    )
    await instance.waitUntilExit()
  })

// hex repl
program
  .command('repl')
  .description('Start interactive REPL (same as running hex with no args)')
  .option('--budget <usd>', 'Max spend in USD', parseFloat)
  .option('--max-turns <n>', 'Max agent turns', parseInt, 50)
  .action(async (opts: { budget?: number; maxTurns: number }) => {
    const { render } = await import('ink')
    const React = await import('react')
    const { HexRepl } = await import('./repl/HexRepl.tsx')

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
    }

    const instance = render(
      React.createElement(HexRepl, {
        budgetUsd: opts.budget,
        maxTurns: opts.maxTurns,
        cwd: process.cwd(),
      }),
      { stdin: process.stdin, stdout: process.stdout },
    )
    await instance.waitUntilExit()
  })

// hex swarm
program
  .command('swarm')
  .description('Run multiple agents in parallel on the same codebase')
  .requiredOption('--goal <goal>', 'The overall goal of the swarm')
  .option('--agent <spec>', 'Agent spec: "name: task" (repeatable)', collect, [])
  .option('--budget <usd>', 'Max total spend in USD', parseFloat)
  .option('--max-turns <n>', 'Max turns per agent', parseInt, 50)
  .action(async (opts: { goal: string; agent: string[]; budget?: number; maxTurns: number }) => {
    if (opts.agent.length === 0) {
      console.error(chalk.red('At least one --agent is required'))
      process.exit(1)
    }

    const agents = opts.agent.map((spec) => {
      const colonIdx = spec.indexOf(':')
      if (colonIdx === -1) {
        console.error(chalk.red(`Invalid agent spec: "${spec}". Format: "name: task"`))
        process.exit(1)
      }
      return {
        name: spec.slice(0, colonIdx).trim(),
        task: spec.slice(colonIdx + 1).trim(),
      }
    })

    console.log(chalk.cyan(`\u2B21 Starting swarm with ${agents.length} agents`))

    const result = await runSwarm({
      goal: opts.goal,
      agents,
      budgetUsd: opts.budget ?? Infinity,
      maxTurnsPerAgent: opts.maxTurns,
    })

    console.log('\n' + chalk.cyan('\u2B21 Swarm complete'))
    console.log(result.orchestratorSummary)
    console.log(chalk.gray(`Total cost: $${result.totalCostUsd.toFixed(4)}`))

    const hasConflicts = [...result.mergeResults.values()].some(r => r === 'conflict')
    if (hasConflicts) {
      console.log(chalk.yellow('\n\u26A0 Some merges had conflicts. Resolve manually then commit.'))
    }
  })

// hex inspect
program
  .command('inspect')
  .description('Start visual web inspector')
  .option('--port <n>', 'Your dev server port', parseInt, 3000)
  .option('--hex-port <n>', 'Hex proxy port', parseInt, 4000)
  .action(async (opts: { port: number; hexPort: number }) => {
    const dict = new DictManager()
    await dict.load()
    const codec = new HexCodec(dict)
    const manifest = new HexManifest()
    await manifest.load()

    console.log(chalk.cyan('\u2B21 Injecting hex IDs...'))
    const count = await injectDirectory(process.cwd(), manifest, dict)
    await manifest.save()
    console.log(chalk.gray(`  Injected ${count} elements`))

    const server = new HexDevServer({
      targetPort: opts.port,
      hexPort: opts.hexPort,
      manifest,
      dict,
      codec,
      onPrompt: async (hexIds, prompt) => {
        console.log(chalk.cyan(`\n\u2B21 Inspector prompt: ${prompt}`))
        const locations = hexIds
          .map(h => manifest.getById(h.hexId))
          .filter(Boolean)
          .map(e => `${e!.file}:${e!.line}`)
          .join(', ')

        const agentPrompt = `The user visually selected these elements: ${locations}\n\nThey want you to: ${prompt}\n\nFocus ONLY on the selected elements and their styles. Do not touch unrelated code.`

        const env = await detect()
        const budget = new BudgetTracker()
        const loopDetector = new LoopDetector()

        await runAgent({
          prompt: agentPrompt,
          systemPrompt: buildSystemPrompt({ env, dict, codec, mode: 'standard' }),
          cwd: process.cwd(),
          dict,
          codec,
          budget,
          loopDetector,
          onToken: (text) => server.broadcast({ type: 'agent-token', text }),
        })
      },
    })

    server.start()
  })

// hex scan
program
  .command('scan')
  .description('Scan project and rebuild HCP dictionary')
  .action(async () => {
    const dict = new DictManager()
    console.log(chalk.cyan('\u2B21 Scanning project...'))
    const result = await scan(process.cwd(), dict)
    await dict.save()
    console.log(chalk.green(`\u2713 ${result.filesRegistered} files, ${result.symbolsRegistered} symbols registered`))
    console.log(chalk.gray(`Dictionary: .hex/dictionary.json (${dict.stats().sizeKb}kb)`))
  })

// hex budget
program
  .command('budget')
  .description('Show cost log for all sessions')
  .action(async () => {
    try {
      const log = await Bun.file('.hex/cost-log.json').text()
      const lines = log.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

      console.log(chalk.cyan('\u2B21 Hex Cost Log'))
      console.log(chalk.gray('\u2500'.repeat(60)))

      let totalCost = 0
      for (const record of lines) {
        totalCost += record.costUsd ?? 0
        console.log(
          chalk.white(record.timestamp?.slice(0, 19) ?? 'unknown') +
          chalk.gray(' | ') +
          chalk.yellow(`$${(record.costUsd ?? 0).toFixed(4)}`) +
          chalk.gray(' | ') +
          chalk.white(record.agentName ?? 'unknown'),
        )
      }

      console.log(chalk.gray('\u2500'.repeat(60)))
      console.log(chalk.white(`Total: `) + chalk.yellow(`$${totalCost.toFixed(4)}`))
    } catch {
      console.log(chalk.gray('No cost log found. Run hex to start tracking.'))
    }
  })

// hex provider
const providerCmd = program.command('provider').description('Manage AI providers')

providerCmd
  .command('add')
  .description('Add a new AI provider')
  .action(async () => {
    const registry = new ProviderRegistry()
    await registry.load()
    await runSetupWizard(registry)
  })

providerCmd
  .command('list')
  .description('List all configured providers')
  .action(async () => {
    const registry = new ProviderRegistry()
    await registry.load()
    const all = registry.getAll()

    if (all.length === 0) {
      console.log(chalk.gray('No providers configured. Run: hex provider add'))
      return
    }

    const defaultConfig = registry.getDefault()
    console.log(chalk.cyan('\n\u2B21 Configured Providers\n'))

    for (const p of all) {
      const isDefault = p.id === defaultConfig?.id
      const icon = p.kind.includes('claude') ? '\u2B21' : p.kind === 'openai' ? '\u25C6' : p.kind === 'gemini' ? '\u2726' : '\u2B1F'
      console.log(
        `${icon} ${chalk.white(p.id)}` +
        (isDefault ? chalk.cyan(' [default]') : '') +
        chalk.gray(` \u00B7 ${p.kind} \u00B7 ${p.model}`),
      )
      if (p.lastUsedAt) {
        console.log(chalk.gray(`    Last used: ${new Date(p.lastUsedAt).toLocaleDateString()}`))
      }
    }
    console.log()
  })

providerCmd
  .command('use <id>')
  .description('Set a provider as default')
  .action(async (id: string) => {
    const registry = new ProviderRegistry()
    await registry.load()
    if (!registry.setDefault(id)) {
      console.log(chalk.red(`Provider not found: ${id}`))
      process.exit(1)
    }
    await registry.saveGlobal()
    console.log(chalk.green(`\u2713 Default provider set to: ${id}`))
  })

providerCmd
  .command('remove <id>')
  .description('Remove a provider')
  .action(async (id: string) => {
    const registry = new ProviderRegistry()
    await registry.load()
    if (!registry.remove(id)) {
      console.log(chalk.red(`Provider not found: ${id}`))
      process.exit(1)
    }
    await registry.saveGlobal()
    console.log(chalk.green(`\u2713 Removed provider: ${id}`))
  })

providerCmd
  .command('test [id]')
  .description('Test a provider connection')
  .action(async (id?: string) => {
    const registry = new ProviderRegistry()
    await registry.load()
    const config = id ? registry.getById(id) : registry.getDefault()

    if (!config) {
      console.log(chalk.red('No provider found.'))
      process.exit(1)
    }

    console.log(chalk.cyan(`\u27F3 Testing ${config.label}...`))
    const provider = instantiate(config, registry)
    const result = await provider.isAvailable()

    if (result.available) {
      console.log(chalk.green(`\u2713 Connected! Latency: ${result.latencyMs}ms`))
      const models = await provider.models()
      console.log(chalk.gray('\nAvailable models:'))
      models.slice(0, 5).forEach(m =>
        console.log(chalk.gray(`  \u00B7 ${m.displayName} (${m.contextWindow.toLocaleString()} ctx)`)),
      )
    } else {
      console.log(chalk.red(`\u2717 Failed: ${result.reason}`))
      process.exit(1)
    }
  })

providerCmd
  .command('models [id]')
  .description('List available models for a provider')
  .action(async (id?: string) => {
    const registry = new ProviderRegistry()
    await registry.load()
    const config = id ? registry.getById(id) : registry.getDefault()
    if (!config) { console.log(chalk.red('No provider found.')); return }

    const p = instantiate(config, registry)
    const models = await p.models()

    console.log(chalk.cyan(`\n\u2B21 Models for ${config.label}\n`))
    for (const m of models) {
      const cost = m.inputCostPer1M !== undefined && m.inputCostPer1M > 0
        ? chalk.gray(` \u00B7 $${m.inputCostPer1M}/M in \u00B7 $${m.outputCostPer1M}/M out`)
        : chalk.green(' \u00B7 free')
      const flags = [m.supportsTools ? 'tools' : '', m.supportsVision ? 'vision' : ''].filter(Boolean).join('+')
      console.log(chalk.white(m.id) + chalk.gray(` \u00B7 ${(m.contextWindow / 1000).toFixed(0)}k ctx \u00B7 ${flags}`) + cost)
    }
    console.log()
  })

program.parse()
