// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import simpleGit from 'simple-git'

export interface HexEnvironment {
  os: 'darwin' | 'linux' | 'win32'
  osVersion: string
  shell: 'bash' | 'zsh' | 'fish' | 'powershell' | 'cmd' | 'unknown'
  shellPath: string
  packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm'
  bunVersion: string | null
  nodeVersion: string | null
  pythonVersion: string | null
  gitBranch: string
  gitClean: boolean
  cwd: string
  homeDir: string
  activeVenv: string | null
  nvmVersion: string | null
}

function detectShell(): { shell: HexEnvironment['shell']; shellPath: string } {
  const platform = process.platform

  if (platform === 'win32') {
    if (process.env['PSModulePath']) {
      return { shell: 'powershell', shellPath: process.env['PSModulePath'] ?? '' }
    }
    return { shell: 'cmd', shellPath: process.env['COMSPEC'] ?? 'cmd.exe' }
  }

  const shellPath = process.env['SHELL'] ?? ''
  const basename = path.basename(shellPath)

  const shellMap: Record<string, HexEnvironment['shell']> = {
    zsh: 'zsh',
    bash: 'bash',
    fish: 'fish',
  }

  return { shell: shellMap[basename] ?? 'unknown', shellPath }
}

function detectPackageManager(cwd: string): HexEnvironment['packageManager'] {
  const checks: Array<[string, HexEnvironment['packageManager']]> = [
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ]

  for (const [file, pm] of checks) {
    if (fs.existsSync(path.join(cwd, file))) {
      return pm
    }
  }

  return 'npm'
}

function runCommand(args: string[]): string | null {
  try {
    const result = Bun.spawnSync(args, { stderr: 'pipe', stdout: 'pipe' })
    if (result.exitCode !== 0) return null
    return result.stdout.toString().trim().replace(/^v/, '')
  } catch {
    return null
  }
}

async function detectGitInfo(cwd: string): Promise<{ gitBranch: string; gitClean: boolean }> {
  try {
    const git = simpleGit(cwd)
    const branch = await git.branch()
    const status = await git.status()
    return { gitBranch: branch.current, gitClean: status.isClean() }
  } catch {
    return { gitBranch: 'unknown', gitClean: true }
  }
}

function detectVenv(): string | null {
  return process.env['VIRTUAL_ENV'] ?? process.env['CONDA_DEFAULT_ENV'] ?? null
}

function detectNvmVersion(): string | null {
  const nvmBin = process.env['NVM_BIN']
  if (!nvmBin) return null
  const match = nvmBin.match(/\/v?([\d.]+)\//)
  return match?.[1] ?? null
}

export async function detect(): Promise<HexEnvironment> {
  const cwd = process.cwd()
  const { shell, shellPath } = detectShell()
  const gitInfo = await detectGitInfo(cwd)

  return {
    os: process.platform as HexEnvironment['os'],
    osVersion: os.release(),
    shell,
    shellPath,
    packageManager: detectPackageManager(cwd),
    bunVersion: runCommand(['bun', '--version']),
    nodeVersion: runCommand(['node', '--version']),
    pythonVersion: runCommand(['python3', '--version'])?.replace('Python ', '') ?? null,
    gitBranch: gitInfo.gitBranch,
    gitClean: gitInfo.gitClean,
    cwd,
    homeDir: os.homedir(),
    activeVenv: detectVenv(),
    nvmVersion: detectNvmVersion(),
  }
}

export function toPromptString(env: HexEnvironment): string {
  const osName = env.os === 'darwin' ? 'macOS' : env.os === 'win32' ? 'Windows' : 'Linux'
  const parts = [
    `${osName} ${env.osVersion}`,
    `${env.shell} (${env.shellPath})`,
    env.bunVersion ? `bun ${env.bunVersion}` : null,
    env.nodeVersion ? `node ${env.nodeVersion}` : null,
    `git:${env.gitBranch}(${env.gitClean ? 'clean' : 'dirty'})`,
    `cwd:${env.cwd}`,
  ].filter(Boolean)

  let result = `Environment: ${parts.join(' | ')}`

  if (env.activeVenv) {
    result += ` | venv:${env.activeVenv}`
  }

  return result
}
