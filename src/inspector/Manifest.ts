// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import path from 'node:path'

export interface ManifestEntry {
  hexId: string
  file: string
  line: number
  column: number
  component: string
  tagName: string
  className: string
  cssRules: string[]
  attributes: Record<string, string>
  hexToken: string
}

export class HexManifest {
  private entries = new Map<string, ManifestEntry>()
  private counters = new Map<string, number>()

  generateId(tagName: string): string {
    const count = (this.counters.get(tagName) ?? 0) + 1
    this.counters.set(tagName, count)
    return `hex-${tagName}-${count.toString().padStart(3, '0')}`
  }

  register(entry: ManifestEntry): void {
    this.entries.set(entry.hexId, entry)
  }

  getById(hexId: string): ManifestEntry | undefined {
    return this.entries.get(hexId)
  }

  getByFile(file: string): ManifestEntry[] {
    return [...this.entries.values()].filter(e => e.file === file)
  }

  async save(): Promise<void> {
    const data = {
      version: 1,
      generatedAt: new Date().toISOString(),
      entries: Object.fromEntries(this.entries),
    }
    await Bun.write(path.join(process.cwd(), 'hex-manifest.json'), JSON.stringify(data, null, 2))
  }

  async load(): Promise<void> {
    try {
      const raw = await Bun.file(path.join(process.cwd(), 'hex-manifest.json')).text()
      const data = JSON.parse(raw)
      for (const [id, entry] of Object.entries(data.entries ?? {})) {
        this.entries.set(id, entry as ManifestEntry)
      }
    } catch { /* file doesn't exist yet */ }
  }
}
