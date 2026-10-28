# Configuration

Terminal MCP can be configured via command-line arguments and selected environment variables when starting the server.

## Command-Line Options

### General Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--cols` | number | `$TERMINAL_TOOLKIT_COLS` or 120 | Terminal width in columns |
| `--rows` | number | `$TERMINAL_TOOLKIT_ROWS` or 40 | Terminal height in rows |
| `--shell` | string | `$SHELL` or `bash` | Shell executable to use |
| `--socket` | string | platform default or `TERMINAL_TOOLKIT_SOCKET` | IPC socket/pipe path for MCP |
| `--headless` | flag | - | Run in headless mode (embedded PTY + MCP over stdio, no TTY needed) |
| `--tmux` | string | `0` | Auto-connect to tmux target session (implies `--headless`). With `--title`: use session group and named window |
| `--sandbox` | flag | - | Enable sandbox mode (restricts filesystem/network) |
| `--sandbox-config` | string | - | Path to sandbox configuration JSON file |
| `--version`, `-v` | flag | - | Show version number |
| `--help`, `-h` | flag | - | Show help message |

### Optional Pi operators

`--pi-operators` adds `read`, `write`, `edit`, and `shell`. The `shell` tool executes a short, one-shot, non-interactive command with the configured shell. Use PTY for long-running compilation, builds, tests, interactive prompts, or ongoing session state. This option works in regular and codemode connections.

See [Sandbox Mode](./sandbox.md) for detailed sandbox configuration.

### Recording Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--record [mode]` | string | `off` | Recording mode: `always`, `on-failure`, `off` |
| `--record-dir` | string | XDG default | Output directory for recordings |
| `--record-format` | string | `v2` | Recording format (asciicast v2) |
| `--idle-time-limit` | number | `2` | Max seconds between events in recording |

See [Recording Documentation](recording.md) for full details on recording features.

## Usage

### Basic Usage

```bash
# Use defaults (120x40, system shell)
terminal-mcp

# Headless mode (no TTY required — recommended for MCP configs)
terminal-mcp --headless

# Custom dimensions
terminal-mcp --cols 80 --rows 24

# Headless with custom dimensions
terminal-mcp --headless --cols 100 --rows 30

# Specific shell
terminal-mcp --shell /bin/zsh

# Combined options
terminal-mcp --cols 100 --rows 30 --shell /usr/local/bin/fish

# Check version
terminal-mcp --version
```

### Recording Usage

```bash
# Record with defaults (saves to ~/.local/state/terminal-mcp/recordings/)
terminal-mcp --record

# Record to specific directory
terminal-mcp --record --record-dir=./my-recordings

# Record only on failure
terminal-mcp --record=on-failure

# Custom idle time limit (5 seconds max between events)
terminal-mcp --record --idle-time-limit=5
```

### Tmux Integration

The `--tmux` flag auto-connects to a tmux session in headless mode (it implies `--headless`):

```bash
# Attach to tmux session '0' (create if not exists)
terminal-mcp --tmux

# Attach to a specific tmux session
terminal-mcp --tmux myproject

# Session group mode: attach to session '0' with named session and window
terminal-mcp --tmux --title Copilot
# Equivalent to: tmux new -A -t 0 -s copilot && tmux select-window -t copilot || tmux new-window -n copilot

# Session group mode with custom target session
terminal-mcp --tmux myproject --title Copilot
# Equivalent to: tmux new -A -t myproject -s copilot && ...
```

When `--title` is provided with `--tmux`:
1. Connects to the target session as a session group member (session name = lowercase title)
2. Switches to or creates a window named after the lowercase title

This is useful for AI agents that share a tmux session group, each with their own named window.

### Help

```bash
node dist/index.js --help
```

Output:
```
terminal-mcp - A headless terminal emulator exposed via MCP

Usage: terminal-mcp [options]

Options:
  --cols <number>   Terminal width in columns (default: 120)
  --rows <number>   Terminal height in rows (default: 40)
  --shell <path>    Shell to use (default: $SHELL or bash)
  --help, -h        Show this help message

Example:
  terminal-mcp --cols 80 --rows 24 --shell /bin/zsh
```

## Claude Code Configuration

### Headless Mode (Recommended)

The simplest setup — no separate interactive session needed:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "terminal-mcp",
      "args": ["--headless", "--cols", "120", "--rows", "40"]
    }
  }
}
```

### Basic Configuration

```json
{
  "mcpServers": {
    "terminal": {
      "command": "node",
      "args": ["/path/to/terminal-mcp/dist/index.js"]
    }
  }
}
```

### With Custom Options

```json
{
  "mcpServers": {
    "terminal": {
      "command": "node",
      "args": [
        "/path/to/terminal-mcp/dist/index.js",
        "--cols", "100",
        "--rows", "30",
        "--shell", "/bin/zsh"
      ]
    }
  }
}
```

### Using npx

Runs the published package without installing it globally. Note the scoped
name: an unrelated placeholder package occupies the unscoped `terminal-mcp`,
so `npx terminal-mcp` would fetch the wrong thing.

`--headless` is required here. Without it, stdin is not a TTY when an MCP
client spawns the process, so it starts in MCP client mode and tries to
connect to the Unix socket of an interactive session that isn't running.

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["-y", "@ellery/terminal-mcp", "--headless", "--cols", "80", "--rows", "24"]
    }
  }
}
```

## Terminal Dimensions

### Choosing Dimensions

The default 120x40 works well for most use cases. Consider adjusting based on:

| Use Case | Recommended Size | Reason |
|----------|------------------|--------|
| General CLI | 120x40 (default) | Comfortable for most commands |
| TUI Apps (htop, etc.) | 100x30 or larger | Need space for interface elements |
| Narrow displays | 80x24 | Classic terminal size |
| Log monitoring | 200x50 | More visible content |
| Vim/editors | 120x40+ | Comfortable editing space |

### Dynamic Resizing

Terminal dimensions are fixed at startup. If you need to resize during a session, you'll need to restart the server with new dimensions.

Future versions may support dynamic resizing via an MCP tool.

## Shell Selection

### Default Shell Detection

Terminal MCP uses this priority for shell selection:

1. `--shell` command-line argument (if provided)
2. `$SHELL` environment variable
3. `bash` as fallback

### Common Shell Paths

| Shell | Common Path |
|-------|-------------|
| Bash | `/bin/bash` |
| Zsh | `/bin/zsh` |
| Fish | `/usr/local/bin/fish` or `/opt/homebrew/bin/fish` |
| PowerShell | `pwsh` (cross-platform) or `powershell.exe` (Windows) |

### Shell-Specific Notes

#### Bash
```bash
node dist/index.js --shell /bin/bash
```
Most compatible option. Works on all Unix systems.

#### Zsh
```bash
node dist/index.js --shell /bin/zsh
```
Default on macOS. Supports advanced features like better tab completion.

#### Fish
```bash
node dist/index.js --shell /usr/local/bin/fish
```
Note: Fish uses non-POSIX syntax. Some scripts may not work.

#### PowerShell (Cross-Platform)
```bash
node dist/index.js --shell pwsh
```
For Windows-style commands on any platform.

## Environment Variables

The terminal session inherits the environment from the parent process. Key variables that affect behavior:

| Variable | Effect |
|----------|--------|
| `SHELL` | Default shell if `--shell` not specified |
| `TERM` | Set to `xterm-256color` by Terminal MCP |
| `PATH` | Determines available commands |
| `HOME` | Home directory for shell |
| `USER` | Current username |
| `TERMINAL_TOOLKIT_COLS` | Default terminal width (overridden by `--cols`) |
| `TERMINAL_TOOLKIT_ROWS` | Default terminal height (overridden by `--rows`) |
| `TERMINAL_TOOLKIT_SOCKET` | Default socket/pipe path for MCP |
| `TERMINAL_TOOLKIT_RECORD_DIR` | Default recording output directory |
| `XDG_STATE_HOME` | XDG base directory for state files (fallback for recordings) |

### Terminal Dimensions Resolution

Terminal dimensions are resolved in this order:

1. `--cols` / `--rows` command-line arguments (if provided)
2. `TERMINAL_TOOLKIT_COLS` / `TERMINAL_TOOLKIT_ROWS` environment variables (if set)
3. Actual terminal size from stdout (interactive mode only)
4. Hardcoded defaults: 120 columns, 40 rows

### Socket Path Resolution

The socket path is resolved in this order:

1. `--socket` command-line argument (if provided)
2. `TERMINAL_TOOLKIT_SOCKET` environment variable (if set)
3. Platform default (`\\.\\pipe\\terminal-mcp` on Windows, `$TMPDIR/terminal-mcp.sock` elsewhere)

### Recording Directory Resolution

The default recording directory is resolved in this order:

1. `--record-dir` command-line argument (if provided)
2. `TERMINAL_TOOLKIT_RECORD_DIR` environment variable (if set)
3. `$XDG_STATE_HOME/terminal-mcp/recordings` (if XDG_STATE_HOME is set)
4. `~/.local/state/terminal-mcp/recordings` (fallback)

### Customizing Environment

Most environment variables are inherited from the process running Terminal MCP. To customize:

1. Set variables before starting:
   ```bash
   MY_VAR=value node dist/index.js
   ```

2. Or export in your shell configuration

Additional environment configuration options may be added in future versions.

## Working Directory

The terminal session starts in the current working directory of the Terminal MCP process.

```bash
# Start in a specific directory
cd /path/to/project && node /path/to/terminal-mcp/dist/index.js
```

## Scrollback Buffer

The terminal maintains a scrollback buffer of 1000 lines by default. By default, `getContent()` returns only the visible viewport. To retrieve historical output from the scrollback buffer, use `getContent({ visibleOnly: false })`, which returns the last `100` lines by default.

Set `maxLines` to control how many trailing scrollback lines are returned, or use `getContent({ visibleOnly: false, maxLines: 0 })` to read the full scrollback buffer.

The scrollback size is currently fixed but may become configurable in future versions.

## Terminal Type

Terminal MCP identifies itself as `xterm-256color`, which:

- Supports 256-color output
- Enables most terminal applications to render correctly
- Provides good compatibility with TUI applications

## Resource Limits

### Memory

Each terminal session maintains:
- PTY process resources
- xterm.js buffer (depends on scrollback size)
- Active shell and its children

For most use cases, memory usage is minimal (< 50MB).

### Process Lifetime

The terminal session lives for the duration of the MCP connection. When the AI assistant disconnects:

1. SIGTERM is sent to gracefully shutdown
2. The PTY process is killed
3. All resources are cleaned up

### Concurrent Sessions

Currently, Terminal MCP supports a single terminal session. The session is created on first tool use and persists until shutdown.

Future versions may support multiple named sessions.
