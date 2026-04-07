// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export type TaskDifficulty = 'simple' | 'medium' | 'complex'

export interface RouteResult {
  difficulty: TaskDifficulty
  model: string
  maxTurns: number
  effort: string
}

const MODEL_MAP: Record<TaskDifficulty, { model: string; maxTurns: number; effort: string }> = {
  simple:  { model: 'haiku',  maxTurns: 5,  effort: 'low' },
  medium:  { model: 'sonnet', maxTurns: 15, effort: 'medium' },
  complex: { model: 'opus',   maxTurns: 50, effort: 'high' },
}

// Fast local classification — no API call, just pattern matching
export function classifyTask(prompt: string): RouteResult {
  const lower = prompt.toLowerCase().trim()

  // Simple: one-step actions, questions, open/run/create a single thing
  const simplePatterns = [
    /^(open|run|start|stop|show|list|print|echo|cat|ls|pwd)\b/,
    /^(what|where|which|how many|is there)\b/,
    /^(create|make|write|add)\s+(a\s+)?(simple|basic|hello|new)\b/,
    /^(delete|remove|rename|move|copy)\s/,
    /^(install|uninstall|update)\s/,
    /^(git\s+(status|log|branch|diff|add|commit|push|pull))\b/,
    /^(open|inspect|serve)\b/,
    /\.(html|css|json|md|txt|yml|yaml)$/,
  ]

  // Complex: multi-file, architecture, refactoring, debugging
  const complexPatterns = [
    /\b(refactor|rewrite|redesign|architect|migrate|restructure)\b/,
    /\b(all files|every file|whole project|entire)\b/,
    /\b(system|framework|infrastructure|pipeline)\b/,
    /\b(debug|investigate|diagnose|figure out why)\b/,
    /\b(multiple|several|all the|across)\b.*\b(files|components|modules)\b/,
    /\b(implement|build)\s+(a|the)\s+\w+\s+(system|service|layer|module|engine)\b/,
    /\b(test suite|full coverage|integration tests)\b/,
  ]

  for (const pattern of simplePatterns) {
    if (pattern.test(lower)) return { difficulty: 'simple', ...MODEL_MAP.simple }
  }

  for (const pattern of complexPatterns) {
    if (pattern.test(lower)) return { difficulty: 'complex', ...MODEL_MAP.complex }
  }

  // Default to medium
  // Short prompts (< 15 words) are likely simple
  const wordCount = lower.split(/\s+/).length
  if (wordCount <= 8) return { difficulty: 'simple', ...MODEL_MAP.simple }
  if (wordCount <= 25) return { difficulty: 'medium', ...MODEL_MAP.medium }

  return { difficulty: 'medium', ...MODEL_MAP.medium }
}
