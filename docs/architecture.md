# Architecture

This document describes the technical architecture of Terminal Toolkit and provides guidance for development and contribution.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Assistant                              │
│                      (Claude Code)                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │ STDIO
                            │ JSON-RPC (MCP Protocol)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Terminal Toolkit Server                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  MCP SDK     │  │    Tools     │  │  Terminal Manager  │    │
│  │  (Protocol)  │──│  (Handlers)  │──│    (Lifecycle)     │    │
│  └──────────────┘  └──────────────┘  └─────────┬──────────┘    │
│                                                 │                │
│                                      ┌──────────▼──────────┐    │
│                                      │  Terminal Session   │    │
│                                      │  ┌────────────────┐ │    │
│                                      │  │  xterm.js      │ │    │
│                                      │  │  (Headless)    │ │    │
│                                      │  └───────┬────────┘ │    │
│                                      │          │ Data     │    │
│                                      │  ┌───────▼────────┐ │    │
│                                      │  │   node-pty     │ │    │
│                                      │  │    (PTY)       │ │    │
│                                      │  └───────┬────────┘ │    │
│                                      └──────────┼──────────┘    │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │
                                                  ▼
                                      ┌────────────────────┐
                                      │   Shell Process    │
                                      │  (bash, zsh, etc.) │
                                      └────────────────────┘
```

## Core Components

### Operating Modes

Terminal Toolkit has three operating modes, selected by the `--headless` flag and TTY detection:

| Mode | Condition | Description |
|------|-----------|-------------|
| **Headless** | `--headless` flag | Self-contained: spawns embedded PTY, serves MCP over stdio. No socket or TTY needed. Recommended for MCP client configs. |
| **Interactive** | stdin is TTY | User gets a shell with PTY I/O. Exposes a Unix socket for AI tool access. |
| **Client** | stdin is not TTY | Connects to an interactive session's socket, proxies MCP tools over stdio. |

**Headless mode** (single process):
```
MCP Client → stdio → [MCP Server + TerminalManager + PTY] → Shell
```

**Interactive + Client** (two processes):
```
User Terminal ↔ [Interactive: PTY + Socket Server]
                        ↕ Unix socket
MCP Client → stdio → [Client: MCP Server + Socket Proxy]
```

### Entry Point (`src/index.ts`)

The entry point handles:
- Shebang for direct execution (`#!/usr/bin/env node`)
- Command-line argument parsing
- Mode selection (`--headless` → `startServer()`, TTY → `startInteractiveMode()`, non-TTY → `startMcpClientMode()`)
- Error handling

### MCP Server (`src/server.ts`)

Responsible for:
- Creating the MCP `Server` instance
- Configuring server capabilities
- Setting up the terminal manager
- Connecting the stdio transport
- Handling graceful shutdown

```typescript
const server = new Server(
  { name: "terminal-toolkit", version: "0.1.0" },
  { capabilities: { tools: {} } }
);
```

### Terminal Manager (`src/terminal/manager.ts`)

Manages terminal session lifecycle:
- Lazy session creation (on first use)
- Session state tracking
- Delegation to session methods
- Resource cleanup

Design decisions:
- Single session for simplicity
- Session created on demand
- Automatic recreation if disposed

### Terminal Session (`src/terminal/session.ts`)

The core terminal implementation:
- Spawns PTY process via `node-pty`
- Creates headless xterm.js terminal
- Pipes PTY output to terminal emulator
- Provides methods for interaction

```typescript
// Data flow
this.ptyProcess.onData((data) => {
  this.terminal.write(data);  // PTY → xterm
});

this.ptyProcess.write(data);  // Input → PTY
```

### Tool Handlers (`src/tools/*.ts`)

Each tool is implemented as:
- Schema definition (using Zod)
- Tool metadata (name, description, inputSchema)
- Handler function

```typescript
// Pattern for each tool
export const toolSchema = z.object({ ... });
export const tool = { name, description, inputSchema };
export function handleTool(manager, args) { ... }
```

### Tool Registry (`src/tools/index.ts`)

Central registration point:
- Lists all available tools
- Routes tool calls to handlers
- Provides error handling wrapper

### Key Mappings (`src/utils/keys.ts`)

Maps key names to ANSI escape sequences:
- Special keys (Enter, Tab, Escape)
- Arrow keys and navigation
- Ctrl combinations
- Function keys

## Data Flow

### Input Flow (AI → Terminal)

```
1. AI calls MCP tool (e.g., type with "ls")
2. Server receives JSON-RPC request
3. CallToolRequestSchema handler routes to tool
4. Tool handler calls manager.write("ls")
5. Manager delegates to session.write("ls")
6. Session writes to ptyProcess
7. PTY sends to shell process
8. Shell executes and produces output
```

### Output Flow (Terminal → AI)

```
1. Shell produces output
2. PTY receives output data
3. ptyProcess.onData fires
4. Session writes to terminal (xterm.js)
5. xterm.js processes ANSI codes
6. AI calls getContent tool
7. Handler reads from terminal.buffer and trims trailing empty lines
8. If `visibleOnly: false`, handler applies `maxLines` to the trailing scrollback content
9. Content returned via MCP response
```

## Technology Choices

### @modelcontextprotocol/sdk

Official MCP SDK providing:
- Protocol implementation
- Request/response handling
- Type definitions
- Transport abstractions

### node-pty

Microsoft-maintained PTY library:
- Cross-platform (macOS, Linux, Windows)
- Native performance
- Full PTY semantics
- Process management

### @xterm/headless

Headless xterm.js:
- Full VT100/ANSI emulation
- No DOM dependency
- Scrollback buffer
- Accurate terminal state

### Zod

Schema validation:
- Runtime type checking
- TypeScript integration
- MCP SDK peer dependency

## File Structure

```
terminal-toolkit/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── server.ts             # MCP server setup
│   ├── terminal/
│   │   ├── index.ts          # Exports
│   │   ├── session.ts        # PTY + xterm integration
│   │   └── manager.ts        # Session lifecycle
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── type.ts           # type tool
│   │   ├── sendKey.ts        # sendKey tool
│   │   ├── sleep.ts          # sleep tool
│   │   ├── getContent.ts     # getContent tool
│   │   ├── getBufferInfo.ts  # getBufferInfo tool
│   │   ├── screenshot.ts     # takeScreenshot tool
│   │   ├── startRecording.ts # startRecording tool
│   │   └── stopRecording.ts  # stopRecording tool
│   └── utils/
│       └── keys.ts           # Key code mappings
├── dist/                     # Compiled output
├── docs/                     # Documentation
├── package.json
└── tsconfig.json
```

## Development

### Building

```bash
npm run build    # Compile TypeScript
npm run dev      # Run with tsx (development)
```

### TypeScript Configuration

- Target: ES2022
- Module: NodeNext (ESM)
- Strict mode enabled
- Source maps for debugging

### Adding a New Tool

1. Create tool file in `src/tools/`:

```typescript
// src/tools/newTool.ts
import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";

export const newToolSchema = z.object({
  param: z.string().describe("Parameter description"),
});

export const newTool = {
  name: "newTool",
  description: "What this tool does",
  inputSchema: {
    type: "object" as const,
    properties: {
      param: { type: "string", description: "..." },
    },
    required: ["param"],
  },
};

export function handleNewTool(manager: TerminalManager, args: unknown) {
  const parsed = newToolSchema.parse(args);
  // Implementation
  return {
    content: [{ type: "text" as const, text: "Result" }],
  };
}
```

2. Register in `src/tools/index.ts`:

```typescript
import { newTool, handleNewTool } from "./newTool.js";

const tools = [...existingTools, newTool];

// In switch statement:
case "newTool":
  return handleNewTool(manager, args);
  // Note: If your handler is async, use: return await handleNewTool(manager, args);
```

### Testing

Manual testing via JSON-RPC:

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/index.js

# List tools
echo '...' | node dist/index.js
```

Node.js test script:

```javascript
const { spawn } = require('child_process');
const proc = spawn('node', ['dist/index.js']);
// Send messages, read responses
```

## Future Enhancements

### Planned Features

- **Multiple Sessions**: Named sessions for parallel terminals
- **Dynamic Resize**: Tool to resize terminal dimensions
- **Environment Config**: CLI options for environment variables
- **Session Persistence**: Save/restore session state
- **Output Streaming**: Real-time output via MCP resources

### Extension Points

The architecture supports extension through:

1. **New Tools**: Add tools following the established pattern
2. **Session Types**: Subclass `TerminalSession` for variants
3. **Custom Shells**: Configuration already supports shell selection
4. **Middleware**: Intercept tool calls for logging/metrics

## Error Handling

### Tool Errors

All tool handlers are wrapped in try-catch:

```typescript
try {
  switch (name) {
    case "type": return await handleType(manager, args);
    case "sleep": return await handleSleep(manager, args);
    case "stopRecording": return await handleStopRecording(manager, args);
    // ... other tools (non-async ones don't need await)
  }
} catch (error) {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
```

### Session Errors

Sessions track disposed state:

```typescript
if (this.disposed) {
  throw new Error("Terminal session has been disposed");
}
```

### Graceful Shutdown

Signal handlers ensure cleanup:

```typescript
process.on("SIGINT", () => {
  manager.dispose();
  process.exit(0);
});
```

## Performance Considerations

### Memory Usage

- xterm.js buffer: ~O(scrollback * cols)
- PTY process: Shell memory footprint
- Typical total: < 50MB

### Latency

- Tool calls: < 10ms for input operations
- Content retrieval: < 50ms for typical buffers
- PTY response: Depends on shell/command

### Throughput

- High-volume output (e.g., `cat large_file`) may overwhelm buffer
- Default `getContent()` only returns visible viewport; use `visibleOnly: false` to read scrollback history, which returns the last `100` lines by default
- Use `maxLines: 0` with `visibleOnly: false` to include the full scrollback buffer when needed
- Screenshot is lighter than full content retrieval

## Session visibility

Only the default session may be displayed directly to the user, when Terminal Toolkit runs interactively. In headless mode the default session is not displayed directly. Each additional PTY made by `createSession()` is headless, independent of the server mode; AI tools can interact with it, but it is not attached to the user-facing terminal. This matters for passwords and direct human observation: creating a new session does not make its prompt visible to the user.
