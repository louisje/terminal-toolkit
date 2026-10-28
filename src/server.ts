import { exec } from "child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TerminalManager } from "./terminal/index.js";
import { VERSION } from "./utils/version.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/index.js";
import { registerSkills } from "./skills.js";
import { installStdioShutdownHandlers } from "./utils/shutdown.js";

export interface ServerOptions {
  cols?: number;
  rows?: number;
  shell?: string;
  login?: boolean;
  tmux?: boolean | string;
  title?: string;
  maxSessions?: number;
  sessionIdleTimeout?: number;
  piOperators?: boolean;
  piExtraOperators?: boolean;
  codemode?: boolean;
}

/**
 * Create and configure the MCP server with an existing terminal manager
 */
export const SERVER_INSTRUCTIONS = `Terminal Toolkit exposes a real PTY-backed shell to AI assistants.

Prefer this server over plain non-interactive shell tools whenever the command:
- needs sudo or otherwise prompts for a password (the human user can type it interactively)
- prompts the user for input mid-execution (ssh login, git push over HTTPS, npm login, etc.)
- runs a TUI program (vim, nano, less, more, htop, top, man, kubectl edit, gh pr create)
- requires line-buffered TTY behavior (color output, progress bars, fzf, watch)
- performs a long-running compile, build, or test run: prefer a PTY even when non-interactive, so progress, failures, and partial output can be inspected without blocking on completion
- needs to be observed while still running (server, REPL, or any command with live progress)

Only the default session may be directly visible to the user (in interactive mode);
under headless mode even the default session is not directly visible. Sessions created
by createSession() are always headless PTYs: AI can interact with them through tools,
but the user cannot see them directly. For user-observed commands or password prompts,
use the default session only when it is visibly available; do not assume that creating
another session will let the user see a prompt or type a password.

First call getContent() without sessionId to inspect the default terminal. Reuse it
only when clearly idle and available. If someone is using it, a command/TUI is
running, or availability is unclear, call createSession() and use the returned
sessionId for subsequent terminal calls, provided direct human interaction is not
required. Do not send input or interrupt occupied terminals.

Workflow in the chosen session: type(<command>), sendKey('Enter'), then getContent() to read the result.
For long-running interactive programs, sendKey for navigation and takeScreenshot to
inspect cursor position and TUI state.

Multi-session: omit sessionId to drive the default session, or call createSession to
get a new isolated PTY for parallel work (e.g. a build in one session, diagnostics in
another). The default session cannot be destroyed.`;

const PI_OPERATOR_INSTRUCTIONS = `

Pi operators are enabled. Prefer read, write, and edit for direct text-file operations instead of
constructing shell commands for them. edit performs exact, unique, non-overlapping string
replacements against the original file; it is not an append/prepend primitive.

For short, one-shot, non-interactive shell commands, prefer shell. It runs a fresh stateless
subprocess using Terminal Toolkit's configured shell (the --shell option, TERMINAL_TOOLKIT_SHELL,
then the platform shell default) in terminal-toolkit's startup working directory and returns stdout/stderr when the
command finishes, so it does not require the PTY type/sendKey/getContent workflow. Use the PTY
tools instead when you need the user's existing cwd/environment/aliases/tmux state, persistent
shell state across calls, interactive input, TTY behavior, or live observability. In particular,
prefer PTY for lengthy compilation, builds, or test suites even if no interaction is expected;
use shell for short checks and quick tests that finish promptly.`;

const PI_EXTRA_OPERATOR_INSTRUCTIONS = `\n\nPi extra operators are enabled: ls lists directory entries, grep searches file contents using installed rg, and find searches paths using installed fd/fdfind. These tools do not install dependencies. If a required executable is missing, ask the user to install it.`;


const CODEMODE_INSTRUCTIONS = `

Codemode exposes one MCP tool that executes JavaScript as an async function body in an isolated QuickJS VM. Use top-level await with tools.<name>(args). Discover all tools with await searchTools(), or search by keyword with await searchTools(query, {limit?, namespace?}); use await describeTool(name) to inspect the inputSchema and await describeNamespace("terminal") for the server tool group.
Use Promise.allSettled for independent calls when failures should not cancel other results; chain dependent calls sequentially. Filter large outputs in the script and emit only relevant results with text(value). Ordinary nested tool results are not automatically returned to the model. Script globals do not include Node.js, filesystem, network, or timers; calls to injected tools retain their existing host permissions. Each execution is a fresh JavaScript environment, while the real terminal sessions persist.
Read await describeNamespace("terminal") for the Terminal Toolkit operational and safety instructions before working with terminal tools.`;

export interface InstructionOptions { codemode?: boolean; piOperators?: boolean; piExtraOperators?: boolean; }

export function getServerInstructions({ codemode = false, piOperators = false, piExtraOperators = false }: InstructionOptions = {}): string {
  if (codemode) return CODEMODE_INSTRUCTIONS.trim();
  return SERVER_INSTRUCTIONS
    + (piOperators ? PI_OPERATOR_INSTRUCTIONS : "")
    + (piExtraOperators ? PI_EXTRA_OPERATOR_INSTRUCTIONS : "");
}

export function createServerWithManager(manager: TerminalManager, piOperators = false, piExtraOperators = false, codemode = false): Server {
  const server = new Server(
    {
      name: "terminal-toolkit",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
        extensions: { "io.modelcontextprotocol/skills": {} },
      },
      instructions: getServerInstructions({ codemode, piOperators, piExtraOperators }),
    }
  );

  registerTools(server, manager, piOperators, piExtraOperators, codemode);
  registerPrompts(server);
  registerSkills(server);

  return server;
}

/**
 * Create and configure the MCP server with a new terminal manager
 */
export function createServer(options: ServerOptions = {}): {
  server: Server;
  manager: TerminalManager;
} {
  const manager = new TerminalManager({
    cols: options.cols,
    rows: options.rows,
    shell: options.shell,
    login: options.login,
    maxSessions: options.maxSessions,
    sessionIdleTimeout: options.sessionIdleTimeout,
  });

  const server = createServerWithManager(manager, options.piOperators, options.piExtraOperators, options.codemode);

  return { server, manager };
}

/**
 * Connect an MCP server to a transport
 */
export async function connectServer(server: Server, transport: Transport): Promise<void> {
  await server.connect(transport);
}

/**
 * Start the MCP server with stdio transport (legacy mode)
 */
export async function startServer(options: ServerOptions = {}): Promise<void> {
  const { server, manager } = createServer(options);

  // Install BEFORE initSession(): that call spawns the PTY, so a signal
  // arriving mid-spawn would otherwise orphan the shell. This is also the only
  // path that can reach dispose() during startup, which is what makes the
  // `disposed` guard in TerminalManager live rather than dead code.
  installStdioShutdownHandlers({
    cleanup: () => {
      // dispose() is synchronous and kills the PTY, so it survives the 'exit'
      // path. finalizeRecordings() runs first only so its synchronous prefix
      // lands there too; its async tail needs a live event loop.
      // The shell has NOT exited — the client detached — so report exitCode
      // null and a shutdown stop reason, not a fabricated clean exit.
      const finalized = manager.finalizeRecordings(null, "server_shutdown");
      manager.dispose();
      return finalized.then(() => undefined);
    },
  });

  // Eagerly initialize the terminal session so tools can use it immediately
  const session = await manager.initSession();

  // Auto-connect to tmux if --tmux is specified
  if (options.tmux) {
    const tmuxTarget = typeof options.tmux === 'string' ? options.tmux : '0';
    const tmuxName = options.title?.toLowerCase();

    // Wait for shell to be ready (prompt indicator appears) before sending tmux commands
    const sendTmuxCommands = () => {
      if (tmuxName) {
        console.error(`[terminal-toolkit] Auto-connecting to tmux session group (target: ${tmuxTarget}, name: ${tmuxName})...`);
        session.write(`tmux new -A -t ${tmuxTarget} -s ${tmuxName} \\; if-shell 'tmux select-window -t ${tmuxName}:${tmuxName}' '' 'new-window -n ${tmuxName}'\n`);
        setTimeout(() => {
          exec(`tmux list-clients -F '#{client_tty}' | sort | uniq | while read tty; do tmux display-message -d 5000 -c "$tty" ' 🔔 terminal-toolkit (${tmuxName}) connected'; done`);
        }, 1000);
      } else {
        console.error(`[terminal-toolkit] Auto-connecting to tmux session '${tmuxTarget}'...`);
        session.write(`tmux new -A -t ${tmuxTarget}\n`);
      }
    };

    // Listen for the prompt indicator to know shell is ready
    let promptSeen = false;
    session.onData((data) => {
      if (!promptSeen && data.includes('\u26a1 mcp')) {
        promptSeen = true;
        // Small delay to ensure prompt is fully rendered
        setTimeout(sendTmuxCommands, 100);
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
