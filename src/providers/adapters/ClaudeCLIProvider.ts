// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import Anthropic from '@anthropic-ai/sdk'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'
import { getSubscriptionToken } from '../auth.ts'
import { classifyTask } from '../router.ts'

export class ClaudeCLIProvider implements HexProvider {
  readonly kind = 'claude-cli' as const
  private client: Anthropic | null = null
  private messages: Anthropic.MessageParam[] = []

  constructor(readonly config: ProviderConfig) {}

  private async getClient(): Promise<Anthropic> {
    if (this.client) return this.client

    const token = await getSubscriptionToken()
    const apiKey = process.env['ANTHROPIC_API_KEY']

    if (token) {
      this.client = new Anthropic({
        apiKey: token,
        defaultHeaders: { 'Authorization': `Bearer ${token}` },
      })
    } else if (apiKey) {
      this.client = new Anthropic({ apiKey })
    } else {
      throw new Error('No auth found. Run `claude login` or set ANTHROPIC_API_KEY.')
    }

    return this.client
  }

  async isAvailable(): Promise<AvailabilityResult> {
    try {
      const start = Date.now()
      const client = await this.getClient()
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return { available: true, latencyMs: Date.now() - start }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { available: false, reason: msg }
    }
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', contextWindow: 200000, supportsTools: true, supportsVision: true, inputCostPer1M: 3, outputCostPer1M: 15 },
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 1000000, supportsTools: true, supportsVision: true, inputCostPer1M: 15, outputCostPer1M: 75 },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', contextWindow: 200000, supportsTools: true, supportsVision: true, inputCostPer1M: 0.8, outputCostPer1M: 4 },
    ]
  }

  async *stream(opts: StreamOptions): AsyncIterable<StreamEvent> {
    const client = await this.getClient()

    // Route model based on task complexity
    const isFirstMessage = this.messages.length === 0
    let model: string
    if (opts.model) {
      model = opts.model
    } else if (isFirstMessage) {
      model = classifyTask(opts.prompt).model
      // Map short names to full IDs
      if (model === 'haiku') model = 'claude-haiku-4-5-20251001'
      else if (model === 'sonnet') model = 'claude-sonnet-4-6'
      else if (model === 'opus') model = 'claude-opus-4-6'
    } else {
      model = 'claude-sonnet-4-6'
    }

    // Add system prompt on first message
    const systemPrompt = isFirstMessage && opts.systemPrompt ? opts.systemPrompt : undefined

    // Add user message to conversation history
    this.messages.push({ role: 'user', content: opts.prompt })

    // Tool definitions for the API
    const tools: Anthropic.Tool[] = [
      { name: 'Read', description: 'Read a file', input_schema: { type: 'object' as const, properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
      { name: 'Write', description: 'Write content to a file', input_schema: { type: 'object' as const, properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
      { name: 'Edit', description: 'Replace text in a file', input_schema: { type: 'object' as const, properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
      { name: 'Bash', description: 'Run a shell command', input_schema: { type: 'object' as const, properties: { command: { type: 'string' } }, required: ['command'] } },
      { name: 'Glob', description: 'Find files by pattern', input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
      { name: 'Grep', description: 'Search file contents', input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
    ]

    let turn = 0
    let totalInput = 0
    let totalOutput = 0
    const maxTurns = opts.maxTurns ?? 15

    while (turn < maxTurns) {
      let assistantText = ''
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
      let finalMessage: Anthropic.Message | null = null

      // Retry loop for rate limits
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const stream = client.messages.stream({
            model,
            max_tokens: 8192,
            system: systemPrompt,
            messages: this.messages,
            tools,
          })

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
          }

          finalMessage = await stream.finalMessage()
          break // success
        } catch (err: any) {
          const status = err?.status ?? err?.error?.status
          const errMsg = err?.error?.error?.message ?? err?.message ?? String(err)

          if (status === 429 || errMsg.includes('rate_limit') || errMsg === 'Error') {
            yield { type: 'error', error: 'Rate limited. Wait ~30s and try again. (Shared with active Claude Code sessions)' }
            return
          }

          yield { type: 'error', error: errMsg }
          return
        }
      }

      if (!finalMessage) {
        yield { type: 'error', error: 'Failed after retries' }
        return
      }
      totalInput += finalMessage.usage.input_tokens
      totalOutput += finalMessage.usage.output_tokens

      // Get complete tool uses from final message
      const completedTools = finalMessage.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )

      // Add assistant message to history
      this.messages.push({ role: 'assistant', content: finalMessage.content })

      turn++
      opts.onTurnComplete?.(turn)
      yield { type: 'turn_complete', turn }

      // No tool calls — done
      if (completedTools.length === 0 || finalMessage.stop_reason !== 'tool_use') break

      // Execute tools
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of completedTools) {
        const input = (tu.input ?? {}) as Record<string, unknown>
        opts.onToolCall?.(tu.name, input)
        yield { type: 'tool_call', toolName: tu.name, toolInput: input }

        const { executeTool } = await import('../../agent/tools.ts')
        const result = await executeTool(tu.name.toLowerCase(), input, {
          scrubber: (await import('../../security/Scrubber.ts')).scrub,
          dict: null as any,
          codec: null as any,
          cwd: process.cwd(),
        })

        opts.onToolResult?.(tu.name, result)
        yield { type: 'tool_result', toolResult: result }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
      }

      this.messages.push({ role: 'user', content: toolResults })
    }

    // Calculate cost
    const modelInfo = (await this.models()).find(m => m.id === model)
    const costUsd = modelInfo
      ? (totalInput / 1_000_000 * (modelInfo.inputCostPer1M ?? 0)) + (totalOutput / 1_000_000 * (modelInfo.outputCostPer1M ?? 0))
      : 0

    yield { type: 'done', inputTokens: totalInput, outputTokens: totalOutput, costUsd }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const client = await this.getClient()
    const response = await client.messages.create({
      model: opts.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens ?? 1000,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.prompt }],
    })
    const block = response.content[0]
    return block?.type === 'text' ? block.text : ''
  }
}
