// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export interface FileEntry {
  token: string
  path: string
  exists: boolean
}

export class FileDict {
  private byToken = new Map<string, FileEntry>()
  private byPath = new Map<string, FileEntry>()
  private nextId = 1

  register(filePath: string): FileEntry {
    const existing = this.byPath.get(filePath)
    if (existing) {
      existing.exists = true
      return existing
    }

    const token = `&xF${this.nextId.toString(16).toUpperCase().padStart(3, '0')};`
    this.nextId++

    const entry: FileEntry = { token, path: filePath, exists: true }
    this.byToken.set(token, entry)
    this.byPath.set(filePath, entry)
    return entry
  }

  getByPath(filePath: string): FileEntry | undefined {
    return this.byPath.get(filePath)
  }

  getByToken(token: string): FileEntry | undefined {
    return this.byToken.get(token)
  }

  markDeleted(filePath: string): void {
    const entry = this.byPath.get(filePath)
    if (entry) entry.exists = false
  }

  rename(oldPath: string, newPath: string): FileEntry {
    const entry = this.byPath.get(oldPath)
    if (!entry) return this.register(newPath)

    this.byPath.delete(oldPath)
    entry.path = newPath
    this.byPath.set(newPath, entry)
    return entry
  }

  entries(): FileEntry[] {
    return [...this.byToken.values()]
  }

  toJSON(): FileEntry[] {
    return this.entries()
  }

  fromJSON(data: FileEntry[]): void {
    this.byToken.clear()
    this.byPath.clear()
    let maxId = 0

    for (const entry of data) {
      this.byToken.set(entry.token, entry)
      this.byPath.set(entry.path, entry)
      const idMatch = entry.token.match(/&xF([0-9A-F]+);/i)
      if (idMatch) {
        maxId = Math.max(maxId, parseInt(idMatch[1]!, 16))
      }
    }

    this.nextId = maxId + 1
  }
}
