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
// auth + SDK used by providers, not directly here
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
  const submitRef = useRef<((prompt: string, fromUser?: boolean) => Promise<void>) | null>(null)
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
      onPrompt: async (hexIds: HexIdPayload[], browserPrompt: string, devtoolsContext?: string) => {
        const label = hexIds.map(h => {
          const tag = h.tagName
          const cls = h.className ? `.${h.className.split(' ')[0]}` : ''
          return `${tag}${cls}`
        }).join(', ') || 'page'

        const elementDetails = hexIds.map(h => {
          const parts = [`<${h.tagName}>`]
          if (h.className) parts.push(`class="${h.className}"`)
          if ((h as any).text) parts.push(`"${(h as any).text.slice(0, 40)}"`)
          return parts.join(' ')
        }).join(', ')
        dispatch({ type: 'SET_INPUT', value: `${browserPrompt} [${label}]` })
        dispatch({ type: 'SUBMIT_INPUT' })

        const targetFile = hexIds.find(h => (h as any).file)?.file as string || 'index.html'
        const isStructural = /\b(remove|delete|rearrange|reorder|move|swap|add|insert|replace|restructure)\b/i.test(browserPrompt)
        const constraint = isStructural ? '' : ' Only modify CSS/style/attributes — preserve all content and children.'
        const fullPrompt = `In ${targetFile}, for the element (${elementDetails}): ${browserPrompt}.${constraint}`

        if (submitRef.current) {
          await submitRef.current(fullPrompt, false)
          server.broadcast({ type: 'agent-token', text: '\u2713 Done' })
          setTimeout(() => server.broadcast({ type: 'reload' }), 800)
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

    // Add user message — skip if inspector already dispatched it
    if (fromUser) {
      dispatch({ type: 'SET_INPUT', value: prompt })
      dispatch({ type: 'SUBMIT_INPUT' })
    }

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
      // Don't show error for aborts — handleSubmit already showed "Interrupted"
      if (!controller.signal.aborted) {
        dispatch({ type: 'ADD_ERROR', content: err instanceof Error ? err.message : String(err) })
      }
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
          onPrompt: async (hexIds: HexIdPayload[], browserPrompt: string, devtoolsContext?: string) => {
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
            const targetFile = hexIds.find(h => (h as any).file)?.file as string || 'index.html'
            const fullPrompt = `Edit ${targetFile}: ${browserPrompt}\nSelected elements: ${elementDetails}${devtoolsContext ? '\nDevtools: ' + devtoolsContext : ''}`

            if (submitRef.current) {
              await submitRef.current(fullPrompt, false)
              inspectServer.broadcast({ type: 'agent-token', text: '\u2713 Done' })
              setTimeout(() => inspectServer.broadcast({ type: 'reload' }), 800)
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
        // Force end streaming state immediately
        if (state.currentAssistantId) {
          dispatch({ type: 'END_STREAMING', messageId: state.currentAssistantId, costUsd: 0, turns: 0 })
        }
        dispatch({ type: 'ADD_SYSTEM', content: 'Interrupted' })
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

    // Intercept "open X and inspect" — handle directly, no AI needed
    const openInspectMatch = prompt.match(/^open\s+(\S+\.html?)\s*(and\s+inspect|inspect)?\s*/i)
    if (openInspectMatch) {
      const file = openInspectMatch[1]!
      dispatch({ type: 'SET_INPUT', value: prompt })
      dispatch({ type: 'SUBMIT_INPUT' })
      autoStartInspector()
      Bun.spawnSync(['open', `http://localhost:4000`])
      dispatch({ type: 'ADD_SYSTEM', content: `Opened ${file} \u00B7 http://localhost:4000` })
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
