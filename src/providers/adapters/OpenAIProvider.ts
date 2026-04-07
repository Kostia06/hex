// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import OpenAI from 'openai'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'

export class OpenAIProvider implements HexProvider {
  readonly kind = 'openai' as const
  private client: OpenAI

  constructor(readonly config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'none',
      baseURL: config.baseUrl ?? 'https://api.openai.com/v1',
    })
  }

  async isAvailable(): Promise<AvailabilityResult> {
    try {
      const start = Date.now()
      await this.client.models.list()
      return { available: true, latencyMs: Date.now() - start }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { available: false, reason: msg.includes('401') ? 'Invalid API key' : msg }
    }
  }

  async models(): Promise<ModelInfo[]> {
    const known: ModelInfo[] = [
      { id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, supportsTools: true, supportsVision: true, inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', contextWindow: 128000, supportsTools: true, supportsVision: true, inputCostPer1M: 0.15, outputCostPer1M: 0.60 },
      { id: 'o3', displayName: 'OpenAI o3', contextWindow: 200000, supportsTools: true, supportsVision: false, inputCostPer1M: 10.00, outputCostPer1M: 40.00 },
      { id: 'o4-mini', displayName: 'OpenAI o4 Mini', contextWindow: 200000, supportsTools: true, supportsVision: true, inputCostPer1M: 1.10, outputCostPer1M: 4.40 },
    ]

    if (this.config.baseUrl && !this.config.baseUrl.includes('openai.com')) {
      try {
        const list = await this.client.models.list()
        const fetched: ModelInfo[] = []
        for await (const m of list) {
          fetched.push({ id: m.id, displayName: m.id, contextWindow: 128000, supportsTools: true, supportsVision: false })
        }
        return fetched
      } catch { /* fall through */ }
    }

    return known
  }

  async *stream(opts: StreamOptions): AsyncIterable<StreamEvent> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
      { role: 'user' as const, content: opts.prompt },
    ]

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = (opts.tools ?? []).map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))

    let turn = 0
    const maxTurns = opts.maxTurns ?? 50

    while (turn < maxTurns) {
      const streamResponse = await this.client.chat.completions.create({
        model: opts.model ?? this.config.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
        max_tokens: opts.maxTokens ?? 8192,
      })

      let assistantContent = ''
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
      let currentToolIdx = -1

      for await (const chunk of streamResponse) {
        const delta = chunk.choices[0]?.delta

        if (delta?.content) {
          assistantContent += delta.content
          opts.onToken?.(delta.content)
          yield { type: 'token', token: delta.content }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              currentToolIdx++
              toolCalls.push({ id: tc.id, name: tc.function?.name ?? '', arguments: '' })
            }
            const current = toolCalls[currentToolIdx]
            if (current && tc.function?.arguments) {
              current.arguments += tc.function.arguments
            }
          }
        }
      }

      const assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: 'assistant',
        content: assistantContent || null,
      }

      if (toolCalls.length > 0) {
        (assistantMessage as any).tool_calls = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))
      }

      messages.push(assistantMessage)
      turn++
      opts.onTurnComplete?.(turn)
      yield { type: 'turn_complete', turn }

      if (toolCalls.length === 0) break

      for (const tc of toolCalls) {
        let toolInput: Record<string, unknown> = {}
        try { toolInput = JSON.parse(tc.arguments) } catch { /* malformed */ }

        opts.onToolCall?.(tc.name, toolInput)
        yield { type: 'tool_call', toolName: tc.name, toolInput }

        const { executeTool } = await import('../../agent/tools.ts')
        const result = await executeTool(tc.name, toolInput, {
          scrubber: (await import('../../security/Scrubber.ts')).scrub,
          dict: null as any,
          codec: null as any,
          cwd: process.cwd(),
        })

        opts.onToolResult?.(tc.name, result)
        yield { type: 'tool_result', toolResult: result }

        messages.push({ role: 'tool' as const, tool_call_id: tc.id, content: result })
      }
    }

    yield { type: 'done', costUsd: 0 }
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
