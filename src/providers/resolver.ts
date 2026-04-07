// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import type { HexProvider, ProviderConfig } from './types.ts'
import { ClaudeCLIProvider } from './adapters/ClaudeCLIProvider.ts'
import { ClaudeAPIProvider } from './adapters/ClaudeAPIProvider.ts'
import { OpenAIProvider } from './adapters/OpenAIProvider.ts'
import { GeminiProvider } from './adapters/GeminiProvider.ts'
import { OllamaProvider } from './adapters/OllamaProvider.ts'
import type { ProviderRegistry } from './registry.ts'

export interface ResolveOptions {
  providerId?: string
  providerKind?: string
  model?: string
}

export async function resolveProvider(
  registry: ProviderRegistry,
  opts: ResolveOptions = {},
): Promise<HexProvider> {
  let config: ProviderConfig | null = null

  if (opts.providerId) {
    config = registry.getById(opts.providerId)
    if (!config) throw new Error(`Provider not found: ${opts.providerId}`)
  } else {
    config = registry.getDefault()
    if (!config) throw new Error('No provider configured. Run: hex provider add')
  }

  if (opts.model) {
    config = { ...config, model: opts.model }
  }

  return instantiate(config, registry)
}

export function instantiate(config: ProviderConfig, registry: ProviderRegistry): HexProvider {
  const decryptedConfig = config.apiKey
    ? { ...config, apiKey: registry.decryptKey(config.apiKey) }
    : config

  switch (config.kind) {
    case 'claude-cli': return new ClaudeCLIProvider(decryptedConfig)
    case 'claude-api': return new ClaudeAPIProvider(decryptedConfig)
    case 'openai': return new OpenAIProvider(decryptedConfig)
    case 'gemini': return new GeminiProvider(decryptedConfig)
    case 'ollama': return new OllamaProvider(decryptedConfig)
    default: throw new Error(`Unknown provider kind: ${config.kind}`)
  }
}
