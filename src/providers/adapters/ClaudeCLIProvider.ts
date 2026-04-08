// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import Anthropic from '@anthropic-ai/sdk'
import { spawn, type ChildProcess } from 'node:child_process'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'
import { classifyTask } from '../router.ts'

export class ClaudeCLIProvider implements HexProvider {
  readonly kind = 'claude-cli' as const
  private useSubprocess: boolean
  private client: Anthropic | null = null
  private messages: Anthropic.MessageParam[] = []
  // Persistent subprocess
  private proc: ChildProcess | null = null
  private procReady = false
  private buffer = ''

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
      yield* this.streamViaPersistentProcess(opts)
    } else {
      yield* this.streamViaSdk(opts)
    }
  }

  // === PERSISTENT SUBPROCESS MODE ===
  private ensureProcess(opts: StreamOptions): ChildProcess {
    if (this.proc && !this.proc.killed) return this.proc

    const isInspectorEdit = /^(In |Edit )\S+\.\w+/.test(opts.prompt) || opts.prompt.includes('Selected elements:')
    const route = classifyTask(opts.prompt)

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--model', opts.model ?? (isInspectorEdit ? 'haiku' : route.model),
      '--max-turns', String(opts.maxTurns ?? (isInspectorEdit ? 3 : route.maxTurns)),
    ]

    if (isInspectorEdit) args.push('--effort', 'low')

    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt)
    }

    this.proc = spawn('claude', args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.procReady = true
    this.buffer = ''

    this.proc.on('exit', () => {
      this.procReady = false
      this.proc = null
    })

    // Drain stderr to prevent pipe buffer deadlock
    this.proc.stderr?.on('data', () => {})

    return this.proc
  }

  private async *streamViaPersistentProcess(opts: StreamOptions): AsyncIterable<StreamEvent> {
    let proc: ChildProcess
    try {
      proc = this.ensureProcess(opts)
    } catch (err) {
      yield { type: 'error', error: `Failed to start claude: ${err instanceof Error ? err.message : String(err)}` }
      return
    }

    if (!proc.stdin || !proc.stdout) {
      yield { type: 'error', error: 'Process stdin/stdout not available' }
      return
    }

    // Send message via stdin as JSON with backpressure handling
    const userMessage = JSON.stringify({ type: 'user', content: opts.prompt }) + '\n'
    const canWrite = proc.stdin.write(userMessage)
    if (!canWrite) {
      await new Promise<void>(resolve => proc.stdin!.once('drain', resolve))
    }

    let turn = 0
    let hasStreamedTokens = false
    let gotResult = false

    // Read response lines from stdout
    const linePromise = this.readLines(proc)

    for await (const line of linePromise) {
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
        opts.onTurnComplete?.(turn)
        yield { type: 'turn_complete', turn }
        hasStreamedTokens = false
      }

      if (msg['type'] === 'result') {
        gotResult = true
        yield { type: 'done', costUsd: (msg['total_cost_usd'] as number) ?? 0 }
        break // result = end of this response
      }
    }

    if (!gotResult && !proc.killed) {
      yield { type: 'done', costUsd: 0 }
    }
  }

  private async *readLines(proc: ChildProcess): AsyncIterable<string> {
    if (!proc.stdout) return
    let buffer = ''

    for await (const chunk of proc.stdout) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        yield line
      }

      // Check if we got a result (end of response)
      if (buffer.includes('"type":"result"') || lines.some(l => l.includes('"type":"result"'))) {
        if (buffer.trim()) yield buffer
        buffer = ''
        return
      }
    }

    if (buffer.trim()) yield buffer
  }

  // === DIRECT SDK MODE (ANTHROPIC_API_KEY) ===
  private async *streamViaSdk(opts: StreamOptions): AsyncIterable<StreamEvent> {
    if (!this.client) this.client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

    const isFirst = this.messages.length === 0
    const sdkRoute = isFirst ? classifyTask(opts.prompt) : { model: 'sonnet' }
    let model = opts.model ?? sdkRoute.model
    if (model === 'haiku') model = 'claude-haiku-4-5-20251001'
    else if (model === 'sonnet') model = 'claude-sonnet-4-6'
    else if (model === 'opus') model = 'claude-opus-4-6'

    const systemBlocks = isFirst && opts.systemPrompt
      ? [{ type: 'text' as const, text: opts.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
      : undefined

    if (this.messages.length > 30) {
      this.messages = [...this.messages.slice(0, 2), ...this.messages.slice(-10)]
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
        const errMsg = err?.error?.error?.message ?? err?.message ?? String(err)
        if (err?.status === 429 || errMsg.includes('rate_limit')) {
          yield { type: 'error', error: 'Rate limited. Wait ~30s and try again.' }
        } else {
          yield { type: 'error', error: errMsg }
        }
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
