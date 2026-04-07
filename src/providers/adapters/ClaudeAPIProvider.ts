// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import Anthropic from '@anthropic-ai/sdk'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'

export class ClaudeAPIProvider implements HexProvider {
  readonly kind = 'claude-api' as const
  private client: Anthropic

  constructor(readonly config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey })
  }

  async isAvailable(): Promise<AvailabilityResult> {
    try {
      const start = Date.now()
      await this.client.messages.create({
        model: this.config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return { available: true, latencyMs: Date.now() - start }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('401') || msg.includes('invalid')) {
        return { available: false, reason: 'Invalid API key' }
      }
      return { available: false, reason: msg }
    }
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', contextWindow: 200000, supportsTools: true, supportsVision: true, inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 1000000, supportsTools: true, supportsVision: true, inputCostPer1M: 15.00, outputCostPer1M: 75.00 },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', contextWindow: 200000, supportsTools: true, supportsVision: true, inputCostPer1M: 0.80, outputCostPer1M: 4.00 },
    ]
  }

  async *stream(opts: StreamOptions): AsyncIterable<StreamEvent> {
    const model = opts.model ?? this.config.model
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.prompt }]

    const tools: Anthropic.Tool[] = (opts.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }))

    let turn = 0
    let totalInput = 0
    let totalOutput = 0
    const maxTurns = opts.maxTurns ?? 50

    while (turn < maxTurns) {
      const stream = this.client.messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      })

      let assistantText = ''
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            assistantText += event.delta.text
            opts.onToken?.(event.delta.text)
            yield { type: 'token', token: event.delta.text }
          }
        }

        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolUses.push({ id: event.content_block.id, name: event.content_block.name, input: {} })
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          // Buffer partial JSON for the current tool
        }
      }

      const finalMessage = await stream.finalMessage()
      totalInput += finalMessage.usage.input_tokens
      totalOutput += finalMessage.usage.output_tokens

      // Extract complete tool uses from final message
      const contentBlocks = finalMessage.content
      const completedToolUses = contentBlocks.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )

      // Build assistant message for history
      messages.push({ role: 'assistant', content: contentBlocks })

      turn++
      opts.onTurnComplete?.(turn)
      yield { type: 'turn_complete', turn }

      if (completedToolUses.length === 0) break

      // Execute tools and add results
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of completedToolUses) {
        opts.onToolCall?.(tu.name, tu.input as Record<string, unknown>)
        yield { type: 'tool_call', toolName: tu.name, toolInput: tu.input as Record<string, unknown> }

        const { executeTool } = await import('../../agent/tools.ts')
        const result = await executeTool(tu.name, tu.input as Record<string, unknown>, {
          scrubber: (await import('../../security/Scrubber.ts')).scrub,
          dict: null as any,
          codec: null as any,
          cwd: process.cwd(),
        })

        opts.onToolResult?.(tu.name, result)
        yield { type: 'tool_result', toolResult: result }

        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
      }

      messages.push({ role: 'user', content: toolResults })
    }

    const modelInfo = (await this.models()).find(m => m.id === model)
    const costUsd = modelInfo
      ? (totalInput / 1_000_000 * (modelInfo.inputCostPer1M ?? 0)) +
        (totalOutput / 1_000_000 * (modelInfo.outputCostPer1M ?? 0))
      : 0

    yield { type: 'done', inputTokens: totalInput, outputTokens: totalOutput, costUsd }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: opts.model ?? this.config.model,
      max_tokens: opts.maxTokens ?? 1000,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.prompt }],
    })
    const block = response.content[0]
    return block?.type === 'text' ? block.text : ''
  }
}
