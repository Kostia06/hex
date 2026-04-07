```
 ╭───────────────────────────────────╮
 │                                   │
 │      ⬡  H  E  X                  │
 │                                   │
 │   The queen bee of AI coding      │
 │   agents                          │
 │                                   │
 ╰───────────────────────────────────╯
```

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-cyan.svg)](package.json)

## Features

| Feature | Description |
|---|---|
| ⬡ Agent Loop | Streaming Claude agent with tool use |
| 🔐 Scrubber | Auto-detects and strips 20+ secret patterns before file writes |
| 📦 HCP Codec | Hex Compression Protocol — compresses agent↔agent messages with tokens |
| 🔍 Scanner | AST-powered file + symbol scanner builds the HCP dictionary |
| 👁️ Watcher | Chokidar file watcher keeps the dictionary live |
| 🐝 Swarm | Parallel agents in git worktrees with orchestrated merge |
| 💰 Budget | Real-time cost tracking with per-agent breakdown |
| 🔁 Loop Detector | Catches stuck agents via message similarity analysis |
| 🧪 Sandbox | Auto-generates and runs tests in a VM sandbox |
| 🕵️ Inspector | Visual web inspector — click elements, prompt changes |
| 🌍 EnvDetector | Detects OS, shell, package manager, versions for accurate commands |

## Installation

```bash
bun install -g @hexhive/cli
```

## Quick Start

```bash
# Ask hex to do something
hex "add a login page with email and password"

# Run a parallel swarm
hex swarm --goal "build auth system" \
  --agent "routes: add /login and /signup routes" \
  --agent "ui: create login and signup components" \
  --agent "db: add users table with bcrypt passwords"

# Scan your project to build the HCP dictionary
hex scan

# View cost history
hex budget

# Start the visual inspector (with your dev server on port 3000)
hex inspect --port 3000
```

## HCP Codec

The Hex Compression Protocol replaces verbose English with short tokens to minimize token spend in agent-to-agent swarm communication.

**Before (raw agent message):**
```
I found a type error in src/auth/jwt.ts on line 42. The validateToken
function returns undefined when the token is expired. I need to edit
the error handling to throw an AuthenticationError instead.
```

**After (HCP encoded):**
```
🔴 &xP006; &xF001; &xL042; &xM003; returns undefined ⏱️ ✏️ &xP018; 💥 AuthenticationError
```

Token savings: ~70% fewer tokens in agent↔agent messages.

## Swarm Architecture

```
                    ┌─────────────┐
                    │ Orchestrator│
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │  Agent A   │ │Agent B│ │  Agent C   │
        │ (worktree) │ │(wktree)│ │ (worktree) │
        └─────┬─────┘ └───┬───┘ └─────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────┴──────┐
                    │  Merge All  │
                    └─────────────┘
```

Each agent works in an isolated git worktree. The orchestrator merges results in dependency order and resolves conflicts.

## Inspector

The Hex Inspector is a visual overlay for web apps. Run `hex inspect` to proxy your dev server — every HTML element gets a `data-hex-id` attribute. Click any element in your browser, type what you want changed, and Hex edits the source code.

## License

[MIT](LICENSE)
