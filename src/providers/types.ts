// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export type ProviderKind =
  | 'claude-cli'
  | 'claude-api'
  | 'openai'
  | 'gemini'
  | 'ollama'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  label: string
  apiKey?: string
  baseUrl?: string
  model: string
  isDefault: boolean
  addedAt: string
  lastUsedAt?: string
  extras?: Record<string, string>
}

export interface HexProvider {
  readonly config: ProviderConfig
  readonly kind: ProviderKind
  isAvailable(): Promise<AvailabilityResult>
  models(): Promise<ModelInfo[]>
  stream(opts: StreamOptions): AsyncIterable<StreamEvent>
  complete(opts: CompleteOptions): Promise<string>
}

export interface AvailabilityResult {
  available: boolean
  reason?: string
  latencyMs?: number
}

export interface ModelInfo {
  id: string
  displayName: string
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
  inputCostPer1M?: number
  outputCostPer1M?: number
}

export interface StreamOptions {
  prompt: string
  systemPrompt: string
  model?: string
  maxTurns?: number
  maxTokens?: number
  tools?: ToolDefinition[]
  onToken?: (token: string) => void
  onToolCall?: (name: string, input: Record<string, unknown>) => void
  onToolResult?: (name: string, result: string) => void
  onTurnComplete?: (turn: number) => void
  signal?: AbortSignal
}

export interface CompleteOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  maxTokens?: number
}

export interface StreamEvent {
  type: 'token' | 'tool_call' | 'tool_result' | 'turn_complete' | 'done' | 'error'
  token?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  turn?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  error?: string
}

export const WEB_TOOLS: ToolDefinition[] = [
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its text content. Use for reading documentation, API responses, or any web page.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to fetch' } },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web and return results with titles, URLs, and snippets. Use to find docs, packages, solutions.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
]

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}
