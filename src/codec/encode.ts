// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import type { DictManager } from './dictionary/DictManager.ts'
import { EMOJI_MAP } from './emoji.ts'

export function encode(text: string, dict: DictManager): string {
  let result = text

  // 1. Phrase replacement (longest first to prevent partial matches)
  const phrases = dict.phrases.entries()
    .sort((a, b) => b.phrase.length - a.phrase.length)

  for (const entry of phrases) {
    const escaped = entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    if (regex.test(result)) {
      result = result.replace(regex, entry.token)
      dict.phrases.incrementFrequency(entry.token)
    }
  }

  // 2. File path replacement
  const fileEntries = dict.files.entries()
    .filter(f => f.exists)
    .sort((a, b) => b.path.length - a.path.length)

  for (const entry of fileEntries) {
    const escaped = entry.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`["'\`]?${escaped}["'\`]?`, 'g')
    result = result.replace(regex, entry.token)
  }

  // 3. Symbol replacement (word boundary matching)
  const symbolEntries = dict.symbols.entries()
    .sort((a, b) => b.name.length - a.name.length)

  for (const entry of symbolEntries) {
    const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'g')
    result = result.replace(regex, entry.token)
  }

  // 4. Whitespace compression
  result = result.replace(/[ \t]{2,}/g, ' ')

  return result
}
