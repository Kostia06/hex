// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React from 'react'
import { Box, Text, useInput } from 'ink'
import { CostDashboard, type AgentBar } from '../budget/CostDashboard.tsx'
import type { BudgetTracker } from '../budget/BudgetTracker.ts'

interface SwarmUIProps {
  agents: AgentBar[]
  goal: string
  budget: BudgetTracker
  startTime: number
  onAbort: () => void
}

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

function AgentPanel({ agent }: { agent: AgentBar }) {
  const color = STATUS_COLOR[agent.status]
  const icon = STATUS_ICON[agent.status]

  return (
    <Box borderStyle="single" borderColor={color} paddingX={1} marginBottom={0}>
      <Text color={color} bold>{icon} {agent.name.padEnd(10)}</Text>
      <Text color="gray">{agent.currentAction?.slice(0, 50) ?? 'Initializing...'}</Text>
      <Box marginLeft={1}>
        <Text color="yellow">${agent.costUsd.toFixed(4)}</Text>
        <Text color="gray"> {agent.turns}/{agent.maxTurns}</Text>
      </Box>
    </Box>
  )
}

export function SwarmUI({ agents, goal, budget, startTime, onAbort }: SwarmUIProps) {
  useInput((input) => {
    if (input === 'q' || input === '\x03') onAbort()
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="cyan" bold>{'\u2B21'} Hex Swarm  </Text>
        <Text color="gray">{goal.slice(0, 60)}{goal.length > 60 ? '...' : ''}</Text>
      </Box>

      <Box marginY={1} flexDirection="column">
        {agents.map(agent => <AgentPanel key={agent.name} agent={agent} />)}
      </Box>

      <CostDashboard
        agents={agents}
        totalCost={budget.totalCost}
        budgetUsd={budget.budgetUsd}
        elapsedMs={Date.now() - startTime}
      />

      <Text color="gray" dimColor>Press q to abort swarm</Text>
    </Box>
  )
}
