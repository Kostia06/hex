// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React, { useState, useEffect, memo } from 'react'
import { Box, Text, useInput } from 'ink'
import { Spinner } from './Spinner.tsx'
import { SLASH_COMMANDS } from './SlashMenu.tsx'

interface InputBarProps {
  isStreaming: boolean
  onSubmit: (value: string) => void
  onSlashCommand: (cmd: string) => void
  onSlashDetect: (isSlash: boolean, filter: string) => void
  historyUp: () => string | null
  historyDown: () => string | null
}

export const InputBar = memo(function InputBar({
  isStreaming, onSubmit, onSlashCommand, onSlashDetect,
  historyUp, historyDown,
}: InputBarProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (key.escape) {
      if (isStreaming) { onSubmit('__ESC__'); return }
      if (value) { setValue(''); setCursor(0); onSlashDetect(false, ''); return }
      return
    }

    if (key.ctrl && input === 'c') { onSubmit('__INTERRUPT__'); return }

    // While streaming: allow typing + Enter to queue
    if (isStreaming) {
      if (key.return && value.trim()) {
        onSubmit(value.trim())
        setValue(''); setCursor(0)
        return
      }
      if (!key.ctrl && !key.meta && input.length > 0) {
        const chars = [...value]; chars.splice(cursor, 0, ...input)
        const nv = chars.join(''); setValue(nv); setCursor(c => c + [...input].length)
      }
      if (key.backspace && cursor > 0) {
        const chars = [...value]; chars.splice(cursor - 1, 1)
        setValue(chars.join('')); setCursor(c => Math.max(0, c - 1))
      }
      return
    }

    if (key.return) {
      if (value.trim().startsWith('/')) onSlashCommand(value.trim().slice(1))
      else if (value.trim()) onSubmit(value.trim())
      setValue(''); setCursor(0); onSlashDetect(false, '')
      return
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const chars = [...value]; chars.splice(cursor - 1, 1)
        const nv = chars.join(''); setValue(nv); setCursor(c => Math.max(0, c - 1))
        onSlashDetect(nv.startsWith('/'), nv.slice(1))
      }
      return
    }

    if (key.leftArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.rightArrow) { setCursor(c => Math.min([...value].length, c + 1)); return }

    if (key.upArrow) {
      const prev = historyUp()
      if (prev !== null) { setValue(prev); setCursor([...prev].length) }
      return
    }
    if (key.downArrow) {
      const next = historyDown()
      if (next !== null) { setValue(next); setCursor([...next].length) }
      return
    }

    if (key.tab) {
      if (value.startsWith('/')) {
        const filter = value.slice(1).toLowerCase()
        const match = SLASH_COMMANDS.find(c => c.name.startsWith(filter))
        if (match) {
          const completed = '/' + match.name + ' '
          setValue(completed); setCursor([...completed].length)
          onSlashDetect(true, match.name)
        }
      }
      return
    }

    if (key.ctrl && input === 'u') { setValue(''); setCursor(0); onSlashDetect(false, ''); return }

    if (!key.ctrl && !key.meta && input.length > 0) {
      const chars = [...value]; chars.splice(cursor, 0, ...input)
      const nv = chars.join(''); setValue(nv); setCursor(c => c + [...input].length)
      if (nv.startsWith('/')) onSlashDetect(true, nv.slice(1))
      else onSlashDetect(false, '')
    }
  })

  if (isStreaming && !value) {
    return (
      <Box paddingX={1}>
        <Spinner color="yellow" />
      </Box>
    )
  }

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
})
