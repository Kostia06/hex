// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import path from 'node:path'
import chokidar from 'chokidar'
import type { DictManager } from '../codec/dictionary/DictManager.ts'
import type { HexCodec } from '../codec/HexCodec.ts'
import { scanFile } from './SymbolScanner.ts'

const TS_EXTENSIONS = ['.ts', '.tsx']

export class HexWatcher {
  private watcher: chokidar.FSWatcher | null = null
  private saveTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private rootDir: string,
    private dict: DictManager,
    private codec: HexCodec,
  ) {}

  start(): void {
    this.watcher = chokidar.watch(this.rootDir, {
      ignored: [/node_modules/, /\.git/, /\.hex/, /dist/],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })

    this.watcher
      .on('add', (p) => this.handleAdd(p))
      .on('unlink', (p) => this.handleUnlink(p))
      .on('change', (p) => this.handleChange(p))
      .on('addDir', (p) => this.handleAddDir(p))
      .on('unlinkDir', (p) => this.handleUnlinkDir(p))
  }

  async stop(): Promise<void> {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    await this.watcher?.close()
  }

  private debouncedSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => {
      this.dict.save().catch(() => {})
    }, 1000)
  }

  private async handleAdd(fullPath: string): Promise<void> {
    const relativePath = path.relative(this.rootDir, fullPath)
    const fileEntry = this.dict.registerFile(relativePath)

    if (TS_EXTENSIONS.includes(path.extname(fullPath))) {
      await new Promise(resolve => setTimeout(resolve, 500))
      await scanFile(fullPath, fileEntry.token, this.dict)
    }

    this.debouncedSave()
  }

  private async handleUnlink(fullPath: string): Promise<void> {
    const relativePath = path.relative(this.rootDir, fullPath)
    const fileEntry = this.dict.files.getByPath(relativePath)

    this.dict.files.markDeleted(relativePath)
    if (fileEntry) {
      this.dict.symbols.removeByFile(fileEntry.token)
    }

    this.debouncedSave()
  }

  private async handleChange(fullPath: string): Promise<void> {
    if (!TS_EXTENSIONS.includes(path.extname(fullPath))) return

    const relativePath = path.relative(this.rootDir, fullPath)
    const fileEntry = this.dict.files.getByPath(relativePath)
    if (!fileEntry) return

    await new Promise(resolve => setTimeout(resolve, 500))

    this.dict.symbols.removeByFile(fileEntry.token)
    await scanFile(fullPath, fileEntry.token, this.dict)

    this.debouncedSave()
  }

  private handleAddDir(fullPath: string): void {
    const relativePath = path.relative(this.rootDir, fullPath)
    this.dict.registerFile(relativePath)
    this.debouncedSave()
  }

  private handleUnlinkDir(fullPath: string): void {
    const relativePath = path.relative(this.rootDir, fullPath)
    this.dict.files.markDeleted(relativePath)

    const fileEntry = this.dict.files.getByPath(relativePath)
    if (fileEntry) {
      for (const entry of this.dict.files.entries()) {
        if (entry.path.startsWith(relativePath + '/')) {
          this.dict.files.markDeleted(entry.path)
          this.dict.symbols.removeByFile(entry.token)
        }
      }
    }

    this.debouncedSave()
  }
}
