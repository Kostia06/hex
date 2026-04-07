// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import os from 'node:os'

interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

interface CredentialsData {
  claudeAiOauth?: OAuthTokens
}

const SERVICE_NAME = 'Claude Code-credentials'

function getUsername(): string {
  return process.env['USER'] ?? os.userInfo().username ?? 'claude-code-user'
}

// Read OAuth tokens from macOS Keychain (same storage Claude Code uses)
async function readFromKeychain(): Promise<CredentialsData | null> {
  try {
    const result = Bun.spawnSync([
      'security', 'find-generic-password',
      '-a', getUsername(),
      '-s', SERVICE_NAME,
      '-w',
    ], { stdout: 'pipe', stderr: 'pipe' })

    if (result.exitCode !== 0) return null

    const raw = result.stdout.toString().trim()
    if (!raw) return null

    // Try parsing as plain JSON first, then as hex-encoded
    try {
      return JSON.parse(raw) as CredentialsData
    } catch {
      // Might be hex-encoded
      const bytes: number[] = []
      for (let i = 0; i < raw.length; i += 2) {
        bytes.push(parseInt(raw.slice(i, i + 2), 16))
      }
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as CredentialsData
    }
  } catch {
    return null
  }
}

// Fallback: read from plaintext credentials file
async function readFromFile(): Promise<CredentialsData | null> {
  try {
    const credPath = `${os.homedir()}/.claude/.credentials.json`
    const text = await Bun.file(credPath).text()
    return JSON.parse(text) as CredentialsData
  } catch {
    return null
  }
}

// Get the OAuth access token for Claude subscription
export async function getSubscriptionToken(): Promise<string | null> {
  // Try Keychain first
  const keychain = await readFromKeychain()
  if (keychain?.claudeAiOauth?.accessToken) {
    // Check if expired
    const expiresAt = keychain.claudeAiOauth.expiresAt ?? Infinity
    if (Date.now() < expiresAt) {
      return keychain.claudeAiOauth.accessToken
    }
    // Token expired — fall through to file
  }

  // Try credentials file
  const file = await readFromFile()
  if (file?.claudeAiOauth?.accessToken) {
    return file.claudeAiOauth.accessToken
  }

  // Try environment variable
  if (process.env['ANTHROPIC_API_KEY']) {
    return null // return null to signal "use API key instead"
  }

  return null
}

// Check if subscription auth is available
export async function hasSubscription(): Promise<boolean> {
  const token = await getSubscriptionToken()
  return token !== null
}
