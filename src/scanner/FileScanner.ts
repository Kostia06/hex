// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import fs from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'
import type { DictManager } from '../codec/dictionary/DictManager.ts'
import { scanFile } from './SymbolScanner.ts'

export interface ScanResult {
  filesRegistered: number
  dirsRegistered: number
  symbolsRegistered: number
  durationMs: number
  skipped: string[]
}

const ALWAYS_SKIP = ['node_modules', 'dist', '.git', '.hex', '.next', '.svelte-kit']
const SKIP_EXTENSIONS = ['.lock', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot']
const TS_EXTENSIONS = ['.ts', '.tsx']

function loadIgnoreRules(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore()

  for (const file of ['.gitignore', '.hexignore']) {
    const filePath = path.join(rootDir, file)
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      ig.add(content)
    }
  }

  return ig
}

async function walkDir(
  dirPath: string,
  rootDir: string,
  ig: ReturnType<typeof ignore>,
  dict: DictManager,
  result: ScanResult,
): Promise<void> {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(rootDir, fullPath)

    if (ALWAYS_SKIP.includes(entry.name)) continue
    if (ig.ignores(relativePath)) {
      result.skipped.push(relativePath)
      continue
    }

    if (entry.isDirectory()) {
      dict.registerFile(relativePath)
      result.dirsRegistered++
      await walkDir(fullPath, rootDir, ig, dict, result)
      continue
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (SKIP_EXTENSIONS.includes(ext)) continue

      const fileEntry = dict.registerFile(relativePath)
      result.filesRegistered++

      if (TS_EXTENSIONS.includes(ext)) {
        const symbolCount = await scanFile(fullPath, fileEntry.token, dict)
        result.symbolsRegistered += symbolCount
      }
    }
  }
}

export async function scan(rootDir: string, dict: DictManager): Promise<ScanResult> {
  const start = Date.now()
  const ig = loadIgnoreRules(rootDir)

  const result: ScanResult = {
    filesRegistered: 0,
    dirsRegistered: 0,
    symbolsRegistered: 0,
    durationMs: 0,
    skipped: [],
  }

  await walkDir(rootDir, rootDir, ig, dict, result)
  await dict.save()

  result.durationMs = Date.now() - start
  return result
}
