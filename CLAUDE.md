# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install        # Install dependencies (includes native node-pty compilation)
npm run build      # Compile TypeScript to dist/
npm run dev        # Run directly with tsx (no build needed)
npm test           # Run tests (node --test with tsx)
npm run lint       # Run ESLint
npm run lint:fix   # Run ESLint with auto-fix
```

## Architecture Overview

Terminal Toolkit is a headless terminal emulator exposed via Model Context Protocol (MCP). It has three operating modes:

### Tri-Mode Architecture

1. **Headless Mode** (`--headless` flag): Self-contained MCP server with embedded PTY
   - Spawns PTY internally, serves MCP directly over stdio
   - No TTY, socket, or separate interactive session needed
   - `src/index.ts` → `startServer()` from `src/server.ts` (eagerly inits session)
   - **Recommended for MCP client configs** (CI, containers, non-interactive environments)

2. **Interactive Mode** (stdin is TTY, no `--headless`): User runs `terminal-toolkit` in their terminal
   - Spawns a PTY shell process, pipes I/O to user's terminal
   - Exposes a Unix socket (Unix: `/tmp/terminal-toolkit.sock`, Windows: `\\.\pipe\terminal-toolkit`) for AI tool access
   - `src/index.ts` → `startInteractiveMode()` → creates `TerminalManager` + `createToolProxyServer()`
   - Supports optional `--sandbox` mode and `--record` mode

3. **MCP Client Mode** (stdin is not TTY, no `--headless`): Claude Code spawns `terminal-toolkit` as MCP server
   - Connects to the Unix socket from interactive mode
   - Serves MCP protocol over stdio to Claude Code
   - `src/client.ts` → `startMcpClientMode()` → proxies tool calls to socket

3. **Direct MCP Mode** (`--mcp` flag): Standalone MCP server without socket proxy
   - Tries to connect to existing interactive session first; if none, creates its own PTY
   - `src/index.ts` → `startServer()` (via `src/server.ts`) → standard MCP over stdio

### Key Components

**Terminal Layer** (`src/terminal/`):
- `session.ts`: Core integration of `node-pty` (PTY process) + `@xterm/headless` (terminal emulation). Handles shell-specific prompt customization via temp rc files.
- `manager.ts`: Multi-session manager. Owns a map of `TerminalSession`s plus a single `RecordingManager` and (optional) `SandboxController`. The "default" session is auto-created on first use and is the implicit target of any tool call without a `sessionId`. Idle non-default sessions are GC'd on a 60s interval.

**Tool Layer** (`src/tools/`):
- Each tool has: Zod schema, tool definition object, handler function
- Pattern: `export const fooTool = {...}` + `export function handleFoo(manager, args)`
- Tools: `type`, `sendKey`, `sleep`, `getContent`, `getBufferInfo`, `takeScreenshot` (formats: `text`, `ansi`, `png`), `startRecording`, `stopRecording`. All accept an optional `sessionId` to target a specific session; omit for the default.
- Multi-session tools: `createSession`, `listSessions`, `destroySession`. The default session cannot be destroyed.
- `definitions.ts`: Shared tool schema definitions; `descriptions.ts`: Tool description strings

**Setup Layer** (`src/setup/`):
- `clients.ts`: One adapter per supported AI tool (codex, copilot, gemini, opencode, claude-code, claude-desktop). Each adapter knows the client's config path, format (JSON or TOML), and the exact MCP server schema that client expects. Most use the standard `mcpServers` JSON shape via `makeMcpServersJsonAdapter`; codex (TOML) and opencode (different schema entirely — top-level `mcp`, command as array) have their own adapters.
- `index.ts`: Orchestrates the `terminal-toolkit setup` subcommand — flag parsing happens in `src/index.ts`, this module handles client selection (auto-detect or explicit `--client`), per-client install/uninstall, and result printing. Writes are atomic (write-to-temp + rename) and always create a `.bak` of the original.

**Transport Layer** (`src/transport/`):
- `socket.ts`: Unix socket (or Windows named pipe) server for tool proxying between modes. Also has `SocketTransport` class implementing MCP's Transport interface.

**Server Layer** (`src/server.ts`):
- Factory functions for creating and connecting MCP servers: `createServer()`, `createServerWithManager()`, `connectServer()`, `startServer()`
- Used by direct MCP mode (`--mcp` flag)

**Recording Layer** (`src/recording/`):
- `recorder.ts`: Writes asciicast v2 format files frame-by-frame
- `manager.ts`: Manages recording lifecycle (start, stop, on-failure filtering)
- `types.ts`: Shared types (`RecordingMode`, `AsciicastEvent`, etc.)

**Sandbox Layer** (`src/sandbox/`):
- `controller.ts`: Platform detection and sandbox enforcement via OS-level sandboxing (macOS `sandbox-exec`, Linux `bwrap`)
- `config.ts`: Permission schema and config file loading (`SandboxPermissions`)
- `prompt.ts`: Interactive TUI permission prompt for sandbox setup

**Prompts Layer** (`src/prompts/`):
- `index.ts`: Registers MCP prompts (e.g., `tool-usage` guide)

**UI Layer** (`src/ui/`):
- `index.ts`: Generates the startup banner displayed in interactive mode

**Utils** (`src/utils/`):
- `keys.ts`: ANSI escape code key sequences
- `platform.ts`: Cross-platform helpers (`getDefaultSocketPath()`, `getDefaultShell()`, `getDefaultRecordDir()`)
- `title.ts`: Terminal title setting helpers
- `version.ts`: Version string export
- `stats.ts`: Buffer/session statistics helpers

### Data Flow

```
Headless Mode:
Claude Code
    ↕ (MCP JSON-RPC over stdio)
MCP Server (server.ts) + TerminalManager + PTY
    ↕
Shell Process

Interactive + Client Mode:
User Terminal                        Claude Code
    ↕ (raw PTY I/O)                     ↕ (MCP JSON-RPC over stdio)
TerminalSession                      MCP Server (client.ts)
    ↕                                   ↕ (custom JSON-RPC over socket)
Tool Proxy Server ←───────────────→ Socket Client
```

## Code Conventions

- ES Modules with `.js` extensions in imports (NodeNext module resolution)
- Zod for runtime validation of tool arguments
- Tools return `{ content: [{ type: "text", text: string }], isError?: boolean }` (except `takeScreenshot` png format which returns `{ type: "image", data: string, mimeType: string }`)
- Key sequences are in `src/utils/keys.ts` (ANSI escape codes)
- Recording format is asciicast v2 (compatible with `asciinema play`)
- Socket path is resolved via `resolveSocketPath()` in `src/utils/platform.ts`; can be overridden with `TERMINAL_TOOLKIT_SOCKET` env var
- Terminal default dimensions resolved via `getDefaultCols()`/`getDefaultRows()` in `src/utils/platform.ts`; can be overridden with `TERMINAL_TOOLKIT_COLS`/`TERMINAL_TOOLKIT_ROWS` env vars
- Recording output directory defaults to `~/.local/state/terminal-toolkit/recordings`; can be overridden with `TERMINAL_TOOLKIT_RECORD_DIR` env var
