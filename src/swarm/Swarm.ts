// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import { detect } from '../env/EnvDetector.ts'
import { DictManager } from '../codec/dictionary/DictManager.ts'
import { HexCodec } from '../codec/HexCodec.ts'
import { scrub } from '../security/Scrubber.ts'
import { BudgetTracker } from '../budget/BudgetTracker.ts'
import { LoopDetector } from '../budget/LoopDetector.ts'
import { WorktreeManager } from './WorktreeManager.ts'
import { buildSystemPrompt } from '../agent/prompts.ts'
import { runAgent, type AgentResult } from '../agent/AgentLoop.ts'
import type { AgentBar } from '../budget/CostDashboard.tsx'

export interface SwarmAgent {
  name: string
  task: string
}

export interface SwarmOptions {
  goal: string
  agents: SwarmAgent[]
  budgetUsd?: number
  maxTurnsPerAgent?: number
  cwd?: string
}

export interface SwarmResult {
  success: boolean
  agentResults: Map<string, AgentResult>
  mergeResults: Map<string, 'ok' | 'conflict'>
  orchestratorSummary: string
  totalCostUsd: number
}

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const cwd = opts.cwd ?? process.cwd()
  const dict = new DictManager(cwd)
  await dict.load()

  const codec = new HexCodec(dict)
  const env = await detect()
  const budget = new BudgetTracker(opts.budgetUsd)
  const worktreeManager = new WorktreeManager(cwd)
  const maxTurns = opts.maxTurnsPerAgent ?? 50

  const agentBars = new Map<string, AgentBar>()
  for (const a of opts.agents) {
    agentBars.set(a.name, {
      name: a.name,
      costUsd: 0,
      turns: 0,
      status: 'waiting',
      maxTurns,
    })
  }

  // Create all worktrees
  const worktrees = await Promise.all(
    opts.agents.map(a => worktreeManager.create(a.name)),
  )

  // Run all agents in parallel
  const agentPromises = opts.agents.map(async (agent) => {
    const wt = worktrees.find(w => w.agentName === agent.name)!

    const bar = agentBars.get(agent.name)!
    bar.status = 'running'

    const systemPrompt = buildSystemPrompt({
      env,
      dict,
      codec,
      mode: 'swarm-agent',
      agentName: agent.name,
      agentTask: agent.task,
      goal: opts.goal,
      relevantFiles: [],
    })

    const loopDetector = new LoopDetector(maxTurns)

    const result = await runAgent({
      prompt: codec.encode(agent.task),
      systemPrompt,
      cwd: wt.path,
      dict,
      codec,
      budget,
      loopDetector,
      maxTurns,
      onToken: (text) => {
        bar.currentAction = text.slice(0, 50)
      },
      onTurnComplete: (turn) => {
        bar.turns = turn
        bar.costUsd = budget.getAgentCosts().find(c => c.agentName === agent.name)?.costUsd ?? 0
      },
    })

    bar.status = result.success ? 'done' : 'failed'
    return { agent, result }
  })

  const agentOutcomes = await Promise.all(agentPromises)

  // Run orchestrator
  const orchestratorInput = agentOutcomes
    .map(({ agent, result }) =>
      `=== Agent: ${agent.name} ===\nTask: ${agent.task}\nOutput:\n${result.finalText}`,
    )
    .join('\n\n')

  const orchestratorResult = await runAgent({
    prompt: orchestratorInput,
    systemPrompt: buildSystemPrompt({
      env, dict, codec,
      mode: 'swarm-orchestrator',
      goal: opts.goal,
    }),
    cwd,
    dict,
    codec,
    budget,
    loopDetector: new LoopDetector(10),
    maxTurns: 10,
    onToken: (text) => process.stdout.write(text),
  })

  // Parse merge order from orchestrator output
  const mergeOrderMatch = orchestratorResult.finalText.match(/MERGE_ORDER:\s*(.+)/i)
  const mergeOrder = mergeOrderMatch?.[1]?.split(',').map(s => s.trim())
    ?? opts.agents.map(a => a.name)

  // Merge worktrees
  const mergeResults = await worktreeManager.mergeAll(mergeOrder)

  // Cleanup
  try {
    await worktreeManager.cleanup()
    await dict.save()
    await budget.save()
  } catch { /* cleanup failures are non-fatal */ }

  return {
    success: agentOutcomes.every(o => o.result.success),
    agentResults: new Map(agentOutcomes.map(o => [o.agent.name, o.result])),
    mergeResults,
    orchestratorSummary: orchestratorResult.finalText,
    totalCostUsd: budget.totalCost,
  }
}
