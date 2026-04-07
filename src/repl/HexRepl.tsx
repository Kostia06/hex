// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import React, { useReducer, useCallback, useRef, useEffect, useState } from 'react'
import { Box, useApp, useStdout } from 'ink'
import fs from 'node:fs'
import path from 'node:path'

import { replReducer, type ReplState } from './replState.ts'
import { StatusBar } from './StatusBar.tsx'
import { MessageList } from './MessageList.tsx'
import { InputBar } from './InputBar.tsx'
import { SlashMenu, SLASH_COMMANDS } from './SlashMenu.tsx'
import { detectDanger } from './dangerDetector.ts'

import { buildSystemPrompt } from '../agent/prompts.ts'
import { HexCodec } from '../codec/HexCodec.ts'
import { DictManager } from '../codec/dictionary/DictManager.ts'
import { BudgetTracker } from '../budget/BudgetTracker.ts'
import { detect, type HexEnvironment } from '../env/EnvDetector.ts'
import { scan } from '../scanner/FileScanner.ts'
import { HexWatcher } from '../scanner/Watcher.ts'
import { ProviderRegistry } from '../providers/registry.ts'
import { resolveProvider } from '../providers/resolver.ts'
import type { HexProvider } from '../providers/types.ts'
import { getSubscriptionToken } from '../providers/auth.ts'
import Anthropic from '@anthropic-ai/sdk'
import { HexManifest } from '../inspector/Manifest.ts'
// import { injectDirectory } from '../inspector/Injector.ts'
import { HexDevServer } from '../inspector/DevServer.ts'
import type { HexIdPayload } from '../inspector/DevServer.ts'

interface HexReplProps {
  initialPrompt?: string
  budgetUsd?: number
  maxTurns?: number
  cwd: string
}

export function HexRepl({ initialPrompt, budgetUsd, maxTurns = 50, cwd }: HexReplProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()

  const dictRef = useRef<DictManager | null>(null)
  const codecRef = useRef<HexCodec | null>(null)
  const envRef = useRef<HexEnvironment | null>(null)
  const budgetRef = useRef(new BudgetTracker(budgetUsd))
  const watcherRef = useRef<HexWatcher | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const providerRef = useRef<HexProvider | null>(null)

  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyFileRef = useRef(path.join(cwd, '.hex', 'prompt-history.txt'))
  const [slashIndex, setSlashIndex] = useState(0)
  const bootedRef = useRef(false)
  const [pendingConfirm, setPendingConfirm] = useState<{ prompt: string; reason: string } | null>(null)
  const ctrlCCountRef = useRef(0)
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inspectorRef = useRef<HexDevServer | null>(null)
  const submitRef = useRef<((prompt: string) => Promise<void>) | null>(null)
  const queueRef = useRef<string[]>([])
  const [queueSize, setQueueSize] = useState(0)

  const initialState: ReplState = {
    messages: [],
    input: '',
    isStreaming: false,
    currentAssistantId: null,
    showSlashMenu: false,
    slashFilter: '',
    sessionCostUsd: 0,
    totalTurns: 0,
    model: 'claude-sonnet-4-6',
    branch: 'unknown',
    gitClean: true,
    mode: 'standard',
  }

  const [state, dispatch] = useReducer(replReducer, initialState)

  // Boot sequence
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    const boot = async () => {
      // Load per-directory prompt history
      try {
        const histFile = historyFileRef.current
        if (fs.existsSync(histFile)) {
          const lines = fs.readFileSync(histFile, 'utf8').trim().split('\n').filter(Boolean)
          historyRef.current = lines.reverse() // most recent first
        }
      } catch { /* no history yet */ }

      const dict = new DictManager(cwd)
      await dict.load()
      dictRef.current = dict

      const codec = new HexCodec(dict)
      codecRef.current = codec

      const env = await detect()
      envRef.current = env

      // Resolve provider
      const registry = new ProviderRegistry()
      await registry.load()
      if (registry.hasAny()) {
        const provider = await resolveProvider(registry)
        providerRef.current = provider
        registry.updateLastUsed(provider.config.id)
        await registry.saveGlobal()
      }

      const providerLabel = providerRef.current?.config.model ?? 'no provider'

      dispatch({
        type: 'ADD_SYSTEM',
        content: `Session started \u00B7 ${providerLabel} \u00B7 ${env.gitBranch}(${env.gitClean ? 'clean' : 'dirty'}) \u00B7 ${cwd}`,
      })

      if (dict.stats().files === 0) {
        dispatch({ type: 'ADD_SYSTEM', content: 'Scanning project...' })
        const result = await scan(cwd, dict)
        await dict.save()
        dispatch({
          type: 'ADD_SYSTEM',
          content: `Dictionary ready \u00B7 ${result.filesRegistered} files \u00B7 ${result.symbolsRegistered} symbols`,
        })
      }

      const watcher = new HexWatcher(cwd, dict, codec)
      watcher.start()
      watcherRef.current = watcher

      if (initialPrompt) {
        dispatch({ type: 'SET_INPUT', value: initialPrompt })
        dispatch({ type: 'SUBMIT_INPUT' })
        await submitPrompt(initialPrompt)
      }
    }

    boot().catch(err => {
      dispatch({ type: 'ADD_ERROR', content: `Boot failed: ${err instanceof Error ? err.message : String(err)}` })
    })

    return () => {
      watcherRef.current?.stop()
      dictRef.current?.save()
      budgetRef.current.save()
    }
  }, [])

  const appendHistory = useCallback(async (prompt: string, response: string, costUsd: number, turns: number) => {
    const entry = {
      ts: new Date().toISOString(),
      prompt,
      response: response.slice(0, 2000),
      costUsd,
      turns,
    }
    const historyPath = path.join(cwd, '.hex', 'history.json')
    try {
      fs.mkdirSync(path.dirname(historyPath), { recursive: true })
      fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n')
    } catch { /* non-fatal */ }
  }, [cwd])

  const autoStartInspector = useCallback(() => {
    if (inspectorRef.current || !dictRef.current || !codecRef.current) return

    const manifest = new HexManifest()
    const hexPort = 4000

    const server = new HexDevServer({
      hexPort,
      serveDir: cwd,
      manifest,
      dict: dictRef.current,
      codec: codecRef.current,
      onPrompt: async (hexIds: HexIdPayload[], browserPrompt: string) => {
        const label = hexIds.map(h => {
          const tag = h.tagName
          const cls = h.className ? `.${h.className.split(' ')[0]}` : ''
          return `${tag}${cls}`
        }).join(', ') || 'page'

        const elementDetails = hexIds.map(h => {
          const parts = [`<${h.tagName}>`]
          if (h.className) parts.push(`class="${h.className}"`)
          if ((h as any).text) parts.push(`text: "${(h as any).text.slice(0, 60)}"`)
          if ((h as any).outerHTML) parts.push(`html: ${(h as any).outerHTML}`)
          return parts.join(' ')
        }).join('\n')
        dispatch({ type: 'SET_INPUT', value: `${browserPrompt} \u2192 [${label}]` })
        dispatch({ type: 'SUBMIT_INPUT' })

        const mid = crypto.randomUUID()
        dispatch({ type: 'START_STREAMING', messageId: mid })

        try {
          const token = await getSubscriptionToken()
          const apiKey = process.env['ANTHROPIC_API_KEY']
          const inspClient = token
            ? new Anthropic({ apiKey: token, defaultHeaders: { 'Authorization': `Bearer ${token}` } })
            : new Anthropic({ apiKey: apiKey ?? '' })

          // Detect file from selected elements or default to index.html
          const targetFile = hexIds.find(h => (h as any).file)?.file as string || 'index.html'
          const targetLines = hexIds.map(h => (h as any).line as number).filter(Boolean)

          let fileContent = ''
          try { fileContent = await Bun.file(path.join(cwd, targetFile)).text() } catch { /* */ }

          // For large files, send only relevant section around selected lines
          let contextContent = fileContent
          if (targetLines.length > 0 && fileContent.split('\n').length > 100) {
            const lines = fileContent.split('\n')
            const minLine = Math.max(0, Math.min(...targetLines) - 15)
            const maxLine = Math.min(lines.length, Math.max(...targetLines) + 15)
            contextContent = lines.slice(minLine, maxLine).map((l, i) => `${minLine + i + 1}: ${l}`).join('\n')
          }

          const inspTools: Anthropic.Tool[] = [
            { name: 'Edit', description: `Replace old_string with new_string in ${targetFile}`, input_schema: { type: 'object' as const, properties: { old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['old_string', 'new_string'] } },
          ]

          const lineHint = targetLines.length > 0 ? ` (around line ${targetLines[0]})` : ''
          const inspMsgs: Anthropic.MessageParam[] = [{ role: 'user', content: `${targetFile}${lineHint}:\n\`\`\`html\n${contextContent}\n\`\`\`\n\nSelected:\n${elementDetails}\n\nDo: ${browserPrompt}\n\nUse Edit tool. old_string must match the file exactly.` }]
          let inspTurns = 0, inspInput = 0, inspOutput = 0

          for (let t = 0; t < 2; t++) {
            const stream = inspClient.messages.stream({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 4096,
              system: 'You edit index.html. Use the Edit tool with old_string/new_string. No explanation. Just edit.',
              messages: inspMsgs,
              tools: inspTools,
            })

            for await (const event of stream) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                dispatch({ type: 'APPEND_TOKEN', messageId: mid, token: event.delta.text })
                server.broadcast({ type: 'agent-token', text: event.delta.text })
              }
            }

            const final = await stream.finalMessage()
            inspInput += final.usage.input_tokens
            inspOutput += final.usage.output_tokens
            inspMsgs.push({ role: 'assistant', content: final.content })
            inspTurns++

            const toolBlocks = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            if (toolBlocks.length === 0 || final.stop_reason !== 'tool_use') break

            const results: Anthropic.ToolResultBlockParam[] = []
            for (const tu of toolBlocks) {
              const input = (tu.input ?? {}) as Record<string, unknown>
              // Target the detected file
              input['file_path'] = input['file_path'] ?? path.join(cwd, targetFile)
              input['path'] = input['path'] ?? path.join(cwd, targetFile)
              dispatch({ type: 'ADD_TOOL_CALL', messageId: mid, tool: { name: 'Edit', input, status: 'done' } })

              const { executeTool } = await import('../agent/tools.ts')
              const result = await executeTool('edit_file', input, {
                scrubber: (await import('../security/Scrubber.ts')).scrub,
                dict: null as any, codec: null as any, cwd,
              })
              results.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
            }
            inspMsgs.push({ role: 'user', content: results })
          }

          const costUsd = (inspInput / 1e6 * 0.8) + (inspOutput / 1e6 * 4)
          dispatch({ type: 'END_STREAMING', messageId: mid, costUsd, turns: inspTurns })
          server.broadcast({ type: 'agent-token', text: '\n\u2713 Done' })
          setTimeout(() => server.broadcast({ type: 'reload' }), 800)
        } catch (err) {
          dispatch({ type: 'ADD_ERROR', content: err instanceof Error ? err.message : String(err) })
          dispatch({ type: 'END_STREAMING', messageId: mid, costUsd: 0, turns: 0 })
        }
      },
    })

    server.start()
    inspectorRef.current = server
    dispatch({ type: 'ADD_SYSTEM', content: `Inspector started \u00B7 http://localhost:${hexPort}` })
  }, [cwd])

  const submitPrompt = useCallback(async (prompt: string, fromUser = true) => {
    if (!dictRef.current || !codecRef.current || !envRef.current) return
    if (!providerRef.current) {
      dispatch({ type: 'ADD_ERROR', content: 'No provider configured. Run: hex provider add' })
      return
    }

    if (prompt === '__INTERRUPT__') {
      abortControllerRef.current?.abort()
      dispatch({ type: 'ADD_SYSTEM', content: 'Interrupted' })
      return
    }

    // Only save user-typed prompts to history
    if (fromUser) {
      historyRef.current.unshift(prompt)
      historyIndexRef.current = -1
      try {
        fs.mkdirSync(path.dirname(historyFileRef.current), { recursive: true })
        fs.appendFileSync(historyFileRef.current, prompt + '\n')
      } catch { /* non-fatal */ }
    }

    // Add user message to conversation
    dispatch({ type: 'SET_INPUT', value: prompt })
    dispatch({ type: 'SUBMIT_INPUT' })

    const messageId = crypto.randomUUID()
    dispatch({ type: 'START_STREAMING', messageId })

    const controller = new AbortController()
    abortControllerRef.current = controller

    const systemPrompt = buildSystemPrompt({
      env: envRef.current,
      dict: dictRef.current,
      codec: codecRef.current,
      mode: 'standard',
    })

    let totalCost = 0
    let turns = 0
    let finalText = ''

    try {
      for await (const event of providerRef.current.stream({
        prompt,
        systemPrompt,
        maxTurns,
        signal: controller.signal,
        onToken: (token) => {
          if (controller.signal.aborted) return
          finalText += token
          dispatch({ type: 'APPEND_TOKEN', messageId, token })
        },
        onToolCall: (name, input) => {
          if (controller.signal.aborted) return
          dispatch({
            type: 'ADD_TOOL_CALL',
            messageId,
            tool: { name, input, status: 'running' },
          })

          // Auto-start inspector when AI opens an HTML file
          const cmd = (input['command'] as string) ?? ''
          if ((name === 'Bash' || name === 'bash') && cmd.match(/^open\s+.*\.html?/i) && !inspectorRef.current) {
            autoStartInspector()
            // Open inspector URL instead of raw file
            setTimeout(() => {
              Bun.spawnSync(['open', 'http://localhost:4000'])
            }, 500)
          }
        },
        onToolResult: (name, result) => {
          if (controller.signal.aborted) return
          dispatch({
            type: 'UPDATE_TOOL_CALL',
            messageId,
            toolName: name,
            result,
            status: 'done',
            durationMs: 0,
          })
        },
        onTurnComplete: (turn) => {
          turns = turn
        },
      })) {
        if (controller.signal.aborted) break

        if (event.type === 'done') {
          totalCost = event.costUsd ?? 0
          budgetRef.current.record({
            agentName: 'main',
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            costUsd: totalCost,
          })
        }

        if (event.type === 'error') {
          dispatch({ type: 'ADD_ERROR', content: event.error ?? 'Unknown error' })
        }
      }

      dispatch({
        type: 'END_STREAMING',
        messageId,
        costUsd: totalCost,
        turns,
      })

      await appendHistory(prompt, finalText, totalCost, turns)
    } catch (err) {
      dispatch({ type: 'ADD_ERROR', content: err instanceof Error ? err.message : String(err) })
      dispatch({ type: 'END_STREAMING', messageId, costUsd: 0, turns: 0 })
    }

    abortControllerRef.current = null
    await dictRef.current?.save()

    // Process queued messages
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!
      setQueueSize(queueRef.current.length)
      await submitPrompt(next, true)
    }
  }, [maxTurns, cwd, appendHistory])

  // Keep ref updated for inspector callback
  submitRef.current = submitPrompt

  const handleSlashCommand = useCallback(async (cmd: string) => {
    const fullCmd = '/' + cmd
    // Save to history
    historyRef.current.unshift(fullCmd)
    historyIndexRef.current = -1
    try {
      fs.mkdirSync(path.dirname(historyFileRef.current), { recursive: true })
      fs.appendFileSync(historyFileRef.current, fullCmd + '\n')
    } catch { /* non-fatal */ }

    const parts = cmd.trim().split(/\s+/)
    const name = parts[0]

    switch (name) {
      case 'clear':
        dispatch({ type: 'CLEAR_HISTORY' })
        break

      case 'exit':
        await watcherRef.current?.stop()
        await dictRef.current?.save()
        await budgetRef.current.save()
        exit()
        break

      case 'cost':
        dispatch({ type: 'ADD_SYSTEM', content: budgetRef.current.summary() })
        break

      case 'scan':
        if (dictRef.current) {
          dispatch({ type: 'ADD_SYSTEM', content: 'Rescanning project...' })
          const result = await scan(cwd, dictRef.current)
          await dictRef.current.save()
          dispatch({
            type: 'ADD_SYSTEM',
            content: `Done \u00B7 ${result.filesRegistered} files \u00B7 ${result.symbolsRegistered} symbols`,
          })
        }
        break

      case 'dict':
        if (dictRef.current) {
          const s = dictRef.current.stats()
          dispatch({
            type: 'ADD_SYSTEM',
            content: `Dictionary: ${s.files} files \u00B7 ${s.symbols} symbols \u00B7 ${s.phrases} phrases \u00B7 ${s.sizeKb}kb`,
          })
        }
        break

      case 'compact':
        if (state.messages.length <= 4) {
          dispatch({ type: 'ADD_SYSTEM', content: 'Nothing to compact.' })
        } else {
          const toKeep = state.messages.slice(-4)
          const toCompact = state.messages.slice(0, -4)
          const summaryText = toCompact
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
            .slice(-10)
            .join(' | ')
          dispatch({ type: 'COMPACT', summary: summaryText.slice(0, 500), keep: toKeep })
          dispatch({ type: 'ADD_SYSTEM', content: `Compacted ${toCompact.length} messages` })
        }
        break

      case 'help': {
        const helpText = SLASH_COMMANDS
          .map(c => `/${c.name}${c.hint ? ' ' + c.hint : ''} \u2014 ${c.description}`)
          .join('\n')
        dispatch({ type: 'ADD_SYSTEM', content: helpText })
        break
      }

      case 'inspect': {
        // /inspect            → serve current dir on :4000
        // /inspect .          → serve current dir on :4000
        // /inspect index.html → serve current dir on :4000
        // /inspect 3000       → proxy port 3000 on :4000
        const arg = parts[1]
        const isPort = arg && /^\d+$/.test(arg)
        const targetPort = isPort ? parseInt(arg) : undefined
        const hexPort = parts[2] ? parseInt(parts[2]) : (targetPort ? targetPort + 1000 : 4000)
        const serveDir = (!arg || arg === '.' || !isPort) ? cwd : undefined

        // Stop existing inspector if running, then restart
        if (inspectorRef.current) {
          inspectorRef.current.stop()
          inspectorRef.current = null
        }

        if (!dictRef.current || !codecRef.current) {
          dispatch({ type: 'ADD_ERROR', content: 'Not ready yet. Wait for boot to complete.' })
          break
        }

        const manifest = new HexManifest()
        await manifest.load()
        // No injection needed — inspector works on any HTML via DOM inspection

        const inspectServer = new HexDevServer({
          targetPort,
          hexPort,
          serveDir,
          manifest,
          dict: dictRef.current,
          codec: codecRef.current,
          onPrompt: async (hexIds: HexIdPayload[], browserPrompt: string) => {
            const label = hexIds.map(h => {
              const tag = h.tagName
              const cls = h.className ? `.${h.className.split(' ')[0]}` : ''
              return `${tag}${cls}`
            }).join(', ') || 'page'

            const elementDetails = hexIds.map(h => {
              const parts = [`<${h.tagName}>`]
              if (h.className) parts.push(`class="${h.className}"`)
              if ((h as any).text) parts.push(`text: "${(h as any).text.slice(0, 60)}"`)
              if ((h as any).outerHTML) parts.push(`html: ${(h as any).outerHTML}`)
              return parts.join(' ')
            }).join('\n')
            dispatch({ type: 'SET_INPUT', value: `${browserPrompt} \u2192 [${label}]` })
            dispatch({ type: 'SUBMIT_INPUT' })

            const mid = crypto.randomUUID()
            dispatch({ type: 'START_STREAMING', messageId: mid })

            try {
              const token = await getSubscriptionToken()
              const ak = process.env['ANTHROPIC_API_KEY']
              const ic = token
                ? new Anthropic({ apiKey: token, defaultHeaders: { 'Authorization': `Bearer ${token}` } })
                : new Anthropic({ apiKey: ak ?? '' })

              const targetFile = hexIds.find(h => (h as any).file)?.file as string || 'index.html'
              const targetLines = hexIds.map(h => (h as any).line as number).filter(Boolean)

              let fileContent = ''
              try { fileContent = await Bun.file(path.join(cwd, targetFile)).text() } catch { /* */ }

              let contextContent = fileContent
              if (targetLines.length > 0 && fileContent.split('\n').length > 100) {
                const lines = fileContent.split('\n')
                const minLine = Math.max(0, Math.min(...targetLines) - 15)
                const maxLine = Math.min(lines.length, Math.max(...targetLines) + 15)
                contextContent = lines.slice(minLine, maxLine).map((l, i) => `${minLine + i + 1}: ${l}`).join('\n')
              }

              const editTool: Anthropic.Tool[] = [
                { name: 'Edit', description: `Replace old_string with new_string in ${targetFile}`, input_schema: { type: 'object' as const, properties: { old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['old_string', 'new_string'] } },
              ]

              const lineHint = targetLines.length > 0 ? ` (around line ${targetLines[0]})` : ''
              const im: Anthropic.MessageParam[] = [{ role: 'user', content: `${targetFile}${lineHint}:\n\`\`\`html\n${contextContent}\n\`\`\`\n\nSelected:\n${elementDetails}\n\nDo: ${browserPrompt}\n\nUse Edit tool. old_string must match the file exactly.` }]
              let turns = 0, inp = 0, out = 0

              for (let t = 0; t < 2; t++) {
                const s = ic.messages.stream({ model: 'claude-haiku-4-5-20251001', max_tokens: 4096, system: `You edit ${targetFile}. Use Edit tool with old_string/new_string. No explanation. Just edit.`, messages: im, tools: editTool })
                for await (const ev of s) {
                  if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
                    dispatch({ type: 'APPEND_TOKEN', messageId: mid, token: ev.delta.text })
                    inspectServer.broadcast({ type: 'agent-token', text: ev.delta.text })
                  }
                }
                const fm = await s.finalMessage()
                inp += fm.usage.input_tokens; out += fm.usage.output_tokens
                im.push({ role: 'assistant', content: fm.content }); turns++
                const tus = fm.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
                if (tus.length === 0 || fm.stop_reason !== 'tool_use') break
                const rs: Anthropic.ToolResultBlockParam[] = []
                for (const tu of tus) {
                  const input = (tu.input ?? {}) as Record<string, unknown>
                  input['file_path'] = input['file_path'] ?? path.join(cwd, targetFile)
                  input['path'] = input['path'] ?? path.join(cwd, targetFile)
                  dispatch({ type: 'ADD_TOOL_CALL', messageId: mid, tool: { name: 'Edit', input, status: 'done' } })
                  const { executeTool } = await import('../agent/tools.ts')
                  const r = await executeTool('edit_file', input, { scrubber: (await import('../security/Scrubber.ts')).scrub, dict: null as any, codec: null as any, cwd })
                  rs.push({ type: 'tool_result', tool_use_id: tu.id, content: r })
                }
                im.push({ role: 'user', content: rs })
              }

              dispatch({ type: 'END_STREAMING', messageId: mid, costUsd: (inp / 1e6 * 0.8) + (out / 1e6 * 4), turns })
              inspectServer.broadcast({ type: 'agent-token', text: '\n\u2713 Done' })
              setTimeout(() => inspectServer.broadcast({ type: 'reload' }), 800)
            } catch (err) {
              dispatch({ type: 'ADD_ERROR', content: err instanceof Error ? err.message : String(err) })
              dispatch({ type: 'END_STREAMING', messageId: mid, costUsd: 0, turns: 0 })
            }
          },
        })

        try {
          inspectServer.start()
          inspectorRef.current = inspectServer
          dispatch({ type: 'ADD_SYSTEM', content: `Inspector \u00B7 http://localhost:${hexPort}` })
        } catch (err) {
          dispatch({ type: 'ADD_ERROR', content: `Inspector failed: ${err instanceof Error ? err.message : String(err)}` })
        }
        break
      }

      case 'inspect-stop': {
        if (inspectorRef.current) {
          inspectorRef.current.stop()
          inspectorRef.current = null
          dispatch({ type: 'ADD_SYSTEM', content: 'Inspector stopped.' })
        } else {
          dispatch({ type: 'ADD_SYSTEM', content: 'No inspector running.' })
        }
        break
      }

      default:
        dispatch({ type: 'ADD_ERROR', content: `Unknown command: /${name}. Type /help for commands.` })
    }

    dispatch({ type: 'HIDE_SLASH_MENU' })
  }, [cwd, exit, state.messages])

  const historyUp = useCallback((): string | null => {
    const next = historyIndexRef.current + 1
    if (next >= historyRef.current.length) return null
    historyIndexRef.current = next
    return historyRef.current[next] ?? null
  }, [])

  const historyDown = useCallback((): string | null => {
    const next = historyIndexRef.current - 1
    if (next < 0) {
      historyIndexRef.current = -1
      return ''
    }
    historyIndexRef.current = next
    return historyRef.current[next] ?? null
  }, [])

  // Wrapper: danger detection + double-Enter confirmation
  const handleSubmit = useCallback(async (prompt: string) => {
    // Esc or Ctrl+C to interrupt/cancel
    if (prompt === '__INTERRUPT__' || prompt === '__ESC__') {
      if (state.isStreaming) {
        abortControllerRef.current?.abort()
        dispatch({ type: 'ADD_SYSTEM', content: 'Interrupted' })
        // Clear queue too
        queueRef.current = []
        setQueueSize(0)
        return
      }
      // Double Ctrl+C to quit
      ctrlCCountRef.current++
      if (ctrlCCountRef.current >= 2) {
        await watcherRef.current?.stop()
        await dictRef.current?.save()
        await budgetRef.current.save()
        exit()
        return
      }
      dispatch({ type: 'ADD_SYSTEM', content: 'Press Ctrl+C again to quit' })
      if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current)
      ctrlCTimerRef.current = setTimeout(() => { ctrlCCountRef.current = 0 }, 2000)
      return
    }

    ctrlCCountRef.current = 0

    // Pending danger confirmation
    if (pendingConfirm) {
      if (prompt.toLowerCase() === 'y' || prompt.toLowerCase() === 'yes' || prompt === '') {
        setPendingConfirm(null)
        await submitPrompt(pendingConfirm.prompt)
      } else {
        setPendingConfirm(null)
        dispatch({ type: 'ADD_SYSTEM', content: 'Cancelled.' })
      }
      return
    }

    // Queue message if currently streaming
    if (state.isStreaming) {
      queueRef.current.push(prompt)
      setQueueSize(queueRef.current.length)
      dispatch({ type: 'ADD_SYSTEM', content: `Queued: "${prompt.slice(0, 50)}" (${queueRef.current.length} in queue)` })
      return
    }

    // Check for dangerous content
    const danger = detectDanger(prompt)
    if (danger.isDangerous) {
      dispatch({
        type: 'ADD_SYSTEM',
        content: `\u26A0 Dangerous (${danger.reason}). Enter to confirm, "n" to cancel.`,
      })
      setPendingConfirm({ prompt, reason: danger.reason })
      return
    }

    await submitPrompt(prompt)
  }, [state.isStreaming, pendingConfirm, submitPrompt, exit])

  return (
    <Box flexDirection="column" height={stdout.rows ?? 24}>
      <StatusBar
        model={state.model}
        branch={envRef.current?.gitBranch ?? '...'}
        gitClean={envRef.current?.gitClean ?? true}
        sessionCostUsd={state.sessionCostUsd}
        totalTurns={state.totalTurns}
        isStreaming={state.isStreaming}
        mode={state.mode}
        cwd={cwd}
      />

      <MessageList messages={state.messages} />

      {state.showSlashMenu && (
        <SlashMenu
          filter={state.slashFilter}
          selectedIndex={slashIndex}
        />
      )}

      <InputBar
        value={state.input}
        isStreaming={state.isStreaming || !!pendingConfirm}
        onChange={(value) => {
          if (pendingConfirm) return  // lock input during confirm
          dispatch({ type: 'SET_INPUT', value })
        }}
        onSubmit={handleSubmit}
        onSlashCommand={handleSlashCommand}
        historyUp={historyUp}
        historyDown={historyDown}
      />
    </Box>
  )
}
