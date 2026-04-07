// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { Spinner } from './Spinner.tsx'
import { SLASH_COMMANDS } from './SlashMenu.tsx'

interface InputBarProps {
  value: string
  isStreaming: boolean
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onSlashCommand: (cmd: string) => void
  historyUp: () => string | null
  historyDown: () => string | null
}

export function InputBar({
  value, isStreaming, onChange, onSubmit,
  onSlashCommand, historyUp, historyDown,
}: InputBarProps) {
  const [cursor, setCursor] = useState(value.length)

  useInput((input, key) => {
    // Esc: cancel streaming or clear input
    if (key.escape) {
      if (isStreaming) { onSubmit('__ESC__'); return }
      if (value) { onChange(''); setCursor(0); return }
      return
    }

    // Ctrl+C: interrupt
    if (key.ctrl && input === 'c') { onSubmit('__INTERRUPT__'); return }

    // While streaming: allow typing + Enter to queue
    if (isStreaming) {
      if (key.return && value.trim()) {
        onSubmit(value.trim())
        onChange(''); setCursor(0)
        return
      }
      // Allow typing into input while streaming
      if (!key.ctrl && !key.meta && input.length > 0) {
        const chars = [...value]; chars.splice(cursor, 0, ...input)
        onChange(chars.join('')); setCursor(c => c + [...input].length)
      }
      if (key.backspace && cursor > 0) {
        const chars = [...value]; chars.splice(cursor - 1, 1)
        onChange(chars.join('')); setCursor(c => Math.max(0, c - 1))
      }
      return
    }

    if (key.return) {
      if (value.trim().startsWith('/')) onSlashCommand(value.trim().slice(1))
      else if (value.trim()) onSubmit(value.trim())
      onChange(''); setCursor(0)
      return
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const chars = [...value]; chars.splice(cursor - 1, 1)
        onChange(chars.join('')); setCursor(c => Math.max(0, c - 1))
      }
      return
    }

    if (key.leftArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.rightArrow) { setCursor(c => Math.min([...value].length, c + 1)); return }

    if (key.upArrow) {
      const prev = historyUp()
      if (prev !== null) { onChange(prev); setCursor([...prev].length) }
      return
    }
    if (key.downArrow) {
      const next = historyDown()
      if (next !== null) { onChange(next); setCursor([...next].length) }
      return
    }

    if (key.tab) {
      if (value.startsWith('/')) {
        const filter = value.slice(1).toLowerCase()
        const match = SLASH_COMMANDS.find(c => c.name.startsWith(filter))
        if (match) {
          const completed = '/' + match.name + ' '
          onChange(completed)
          setCursor([...completed].length)
        }
      }
      return
    }
    if (key.ctrl && input === 'u') { onChange(''); setCursor(0); return }
    if (key.ctrl && input === 'c') { onSubmit('__INTERRUPT__'); return }

    if (!key.ctrl && !key.meta && input.length > 0) {
      const chars = [...value]; chars.splice(cursor, 0, ...input)
      onChange(chars.join('')); setCursor(c => c + [...input].length)
    }
  })

  const chars = [...value]
  const before = chars.slice(0, cursor).join('')
  const at = chars[cursor] ?? ' '
  const after = chars.slice(cursor + 1).join('')

  return (
    <Box paddingX={1}>
      {isStreaming
        ? <><Spinner color="yellow" /><Text> </Text></>
        : <Text color="yellow" bold>{'> '}</Text>
      }
      <Text>{before}</Text>
      <Text backgroundColor="white" color="black">{at}</Text>
      <Text>{after}</Text>
    </Box>
  )
}
