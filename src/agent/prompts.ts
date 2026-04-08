// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import type { HexEnvironment } from '../env/EnvDetector.ts'
import { toPromptString } from '../env/EnvDetector.ts'
import type { DictManager } from '../codec/dictionary/DictManager.ts'
import type { HexCodec } from '../codec/HexCodec.ts'

export interface PromptOptions {
  env: HexEnvironment
  dict: DictManager
  codec: HexCodec
  mode: 'standard' | 'swarm-agent' | 'swarm-orchestrator'
  agentName?: string
  agentTask?: string
  goal?: string
  relevantFiles?: string[]
}

function buildStandardPrompt(opts: PromptOptions): string {
  const envStr = toPromptString(opts.env)

  return `You are Hex. Act, don't explain.

${envStr}

RULES:
- "open X" = \`open X\`. One bash call. Do NOT read the file.
- "create X" = one write. Do NOT read or list first.
- "edit X" = read once, edit once. Done.
- Response: 1 sentence max. Say what you did.
- Never ask questions. Never describe file contents. Never inspect or analyze unless asked.
- Never glob, grep, or list directories unless the task requires finding something.`
}

function buildSwarmAgentPrompt(opts: PromptOptions): string {
  const base = buildStandardPrompt(opts)
  const tokenTable = opts.codec.tokenTableFor(opts.relevantFiles ?? [])

  return `${base}

<swarm_context>
You are the "${opts.agentName}" agent in a parallel swarm.
Overall goal: ${opts.goal}
YOUR specific task: ${opts.agentTask}
You are working in an isolated git worktree branch. Do not touch files outside your assigned scope. If you need something from another agent, document it as a dependency note at the end of your output:
DEPS: [agent-name] needs to \${description}

Write all progress messages in HCP (Hex Compression Protocol) format.
Use the tokens in your dictionary. Only your FINAL SUMMARY should be in plain English \u2014 everything else uses HCP to save tokens.
</swarm_context>

<token_table>
${tokenTable}
</token_table>`
}

function buildOrchestratorPrompt(opts: PromptOptions): string {
  return `You are the Hex Swarm Orchestrator. You receive the outputs of N parallel agents and synthesize them into a coherent result.

<environment>
${toPromptString(opts.env)}
</environment>

<goal>
${opts.goal}
</goal>

Your job:
1. Decode all HCP messages from agents into plain English
2. Identify conflicts (two agents edited the same file differently)
3. Identify dependency ordering for merging (which branches to merge first)
4. Identify gaps (tasks mentioned but not completed)
5. Write a final integration summary in plain English for the user

Format your output as:
CONFLICTS: [list or "none"]
MERGE_ORDER: [agent names in order]
GAPS: [list or "none"]
SUMMARY: [plain English summary of what was built]`
}

export function buildSystemPrompt(opts: PromptOptions): string {
  switch (opts.mode) {
    case 'standard': return buildStandardPrompt(opts)
    case 'swarm-agent': return buildSwarmAgentPrompt(opts)
    case 'swarm-orchestrator': return buildOrchestratorPrompt(opts)
  }
}
