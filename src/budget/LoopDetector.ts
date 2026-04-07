// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export interface LoopCheckResult {
  isLooping: boolean
  reason?: string
}

const WINDOW = 5
const THRESHOLD = 0.85
const TOKEN_PATTERN = /&x[FDSMLVEP][0-9A-F]{3};/gi

export class LoopDetector {
  private recentMessages: string[] = []

  constructor(private maxTurns: number = 50) {}

  check(latestMessage: string, currentTurn: number): LoopCheckResult {
    if (currentTurn >= this.maxTurns) {
      return { isLooping: true, reason: `Max turns (${this.maxTurns}) reached` }
    }

    this.recentMessages.push(latestMessage)
    if (this.recentMessages.length > WINDOW) {
      this.recentMessages.shift()
    }

    // Exact repeat detection
    const counts = new Map<string, number>()
    for (const msg of this.recentMessages) {
      const normalized = msg.trim().toLowerCase().slice(0, 200)
      const count = (counts.get(normalized) ?? 0) + 1
      counts.set(normalized, count)
      if (count >= 2) {
        return { isLooping: true, reason: 'Repeated identical response detected' }
      }
    }

    // HCP token pattern repeat
    if (this.recentMessages.length >= 3) {
      const tokenSets = this.recentMessages.slice(-3).map(m => {
        const tokens = [...m.matchAll(TOKEN_PATTERN)].map(match => match[0])
        return new Set(tokens)
      })

      const first = tokenSets[0]
      if (first && first.size > 3) {
        const intersection = [...first].filter(t => tokenSets.every(s => s.has(t)))
        if (intersection.length / first.size > THRESHOLD) {
          return { isLooping: true, reason: 'Repeating HCP token pattern detected' }
        }
      }
    }

    return { isLooping: false }
  }

  reset(): void {
    this.recentMessages = []
  }
}
