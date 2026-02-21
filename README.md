# ThunderClaude

**Desktop AI orchestration app** with multi-model parallel execution, deep research pipelines, and intelligent task decomposition.

Built with Tauri v2 + React 19 + TypeScript 5.8.

<p align="center">
  <a href="https://github.com/Lebedinskas/ThunderClaude/releases/latest">
    <img src="https://img.shields.io/github/v/release/Lebedinskas/ThunderClaude?style=flat-square&color=blue" alt="Latest Release">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8D8?style=flat-square&logo=tauri" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
</p>

---

## Features

### Three Operating Modes

| Mode | Description |
|------|-------------|
| **Direct** | Single model responds — fast, focused, no overhead |
| **Commander** | Multi-worker parallel execution with task decomposition and dependency resolution |
| **Researcher** | Multi-step deep research pipeline with source extraction, gap analysis, and follow-up |

**Auto mode** intelligently routes each message to the optimal mode.

### Commander Mode

Decomposes complex requests into 1-7 parallel subtasks, each assigned to the optimal model. Features include:

- **Plan review gate** — approve task decomposition before execution
- **Wave-based parallelism** — tasks with dependencies execute in correct order
- **Real-time progress** — live streaming from each worker with progress indicators
- **Synthesis** — automatically merges worker outputs into a coherent response
- **Build mode detection** — coding tasks auto-route to a 2-worker split to prevent file conflicts

### Researcher Mode

Structured research pipeline with quality gates:

- **Quick** (2-3 questions, fast) or **Deep** (up to 15 questions, thorough)
- Plan review before execution
- Parallel research workers with web search capabilities
- Automatic gap analysis and follow-up research
- Source extraction and deduplication
- Final synthesis with citations

### Dual-Engine Architecture

Runs both **Claude** and **Gemini** models natively via CLI subprocess spawning:

**Claude**: Opus 4.6, Sonnet 4.6, Haiku 4.5
**Gemini**: 3.1 Pro, 3 Pro, 3 Flash, 2.5 Pro, 2.5 Flash

Each engine operates independently — not a provider abstraction layer, but genuine parallel engines with different strengths.

### Multi-Tab Conversations

- `Ctrl+T` new tab | `Ctrl+W` close | `Ctrl+Tab` navigate | `Ctrl+1-9` jump
- Per-tab model and mode selection
- Independent conversation history per tab

### Cost & Token Tracking

- Real-time cost display per model
- Token counting (input / output / total)
- Session cumulative totals
- Per-message breakdown

### Auto-Update

- Checks for updates on startup
- One-click install from GitHub releases
- Signed builds with automatic verification

---

## Installation

Download the latest installer from [Releases](https://github.com/Lebedinskas/ThunderClaude/releases/latest) and run it.

### Prerequisites

- **Claude CLI** — for Claude models
- **Gemini CLI** — for Gemini models

At least one CLI must be installed and authenticated for the app to function.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+L` | Focus input |
| `Ctrl+N` | New conversation |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+,` | Settings |
| `Ctrl+/` | Show all shortcuts |
| `Ctrl+Shift+F` | Search conversations |
| `Ctrl+Shift+S` | Export conversation |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Tauri v2 (Rust + WebView) |
| Frontend | React 19 + TypeScript 5.8 |
| Styling | Tailwind CSS v4 |
| Build | Vite 7 |
| State management | Zustand 5 |
| Testing | Vitest 4 |
| Markdown | react-markdown + Shiki syntax highlighting |
| AI engines | Claude CLI + Gemini CLI (subprocess) |

---

## Architecture

```
ThunderClaude/
├── src/
│   ├── components/          # React UI components
│   │   ├── Chat/            # Message display, input, status
│   │   ├── Settings/        # App configuration
│   │   └── ...              # Sidebar panels (MCP, Memory, Research, etc.)
│   ├── lib/
│   │   ├── commander.ts     # Multi-worker orchestration engine
│   │   ├── researcher.ts    # Research pipeline with quality gates
│   │   ├── models.ts        # Model definitions and grouping
│   │   ├── updater.ts       # Auto-update logic
│   │   └── constants.ts     # Centralized configuration
│   ├── hooks/               # React hooks (chat, tabs, streaming)
│   └── stores/              # Zustand state stores
├── src-tauri/
│   ├── src/                 # Rust backend (process spawning, IPC)
│   └── tauri.conf.json      # App configuration
└── package.json
```

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build

# Run tests
npx vitest run
```

---

## License

Private — All rights reserved.
