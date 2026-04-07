// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React, { useState, useEffect, memo } from 'react'
import { Box, Text } from 'ink'
import { Spinner } from './Spinner.tsx'
import { DiffView } from './DiffView.tsx'
import type { HexMessage, ToolCall } from './replState.ts'

// Format tool input cleanly
function formatInput(tool: ToolCall): string {
  const i = tool.input
  if (typeof i['path'] === 'string') return i['path'] as string
  if (typeof i['file_path'] === 'string') return i['file_path'] as string
  if (typeof i['command'] === 'string') return (i['command'] as string).slice(0, 80)
  if (typeof i['pattern'] === 'string') return i['pattern'] as string
  if (typeof i['query'] === 'string') return i['query'] as string
  if (typeof i['url'] === 'string') return i['url'] as string
  const entries = Object.entries(i).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 40)).join(' ')
}

// Inline markdown: **bold** and `code`
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let rest = text, k = 0

  while (rest.length > 0) {
    const bold = rest.match(/^(.*?)\*\*(.+?)\*\*(.*)/)
    if (bold) {
      if (bold[1]) parts.push(<Text key={k++}>{bold[1]}</Text>)
      parts.push(<Text key={k++} bold>{bold[2]}</Text>)
      rest = bold[3]!; continue
    }
    const code = rest.match(/^(.*?)`(.+?)`(.*)/)
    if (code) {
      if (code[1]) parts.push(<Text key={k++}>{code[1]}</Text>)
      parts.push(<Text key={k++} color="yellow">{code[2]}</Text>)
      rest = code[3]!; continue
    }
    parts.push(<Text key={k++}>{rest}</Text>)
    break
  }
  return <>{parts}</>
}

const ToolCallLine = memo(function ToolCallLine({ tool }: { tool: ToolCall }) {
  const summary = formatInput(tool)
  const isBash = tool.name === 'Bash' || tool.name === 'bash'

  if (tool.status === 'running') {
    return (
      <Box>
        <Spinner color="#888" />
        <Text dimColor> {tool.name}</Text>
        {summary && <Text color={isBash ? 'white' : undefined} dimColor={!isBash}>  {summary}</Text>}
      </Box>
    )
  }

  // Check if result contains a diff
  let editDiff: { file: string; old: string; new: string } | null = null
  if (tool.result) {
    try {
      const parsed = JSON.parse(tool.result)
      if (parsed._hexEdit) editDiff = parsed
    } catch { /* not JSON */ }
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={tool.status === 'done' ? 'green' : 'red'}>{tool.status === 'done' ? '\u2713' : '\u2717'} </Text>
        <Text dimColor>{tool.name}</Text>
        {summary && <Text color={isBash ? 'white' : undefined} dimColor={!isBash}>  {summary}</Text>}
      </Box>
      {editDiff && <DiffView filePath={editDiff.file} oldStr={editDiff.old} newStr={editDiff.new} />}
    </Box>
  )
})

export const Message = memo(function Message({ message }: { message: HexMessage }) {
  const [cursorOn, setCursorOn] = useState(true)

  useEffect(() => {
    if (!message.streaming) return
    const t = setInterval(() => setCursorOn(v => !v), 530)
    return () => clearInterval(t)
  }, [message.streaming])

  switch (message.role) {
    case 'user':
      return (
        <Box paddingLeft={1} marginTop={1}>
          <Text color="yellow" bold>{'> '}</Text>
          <Text bold>{message.content}</Text>
        </Box>
      )

    case 'assistant': {
      const hasContent = message.content.length > 0
      const hasTools = message.toolCalls.length > 0
      const isThinking = message.streaming && !hasContent && !hasTools

      const lines = hasContent ? message.content.split('\n') : []
      let inCode = false

      return (
        <Box flexDirection="column" paddingLeft={3} marginTop={0}>
          {isThinking && <Spinner color="#888" label="thinking..." />}

          {hasTools && (
            <Box flexDirection="column">
              {message.toolCalls.map((tool, i) => (
                <ToolCallLine key={`${tool.name}-${i}`} tool={tool} />
              ))}
            </Box>
          )}

          {hasContent && (
            <Box flexDirection="column" marginTop={hasTools ? 1 : 0}>
              {lines.map((line, i) => {
                // Code fence
                if (line.startsWith('```')) {
                  inCode = !inCode
                  const lang = inCode ? line.slice(3).trim() : ''
                  return <Text key={i} dimColor>{inCode ? `\u250C\u2500 ${lang}` : '\u2514\u2500'}</Text>
                }
                // Inside code block
                if (inCode) {
                  return <Text key={i} color="#aaa">{`\u2502 ${line}`}</Text>
                }
                // Empty
                if (!line.trim()) return <Text key={i}> </Text>
                // List
                if (line.match(/^\s*-\s/)) {
                  return <Text key={i} wrap="wrap">  {'\u2022'} {renderInline(line.replace(/^\s*-\s+/, ''))}</Text>
                }
                // Header
                if (line.startsWith('# ')) return <Text key={i} bold>{line.slice(2)}</Text>
                if (line.startsWith('## ')) return <Text key={i} bold>{line.slice(3)}</Text>
                if (line.startsWith('### ')) return <Text key={i} bold dimColor>{line.slice(4)}</Text>
                // Normal text with cursor on last line if streaming
                const isLast = message.streaming && i === lines.length - 1
                return (
                  <Text key={i} wrap="wrap">
                    {renderInline(line)}
                    {isLast && <Text color="yellow">{cursorOn ? '\u2588' : ' '}</Text>}
                  </Text>
                )
              })}
            </Box>
          )}
        </Box>
      )
    }

    case 'system':
      return (
        <Box paddingLeft={1}>
          <Text dimColor>{message.content}</Text>
        </Box>
      )

    case 'error':
      return (
        <Box paddingLeft={1}>
          <Text color="red">{'\u2717'} {message.content}</Text>
        </Box>
      )

    default:
      return null
  }
})
