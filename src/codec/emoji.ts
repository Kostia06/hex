// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export const EMOJI_MAP: Record<string, string> = {
  // Status
  '\u{1F534}': 'ERROR',
  '\u{1F7E2}': 'SUCCESS',
  '\u26A0\uFE0F': 'WARNING',
  '\u2705': 'DONE',
  '\u{1F6D1}': 'BLOCKED',
  '\u2753': 'UNKNOWN',
  // Actions
  '\u270F\uFE0F': 'EDIT',
  '\u{1F5D1}\uFE0F': 'DELETE',
  '\u{1F50D}': 'FIND',
  '\u{1F504}': 'REFACTOR',
  '\u{1F501}': 'RETRY',
  '\u{1F4A5}': 'CRASH',
  // Concepts
  '\u{1F4C1}': 'FILE',
  '\u2699\uFE0F': 'FUNCTION',
  '\u{1F9EA}': 'TEST',
  '\u{1F517}': 'DEPENDENCY',
  '\u{1F4E6}': 'PACKAGE',
  '\u{1F512}': 'SECURITY',
  '\u{1F4BE}': 'SAVE',
  '\u{1F680}': 'DEPLOY',
  '\u{1F9E0}': 'MEMORY',
  '\u{1F4DD}': 'LOG',
  '\u{1F527}': 'FIX',
  '\u2795': 'ADD',
  '\u2796': 'REMOVE',
  '\u{1F500}': 'MERGE',
  '\u{1F4E4}': 'EXPORT',
  '\u{1F4E5}': 'IMPORT',
  '\u23F1\uFE0F': 'TIMEOUT',
  '\u{1F50C}': 'CONNECT',
}

const reverseMap = new Map<string, string>()
for (const [emoji, word] of Object.entries(EMOJI_MAP)) {
  reverseMap.set(word, emoji)
}

export function emojiToWord(emoji: string): string | undefined {
  return EMOJI_MAP[emoji]
}

export function wordToEmoji(word: string): string | undefined {
  return reverseMap.get(word.toUpperCase())
}
