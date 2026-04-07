// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system' | 'error'

export interface ToolCall {
  name: string
  input: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'error'
  durationMs?: number
}

export interface HexMessage {
  id: string
  role: MessageRole
  content: string
  streaming: boolean
  toolCalls: ToolCall[]
  costUsd?: number
  turns?: number
  timestamp: Date
}

export interface ReplState {
  messages: HexMessage[]
  input: string
  isStreaming: boolean
  currentAssistantId: string | null
  showSlashMenu: boolean
  slashFilter: string
  sessionCostUsd: number
  totalTurns: number
  model: string
  branch: string
  gitClean: boolean
  mode: 'standard' | 'plan' | 'auto'
}

export type ReplAction =
  | { type: 'SET_INPUT'; value: string }
  | { type: 'SUBMIT_INPUT' }
  | { type: 'START_STREAMING'; messageId: string }
  | { type: 'APPEND_TOKEN'; messageId: string; token: string }
  | { type: 'ADD_TOOL_CALL'; messageId: string; tool: ToolCall }
  | { type: 'UPDATE_TOOL_CALL'; messageId: string; toolName: string; result: string; status: 'done' | 'error'; durationMs: number }
  | { type: 'END_STREAMING'; messageId: string; costUsd: number; turns: number }
  | { type: 'ADD_SYSTEM'; content: string }
  | { type: 'ADD_ERROR'; content: string }
  | { type: 'SHOW_SLASH_MENU'; filter: string }
  | { type: 'HIDE_SLASH_MENU' }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'COMPACT'; summary: string; keep: HexMessage[] }

function makeMessage(role: MessageRole, content: string): HexMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    streaming: false,
    toolCalls: [],
    timestamp: new Date(),
  }
}

export function replReducer(state: ReplState, action: ReplAction): ReplState {
  switch (action.type) {
    case 'SET_INPUT':
      return {
        ...state,
        input: action.value,
        showSlashMenu: action.value.startsWith('/'),
        slashFilter: action.value.startsWith('/') ? action.value.slice(1) : '',
      }

    case 'SUBMIT_INPUT': {
      if (!state.input.trim() || state.isStreaming) return state
      const userMsg = makeMessage('user', state.input.trim())
      return {
        ...state,
        messages: [...state.messages, userMsg],
        input: '',
        isStreaming: true,
        showSlashMenu: false,
      }
    }

    case 'START_STREAMING': {
      const assistantMsg: HexMessage = {
        id: action.messageId,
        role: 'assistant',
        content: '',
        streaming: true,
        toolCalls: [],
        timestamp: new Date(),
      }
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        currentAssistantId: action.messageId,
      }
    }

    case 'APPEND_TOKEN':
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.messageId
            ? { ...m, content: m.content + action.token }
            : m,
        ),
      }

    case 'ADD_TOOL_CALL':
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.messageId
            ? { ...m, toolCalls: [...m.toolCalls, action.tool] }
            : m,
        ),
      }

    case 'UPDATE_TOOL_CALL':
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.messageId
            ? {
                ...m,
                toolCalls: m.toolCalls.map(t =>
                  t.name === action.toolName && t.status === 'running'
                    ? { ...t, result: action.result, status: action.status, durationMs: action.durationMs }
                    : t,
                ),
              }
            : m,
        ),
      }

    case 'END_STREAMING':
      return {
        ...state,
        isStreaming: false,
        currentAssistantId: null,
        sessionCostUsd: state.sessionCostUsd + action.costUsd,
        totalTurns: state.totalTurns + action.turns,
        messages: state.messages.map(m =>
          m.id === action.messageId
            ? {
                ...m,
                streaming: false,
                costUsd: action.costUsd,
                turns: action.turns,
                // Mark all remaining running tool calls as done
                toolCalls: m.toolCalls.map(t =>
                  t.status === 'running' ? { ...t, status: 'done' as const } : t,
                ),
              }
            : m,
        ),
      }

    case 'ADD_SYSTEM':
      return { ...state, messages: [...state.messages, makeMessage('system', action.content)] }

    case 'ADD_ERROR':
      return {
        ...state,
        messages: [...state.messages, makeMessage('error', action.content)],
        isStreaming: false,
      }

    case 'SHOW_SLASH_MENU':
      return { ...state, showSlashMenu: true, slashFilter: action.filter }

    case 'HIDE_SLASH_MENU':
      return { ...state, showSlashMenu: false, slashFilter: '' }

    case 'CLEAR_HISTORY':
      return { ...state, messages: [], sessionCostUsd: 0, totalTurns: 0 }

    case 'COMPACT': {
      const compactMsg = makeMessage('system', `[Compacted] ${action.summary}`)
      return { ...state, messages: [compactMsg, ...action.keep] }
    }

    default:
      return state
  }
}
