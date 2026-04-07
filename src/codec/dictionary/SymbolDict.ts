// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export type SymbolKind = 'method' | 'class' | 'interface' | 'variable' | 'line' | 'error'

export interface SymbolEntry {
  token: string
  kind: SymbolKind
  name: string
  fileToken: string
  line: number
  signature?: string
}

const PREFIX_MAP: Record<SymbolKind, string> = {
  method: 'M',
  class: 'S',
  interface: 'S',
  variable: 'V',
  line: 'L',
  error: 'E',
}

export class SymbolDict {
  private byToken = new Map<string, SymbolEntry>()
  private byNameAndFile = new Map<string, SymbolEntry>()
  private byFile = new Map<string, SymbolEntry[]>()
  private counters = new Map<string, number>()

  private makeKey(name: string, fileToken: string): string {
    return `${fileToken}:${name}`
  }

  private nextToken(kind: SymbolKind): string {
    const prefix = PREFIX_MAP[kind]!
    const count = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, count)
    return `&x${prefix}${count.toString(16).toUpperCase().padStart(3, '0')};`
  }

  register(entry: Omit<SymbolEntry, 'token'>): SymbolEntry {
    const key = this.makeKey(entry.name, entry.fileToken)
    const existing = this.byNameAndFile.get(key)
    if (existing) {
      existing.line = entry.line
      if (entry.signature) existing.signature = entry.signature
      return existing
    }

    const token = this.nextToken(entry.kind)
    const full: SymbolEntry = { ...entry, token }

    this.byToken.set(token, full)
    this.byNameAndFile.set(key, full)

    const fileEntries = this.byFile.get(entry.fileToken) ?? []
    fileEntries.push(full)
    this.byFile.set(entry.fileToken, fileEntries)

    return full
  }

  getByName(name: string, fileToken: string): SymbolEntry | undefined {
    return this.byNameAndFile.get(this.makeKey(name, fileToken))
  }

  getByToken(token: string): SymbolEntry | undefined {
    return this.byToken.get(token)
  }

  getByFile(fileToken: string): SymbolEntry[] {
    return this.byFile.get(fileToken) ?? []
  }

  removeByFile(fileToken: string): void {
    const entries = this.byFile.get(fileToken) ?? []
    for (const entry of entries) {
      this.byToken.delete(entry.token)
      this.byNameAndFile.delete(this.makeKey(entry.name, entry.fileToken))
    }
    this.byFile.delete(fileToken)
  }

  updateLine(token: string, newLine: number): void {
    const entry = this.byToken.get(token)
    if (entry) entry.line = newLine
  }

  entries(): SymbolEntry[] {
    return [...this.byToken.values()]
  }

  toJSON(): SymbolEntry[] {
    return this.entries()
  }

  fromJSON(data: SymbolEntry[]): void {
    this.byToken.clear()
    this.byNameAndFile.clear()
    this.byFile.clear()
    this.counters.clear()

    for (const entry of data) {
      this.byToken.set(entry.token, entry)
      this.byNameAndFile.set(this.makeKey(entry.name, entry.fileToken), entry)

      const fileEntries = this.byFile.get(entry.fileToken) ?? []
      fileEntries.push(entry)
      this.byFile.set(entry.fileToken, fileEntries)

      const prefix = entry.token.match(/&x([A-Z])/)?.[1]
      if (prefix) {
        const num = parseInt(entry.token.match(/&x[A-Z]([0-9A-F]+);/i)?.[1] ?? '0', 16)
        this.counters.set(prefix, Math.max(this.counters.get(prefix) ?? 0, num))
      }
    }
  }
}
