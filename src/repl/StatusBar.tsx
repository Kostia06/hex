// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React from 'react'
import { Box, Text } from 'ink'

interface StatusBarProps {
  model: string
  branch: string
  gitClean: boolean
  sessionCostUsd: number
  totalTurns: number
  isStreaming: boolean
  mode: string
  cwd: string
}

export function StatusBar({
  model, branch, gitClean, sessionCostUsd,
  totalTurns, isStreaming, mode, cwd,
}: StatusBarProps) {
  const projectName = cwd.split('/').at(-1) ?? cwd
  const branchColor = gitClean ? 'green' : 'yellow'
  const modelShort = model.replace('claude-', '').replace(/-\d{8}$/, '')

  return (
    <Box paddingX={1} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" gap={1}>
        <Text color="yellow" bold>{'\u2B21'}</Text>
        <Text dimColor>{projectName}</Text>
        <Text dimColor color={branchColor}>{branch}</Text>
        {isStreaming && <Text color="yellow">{'\u25CF'}</Text>}
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{modelShort}</Text>
        {sessionCostUsd > 0 && <Text dimColor>${sessionCostUsd.toFixed(4)}</Text>}
      </Box>
    </Box>
  )
}
