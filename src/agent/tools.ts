// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import path from 'node:path'
import fs from 'node:fs'
import type { DictManager } from '../codec/dictionary/DictManager.ts'
import type { HexCodec } from '../codec/HexCodec.ts'
import { scrub } from '../security/Scrubber.ts'
import { scanFile } from '../scanner/SymbolScanner.ts'
import { executeWebTool } from './webTool.ts'

export interface ToolOptions {
  scrubber: typeof scrub
  dict: DictManager
  codec: HexCodec
  cwd: string
  onWrite?: (filePath: string, content: string) => Promise<void>
}

function resolvePath(input: string, opts: ToolOptions): string {
  const fileEntry = opts.dict?.files.getByToken(input)
  const resolved = fileEntry ? fileEntry.path : input
  return path.isAbsolute(resolved) ? resolved : path.join(opts.cwd, resolved)
}

function resolveDir(input: string, opts: ToolOptions): string {
  const token = opts.dict?.resolve(input)
  const resolved = token ?? input
  return path.isAbsolute(resolved) ? resolved : path.join(opts.cwd, resolved)
}

async function readFile(input: Record<string, unknown>, opts: ToolOptions): Promise<string> {
  const filePath = resolvePath(input['path'] as string, opts)

  try {
    const content = await Bun.file(filePath).text()
    const lines = content.split('\n')
    const total = lines.length

    if (total > 500) {
      const truncated = lines.slice(0, 200)
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join('\n')
      return `${truncated}\n... [truncated, ${total} lines total]`
    }

    return lines.map((line, i) => `${String(i + 1).padStart(4)} | ${line}`).join('\n')
  } catch {
    return `ERROR: File not found: ${filePath}`
  }
}

async function writeFile(input: Record<string, unknown>, opts: ToolOptions): Promise<string> {
  const filePath = resolvePath(input['path'] as string, opts)
  const rawContent = input['content'] as string

  const result = scrub(rawContent, filePath)
  if (result.hadSecrets) {
    console.warn(`\u26A0 Scrubber removed ${result.detections.length} secret(s) from ${filePath}`)
  }

  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  await Bun.write(filePath, result.content)

  const lineCount = result.content.split('\n').length

  if (opts.dict && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
    const relativePath = path.relative(opts.cwd, filePath)
    const fileEntry = opts.dict.files.getByPath(relativePath) ?? opts.dict.registerFile(relativePath)
    opts.dict.symbols.removeByFile(fileEntry.token)
    await scanFile(filePath, fileEntry.token, opts.dict)
  }

  await opts.onWrite?.(filePath, result.content)

  return `Written: ${filePath} (${lineCount} lines)`
}

async function editFile(input: Record<string, unknown>, opts: ToolOptions): Promise<string> {
  const filePath = resolvePath((input['path'] ?? input['file_path'] ?? '') as string, opts)
  const oldStr = (input['old_str'] ?? input['old_string'] ?? '') as string
  const newStr = (input['new_str'] ?? input['new_string'] ?? '') as string

  // Validate
  if (!oldStr) return 'ERROR: old_string cannot be empty'

  try {
    const content = await Bun.file(filePath).text()
    const occurrences = content.split(oldStr).length - 1

    if (occurrences === 0) {
      return `ERROR: old_str not found in ${filePath}`
    }
    if (occurrences > 1) {
      return `ERROR: old_str appears ${occurrences} times in ${filePath}. Must be unique.`
    }

    const updated = content.replace(oldStr, newStr)
    const result = scrub(updated, filePath)
    await Bun.write(filePath, result.content)

    if (opts.dict && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
      const relativePath = path.relative(opts.cwd, filePath)
      const fileEntry = opts.dict.files.getByPath(relativePath) ?? opts.dict.registerFile(relativePath)
      opts.dict.symbols.removeByFile(fileEntry.token)
      await scanFile(filePath, fileEntry.token, opts.dict)
    }

    const relPath = path.relative(opts.cwd, filePath) || filePath
    // Human-readable + JSON for REPL diff rendering
    return `Edited ${relPath}\n${JSON.stringify({ _hexEdit: true, file: filePath, old: oldStr, new: newStr })}`
  } catch {
    return `ERROR: Could not read ${filePath}`
  }
}

async function runBash(input: Record<string, unknown>, opts: ToolOptions): Promise<string> {
  const command = input['command'] as string
  const timeoutMs = Math.min((input['timeout_ms'] as number) ?? 30000, 30000)

  try {
    const result = Bun.spawnSync(['sh', '-c', command], {
      cwd: opts.cwd,
      timeout: timeoutMs,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Truncate at line boundaries
    const stdoutLines = result.stdout.toString().split('\n')
    const stderrLines = result.stderr.toString().split('\n')
    const stdout = stdoutLines.slice(0, 200).join('\n') + (stdoutLines.length > 200 ? `\n[...${stdoutLines.length - 200} more lines]` : '')
    const stderr = stderrLines.slice(0, 50).join('\n')
    const prefix = result.exitCode !== 0 ? 'ERROR: ' : ''

    return `${prefix}Exit: ${result.exitCode}\n${stdout}${stderr ? '\nStderr:\n' + stderr : ''}`
  } catch (err) {
    return `ERROR: Command failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function listDir(input: Record<string, unknown>, opts: ToolOptions): Promise<string> {
  const dirPath = resolveDir((input['path'] as string) ?? '.', opts)
  const maxDepth = (input['depth'] as number) ?? 2

  function buildTree(dir: string, prefix: string, depth: number): string[] {
    if (depth > maxDepth) return []
    const lines: string[] = []

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        const isLast = i === entries.length - 1
        const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 '
        const childPrefix = isLast ? '    ' : '\u2502   '

        const relativePath = path.relative(opts.cwd, path.join(dir, entry.name))
        const token = opts.dict?.files.getByPath(relativePath)?.token ?? ''
        const suffix = token ? ` ${token}` : ''

        if (entry.isDirectory()) {
          lines.push(`${prefix}${connector}${entry.name}/${suffix}`)
          lines.push(...buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1))
        } else {
          lines.push(`${prefix}${connector}${entry.name}${suffix}`)
        }
      }
    } catch {
      lines.push(`${prefix}[unreadable]`)
    }

    return lines
  }

  const rootRelative = path.relative(opts.cwd, dirPath) || '.'
  const rootToken = opts.dict?.files.getByPath(rootRelative)?.token ?? ''
  const header = `${rootRelative}/${rootToken ? ` ${rootToken}` : ''}`

  return [header, ...buildTree(dirPath, '', 0)].join('\n')
}

const TOOL_TIMEOUT = 30_000

async function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool "${label}" timed out after ${ms / 1000}s`)), ms),
    ),
  ])
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  opts: ToolOptions,
): Promise<string> {
  try {
    // Normalize tool names (Claude CLI uses capitalized, our tools use lowercase)
    const n = name.toLowerCase()
    switch (n) {
      case 'read_file':
      case 'read':
        return await withTimeout(() => readFile(input, opts), TOOL_TIMEOUT, name)
      case 'write_file':
      case 'write':
        return await withTimeout(() => writeFile(input, opts), TOOL_TIMEOUT, name)
      case 'edit_file':
      case 'edit':
        return await withTimeout(() => editFile(input, opts), TOOL_TIMEOUT, name)
      case 'bash':
        return await withTimeout(() => runBash(input, opts), 60_000, name) // bash gets 60s
      case 'list_dir':
      case 'ls':
        return await withTimeout(() => listDir(input, opts), TOOL_TIMEOUT, name)
      case 'glob': {
        // Sanitize pattern
        const globPat = String(input['pattern'] ?? '*').replace(/[;&|`$(){}]/g, '')
        return await withTimeout(() => runBash({ command: `find . -name '${globPat}' -not -path '*/node_modules/*' -not -path '*/.git/*' | head -20` }, opts), TOOL_TIMEOUT, name)
      }
      case 'grep': {
        const grepPat = String(input['pattern'] ?? '').replace(/[;&|`$(){}]/g, '')
        return await withTimeout(() => runBash({ command: `grep -rn '${grepPat}' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.html' --include='*.css' -l . 2>/dev/null | head -20` }, opts), TOOL_TIMEOUT, name)
      }
      case 'web_fetch':
        return await withTimeout(() => executeWebTool('web_fetch', input), 15_000, name)
      case 'web_search':
        return await withTimeout(() => executeWebTool('web_search', input), 15_000, name)
      default:
        return `Unknown tool: ${name}`
    }
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`
  }
}
