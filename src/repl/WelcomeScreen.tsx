// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React from 'react'
import { Box, Text } from 'ink'

export function WelcomeScreen() {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text color="yellow" bold>{'\u2B21'} hex</Text>
      <Text dimColor>Type a prompt to start, /help for commands</Text>
    </Box>
  )
}
