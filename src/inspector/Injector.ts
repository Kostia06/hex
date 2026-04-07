// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import fs from 'node:fs'
import path from 'node:path'
import type { HexManifest } from './Manifest.ts'
import type { DictManager } from '../codec/dictionary/DictManager.ts'

const HTML_TAGS = 'nav|div|section|header|footer|main|aside|article|p|span|ul|ol|li|button|input|textarea|select|form|a|img|h[1-6]|table|tr|td|th|thead|tbody'
const TAG_PATTERN = new RegExp(`<(${HTML_TAGS})(\\s[^>]*)?>`, 'gi')
const SKIP_DIRS = ['node_modules', 'dist', '.git', '.hex', '.next']
const INJECTABLE_EXTS = ['.html', '.htm']

export async function injectFile(
  filePath: string,
  manifest: HexManifest,
  dict: DictManager,
): Promise<number> {
  const content = await Bun.file(filePath).text()
  const relativePath = path.relative(process.cwd(), filePath)
  const fileEntry = dict.files.getByPath(relativePath)
  const hexToken = fileEntry?.token ?? ''
  let count = 0

  const injected = content.replace(TAG_PATTERN, (match, tagName: string, attrs: string | undefined) => {
    if (match.includes('data-hex-id')) return match

    const position = content.indexOf(match)
    const line = content.slice(0, position).split('\n').length

    const hexId = manifest.generateId(tagName.toLowerCase())
    count++

    const classMatch = (attrs ?? '').match(/class="([^"]*)"/)
    const className = classMatch?.[1] ?? ''

    manifest.register({
      hexId,
      file: relativePath,
      line,
      column: 0,
      component: tagName.toLowerCase(),
      tagName: tagName.toLowerCase(),
      className,
      cssRules: [],
      attributes: {},
      hexToken,
    })

    const injection = ` data-hex-id="${hexId}" data-hex-file="${relativePath}" data-hex-line="${line}"`

    if (attrs) {
      return `<${tagName}${injection}${attrs}>`
    }
    return `<${tagName}${injection}>`
  })

  if (count > 0) {
    await Bun.write(filePath, injected)
  }

  return count
}

export async function injectDirectory(
  dirPath: string,
  manifest: HexManifest,
  dict: DictManager,
): Promise<number> {
  let total = 0

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name)) continue

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (INJECTABLE_EXTS.includes(path.extname(entry.name))) {
        // We queue these and handle async outside
      }
    }
  }

  // Collect injectable files
  const files: string[] = []
  function collectFiles(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        collectFiles(fullPath)
      } else if (INJECTABLE_EXTS.includes(path.extname(entry.name))) {
        files.push(fullPath)
      }
    }
  }

  collectFiles(dirPath)

  for (const file of files) {
    total += await injectFile(file, manifest, dict)
  }

  return total
}
