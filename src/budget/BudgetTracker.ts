// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import path from 'node:path'
import fs from 'node:fs'

export interface TokenRecord {
  agentName: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  timestamp: string
}

export interface AgentCost {
  agentName: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
}

const INPUT_COST_PER_1K = 0.003
const OUTPUT_COST_PER_1K = 0.015

export class BudgetTracker {
  private records: TokenRecord[] = []
  private agentCosts = new Map<string, AgentCost>()
  readonly budgetUsd: number

  constructor(budgetUsd = Infinity) {
    this.budgetUsd = budgetUsd
  }

  record(opts: { agentName: string; inputTokens: number; outputTokens: number; costUsd?: number }): void {
    const costUsd = opts.costUsd ?? (opts.inputTokens / 1000) * INPUT_COST_PER_1K + (opts.outputTokens / 1000) * OUTPUT_COST_PER_1K

    const record: TokenRecord = {
      agentName: opts.agentName,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    }
    this.records.push(record)

    const existing = this.agentCosts.get(opts.agentName)
    if (existing) {
      existing.inputTokens += opts.inputTokens
      existing.outputTokens += opts.outputTokens
      existing.costUsd += costUsd
      existing.turns++
    } else {
      this.agentCosts.set(opts.agentName, {
        agentName: opts.agentName,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        costUsd,
        turns: 1,
      })
    }
  }

  get totalCost(): number {
    let sum = 0
    for (const cost of this.agentCosts.values()) sum += cost.costUsd
    return sum
  }

  get totalInputTokens(): number {
    let sum = 0
    for (const cost of this.agentCosts.values()) sum += cost.inputTokens
    return sum
  }

  get totalOutputTokens(): number {
    let sum = 0
    for (const cost of this.agentCosts.values()) sum += cost.outputTokens
    return sum
  }

  get budgetRemaining(): number {
    return this.budgetUsd - this.totalCost
  }

  get budgetPercent(): number {
    if (this.budgetUsd === Infinity) return 0
    return Math.round((this.totalCost / this.budgetUsd) * 100)
  }

  isExceeded(): boolean {
    return this.totalCost >= this.budgetUsd
  }

  isWarning(): boolean {
    return this.totalCost >= this.budgetUsd * 0.8
  }

  getAgentCosts(): AgentCost[] {
    return [...this.agentCosts.values()]
  }

  async save(): Promise<void> {
    const logPath = path.join(process.cwd(), '.hex', 'cost-log.json')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })

    const lines = this.records.map(r => JSON.stringify(r)).join('\n')
    fs.appendFileSync(logPath, lines + '\n')
  }

  summary(): string {
    const input = this.totalInputTokens.toLocaleString()
    const output = this.totalOutputTokens.toLocaleString()
    const cost = this.totalCost.toFixed(4)

    if (this.budgetUsd === Infinity) {
      return `Total: $${cost} | Input: ${input} tok | Output: ${output} tok`
    }

    return `Total: $${cost} | Input: ${input} tok | Output: ${output} tok | Budget: $${cost}/$${this.budgetUsd.toFixed(2)} (${this.budgetPercent}%)`
  }
}
