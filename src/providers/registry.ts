// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import type { ProviderConfig, ProviderKind } from './types.ts'

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.hex', 'providers.json')
const PROJECT_CONFIG_PATH = path.join(process.cwd(), '.hex', 'providers.json')

export interface ProvidersFile {
  version: 1
  providers: ProviderConfig[]
  defaultId: string | null
}

export class ProviderRegistry {
  private global: ProvidersFile = { version: 1, providers: [], defaultId: null }
  private project: ProvidersFile | null = null

  async load(): Promise<void> {
    try {
      const text = await Bun.file(GLOBAL_CONFIG_PATH).text()
      this.global = JSON.parse(text)
    } catch { /* first run */ }

    try {
      const text = await Bun.file(PROJECT_CONFIG_PATH).text()
      this.project = JSON.parse(text)
    } catch { /* no project config */ }
  }

  async saveGlobal(): Promise<void> {
    const dir = path.join(os.homedir(), '.hex')
    fs.mkdirSync(dir, { recursive: true })
    const tmp = GLOBAL_CONFIG_PATH + '.tmp'
    await Bun.write(tmp, JSON.stringify(this.global, null, 2))
    fs.renameSync(tmp, GLOBAL_CONFIG_PATH)
  }

  getAll(): ProviderConfig[] {
    const merged = new Map(this.global.providers.map(p => [p.id, p]))
    if (this.project) {
      for (const p of this.project.providers) {
        merged.set(p.id, p)
      }
    }
    return [...merged.values()]
  }

  getDefault(): ProviderConfig | null {
    const all = this.getAll()
    if (all.length === 0) return null

    if (this.project?.defaultId) {
      const found = all.find(p => p.id === this.project!.defaultId)
      if (found) return found
    }

    if (this.global.defaultId) {
      const found = all.find(p => p.id === this.global.defaultId)
      if (found) return found
    }

    return all[0] ?? null
  }

  getById(id: string): ProviderConfig | null {
    return this.getAll().find(p => p.id === id) ?? null
  }

  getByKind(kind: ProviderKind): ProviderConfig[] {
    return this.getAll().filter(p => p.kind === kind)
  }

  add(config: ProviderConfig): void {
    const existing = this.global.providers.findIndex(p => p.id === config.id)
    if (existing >= 0) {
      this.global.providers[existing] = config
    } else {
      this.global.providers.push(config)
    }

    if (this.global.providers.length === 1 || config.isDefault) {
      this.global.defaultId = config.id
    }
  }

  remove(id: string): boolean {
    const before = this.global.providers.length
    this.global.providers = this.global.providers.filter(p => p.id !== id)
    if (this.global.defaultId === id) {
      this.global.defaultId = this.global.providers[0]?.id ?? null
    }
    return this.global.providers.length < before
  }

  setDefault(id: string): boolean {
    const exists = this.global.providers.some(p => p.id === id)
    if (!exists) return false
    this.global.defaultId = id
    return true
  }

  updateLastUsed(id: string): void {
    const p = this.global.providers.find(p => p.id === id)
    if (p) p.lastUsedAt = new Date().toISOString()
  }

  hasAny(): boolean {
    return this.getAll().length > 0
  }

  encryptKey(key: string): string {
    const seed = this.getMachineId()
    const keyBytes = Buffer.from(key, 'utf8')
    const seedBytes = Buffer.from(seed.repeat(Math.ceil(key.length / seed.length)), 'utf8')
    const xored = Buffer.alloc(keyBytes.length)
    for (let i = 0; i < keyBytes.length; i++) {
      xored[i] = (keyBytes[i] ?? 0) ^ (seedBytes[i] ?? 0)
    }
    return xored.toString('base64')
  }

  decryptKey(encrypted: string): string {
    const seed = this.getMachineId()
    const xored = Buffer.from(encrypted, 'base64')
    const seedBytes = Buffer.from(seed.repeat(Math.ceil(xored.length / seed.length)), 'utf8')
    const result = Buffer.alloc(xored.length)
    for (let i = 0; i < xored.length; i++) {
      result[i] = (xored[i] ?? 0) ^ (seedBytes[i] ?? 0)
    }
    return result.toString('utf8')
  }

  private getMachineId(): string {
    return `${os.hostname()}-${os.userInfo().username}`
  }
}
