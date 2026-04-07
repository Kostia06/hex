// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import type { DictManager } from './dictionary/DictManager.ts'
import { EMOJI_MAP } from './emoji.ts'

const TOKEN_PATTERN = /&x[FDSMLVEP][0-9A-F]{3};/gi

export function decode(hcp: string, dict: DictManager): string {
  let result = hcp

  // 1. Replace all hex tokens with human-readable strings
  result = result.replace(TOKEN_PATTERN, (match) => {
    const resolved = dict.resolve(match)
    if (resolved) return resolved
    return `[?]${match}`
  })

  // 2. Replace emoji with English words
  for (const [emoji, word] of Object.entries(EMOJI_MAP)) {
    if (result.includes(emoji)) {
      result = result.replaceAll(emoji, word)
    }
  }

  return result
}
