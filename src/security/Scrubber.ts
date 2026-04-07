// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import fs from 'node:fs'
import path from 'node:path'
import { SECRET_PATTERNS, type SecretPattern } from './patterns.ts'

export interface Detection {
  pattern: SecretPattern
  original: string
  replacement: string
  line: number
}

export interface ScrubResult {
  content: string
  detections: Detection[]
  hadSecrets: boolean
}

function appendToLog(entry: object): void {
  const logPath = path.join(process.cwd(), '.hex', 'scrubber.log')
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n')
  } catch {
    // silently fail — logging should never crash the scrubber
  }
}

export function scrub(content: string, filename: string): ScrubResult {
  const detections: Detection[] = []
  let scrubbed = content
  const lines = content.split('\n')

  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags)
    let match: RegExpExecArray | null

    while ((match = regex.exec(scrubbed)) !== null) {
      const matchedValue = match[1] ?? match[0]
      const position = match.index
      const lineNumber = scrubbed.slice(0, position).split('\n').length

      const replacement = `process.env.${pattern.envVarName}`
      const original = matchedValue.slice(0, 8) + '...'

      detections.push({ pattern, original, replacement, line: lineNumber })

      appendToLog({
        ts: new Date().toISOString(),
        file: filename,
        pattern: pattern.name,
        line: lineNumber,
      })

      scrubbed = scrubbed.slice(0, match.index) + replacement + scrubbed.slice(match.index + match[0].length)
      regex.lastIndex = match.index + replacement.length
    }
  }

  return {
    content: scrubbed,
    detections,
    hadSecrets: detections.length > 0,
  }
}

export async function scrubFile(filePath: string): Promise<ScrubResult> {
  const content = await Bun.file(filePath).text()
  const result = scrub(content, filePath)

  if (result.hadSecrets) {
    await Bun.write(filePath, result.content)
  }

  return result
}
