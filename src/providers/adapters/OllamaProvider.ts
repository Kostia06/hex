// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import OpenAI from 'openai'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'
import { OpenAIProvider } from './OpenAIProvider.ts'

export class OllamaProvider implements HexProvider {
  readonly kind = 'ollama' as const
  private client: OpenAI
  private baseUrl: string

  constructor(readonly config: ProviderConfig) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434/v1'
    this.client = new OpenAI({ apiKey: 'ollama', baseURL: this.baseUrl })
  }

  async isAvailable(): Promise<AvailabilityResult> {
    try {
      const start = Date.now()
      const healthUrl = this.baseUrl.replace('/v1', '') + '/api/tags'
      const response = await fetch(healthUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { available: true, latencyMs: Date.now() - start }
    } catch {
      return { available: false, reason: `Ollama not reachable at ${this.baseUrl}. Run: ollama serve` }
    }
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const healthUrl = this.baseUrl.replace('/v1', '') + '/api/tags'
      const response = await fetch(healthUrl)
      const data = await response.json() as { models: Array<{ name: string; size: number }> }

      return data.models.map(m => ({
        id: m.name,
        displayName: `${m.name} (local \u00B7 ${(m.size / 1e9).toFixed(1)}GB)`,
        contextWindow: 32768,
        supportsTools: m.name.includes('mistral') || m.name.includes('llama3') || m.name.includes('qwen'),
        supportsVision: m.name.includes('vision') || m.name.includes('llava'),
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      }))
    } catch {
      return [{ id: this.config.model, displayName: this.config.model + ' (local)', contextWindow: 32768, supportsTools: false, supportsVision: false, inputCostPer1M: 0, outputCostPer1M: 0 }]
    }
  }

  async *stream(opts: StreamOptions): AsyncIterable<StreamEvent> {
    const openaiAdapter = new OpenAIProvider({
      ...this.config,
      kind: 'openai',
      baseUrl: this.baseUrl,
      apiKey: 'ollama',
    })
    yield* openaiAdapter.stream(opts)
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: opts.model ?? this.config.model,
      max_tokens: opts.maxTokens ?? 1000,
      messages: [
        ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
        { role: 'user' as const, content: opts.prompt },
      ],
    })
    return response.choices[0]?.message.content ?? ''
  }
}
