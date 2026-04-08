// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export type TaskDifficulty = 'simple' | 'medium' | 'complex'

export interface RouteResult {
  difficulty: TaskDifficulty
  model: string
  maxTurns: number
  effort: string
  score: number
  usedFallback: boolean
}

const MODEL_MAP: Record<TaskDifficulty, { model: string; maxTurns: number; effort: string }> = {
  simple:  { model: 'haiku',  maxTurns: 5,  effort: 'low' },
  medium:  { model: 'sonnet', maxTurns: 15, effort: 'medium' },
  complex: { model: 'opus',   maxTurns: 50, effort: 'high' },
}

// Weighted scoring signals — positive = complex, negative = simple
const SIGNALS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // === SIMPLICITY signals (negative weight) ===
  // One-shot commands
  { pattern: /^(open|run|start|stop|show|cat|ls|pwd)\b/, weight: -5, label: 'one-shot-cmd' },
  { pattern: /^(install|uninstall|update|upgrade)\s/, weight: -3, label: 'package-cmd' },
  { pattern: /^(git\s+(status|log|diff|add|commit|push|pull|branch))\b/, weight: -4, label: 'git-cmd' },
  // Simple questions
  { pattern: /^(what|where|which|how many|is there|does|can you|show me)\b/, weight: -3, label: 'question' },
  // Single file mentions
  { pattern: /\.(html|css|json|md|txt|yml|yaml|toml|env)$/i, weight: -2, label: 'simple-ext' },
  // Simple verbs with simple objects
  { pattern: /^(delete|remove|rename|move|copy|touch)\s+\S+$/, weight: -4, label: 'file-op' },
  // Quick style/color changes
  { pattern: /\b(color|background|font|size|margin|padding|border|opacity|shadow)\b/i, weight: -2, label: 'css-change' },
  { pattern: /\bmake\s+it\s+(red|blue|green|dark|light|big|small|bold|italic)\b/i, weight: -4, label: 'style-tweak' },
  // Short imperative with known file
  { pattern: /^(create|make|write|add)\s+(a\s+)?(simple|basic|new|hello)\b/, weight: -3, label: 'simple-create' },

  // === COMPLEXITY signals (positive weight) ===
  // Multi-file scope
  { pattern: /\b(all files|every file|whole project|entire|across the)\b/i, weight: 4, label: 'multi-scope' },
  { pattern: /\b(multiple|several)\s+(files|components|modules|pages)\b/i, weight: 3, label: 'multi-target' },
  // Architecture/design
  { pattern: /\b(refactor|rewrite|redesign|architect|migrate|restructure|overhaul)\b/i, weight: 5, label: 'refactor' },
  { pattern: /\b(system|framework|infrastructure|pipeline|engine|platform)\b/i, weight: 3, label: 'architecture' },
  { pattern: /\b(design pattern|abstraction|interface|dependency injection)\b/i, weight: 4, label: 'design' },
  // Debugging/investigation
  { pattern: /\b(debug|investigate|diagnose|figure out why|trace|root cause)\b/i, weight: 4, label: 'debug' },
  { pattern: /\b(performance|optimize|memory leak|profil|bottleneck)\b/i, weight: 3, label: 'perf' },
  // Testing
  { pattern: /\b(test suite|full coverage|integration tests|e2e|end.to.end)\b/i, weight: 4, label: 'testing' },
  // Build systems
  { pattern: /\b(implement|build)\s+(a|the|an)\s+\w+\s+(system|service|layer|module|api)\b/i, weight: 5, label: 'build-system' },
  { pattern: /\b(authentication|authorization|payment|billing|subscription)\b/i, weight: 3, label: 'feature' },
  // Multi-step indicators
  { pattern: /\b(then|after that|also|and also|next|finally|step \d)\b/i, weight: 2, label: 'multi-step' },
  { pattern: /\b(convert|transform|port)\s+.*(from|to)\b/i, weight: 3, label: 'conversion' },
  // Security
  { pattern: /\b(security|vulnerability|exploit|injection|xss|csrf|auth)\b/i, weight: 3, label: 'security' },
  // Database
  { pattern: /\b(database|schema|migration|seed|orm|query|sql)\b/i, weight: 3, label: 'database' },

  // === MEDIUM signals ===
  { pattern: /\b(fix|update|change|modify|adjust|tweak)\b/i, weight: 1, label: 'modify' },
  { pattern: /\b(add|create|implement|build)\b/i, weight: 1, label: 'create' },
  { pattern: /\b(component|page|route|endpoint|handler|hook)\b/i, weight: 1, label: 'web-concept' },
]

// Word count scoring
function wordCountScore(wordCount: number): number {
  if (wordCount <= 4) return -3    // very short = simple
  if (wordCount <= 8) return -1    // short = likely simple
  if (wordCount <= 15) return 0    // medium length
  if (wordCount <= 30) return 1    // detailed = probably medium
  return 3                          // long = probably complex
}

// File/path count scoring
function fileCountScore(prompt: string): number {
  const paths = prompt.match(/\b[\w./]+\.\w{1,5}\b/g) ?? []
  const dirs = prompt.match(/\b[\w./]+\//g) ?? []
  const count = new Set([...paths, ...dirs]).size
  if (count === 0) return 0
  if (count === 1) return -1  // single file = simpler
  if (count <= 3) return 2    // few files = medium
  return 4                     // many files = complex
}

// Code snippet scoring — if prompt contains code, it's more complex
function codeScore(prompt: string): number {
  if (prompt.includes('```')) return 2
  if (prompt.includes('=>') || prompt.includes('function ') || prompt.includes('class ')) return 1
  return 0
}

export function classifyTask(prompt: string): RouteResult {
  const lower = prompt.toLowerCase().trim()
  const words = lower.split(/\s+/)

  // Calculate weighted score
  let score = 0
  const matched: string[] = []

  for (const signal of SIGNALS) {
    if (signal.pattern.test(lower)) {
      score += signal.weight
      matched.push(signal.label)
    }
  }

  score += wordCountScore(words.length)
  score += fileCountScore(prompt)
  score += codeScore(prompt)

  // Map score to difficulty
  let difficulty: TaskDifficulty
  if (score <= -3) difficulty = 'simple'
  else if (score >= 5) difficulty = 'complex'
  else difficulty = 'medium'

  return { difficulty, ...MODEL_MAP[difficulty], score, usedFallback: false }
}

// Haiku fallback classifier — use when score is uncertain (between -2 and 4)
export async function classifyWithFallback(prompt: string): Promise<RouteResult> {
  const fast = classifyTask(prompt)

  // Confident? Use fast result
  if (fast.score <= -3 || fast.score >= 5) return fast

  // Uncertain range — ask haiku
  try {
    const { spawn } = await import('node:child_process')
    const proc = spawn('claude', [
      '--print', '--model', 'haiku', '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--', `Rate this task 1-3 (1=simple one-step, 2=moderate multi-step, 3=complex architecture/debugging). Reply with ONLY the number.\n\nTask: ${prompt}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    const chunks: Buffer[] = []
    for await (const chunk of proc.stdout!) chunks.push(chunk)
    const output = Buffer.concat(chunks).toString().trim()

    const rating = parseInt(output.charAt(0))
    if (rating === 1) return { difficulty: 'simple', ...MODEL_MAP.simple, score: fast.score, usedFallback: true }
    if (rating === 3) return { difficulty: 'complex', ...MODEL_MAP.complex, score: fast.score, usedFallback: true }
    return { difficulty: 'medium', ...MODEL_MAP.medium, score: fast.score, usedFallback: true }
  } catch {
    // Fallback failed — use fast result
    return fast
  }
}
