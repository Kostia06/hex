// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import fs from 'node:fs'
import path from 'node:path'
import type { HexMessage } from './replState.ts'

const SESSIONS_DIR = '.hex/sessions'

export interface SessionMeta {
  id: string
  firstPrompt: string
  messageCount: number
  createdAt: string
  updatedAt: string
  sizeByte: number
}

function ensureDir(cwd: string): string {
  const dir = path.join(cwd, SESSIONS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function createSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function appendMessage(cwd: string, sessionId: string, message: HexMessage): void {
  const dir = ensureDir(cwd)
  const file = path.join(dir, `${sessionId}.jsonl`)
  const entry = {
    id: message.id,
    role: message.role,
    content: message.content.slice(0, 5000),
    toolCalls: message.toolCalls.map(t => ({ name: t.name, status: t.status })),
    ts: message.timestamp.toISOString(),
  }
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    fs.writeFileSync(file, existing + JSON.stringify(entry) + '\n')
  } catch { /* non-fatal */ }
}

export function listSessions(cwd: string, limit = 10): SessionMeta[] {
  const dir = path.join(cwd, SESSIONS_DIR)
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const full = path.join(dir, f)
      const stat = fs.statSync(full)
      return { name: f, mtime: stat.mtimeMs, size: stat.size, path: full }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)

  return files.map(f => {
    let firstPrompt = ''
    let messageCount = 0
    try {
      const content = fs.readFileSync(f.path, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      messageCount = lines.length
      for (const line of lines) {
        const msg = JSON.parse(line)
        if (msg.role === 'user' && msg.content) {
          firstPrompt = msg.content.slice(0, 80)
          break
        }
      }
    } catch { /* */ }

    return {
      id: f.name.replace('.jsonl', ''),
      firstPrompt,
      messageCount,
      createdAt: new Date(parseInt(f.name)).toISOString(),
      updatedAt: new Date(f.mtime).toISOString(),
      sizeByte: f.size,
    }
  })
}

export function loadSession(cwd: string, sessionId: string): HexMessage[] {
  const file = path.join(cwd, SESSIONS_DIR, `${sessionId}.jsonl`)
  if (!fs.existsSync(file)) return []

  try {
    const content = fs.readFileSync(file, 'utf8')
    return content.trim().split('\n').filter(Boolean).map(line => {
      const entry = JSON.parse(line)
      return {
        id: entry.id ?? crypto.randomUUID(),
        role: entry.role,
        content: entry.content,
        streaming: false,
        toolCalls: entry.toolCalls ?? [],
        timestamp: new Date(entry.ts),
      } as HexMessage
    })
  } catch {
    return []
  }
}
