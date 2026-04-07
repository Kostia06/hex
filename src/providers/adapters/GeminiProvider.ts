// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import type {
  HexProvider, ProviderConfig, StreamOptions, StreamEvent,
  CompleteOptions, AvailabilityResult, ModelInfo,
} from '../types.ts'

export class GeminiProvider implements HexProvider {
  readonly kind = 'gemini' as const
  private genAI: GoogleGenerativeAI

  constructor(readonly config: ProviderConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey ?? '')
  }

  async isAvailable(): Promise<AvailabilityResult> {
    try {
      const start = Date.now()
      const model = this.genAI.getGenerativeModel({ model: this.config.model })
      await model.generateContent('ping')
      return { available: true, latencyMs: Date.now() - start }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { available: false, reason: msg.includes('API_KEY') ? 'Invalid Gemini API key' : msg }
    }
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 1000000, supportsTools: true, supportsVision: true, inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1000000, supportsTools: true, supportsVision: true, inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1000000, supportsTools: true, supportsVision: true, inputCostPer1M: 0.10, outputCostPer1M: 0.40 },
    ]
  }

  async *stream(opts: StreamOptions): AsyncIterable<StreamEvent> {
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ]

    const toolDeclarations = opts.tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT' as const,
        properties: t.input_schema.properties,
        required: t.input_schema.required,
      },
    }))

    const model = this.genAI.getGenerativeModel({
      model: opts.model ?? this.config.model,
      systemInstruction: opts.systemPrompt,
      safetySettings,
      tools: toolDeclarations ? [{ functionDeclarations: toolDeclarations } as any] : undefined,
    })

    const chat = model.startChat()
    let turn = 0
    const maxTurns = opts.maxTurns ?? 50
    let currentPrompt = opts.prompt

    while (turn < maxTurns) {
      const result = await chat.sendMessageStream(currentPrompt)
      const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = []

      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) {
          opts.onToken?.(text)
          yield { type: 'token', token: text }
        }

        const calls = chunk.functionCalls()
        if (calls) {
          for (const call of calls) {
            functionCalls.push({ name: call.name, args: (call.args ?? {}) as Record<string, unknown> })
          }
        }
      }

      turn++
      opts.onTurnComplete?.(turn)
      yield { type: 'turn_complete', turn }

      if (functionCalls.length === 0) break

      const functionResponses: Array<{ functionResponse: { name: string; response: Record<string, unknown> } }> = []

      for (const call of functionCalls) {
        opts.onToolCall?.(call.name, call.args)
        yield { type: 'tool_call', toolName: call.name, toolInput: call.args }

        const { executeTool } = await import('../../agent/tools.ts')
        const toolResult = await executeTool(call.name, call.args, {
          scrubber: (await import('../../security/Scrubber.ts')).scrub,
          dict: null as any,
          codec: null as any,
          cwd: process.cwd(),
        })

        opts.onToolResult?.(call.name, toolResult)
        yield { type: 'tool_result', toolResult }

        functionResponses.push({ functionResponse: { name: call.name, response: { output: toolResult } } })
      }

      currentPrompt = JSON.stringify(functionResponses)
    }

    yield { type: 'done', costUsd: 0 }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: opts.model ?? this.config.model,
      systemInstruction: opts.systemPrompt,
    })
    const result = await model.generateContent(opts.prompt)
    return result.response.text()
  }
}
