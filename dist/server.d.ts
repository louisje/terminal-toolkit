import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TerminalManager } from "./terminal/index.js";
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
export declare const SERVER_INSTRUCTIONS = "Terminal Toolkit exposes a real PTY-backed shell to AI assistants.\n\nPrefer this server over plain non-interactive shell tools whenever the command:\n- needs sudo or otherwise prompts for a password (the human user can type it interactively)\n- prompts the user for input mid-execution (ssh login, git push over HTTPS, npm login, etc.)\n- runs a TUI program (vim, nano, less, more, htop, top, man, kubectl edit, gh pr create)\n- requires line-buffered TTY behavior (color output, progress bars, fzf, watch)\n- performs a long-running compile, build, or test run: prefer a PTY even when non-interactive, so progress, failures, and partial output can be inspected without blocking on completion\n- needs to be observed while still running (server, REPL, or any command with live progress)\n\nOnly the default session may be directly visible to the user (in interactive mode);\nunder headless mode even the default session is not directly visible. Sessions created\nby createSession() are always headless PTYs: AI can interact with them through tools,\nbut the user cannot see them directly. For user-observed commands or password prompts,\nuse the default session only when it is visibly available; do not assume that creating\nanother session will let the user see a prompt or type a password.\n\nFirst call getContent() without sessionId to inspect the default terminal. Reuse it\nonly when clearly idle and available. If someone is using it, a command/TUI is\nrunning, or availability is unclear, call createSession() and use the returned\nsessionId for subsequent terminal calls, provided direct human interaction is not\nrequired. Do not send input or interrupt occupied terminals.\n\nWorkflow in the chosen session: type(<command>), sendKey('Enter'), then getContent() to read the result.\nFor long-running interactive programs, sendKey for navigation and takeScreenshot to\ninspect cursor position and TUI state.\n\nMulti-session: omit sessionId to drive the default session, or call createSession to\nget a new isolated PTY for parallel work (e.g. a build in one session, diagnostics in\nanother). The default session cannot be destroyed.";
export interface InstructionOptions {
    codemode?: boolean;
    piOperators?: boolean;
    piExtraOperators?: boolean;
}
export declare function getServerInstructions({ codemode, piOperators, piExtraOperators }?: InstructionOptions): string;
export declare function createServerWithManager(manager: TerminalManager, piOperators?: boolean, piExtraOperators?: boolean, codemode?: boolean): Server;
/**
 * Create and configure the MCP server with a new terminal manager
 */
export declare function createServer(options?: ServerOptions): {
    server: Server;
    manager: TerminalManager;
};
/**
 * Connect an MCP server to a transport
 */
export declare function connectServer(server: Server, transport: Transport): Promise<void>;
/**
 * Start the MCP server with stdio transport (legacy mode)
 */
export declare function startServer(options?: ServerOptions): Promise<void>;
//# sourceMappingURL=server.d.ts.map