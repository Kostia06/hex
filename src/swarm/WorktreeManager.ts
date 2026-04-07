// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import fs from 'node:fs'
import path from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'

export interface Worktree {
  agentName: string
  branch: string
  path: string
  status: 'active' | 'merged' | 'failed' | 'conflict'
}

export class WorktreeManager {
  private git: SimpleGit
  private worktrees = new Map<string, Worktree>()

  constructor(private rootDir: string) {
    this.git = simpleGit(rootDir)
  }

  async create(agentName: string): Promise<Worktree> {
    const ts = Date.now()
    const branch = `hex/${agentName}/${ts}`
    const wtPath = path.join(this.rootDir, '.hex', 'worktrees', agentName)

    fs.mkdirSync(path.join(this.rootDir, '.hex', 'worktrees'), { recursive: true })

    try {
      await this.git.raw(['worktree', 'add', wtPath, '-b', branch])
    } catch {
      // worktree may already exist — remove and retry
      try {
        await this.git.raw(['worktree', 'remove', wtPath, '--force'])
      } catch { /* ignore */ }
      await this.git.raw(['worktree', 'add', wtPath, '-b', branch])
    }

    const worktree: Worktree = { agentName, branch, path: wtPath, status: 'active' }
    this.worktrees.set(agentName, worktree)
    return worktree
  }

  async remove(agentName: string): Promise<void> {
    const wt = this.worktrees.get(agentName)
    if (!wt) return

    try {
      await this.git.raw(['worktree', 'remove', wt.path, '--force'])
    } catch { /* already removed */ }

    try {
      await this.git.raw(['branch', '-D', wt.branch])
    } catch { /* branch may not exist */ }

    this.worktrees.delete(agentName)
  }

  async merge(agentName: string, strategy: 'merge' | 'rebase' = 'merge'): Promise<'ok' | 'conflict'> {
    const wt = this.worktrees.get(agentName)
    if (!wt) throw new Error(`No worktree for agent: ${agentName}`)

    try {
      if (strategy === 'merge') {
        await this.git.merge([wt.branch, '--no-ff', '-m', `hex: merge ${agentName} agent`])
      } else {
        await this.git.rebase([wt.branch])
      }
      wt.status = 'merged'
      return 'ok'
    } catch {
      wt.status = 'conflict'
      return 'conflict'
    }
  }

  async mergeAll(order: string[]): Promise<Map<string, 'ok' | 'conflict'>> {
    const results = new Map<string, 'ok' | 'conflict'>()
    for (const agentName of order) {
      results.set(agentName, await this.merge(agentName))
    }
    return results
  }

  async cleanup(): Promise<void> {
    const names = [...this.worktrees.keys()]
    for (const name of names) {
      await this.remove(name)
    }
    try {
      await this.git.raw(['worktree', 'prune'])
    } catch { /* ignore */ }
  }

  getWorktreePath(agentName: string): string {
    return this.worktrees.get(agentName)?.path ?? ''
  }
}
