// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React from 'react'
import { Box, Text } from 'ink'

export interface SlashCommand {
  name: string
  description: string
  hint?: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Clear conversation history' },
  { name: 'cost', description: 'Show session cost breakdown' },
  { name: 'scan', description: 'Rescan project dictionary' },
  { name: 'swarm', description: 'Enter swarm mode', hint: '--goal "..." --agent "n: task"' },
  { name: 'inspect', description: 'Start visual web inspector', hint: '<port> [hex-port]' },
  { name: 'inspect-stop', description: 'Stop the web inspector' },
  { name: 'model', description: 'Switch model', hint: 'sonnet|opus|haiku' },
  { name: 'plan', description: 'Enter plan mode (read-only, proposes before acting)' },
  { name: 'auto', description: 'Enter auto mode (no confirmations)' },
  { name: 'compact', description: 'Compress conversation history to save tokens' },
  { name: 'dict', description: 'Show HCP dictionary stats' },
  { name: 'help', description: 'Show all commands' },
  { name: 'exit', description: 'Exit Hex REPL' },
]

interface SlashMenuProps {
  filter: string
  selectedIndex: number
}

export function SlashMenu({ filter, selectedIndex }: SlashMenuProps) {
  const filtered = SLASH_COMMANDS
    .filter(cmd => cmd.name.startsWith(filter.toLowerCase()))
    .slice(0, 6)

  if (filtered.length === 0) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="bold"
      borderColor="yellow"
      marginX={1}
      paddingX={1}
    >
      {filtered.map((cmd, i) => {
        const isSelected = i === selectedIndex % filtered.length
        return (
          <Box key={cmd.name} flexDirection="row" gap={1}>
            <Text color={isSelected ? 'yellow' : 'white'} bold={isSelected}>
              /{cmd.name}
            </Text>
            {cmd.hint && (
              <Text color="gray" dimColor>{cmd.hint}</Text>
            )}
            <Text color="gray" dimColor>  {cmd.description}</Text>
          </Box>
        )
      })}
      <Box marginTop={0}>
        <Text color="gray" dimColor>{'\u2191\u2193'} navigate {'\u00B7'} Tab/Enter select {'\u00B7'} Esc dismiss</Text>
      </Box>
    </Box>
  )
}
