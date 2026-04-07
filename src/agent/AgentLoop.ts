// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { DictManager } from '../codec/dictionary/DictManager.ts'
import type { HexCodec } from '../codec/HexCodec.ts'
import type { BudgetTracker } from '../budget/BudgetTracker.ts'
import type { LoopDetector } from '../budget/LoopDetector.ts'

interface StreamEvent {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' | string
  content_block?: { type: string; name?: string; input?: unknown; id?: string }
  delta?: { type: string; text?: string; partial_json?: string }
  index?: number
}

interface ToolProgressMessage {
  type: 'tool_progress'
  tool_name: string
  tool_use_id: string
  elapsed_time_seconds: number
}

interface AssistantMessage {
  type: 'assistant'
  message: {
    content: Array<{ type: string; name?: string; input?: unknown; id?: string; text?: string }>
  }
}

interface ResultMessage {
  type: 'result'
  subtype?: string
  result?: string
  num_turns?: number
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface AgentOptions {
  prompt: string
  systemPrompt: string
  cwd: string
  dict: DictManager
  codec: HexCodec
  budget: BudgetTracker
  loopDetector: LoopDetector
  maxTurns?: number
  abortController?: AbortController
  onToken?: (text: string) => void
  onToolCall?: (name: string, input: unknown) => void
  onToolResult?: (name: string, result: string, durationMs?: number) => void
  onTurnComplete?: (turn: number) => void
}

export interface AgentResult {
  success: boolean
  finalText: string
  turns: number
  totalCostUsd: number
  error?: string
}

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  let turns = 0
  let finalText = ''
  const maxTurns = opts.maxTurns ?? 50

  const abortController = opts.abortController ?? new AbortController()

  const agentQuery = query({
    prompt: opts.prompt,
    options: {
      systemPrompt: opts.systemPrompt,
      maxTurns,
      cwd: opts.cwd,
      abortController,
    },
  })

  // Track active tool calls by index for pairing start/stop
  const activeTools = new Map<number, { name: string; startMs: number }>()

  try {
    for await (const message of agentQuery) {
      // --- Stream events: text deltas + tool_use block starts ---
      if (message.type === 'stream_event') {
        const event = message.event as StreamEvent

        // Tool use block started (content_block_start with tool_use)
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const name = event.content_block.name ?? 'unknown'
          const input = (event.content_block.input ?? {}) as Record<string, unknown>
          activeTools.set(event.index ?? 0, { name, startMs: Date.now() })
          opts.onToolCall?.(name, input)
        }

        // Text delta — only handle actual text, not input_json
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          opts.onToken?.(event.delta.text)
          finalText += event.delta.text
        }

        // Content block finished — if it was a tool, mark done
        if (event.type === 'content_block_stop' && event.index !== undefined) {
          const tool = activeTools.get(event.index)
          if (tool) {
            const durationMs = Date.now() - tool.startMs
            opts.onToolResult?.(tool.name, `completed in ${durationMs}ms`, durationMs)
            activeTools.delete(event.index)
          }
        }
      }

      // --- Tool progress: SDK tells us a tool is still running ---
      if (message.type === 'tool_progress') {
        const progress = message as unknown as ToolProgressMessage
        // Update the UI with tool activity (re-fire onToolCall if needed)
        opts.onToolCall?.(progress.tool_name, { _progress: true, elapsed: progress.elapsed_time_seconds })
      }

      // --- Complete assistant turn ---
      if (message.type === 'assistant') {
        turns++
        opts.onTurnComplete?.(turns)

        // Extract tool calls from the completed message for any we missed during streaming
        const msg = message as unknown as AssistantMessage
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_use' && block.name) {
              // Only fire if we didn't already catch it via stream events
              const alreadyTracked = [...activeTools.values()].some(t => t.name === block.name)
              if (!alreadyTracked) {
                opts.onToolCall?.(block.name, (block.input ?? {}) as Record<string, unknown>)
                opts.onToolResult?.(block.name, 'done', 0)
              }
            }
          }
        }

        // Clear any remaining active tools (they completed with the turn)
        for (const [idx, tool] of activeTools) {
          opts.onToolResult?.(tool.name, 'done', Date.now() - tool.startMs)
        }
        activeTools.clear()

        const loopResult = opts.loopDetector.check(finalText, turns)
        if (loopResult.isLooping) {
          abortController.abort()
          return {
            success: false,
            finalText,
            turns,
            totalCostUsd: opts.budget.totalCost,
            error: `Loop detected at turn ${turns}: ${loopResult.reason}`,
          }
        }
      }

      // --- Final result with cost ---
      if (message.type === 'result') {
        const msg = message as unknown as ResultMessage
        const costUsd = msg.total_cost_usd ?? 0

        opts.budget.record({
          agentName: 'main',
          inputTokens: msg.usage?.input_tokens ?? 0,
          outputTokens: msg.usage?.output_tokens ?? 0,
          costUsd,
        })

        if (opts.budget.isExceeded()) {
          return {
            success: false,
            finalText,
            turns,
            totalCostUsd: opts.budget.totalCost,
            error: `Budget exceeded: $${opts.budget.totalCost.toFixed(4)}`,
          }
        }

        if (msg.subtype === 'error') {
          return {
            success: false,
            finalText: msg.result ?? finalText,
            turns: msg.num_turns ?? turns,
            totalCostUsd: opts.budget.totalCost,
            error: msg.result ?? 'Agent error',
          }
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      return {
        success: false,
        finalText,
        turns,
        totalCostUsd: opts.budget.totalCost,
        error: 'Aborted',
      }
    }
    return {
      success: false,
      finalText,
      turns,
      totalCostUsd: opts.budget.totalCost,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  return {
    success: true,
    finalText,
    turns,
    totalCostUsd: opts.budget.totalCost,
  }
}
