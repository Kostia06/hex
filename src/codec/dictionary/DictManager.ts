// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import path from 'node:path'
import fs from 'node:fs'
import { LanguageDict, type PhraseEntry } from './LanguageDict.ts'
import { FileDict, type FileEntry } from './FileDict.ts'
import { SymbolDict, type SymbolEntry, type SymbolKind } from './SymbolDict.ts'

export interface DictState {
  version: number
  savedAt: string
  phrases: PhraseEntry[]
  files: FileEntry[]
  symbols: SymbolEntry[]
}

export class DictManager {
  readonly phrases = new LanguageDict()
  readonly files = new FileDict()
  readonly symbols = new SymbolDict()

  private version = 0
  private dictPath: string

  constructor(rootDir?: string) {
    this.dictPath = path.join(rootDir ?? process.cwd(), '.hex', 'dictionary.json')
  }

  async load(): Promise<void> {
    try {
      const raw = await Bun.file(this.dictPath).text()
      const state: DictState = JSON.parse(raw)
      this.version = state.version
      this.phrases.fromJSON(state.phrases)
      this.files.fromJSON(state.files)
      this.symbols.fromJSON(state.symbols)
    } catch {
      // no dictionary yet — start fresh
    }
  }

  async save(): Promise<void> {
    this.version++
    const state: DictState = {
      version: this.version,
      savedAt: new Date().toISOString(),
      phrases: this.phrases.toJSON(),
      files: this.files.toJSON(),
      symbols: this.symbols.toJSON(),
    }

    const dir = path.dirname(this.dictPath)
    fs.mkdirSync(dir, { recursive: true })

    const tmpPath = this.dictPath + '.tmp'
    await Bun.write(tmpPath, JSON.stringify(state, null, 2))
    fs.renameSync(tmpPath, this.dictPath)
  }

  getToken(input: string): string | null {
    const phrase = this.phrases.getByPhrase(input)
    if (phrase) return phrase.token

    const file = this.files.getByPath(input)
    if (file) return file.token

    return null
  }

  resolve(token: string): string | null {
    const phrase = this.phrases.getByToken(token)
    if (phrase) return phrase.phrase

    const file = this.files.getByToken(token)
    if (file) return file.path

    const symbol = this.symbols.getByToken(token)
    if (symbol) return symbol.name

    return null
  }

  registerFile(filePath: string): FileEntry {
    return this.files.register(filePath)
  }

  registerSymbol(entry: Omit<SymbolEntry, 'token'>): SymbolEntry {
    return this.symbols.register(entry)
  }

  async onFileChange(event: 'add' | 'change' | 'unlink', filePath: string): Promise<void> {
    switch (event) {
      case 'add':
        this.files.register(filePath)
        break
      case 'unlink':
        this.files.markDeleted(filePath)
        const fileEntry = this.files.getByPath(filePath)
        if (fileEntry) {
          this.symbols.removeByFile(fileEntry.token)
        }
        break
      case 'change': {
        const entry = this.files.getByPath(filePath)
        if (entry) {
          this.symbols.removeByFile(entry.token)
        }
        break
      }
    }
  }

  stats(): { files: number; symbols: number; phrases: number; sizeKb: number } {
    const files = this.files.entries().length
    const symbols = this.symbols.entries().length
    const phrases = this.phrases.entries().length
    const json = JSON.stringify({
      phrases: this.phrases.toJSON(),
      files: this.files.toJSON(),
      symbols: this.symbols.toJSON(),
    })
    const sizeKb = Math.round(Buffer.byteLength(json, 'utf8') / 1024)

    return { files, symbols, phrases, sizeKb }
  }
}
