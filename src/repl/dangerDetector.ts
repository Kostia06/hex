// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

const DANGEROUS_PATTERNS = [
  // Destructive file operations
  /\brm\s+-rf?\b/i,
  /\bdelete\s+(all|everything|the\s+(project|repo|directory|folder))/i,
  /\bwipe\b/i,
  /\bformat\b/i,
  /\bnuke\b/i,
  /\bdestroy\b/i,
  // Git destructive
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bforce\s+push\b/i,
  // Database
  /\bdrop\s+(table|database|schema|collection)\b/i,
  /\btruncate\b/i,
  /\bDELETE\s+FROM\b(?!.*WHERE)/i,
  // System
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bcurl\b.*\|\s*sh\b/i,
  /\bcurl\b.*\|\s*bash\b/i,
  // Package/deploy
  /\bnpm\s+publish\b/i,
  /\bdeploy\s+to\s+prod/i,
  /\bpush\s+to\s+(main|master|production)\b/i,
]

export interface DangerResult {
  isDangerous: boolean
  reason: string
}

export function detectDanger(prompt: string): DangerResult {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(prompt)) {
      const match = prompt.match(pattern)
      return {
        isDangerous: true,
        reason: `contains: "${match?.[0] ?? 'dangerous pattern'}"`,
      }
    }
  }
  return { isDangerous: false, reason: '' }
}

export function detectToolDanger(toolName: string, input: Record<string, unknown>): DangerResult {
  if (toolName !== 'Bash' && toolName !== 'bash') {
    return { isDangerous: false, reason: '' }
  }

  const command = (input['command'] as string) ?? ''
  return detectDanger(command)
}
