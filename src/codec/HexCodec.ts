// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import type { DictManager } from './dictionary/DictManager.ts'
import { encode } from './encode.ts'
import { decode } from './decode.ts'

export class HexCodec {
  constructor(private dict: DictManager) {}

  encode(text: string): string {
    return encode(text, this.dict)
  }

  decode(hcp: string): string {
    return decode(hcp, this.dict)
  }

  wrapSystemPrompt(basePrompt: string): string {
    const table = this.tokenTableFor([])
    return `${basePrompt}

<hex_compression_protocol>
You MUST write all inter-agent messages using HCP tokens.
Replace known file paths, symbols, and phrases with their hex tokens.
Never decode tokens yourself — the orchestrator handles decoding.

Current token table:
${table}
</hex_compression_protocol>`
  }

  tokenTableFor(filePaths: string[]): string {
    const lines: string[] = ['| Token | Type | Value |', '|---|---|---|']

    const fileEntries = filePaths.length > 0
      ? filePaths.map(p => this.dict.files.getByPath(p)).filter(Boolean)
      : this.dict.files.entries().filter(f => f.exists).slice(0, 100)

    for (const entry of fileEntries) {
      if (!entry) continue
      lines.push(`| ${entry.token} | file | ${entry.path} |`)

      const symbols = this.dict.symbols.getByFile(entry.token)
      for (const sym of symbols) {
        const sig = sym.signature ? ` ${sym.signature}` : ''
        lines.push(`| ${sym.token} | ${sym.kind} | ${sym.name}${sig} |`)
      }
    }

    const phrases = this.dict.phrases.entries()
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 30)

    for (const entry of phrases) {
      lines.push(`| ${entry.token} | phrase | ${entry.phrase} |`)
    }

    return lines.join('\n')
  }
}
