// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'node:child_process'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'
import { classifyTask, classifyWithFallback } from '../router.ts'

export class ClaudeCLIProvider implements HexProvider {
  readonly kind = 'claude-cli' as const
  private useSubprocess: boolean
  private client: Anthropic | null = null
  private messages: Anthropic.MessageParam[] = []
  private hasSession = false
  private sessionTurns = 0
  private readonly MAX_SESSION_TURNS = 20 // reset session after this many turns

  constructor(readonly config: ProviderConfig) {
    this.useSubprocess = !process.env['ANTHROPIC_API_KEY']
  }

  async isAvailable(): Promise<AvailabilityResult> {
    if (this.useSubprocess) {
      const which = Bun.spawnSync(['which', 'claude'])
      if (which.exitCode !== 0) return { available: false, reason: '`claude` not found' }
      return { available: true, latencyMs: 0 }
    }
    try {
      const start = Date.now()
      if (!this.client) this.client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })
      await this.client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      return { available: true, latencyMs: Date.now() - start }
    } catch (err) {
      return { available: false, reason: err instanceof Error ? err.message : String(err) }
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
    if (this.useSubprocess) {
      yield* this.streamViaSubprocess(opts)
    } else {
      yield* this.streamViaSdk(opts)
    }
  }

  // === SUBPROCESS MODE (subscription auth via `claude` CLI) ===
  private async *streamViaSubprocess(opts: StreamOptions): AsyncIterable<StreamEvent> {
    const args = [
      '--print', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--dangerously-skip-permissions',
    ]

    // Auto-compact: reset session when turns exceed limit
    if (this.sessionTurns >= this.MAX_SESSION_TURNS) {
      this.hasSession = false
      this.sessionTurns = 0
    }

    if (this.hasSession) args.push('--continue')

    const isFirst = !this.hasSession
    const route = isFirst ? await classifyWithFallback(opts.prompt) : { model: 'sonnet', maxTurns: 15 }
    args.push('--model', opts.model ?? route.model)
    args.push('--max-turns', String(opts.maxTurns ?? route.maxTurns))

    if (opts.systemPrompt && isFirst) {
      args.push('--append-system-prompt', opts.systemPrompt)
    }

    args.push('--', opts.prompt)
    this.hasSession = true

    const proc = spawn('claude', args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
    const killTimer = setTimeout(() => proc.kill(), 120_000)

    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString() })

    let buffer = ''
    let turn = 0
    let hasStreamedTokens = false

    for await (const chunk of proc.stdout!) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) } catch { continue }

        if (msg['type'] === 'stream_event') {
          const event = msg['event'] as Record<string, unknown> | undefined
          if (event?.['type'] === 'content_block_delta') {
            const delta = event['delta'] as Record<string, unknown> | undefined
            if (delta?.['type'] === 'text_delta' && delta['text']) {
              hasStreamedTokens = true
              opts.onToken?.(delta['text'] as string)
              yield { type: 'token', token: delta['text'] as string }
            }
          }
        }

        if (msg['type'] === 'assistant') {
          const message = msg['message'] as Record<string, unknown> | undefined
          const content = (message?.['content'] as Array<Record<string, unknown>>) ?? []

          if (!hasStreamedTokens) {
            for (const block of content) {
              if (block['type'] === 'text') {
                opts.onToken?.(block['text'] as string)
                yield { type: 'token', token: block['text'] as string }
              }
            }
          }

          for (const block of content) {
            if (block['type'] === 'tool_use') {
              opts.onToolCall?.(block['name'] as string, (block['input'] ?? {}) as Record<string, unknown>)
              yield { type: 'tool_call', toolName: block['name'] as string, toolInput: (block['input'] ?? {}) as Record<string, unknown> }
            }
          }

          turn++
          this.sessionTurns++
          opts.onTurnComplete?.(turn)
          yield { type: 'turn_complete', turn }
          hasStreamedTokens = false
        }

        if (msg['type'] === 'result') {
          yield { type: 'done', costUsd: (msg['total_cost_usd'] as number) ?? 0 }
        }
      }
    }

    clearTimeout(killTimer)

    const exitCode = await Promise.race([
      new Promise<number>(resolve => proc.on('close', (code) => resolve(code ?? 1))),
      new Promise<number>(resolve => setTimeout(() => { proc.kill(); resolve(1) }, 5000)),
    ])

    if (!hasStreamedTokens && stderrBuf.trim()) {
      const err = stderrBuf.trim()
      // Classify error type for better recovery
      if (err.includes('rate_limit') || err.includes('429')) {
        yield { type: 'error', error: 'Rate limited. Wait ~30s and try again.' }
      } else if (err.includes('prompt is too long') || err.includes('token')) {
        // Session got too long — reset and tell user
        this.hasSession = false
        this.sessionTurns = 0
        yield { type: 'error', error: 'Conversation too long — session reset. Try again.' }
      } else if (err.includes('authentication') || err.includes('401')) {
        yield { type: 'error', error: 'Auth failed. Run `claude login` to re-authenticate.' }
      } else {
        yield { type: 'error', error: err.slice(0, 300) }
      }
    }
  }

  // === DIRECT SDK MODE (ANTHROPIC_API_KEY) ===
  private async *streamViaSdk(opts: StreamOptions): AsyncIterable<StreamEvent> {
    if (!this.client) this.client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

    const isFirst = this.messages.length === 0
    const sdkRoute = isFirst ? await classifyWithFallback(opts.prompt) : { model: 'sonnet' }
    let model = opts.model ?? sdkRoute.model
    if (model === 'haiku') model = 'claude-haiku-4-5-20251001'
    else if (model === 'sonnet') model = 'claude-sonnet-4-6'
    else if (model === 'opus') model = 'claude-opus-4-6'

    // Prompt caching: use cache_control on system prompt for cost savings
    const systemBlocks = isFirst && opts.systemPrompt
      ? [{ type: 'text' as const, text: opts.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
      : undefined

    // Auto-compact SDK messages when too long
    if (this.messages.length > 30) {
      // Keep first 2 (system context) and last 10 (recent conversation)
      const kept = [...this.messages.slice(0, 2), ...this.messages.slice(-10)]
      this.messages = kept
    }

    this.messages.push({ role: 'user', content: opts.prompt })

    const tools: Anthropic.Tool[] = [
      { name: 'Read', description: 'Read a file', input_schema: { type: 'object' as const, properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
      { name: 'Write', description: 'Write content to a file', input_schema: { type: 'object' as const, properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
      { name: 'Edit', description: 'Replace text in a file', input_schema: { type: 'object' as const, properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
      { name: 'Bash', description: 'Run a shell command', input_schema: { type: 'object' as const, properties: { command: { type: 'string' } }, required: ['command'] } },
    ]

    let turn = 0, totalInput = 0, totalOutput = 0
    const maxTurns = opts.maxTurns ?? 15

    while (turn < maxTurns) {
      try {
        const stream = this.client.messages.stream({ model, max_tokens: 8192, system: systemBlocks as any, messages: this.messages, tools })

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            opts.onToken?.(event.delta.text)
            yield { type: 'token', token: event.delta.text }
          }
        }

        const finalMessage = await stream.finalMessage()
        totalInput += finalMessage.usage.input_tokens
        totalOutput += finalMessage.usage.output_tokens

        const completedTools = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        this.messages.push({ role: 'assistant', content: finalMessage.content })

        turn++
        opts.onTurnComplete?.(turn)
        yield { type: 'turn_complete', turn }

        if (completedTools.length === 0 || finalMessage.stop_reason !== 'tool_use') break

        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const tu of completedTools) {
          const input = (tu.input ?? {}) as Record<string, unknown>
          opts.onToolCall?.(tu.name, input)
          yield { type: 'tool_call', toolName: tu.name, toolInput: input }

          const { executeTool } = await import('../../agent/tools.ts')
          const result = await executeTool(tu.name.toLowerCase(), input, {
            scrubber: (await import('../../security/Scrubber.ts')).scrub,
            dict: null as any, codec: null as any, cwd: process.cwd(),
          })

          opts.onToolResult?.(tu.name, result)
          yield { type: 'tool_result', toolResult: result }
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
        }

        this.messages.push({ role: 'user', content: toolResults })
      } catch (err: any) {
        yield { type: 'error', error: err?.error?.error?.message ?? err?.message ?? String(err) }
        return
      }
    }

    const modelInfo = (await this.models()).find(m => m.id === model)
    const costUsd = modelInfo
      ? (totalInput / 1e6 * (modelInfo.inputCostPer1M ?? 0)) + (totalOutput / 1e6 * (modelInfo.outputCostPer1M ?? 0))
      : 0
    yield { type: 'done', inputTokens: totalInput, outputTokens: totalOutput, costUsd }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    if (this.useSubprocess) {
      const args = ['--print', '--output-format', 'json']
      if (opts.model) args.push('--model', opts.model)
      if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt)
      args.push('--', opts.prompt)
      const result = Bun.spawnSync(['claude', ...args])
      try { return JSON.parse(result.stdout.toString()).result ?? result.stdout.toString() }
      catch { return result.stdout.toString() }
    }

    if (!this.client) this.client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })
    const response = await this.client.messages.create({
      model: opts.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens ?? 1000,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.prompt }],
    })
    const block = response.content[0]
    return block?.type === 'text' ? block.text : ''
  }
}
