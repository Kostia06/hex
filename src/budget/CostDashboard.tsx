// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React from 'react'
import { Box, Text } from 'ink'

export interface AgentBar {
  name: string
  costUsd: number
  turns: number
  status: 'running' | 'done' | 'failed' | 'waiting'
  maxTurns: number
  currentAction?: string
}

interface CostDashboardProps {
  agents: AgentBar[]
  totalCost: number
  budgetUsd: number
  elapsedMs: number
}

const BAR_WIDTH = 20

const STATUS_COLOR: Record<AgentBar['status'], string> = {
  running: 'cyan',
  done: 'green',
  failed: 'red',
  waiting: 'gray',
}

const STATUS_ICON: Record<AgentBar['status'], string> = {
  running: '\u27F3',
  done: '\u2713',
  failed: '\u2717',
  waiting: '\u00B7',
}

function AgentBarRow({ agent }: { agent: AgentBar }) {
  const pct = Math.min(agent.turns / agent.maxTurns, 1)
  const filled = Math.round(pct * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty)
  const color = STATUS_COLOR[agent.status]
  const icon = STATUS_ICON[agent.status]

  return (
    <Box>
      <Text color="white">{agent.name.padEnd(12)}</Text>
      <Text color={color}>{bar}</Text>
      <Text color="white"> {icon} </Text>
      <Text color="yellow">${agent.costUsd.toFixed(4)}</Text>
      <Text color="gray"> {agent.turns} turns</Text>
    </Box>
  )
}

export function CostDashboard({ agents, totalCost, budgetUsd, elapsedMs }: CostDashboardProps) {
  const budgetPct = budgetUsd < Infinity ? (totalCost / budgetUsd * 100).toFixed(0) : null
  const elapsed = (elapsedMs / 1000).toFixed(0)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>{'\u2B21'} Hex Swarm</Text>
      <Box marginTop={1} flexDirection="column">
        {agents.map(agent => <AgentBarRow key={agent.name} agent={agent} />)}
      </Box>
      <Box marginTop={1} borderStyle="single" borderColor="gray">
        <Text color="white">Total: </Text>
        <Text color="yellow">${totalCost.toFixed(4)}</Text>
        {budgetPct && <Text color="gray"> / ${budgetUsd.toFixed(2)} ({budgetPct}%)</Text>}
        <Text color="gray"> | {elapsed}s elapsed</Text>
      </Box>
    </Box>
  )
}
