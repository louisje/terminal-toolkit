#!/usr/bin/env node

import * as fs from "fs";
import { createRequire } from "module";
import updateNotifier from "update-notifier";
import { startServer } from "./server.js";
import { startMcpClientMode } from "./client.js";
import { TerminalManager } from "./terminal/index.js";
import { createToolProxyServer } from "./transport/index.js";
import { getBanner } from "./ui/index.js";
import { getDefaultSocketPath, getDefaultShell, getDefaultCols, getDefaultRows, resolveSocketPath } from "./utils/platform.js";
import { createClientTitleSetter } from "./utils/title.js";
import {
  SandboxController,
  loadConfigFromFile,
  promptForPermissions,
  type SandboxPermissions,
} from "./sandbox/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const { version } = pkg;

// Default socket path
const DEFAULT_SOCKET_PATH = getDefaultSocketPath();

// Recording mode type
type RecordingMode = 'always' | 'on-failure' | 'off';

// Subcommand dispatch — handle these BEFORE the main flag parser so they
// can have their own argument shape and don't accidentally fall through
// into the interactive/headless/client mode-detection logic below.
const subcommandArgs = process.argv.slice(2);
const subcommand = subcommandArgs[0];
if (subcommand === "setup") {
  const { runSetup } = await import("./setup/index.js");
  const setupOpts = { dryRun: false, uninstall: false, clients: undefined as string[] | undefined };
  for (let i = 1; i < subcommandArgs.length; i++) {
    const a = subcommandArgs[i];
    const n = subcommandArgs[i + 1];
    if (a === "--dry-run") setupOpts.dryRun = true;
    else if (a === "--uninstall") setupOpts.uninstall = true;
    else if (a === "--client" && n) { setupOpts.clients = n.split(",").map((s) => s.trim()).filter(Boolean); i++; }
    else if (a === "--help" || a === "-h") {
      console.log(`
terminal-toolkit setup — install the terminal-toolkit MCP server entry into AI tool configs

Usage: terminal-toolkit setup [options]

Options:
  --client <names>   Comma-separated client names, or 'all'. Default: every detected client.
                     Known: codex, copilot, gemini, opencode, claude-code, claude-desktop
  --dry-run          Print what would change without writing.
  --uninstall        Remove the terminal-toolkit entry instead of adding it.
  --help, -h         Show this help.

Examples:
  terminal-toolkit setup
  terminal-toolkit setup --dry-run
  terminal-toolkit setup --client claude-code,gemini
  terminal-toolkit setup --uninstall --client all
`);
      process.exit(0);
    }
  }
  process.exit(await runSetup(setupOpts));
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: {
  cols?: number;
  rows?: number;
  shell?: string;
  socket?: string;
  title?: string;
  headless?: boolean;
  sandbox?: boolean;
  sandboxConfig?: string;
  record?: RecordingMode;
  recordDir?: string;
  recordFormat?: 'v2';
  idleTimeLimit?: number;
  maxDuration?: number;
  inactivityTimeout?: number;
  useMcp?: boolean;
  login?: boolean;
  tmux?: boolean | string;
  maxSessions?: number;
  sessionIdleTimeout?: number;
  piOperators?: boolean;
  piExtraOperators?: boolean;
  codemode?: boolean;
} = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const next = args[i + 1];

  switch (arg) {
    case "--mcp":
      options.useMcp = true;
      break;
    case "--pi-extra-operators":
      options.piExtraOperators = true;
      break;
    case "--codemode":
      options.codemode = true;
      break;
    case "--pi-operators":
      options.piOperators = true;
      break;
    case "--cols":
      if (next) {
        options.cols = parseInt(next, 10);
        i++;
      }
      break;
    case "--rows":
      if (next) {
        options.rows = parseInt(next, 10);
        i++;
      }
      break;
    case "--shell":
      if (next) {
        options.shell = next;
        i++;
      }
      break;
    case "--socket":
      if (next) {
        options.socket = next;
        i++;
      }
      break;
    case "--title":
      if (next) {
        options.title = next;
        i++;
      }
      break;
    case "--headless":
      options.headless = true;
      break;
    case "-l":
    case "--login":
      options.login = true;
      break;
    case "--sandbox":
      options.sandbox = true;
      break;
    case "--tmux":
      // Support bare --tmux (defaults to session '0') or --tmux <session>
      if (!next || next.startsWith('-')) {
        options.tmux = true;
      } else {
        options.tmux = next;
        i++;
      }
      break;
    case "--sandbox-config":
      if (next) {
        options.sandboxConfig = next;
        options.sandbox = true; // Implicitly enable sandbox
        i++;
      }
      break;
    case "--record":
      // Support bare --record (defaults to 'always')
      if (!next || next.startsWith('-')) {
        options.record = 'always';
      } else if (['always', 'on-failure', 'off'].includes(next)) {
        options.record = next as RecordingMode;
        i++;
      } else {
        // Unknown value, treat as bare --record
        options.record = 'always';
      }
      break;
    case "--record-dir":
      if (next) {
        options.recordDir = next;
        i++;
      }
      break;
    case "--record-format":
      if (next) {
        options.recordFormat = next as 'v2';
        i++;
      }
      break;
    case "--idle-time-limit":
      if (next) {
        options.idleTimeLimit = parseFloat(next);
        i++;
      }
      break;
    case "--max-duration":
      if (next) {
        options.maxDuration = parseFloat(next);
        i++;
      }
      break;
    case "--inactivity-timeout":
      if (next) {
        options.inactivityTimeout = parseFloat(next);
        i++;
      }
      break;
    case "--max-sessions":
      if (next) {
        options.maxSessions = parseInt(next, 10);
        i++;
      }
      break;
    case "--session-idle-timeout":
      if (next) {
        options.sessionIdleTimeout = parseFloat(next);
        i++;
      }
      break;
    case "--version":
    case "-v":
      console.log(`terminal-toolkit v${version}`);
      process.exit(0);
    case "--help":
    case "-h":
      console.log(`
terminal-toolkit v${version} - A headless terminal emulator exposed via MCP

Usage: terminal-toolkit [options]
       terminal-toolkit setup [options]   Install MCP entry into AI tool configs (run 'terminal-toolkit setup --help')

Options:
  --cols <number>        Terminal width in columns (default: $TERMINAL_TOOLKIT_COLS or 120)
  --rows <number>        Terminal height in rows (default: $TERMINAL_TOOLKIT_ROWS or 40)
  --shell <path>         Shell to use (default: $TERMINAL_TOOLKIT_SHELL, $SHELL, or bash)
  -l, --login            Start a login shell (sources ~/.bash_profile or ~/.zprofile
                         instead of ~/.bashrc or ~/.zshrc only)
  --socket <path>        IPC socket/pipe path for MCP (default: ${DEFAULT_SOCKET_PATH})
  --mcp                  Use direct MCP mode (no socket, standard MCP mode)
  --codemode             Expose a single QuickJS codemode tool (Node >=22.19)
  --pi-operators         Expose Pi-style read, write, edit, and shell tools (19 total)
  --pi-extra-operators   Expose ls, grep, and find independently (18 total; 22 with both)
  --title <label>        Set the interactive terminal title when connecting as a client
  --headless             Run in headless mode (MCP server with embedded terminal, no TTY needed)
  --tmux [session]       Auto-connect to tmux (implies --headless; default target session: 0)
                         With --title: use session group and named window
  --sandbox              Enable sandbox mode (restricts filesystem/network access)
  --sandbox-config <path> Load sandbox config from JSON file
  --max-sessions <n>     Max concurrent terminal sessions (default: 5)
  --session-idle-timeout <sec> Idle non-default sessions auto-destroy after this (default: 600)
  --version, -v          Show version number
  --help, -h             Show this help message

Recording Options:
  --record [mode]     Enable recording (default mode: always)
                      Modes: always, on-failure, off
                      - always: Save all recordings
                      - on-failure: Only save recordings on non-zero exit
                      - off: Disable recording
  --record-dir <dir>  Recording output directory
                      Default: ~/.local/state/terminal-toolkit/recordings
                      Override: TERMINAL_TOOLKIT_RECORD_DIR env var
  --record-format <f> Recording format: v2 (default: v2, asciicast v2 format)
  --idle-time-limit <sec>  Max idle time between events (default: 2s)
                      Caps idle time in recordings to prevent long pauses
  --max-duration <sec>     Max recording duration (default: 3600 = 60 min)
                      Recording auto-stops when this limit is reached
  --inactivity-timeout <sec>  Stop after no output (default: 600 = 10 min)
                      Resets on each terminal output event

Environment Variables:
  TERMINAL_TOOLKIT_COLS        Default terminal width (overridden by --cols)
  TERMINAL_TOOLKIT_ROWS        Default terminal height (overridden by --rows)
  TERMINAL_TOOLKIT_SOCKET      Default socket/pipe path for MCP (overridden by --socket)
  TERMINAL_TOOLKIT_RECORD_DIR  Default recording output directory

Mode Detection:
  - If --headless or --tmux: Headless mode (embedded PTY + MCP server over stdio)
  - If stdin is a TTY: Interactive mode (gives you a shell, exposes socket)
  - If stdin is not a TTY: MCP client mode (connects to socket, serves MCP)

Interactive Mode (run in your terminal):
  terminal-toolkit              # Normal mode
  terminal-toolkit --sandbox    # With sandbox (interactive permission prompt)

  This gives you an interactive shell. AI can observe/interact via MCP.

  With recording:
  terminal-toolkit --record
  terminal-toolkit --record --record-dir=./project-recordings
  terminal-toolkit --record=on-failure --idle-time-limit=5

Sandbox Mode:
  When --sandbox is enabled, the terminal runs with restricted access:
  - Filesystem: Configurable read/write, read-only, and blocked paths
  - Network: Allow all, block all, or custom domain allowlist

  Without --sandbox-config, an interactive prompt lets you configure permissions.

  Example config file (~/.terminal-toolkit-sandbox.json):
  {
    "filesystem": {
      "readWrite": [".", "/tmp"],
      "readOnly": ["~"],
      "blocked": ["~/.ssh", "~/.aws"]
    },
    "network": {
      "mode": "all"
    }
  }

Headless Mode (no TTY required, for CI/containers/MCP servers):
  terminal-toolkit --headless
  terminal-toolkit --headless --cols 120 --rows 40

  Spawns a PTY shell internally and serves MCP directly over stdio.
  No separate interactive session or socket needed.

  MCP client config for headless:
  {
    "mcpServers": {
      "terminal": {
        "command": "terminal-toolkit",
        "args": ["--headless", "--cols", "120", "--rows", "40"]
      }
    }
  }

MCP Client Mode (add to your MCP client config):
  {
    "mcpServers": {
      "terminal": {
        "command": "terminal-toolkit"
      }
    }
  }
`);
      process.exit(0);
  }
}

// --tmux implies --headless (tmux mode is always headless MCP server)
if (options.tmux) {
  options.headless = true;
}

async function main() {
  const socketPath = resolveSocketPath(options.socket);

  // Check if --mcp flag is set to use direct MCP mode
  if (options.useMcp) {
    console.error('[terminal-toolkit] Starting in MCP mode...');
    
    // Try to connect to existing interactive session first
    const fs = await import('fs');
    if (fs.existsSync(socketPath)) {
      try {
        console.error('[terminal-toolkit] Found existing session, connecting as client...');
        if (options.tmux) {
          console.error('[terminal-toolkit] Note: --tmux ignored when connecting to existing session.');
        }
          await startMcpClientMode(socketPath, { title: options.title, piOperators: options.piOperators, piExtraOperators: options.piExtraOperators, codemode: options.codemode });
        return;
      } catch {
        // If connection fails, fall through to create new PTY
        console.error('[terminal-toolkit] Failed to connect to existing session, creating new PTY...');
      }
    } else {
      console.error('[terminal-toolkit] No existing session found, creating new PTY...');
    }
    
    // No existing session, create our own PTY
    await startServer({
      cols: options.cols ?? getDefaultCols(),
      rows: options.rows ?? getDefaultRows(),
      shell: options.shell,
      login: options.login,
        tmux: options.tmux,
        title: options.title,
        piOperators: options.piOperators, piExtraOperators: options.piExtraOperators, codemode: options.codemode,
    });
    return;
  }
  const isInteractive = process.stdin.isTTY;

  // Prevent recursive invocation
  if (process.env.TERMINAL_TOOLKIT === '1') {
    console.error(
      'Error: terminal-toolkit cannot be run from within itself.\n' +
      'You are already inside a terminal-toolkit session.\n\n' +
      'To use MCP tools, configure your MCP client to connect to this session.'
    );
    process.exit(1);
  }

  if (options.headless) {
    // Headless mode: Spawn PTY internally, serve MCP directly over stdio
    // No TTY or socket needed
    await startServer({
      cols: options.cols ?? getDefaultCols(),
      rows: options.rows ?? getDefaultRows(),
      shell: options.shell,
      login: options.login,
      tmux: options.tmux,
      title: options.title,
      maxSessions: options.maxSessions,
        sessionIdleTimeout: options.sessionIdleTimeout,
        piOperators: options.piOperators, piExtraOperators: options.piExtraOperators, codemode: options.codemode,
    });
  } else if (isInteractive) {
    // Interactive mode: Shell on stdin/stdout, tool proxy on Unix socket
      await startInteractiveMode(socketPath);
  } else {
    // MCP client mode: Connect to socket, serve MCP over stdio
      await startMcpClientMode(socketPath, { title: options.title, piOperators: options.piOperators, piExtraOperators: options.piExtraOperators, codemode: options.codemode });
  }
}

async function startInteractiveMode(socketPath: string): Promise<void> {
  // Throttled update check (once per day). Prints to stderr in the user's
  // terminal, never in headless / MCP-client mode where it would corrupt
  // JSON-RPC over stdio.
  try {
    updateNotifier({ pkg }).notify({ defer: false });
  } catch {
    // Never let an update check break startup.
  }

  // Get terminal size from CLI args > env vars > stdout size > defaults
  const cols = options.cols ?? (process.stdout.columns || getDefaultCols());
  const rows = options.rows ?? (process.stdout.rows || getDefaultRows());
  const shell = options.shell || getDefaultShell();

  // Initialize sandbox if enabled
  let sandboxController: SandboxController | undefined;
  let sandboxEnabled = false;

  if (options.sandbox) {
    sandboxController = new SandboxController();

    // Check platform support and dependencies BEFORE showing the modal
    if (!sandboxController.isSupported()) {
      const platform = sandboxController.getPlatform();
      if (platform === "win32") {
        console.error("[terminal-toolkit] Error: Sandbox mode is not supported on Windows.");
      } else {
        console.error(`[terminal-toolkit] Error: Sandbox mode is not supported on platform '${platform}'.`);
      }
      console.error("[terminal-toolkit] Please run without the --sandbox flag.");
      process.exit(1);
    }

    // Check Linux-specific dependencies
    const depCheck = sandboxController.checkLinuxDependencies();
    if (!depCheck.supported) {
      console.error(`[terminal-toolkit] Error: Sandbox dependencies not available.`);
      console.error(`[terminal-toolkit] Missing: ${depCheck.message}`);
      console.error("");
      console.error("To install on Arch Linux:");
      console.error("  sudo pacman -S bubblewrap socat");
      console.error("");
      console.error("To install on Debian/Ubuntu:");
      console.error("  sudo apt install bubblewrap socat");
      console.error("");
      console.error("Or run without the --sandbox flag.");
      process.exit(1);
    }

    // Determine permissions
    let permissions: SandboxPermissions;
    if (options.sandboxConfig) {
      try {
        permissions = loadConfigFromFile(options.sandboxConfig);
        console.log(`[terminal-toolkit] Loaded sandbox config from ${options.sandboxConfig}`);
      } catch (error) {
        console.error(`[terminal-toolkit] Failed to load sandbox config: ${error}`);
        process.exit(1);
      }
    } else {
      // Interactive permission prompt
      try {
        permissions = await promptForPermissions();
      } catch (error) {
        if (error instanceof Error && error.message === "cancelled") {
          console.log("[terminal-toolkit] Cancelled.");
          process.exit(0);
        }
        throw error;
      }
    }

    // Initialize sandbox
    const status = await sandboxController.initialize(permissions);
    sandboxEnabled = status.enabled;

    if (status.enabled) {
      console.log(`[terminal-toolkit] Sandbox enabled (${status.platform})`);
    } else {
      // If we get here, something unexpected failed during initialization
      console.error(`[terminal-toolkit] Error: Failed to initialize sandbox: ${status.reason}`);
      console.error("[terminal-toolkit] Please run without the --sandbox flag or fix the issue above.");
      process.exit(1);
    }
  }

  // Generate startup banner
  const startupBanner = getBanner({
    socketPath,
    cols,
    rows,
    shell,
    sandboxEnabled,
  });

  // Create terminal manager (prompt customization handled in session.ts)
  const manager = new TerminalManager({
    cols,
    rows,
    shell: options.shell,
    login: options.login,
    startupBanner,
    sandboxController,
    record: options.record,
    recordDir: options.recordDir,
    recordFormat: options.recordFormat,
    idleTimeLimit: options.idleTimeLimit,
    maxDuration: options.maxDuration,
    inactivityTimeout: options.inactivityTimeout,
    maxSessions: options.maxSessions,
    sessionIdleTimeout: options.sessionIdleTimeout,
  });

  // Get the session and set up interactive I/O
  const session = await manager.initSession();

  // Track if we've shown the banner (for Windows, show after shell init)
  let bannerShown = false;
  const isWindows = process.platform === "win32";

  // Pipe PTY output to stdout
  session.onData((data) => {
    process.stdout.write(data);

    // On Windows, show banner after first prompt appears
    if (isWindows && !bannerShown && data.includes("⚡")) {
      bannerShown = true;
      process.stdout.write("\n" + startupBanner + "\n");
      // Send Enter to get a fresh prompt
      session.write("\r");
    }
  });

  // On non-Windows, banner is shown via shell rc file
  if (!isWindows) {
    bannerShown = true;
  }

  // Handle PTY exit
  session.onExit(async (code) => {
    // Finalize recordings and get results
    const recordings = await manager.finalizeRecordings(code);

    console.log(`\n[terminal-toolkit] Shell exited with code ${code}`);

    // Show recording info if any were saved
    const savedRecordings = recordings.filter(r => r.saved);
    if (savedRecordings.length > 0) {
      console.log('\nRecordings saved:');
      for (const rec of savedRecordings) {
        console.log(`  ${rec.path}`);
      }
      console.log('\nPlay with: asciinema play <file>');
      console.log('Install:   pip install asciinema  or  brew install asciinema');
    }

    cleanup();
    process.exit(code);
  });

  // Set up raw mode for stdin if it's a TTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  // Pipe stdin directly to PTY
  process.stdin.on("data", (data) => {
    session.write(data.toString());
  });

  // Handle terminal resize
  process.stdout.on("resize", () => {
    const newCols = process.stdout.columns || cols;
    const newRows = process.stdout.rows || rows;
    session.resize(newCols, newRows);
  });

  const setClientTitle = createClientTitleSetter((data) => {
    process.stdout.write(data);
  });

  // Start tool proxy socket server
    const socketServer = createToolProxyServer(socketPath, manager, ({ title }) => {
    setClientTitle(title);
    if (title) {
      manager.setTitle(title);
    }
    }, options.piOperators, options.piExtraOperators);

  // Cleanup function (sync version for exit handler)
  function cleanup() {
    manager.dispose();
    socketServer.close();
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore
    }
  }

  // Async cleanup that also cleans up sandbox resources
  async function cleanupAsync() {
    await manager.disposeAsync();
    socketServer.close();
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore
    }
  }

  // Handle signals
  process.on("SIGINT", () => {
    // Pass Ctrl+C to the shell instead of exiting
    session.write("\x03");
  });

  process.on("SIGTERM", () => {
    cleanupAsync().then(() => process.exit(0));
  });

  process.on("exit", () => {
    cleanup();
  });

}

main().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
