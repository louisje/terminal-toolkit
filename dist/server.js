import { exec } from "child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TerminalManager } from "./terminal/index.js";
import { VERSION } from "./utils/version.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/index.js";
/**
 * Create and configure the MCP server with an existing terminal manager
 */
const SERVER_INSTRUCTIONS = `Terminal MCP exposes a real PTY-backed shell to AI assistants.

Prefer this server over plain non-interactive shell tools whenever the command:
- needs sudo or otherwise prompts for a password (the human user can type it interactively)
- prompts the user for input mid-execution (ssh login, git push over HTTPS, npm login, etc.)
- runs a TUI program (vim, nano, less, more, htop, top, man, kubectl edit, gh pr create)
- requires line-buffered TTY behavior (color output, progress bars, fzf, watch)
- needs to be observed while still running (long-running build, server, REPL)

Workflow: type(<command>), sendKey('Enter'), then getContent() to read the result.
For long-running interactive programs, sendKey for navigation and takeScreenshot to
inspect cursor position and TUI state.

Multi-session: omit sessionId to drive the default session, or call createSession to
get a new isolated PTY for parallel work (e.g. a build in one session, diagnostics in
another). The default session cannot be destroyed.`;
export function createServerWithManager(manager) {
    const server = new Server({
        name: "terminal-mcp",
        version: VERSION,
    }, {
        capabilities: {
            tools: {},
            prompts: {},
        },
        instructions: SERVER_INSTRUCTIONS,
    });
    registerTools(server, manager);
    registerPrompts(server);
    return server;
}
/**
 * Create and configure the MCP server with a new terminal manager
 */
export function createServer(options = {}) {
    const manager = new TerminalManager({
        cols: options.cols,
        rows: options.rows,
        shell: options.shell,
        login: options.login,
        maxSessions: options.maxSessions,
        sessionIdleTimeout: options.sessionIdleTimeout,
    });
    const server = createServerWithManager(manager);
    return { server, manager };
}
/**
 * Connect an MCP server to a transport
 */
export async function connectServer(server, transport) {
    await server.connect(transport);
}
/**
 * Start the MCP server with stdio transport (legacy mode)
 */
export async function startServer(options = {}) {
    const { server, manager } = createServer(options);
    // Eagerly initialize the terminal session so tools can use it immediately
    const session = await manager.initSession();
    // Auto-connect to tmux if --tmux is specified
    if (options.tmux) {
        const tmuxTarget = typeof options.tmux === 'string' ? options.tmux : '0';
        const tmuxName = options.title?.toLowerCase();
        // Wait for shell to be ready (prompt indicator appears) before sending tmux commands
        const sendTmuxCommands = () => {
            if (tmuxName) {
                console.error(`[terminal-mcp] Auto-connecting to tmux session group (target: ${tmuxTarget}, name: ${tmuxName})...`);
                session.write(`tmux new -A -t ${tmuxTarget} -s ${tmuxName} \\; if-shell 'tmux select-window -t ${tmuxName}:${tmuxName}' '' 'new-window -n ${tmuxName}'\n`);
                setTimeout(() => {
                    exec(`tmux list-clients -F '#{client_tty}' | sort | uniq | while read tty; do tmux display-message -d 5000 -c "$tty" ' 🔔 terminal-mcp (${tmuxName}) connected'; done`);
                }, 1000);
            }
            else {
                console.error(`[terminal-mcp] Auto-connecting to tmux session '${tmuxTarget}'...`);
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
    // Handle graceful shutdown
    process.on("SIGINT", () => {
        manager.dispose();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        manager.dispose();
        process.exit(0);
    });
    // Initialize terminal session in background (don't block MCP connection)
    // This allows MCP server to start accepting messages while session initializes
    manager.initSession().catch((error) => {
        console.error("[terminal-mcp] Failed to initialize session:", error);
    });
    // Connect to transport (this will block until transport closes)
    await server.connect(transport);
}
//# sourceMappingURL=server.js.map