import { exec } from "child_process";
import { enableInitializeExperiment } from "./initializeExperiment.js";
import { enableToolsListChangedExperiment } from "./toolsListChangedExperiment.js";
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
  experimentInitialize?: boolean;
  experimentToolsListChanged?: boolean;
  cols?: number;
  rows?: number;
  shell?: string;
  login?: boolean;
  tmux?: boolean | string;
  title?: string;
  maxSessions?: number;
  sessionIdleTimeout?: number;
    piExtraOperators?: boolean;
  codemode?: boolean;
}

export function createServerWithManager(manager: TerminalManager, piExtraOperators = false, codemode = false): Server {
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
    }
  );

  registerTools(server, manager, piExtraOperators, codemode);
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
    mode: "headless",
    role: "server",
    cols: options.cols,
    rows: options.rows,
    shell: options.shell,
    login: options.login,
    maxSessions: options.maxSessions,
    sessionIdleTimeout: options.sessionIdleTimeout,
  });

  const server = createServerWithManager(manager, options.piExtraOperators, options.codemode);
  if (options.experimentInitialize) enableInitializeExperiment(server);
  if (options.experimentToolsListChanged) enableToolsListChangedExperiment(server);

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
