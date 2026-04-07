// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import * as readline from 'node:readline/promises'
import chalk from 'chalk'
import type { ProviderConfig, ProviderKind } from './types.ts'
import { ProviderRegistry } from './registry.ts'
import { instantiate } from './resolver.ts'

interface MenuItem {
  kind: ProviderKind
  label: string
  desc: string
  isCustomEndpoint?: boolean
}

const MENU: MenuItem[] = [
  { kind: 'claude-cli', label: 'Claude Code CLI', desc: 'Uses your subscription \u2014 free, no API key' },
  { kind: 'claude-api', label: 'Claude API', desc: 'Anthropic API key \u2014 pay per token' },
  { kind: 'openai', label: 'OpenAI / ChatGPT', desc: 'GPT-4o, o3, o4-mini \u2014 requires API key' },
  { kind: 'openai', label: 'OpenAI-compatible endpoint', desc: 'Together, Groq, OpenRouter, LM Studio, etc', isCustomEndpoint: true },
  { kind: 'gemini', label: 'Google Gemini', desc: 'Gemini 2.5 Pro/Flash \u2014 requires API key' },
  { kind: 'ollama', label: 'Ollama (local)', desc: 'Run models locally \u2014 no API key, fully offline' },
]

const DEFAULT_MODELS: Record<ProviderKind, string> = {
  'claude-cli': 'claude-sonnet-4-6',
  'claude-api': 'claude-sonnet-4-6',
  'openai': 'gpt-4o',
  'gemini': 'gemini-2.5-flash',
  'ollama': 'llama3',
}

export async function runSetupWizard(registry: ProviderRegistry): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log(chalk.cyan('\n\u2B21 Hex \u2014 Provider Setup\n'))
  console.log('Hex needs at least one AI provider to work.')
  console.log('You can add more later with: hex provider add\n')

  MENU.forEach((item, i) => {
    console.log(`  ${chalk.cyan(i + 1)}  ${chalk.white(item.label)}`)
    console.log(`     ${chalk.gray(item.desc)}`)
  })

  console.log()
  const choice = await rl.question(chalk.cyan('Pick a provider (1-6): '))
  const idx = parseInt(choice.trim()) - 1

  if (idx < 0 || idx >= MENU.length) {
    console.log(chalk.red('Invalid choice.'))
    rl.close()
    return
  }

  const selected = MENU[idx]!
  const config = await gatherConfig(selected, rl, registry)

  if (!config) {
    rl.close()
    return
  }

  console.log(chalk.cyan('\n\u27F3 Testing connection...'))
  const provider = instantiate(config, registry)
  const result = await provider.isAvailable()

  if (!result.available) {
    console.log(chalk.red(`\u2717 Connection failed: ${result.reason}`))
    console.log(chalk.gray('Provider saved anyway. Fix the issue and run: hex provider test'))
  } else {
    console.log(chalk.green(`\u2713 Connected! Latency: ${result.latencyMs}ms`))
  }

  registry.add(config)
  await registry.saveGlobal()
  console.log(chalk.green(`\n\u2713 Provider "${config.label}" added as default.`))
  console.log(chalk.gray('Manage providers: hex provider list\n'))

  rl.close()
}

async function pickModel(models: string[], rl: readline.Interface): Promise<string> {
  console.log(chalk.gray('\nAvailable models:'))
  models.forEach((m, i) => console.log(`  ${chalk.cyan(i + 1)}  ${m}`))
  const choice = await rl.question(chalk.cyan('Pick a model [1]: '))
  const idx = parseInt(choice.trim() || '1') - 1
  return models[Math.max(0, Math.min(idx, models.length - 1))] ?? models[0]!
}

async function gatherConfig(
  item: MenuItem,
  rl: readline.Interface,
  registry: ProviderRegistry,
): Promise<ProviderConfig | null> {
  const id = (await rl.question(chalk.cyan('\nName this provider (e.g. "my-claude"): ')))
    || item.label.toLowerCase().replace(/\s+/g, '-')

  let apiKey: string | undefined
  let baseUrl: string | undefined
  let model = DEFAULT_MODELS[item.kind]

  switch (item.kind) {
    case 'claude-cli': {
      const which = Bun.spawnSync(['which', 'claude'])
      if (which.exitCode !== 0) {
        console.log(chalk.yellow('\n\u26A0 `claude` CLI not found.'))
        console.log('Install it: curl -fsSL https://claude.ai/install.sh | sh')
        return null
      }
      break
    }

    case 'claude-api': {
      apiKey = await rl.question(chalk.cyan('Anthropic API key (sk-ant-...): '))
      if (!apiKey.startsWith('sk-ant-')) {
        console.log(chalk.red('Invalid Anthropic API key format.'))
        return null
      }
      model = await pickModel(['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'], rl)
      break
    }

    case 'openai': {
      if (item.isCustomEndpoint) {
        baseUrl = await rl.question(chalk.cyan('Base URL (e.g. https://api.together.xyz/v1): '))
        apiKey = await rl.question(chalk.cyan('API key: '))
        model = await rl.question(chalk.cyan('Default model ID: '))
      } else {
        apiKey = await rl.question(chalk.cyan('OpenAI API key (sk-...): '))
        if (!apiKey.startsWith('sk-')) {
          console.log(chalk.red('Invalid OpenAI API key format.'))
          return null
        }
        model = await pickModel(['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'], rl)
      }
      break
    }

    case 'gemini': {
      apiKey = await rl.question(chalk.cyan('Google AI API key (AIza...): '))
      if (!apiKey.startsWith('AIza')) {
        console.log(chalk.red('Invalid Gemini API key format.'))
        return null
      }
      model = await pickModel(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'], rl)
      break
    }

    case 'ollama': {
      const defaultUrl = 'http://localhost:11434'
      const customUrl = await rl.question(chalk.cyan(`Ollama URL [${defaultUrl}]: `))
      baseUrl = (customUrl.trim() || defaultUrl) + '/v1'

      try {
        const resp = await fetch(`${baseUrl.replace('/v1', '')}/api/tags`)
        const data = await resp.json() as { models: Array<{ name: string }> }
        const names = data.models.map(m => m.name)
        if (names.length === 0) {
          console.log(chalk.yellow('No models found. Pull one: ollama pull llama3'))
          return null
        }
        model = await pickModel(names, rl)
      } catch {
        model = await rl.question(chalk.cyan('Model name (e.g. llama3): '))
      }
      break
    }
  }

  return {
    id: id.trim() || `${item.kind}-${Date.now()}`,
    kind: item.kind,
    label: item.label,
    apiKey: apiKey ? registry.encryptKey(apiKey) : undefined,
    baseUrl,
    model,
    isDefault: true,
    addedAt: new Date().toISOString(),
  }
}
