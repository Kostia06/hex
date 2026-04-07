// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React, { useMemo, memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { Message } from './Message.tsx'
import { WelcomeScreen } from './WelcomeScreen.tsx'
import type { HexMessage } from './replState.ts'

function estimateLines(msg: HexMessage, cols: number): number {
  const textCols = Math.max(cols - 10, 20)
  if (msg.role === 'system' || msg.role === 'error') return 1
  if (msg.role === 'user') return Math.max(1, Math.ceil(msg.content.length / textCols))
  const contentLines = msg.content.split('\n').length
  const toolLines = msg.toolCalls.length
  const costLine = msg.streaming ? 0 : 1
  return contentLines + toolLines + costLine + 1
}

export const MessageList = memo(function MessageList({ messages }: { messages: HexMessage[] }) {
  const { stdout } = useStdout()
  const rows = stdout.rows ?? 24
  const cols = stdout.columns ?? 80
  const availableLines = rows - 7

  const visibleMessages = useMemo(() => {
    let lineCount = 0
    const result: HexMessage[] = []

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!
      const est = estimateLines(msg, cols)
      if (lineCount + est > availableLines && result.length > 0) break
      result.unshift(msg)
      lineCount += est
    }

    return result
  }, [messages, availableLines, cols])

  const hasConversation = messages.some(m => m.role === 'user' || m.role === 'assistant')

  if (!hasConversation) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <WelcomeScreen />
      </Box>
    )
  }

  const hiddenCount = messages.length - visibleMessages.length

  return (
    <Box flexDirection="column" flexGrow={1} paddingY={0}>
      {hiddenCount > 0 && (
        <Box paddingLeft={2}>
          <Text color="yellow" dimColor>{'\u2191'} {hiddenCount} earlier</Text>
        </Box>
      )}
      {visibleMessages.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
    </Box>
  )
})
