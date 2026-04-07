// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React, { useState, memo } from 'react'
import { Box, Text } from 'ink'

interface DiffViewProps {
  filePath: string
  oldStr: string
  newStr: string
}

function computeDiff(oldStr: string, newStr: string): Array<{ type: '+' | '-' | ' '; line: string }> {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const result: Array<{ type: '+' | '-' | ' '; line: string }> = []

  // Simple line-by-line diff using LCS-like approach
  let oi = 0, ni = 0
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: ' ', line: oldLines[oi]! })
      oi++; ni++
    } else if (ni < newLines.length && (oi >= oldLines.length || !oldLines.includes(newLines[ni]!))) {
      result.push({ type: '+', line: newLines[ni]! })
      ni++
    } else if (oi < oldLines.length) {
      result.push({ type: '-', line: oldLines[oi]! })
      oi++
    }
  }

  return result
}

export const DiffView = memo(function DiffView({ filePath, oldStr, newStr }: DiffViewProps) {
  const [collapsed, setCollapsed] = useState(false)
  const diff = computeDiff(oldStr, newStr)
  const added = diff.filter(d => d.type === '+').length
  const removed = diff.filter(d => d.type === '-').length

  // Only show changed lines + 2 lines of context
  const changedIndices = new Set<number>()
  diff.forEach((d, i) => {
    if (d.type !== ' ') {
      for (let j = Math.max(0, i - 2); j <= Math.min(diff.length - 1, i + 2); j++) {
        changedIndices.add(j)
      }
    }
  })

  const fileName = filePath.split('/').pop() ?? filePath

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box>
        <Text dimColor>{collapsed ? '\u25B8' : '\u25BE'} </Text>
        <Text color="yellow">{fileName}</Text>
        <Text color="green"> +{added}</Text>
        <Text color="red"> -{removed}</Text>
      </Box>

      {!collapsed && (
        <Box flexDirection="column" paddingLeft={2}>
          {diff.map((d, i) => {
            if (!changedIndices.has(i)) {
              // Show ellipsis for skipped context
              if (i > 0 && changedIndices.has(i - 1)) {
                return <Text key={i} dimColor>  ...</Text>
              }
              return null
            }

            if (d.type === '+') {
              return <Text key={i} color="green">+ {d.line}</Text>
            }
            if (d.type === '-') {
              return <Text key={i} color="red">- {d.line}</Text>
            }
            return <Text key={i} dimColor>  {d.line}</Text>
          })}
        </Box>
      )}
    </Box>
  )
})
