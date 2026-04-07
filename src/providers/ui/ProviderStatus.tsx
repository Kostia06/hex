// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React from 'react'
import { Text } from 'ink'
import type { ProviderConfig } from '../types.ts'

interface ProviderStatusProps {
  config: ProviderConfig
  isStreaming: boolean
}

const KIND_ICONS: Record<string, string> = {
  'claude-cli': '\u2B21',
  'claude-api': '\u2B21',
  'openai': '\u25C6',
  'gemini': '\u2726',
  'ollama': '\u2B1F',
}

const KIND_COLORS: Record<string, string> = {
  'claude-cli': 'cyan',
  'claude-api': 'cyan',
  'openai': 'green',
  'gemini': 'blue',
  'ollama': 'magenta',
}

export function ProviderStatus({ config, isStreaming }: ProviderStatusProps) {
  const icon = KIND_ICONS[config.kind] ?? '?'
  const color = KIND_COLORS[config.kind] ?? 'white'
  const modelShort = config.model
    .replace('claude-', '')
    .replace('gpt-', '')
    .replace('gemini-', '')
    .replace('-20251001', '')
    .replace('-4-6', '4.6')

  return (
    <Text color={color}>
      {isStreaming ? '\u27F3' : icon} {modelShort}
    </Text>
  )
}
