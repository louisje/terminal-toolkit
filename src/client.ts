import * as net from "net";
import { createRequestContext, requestContextStorage, type RequestContext } from "./requestContext.js";
import * as fs from "fs";
import { TerminalManager } from "./terminal/index.js";
import { createToolProxyServer } from "./transport/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./utils/version.js";
import { enableInitializeExperiment } from "./initializeExperiment.js";
import { enableToolsListChangedExperiment } from "./toolsListChangedExperiment.js";
import { enableMcpEventsExperiment } from "./mcpEventsExperiment.js";
import { skillDiscoveryDefinitions, handleSkillDiscovery } from './tools/skillDiscovery.js';
import { registerSkills } from "./skills.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getMcpToolDefinitions, getCodemodeToolDefinitions } from "./tools/definitions.js";
import { runCodemodeWithDispatch, codemodeDefinition } from "./tools/codemode.js";
import { limitToolResponse } from "./tools/outputLimit.js";
import { installStdioShutdownHandlers } from "./utils/shutdown.js";

interface SocketRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  requestContext?: RequestContext;
}

interface SocketResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

interface McpClientModeOptions {
  experimentInitialize?: boolean;
  experimentToolsListChanged?: boolean;
  experimentMcpEvents?: boolean;
  title?: string;
    piExtraOperators?: boolean;
  codemode?: boolean;
  skills?: boolean;
  shell?: string;
  cols?: number;
  rows?: number;
  login?: boolean;
  maxSessions?: number;
  sessionIdleTimeout?: number;
}

type SocketRequestSender = (
  method: string,
  params?: Record<string, unknown>
) => Promise<unknown>;
export async function notifyClientConnected(
  sendRequest: SocketRequestSender,
  options: { title?: string; piOperators?: boolean; piExtraOperators?: boolean }
): Promise<void> {
  const params = options.title === undefined && options.piExtraOperators === undefined
    ? undefined
    : {
        ...(options.title === undefined ? {} : { title: options.title }),
                ...(options.piExtraOperators === undefined ? {} : { piExtraOperators: options.piExtraOperators }),
      };
  await sendRequest("clientConnected", params);
}

/**
 * MCP Client Mode - connects to existing terminal socket and serves MCP over stdio
 */
export async function startMcpClientMode(
  socketPath: string,
  options: McpClientModeOptions = {}
): Promise<void> {
  // Keep the MCP stdio transport alive across socket server restarts.
  let socket: net.Socket | undefined;
  let ownedManager: TerminalManager | undefined;
  let ownedServer: net.Server | undefined;
  let ownedSocketIdentity: { dev: number; ino: number } | undefined;
  let reconnecting = false;
  let stopped = false;
  const isRemoteClient = () => !ownedServer;
  const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let requestId = 0;
  let buffer = "";
  const unavailable = () => new Error("Socket server unavailable; reconnecting");
  const failPending = () => {
    for (const pending of pendingRequests.values()) pending.reject(unavailable());
    pendingRequests.clear();
  };
  const releaseOwned = () => {
    ownedServer?.close();
    ownedManager?.dispose();
    ownedServer = undefined;
    ownedManager = undefined;
    if (ownedSocketIdentity) {
      try {
        const current = fs.statSync(socketPath);
        if (current.dev === ownedSocketIdentity.dev && current.ino === ownedSocketIdentity.ino) fs.unlinkSync(socketPath);
      } catch { /* Already removed or replaced. */ }
    }
    ownedSocketIdentity = undefined;
  };
  const shutdownState = installStdioShutdownHandlers({ cleanup: () => {
    stopped = true;
    socket?.destroy();
    failPending();
    releaseOwned();
  } });

  function attachSocket(next: net.Socket): void {
    socket = next;
    buffer = "";
    next.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line) as SocketResponse;
          const pending = pendingRequests.get(response.id);
          if (!pending) continue;
          pendingRequests.delete(response.id);
          if (response.error) pending.reject(new Error(response.error.message));
          else pending.resolve(response.result);
        } catch { /* Ignore malformed frames. */ }
      }
    });
    next.on("error", (error) => console.error("Socket error:", error.message));
    next.on("close", () => {
      if (socket !== next) return;
      socket = undefined;
      failPending();
      if (!stopped && !shutdownState.isShuttingDown()) void reconnect();
    });
  }

  async function establish(allowTakeover: boolean): Promise<net.Socket> {
    try { return await connectToSocket(socketPath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!allowTakeover || (code !== "ENOENT" && code !== "ECONNREFUSED" && code !== "ENOTSOCK")) throw error;
      // Only reclaim a stale pathname after verifying no server accepts connections.
      if (code !== "ENOENT") {
        let stale: { dev: number; ino: number } | undefined;
        try { const stat = fs.statSync(socketPath); stale = { dev: stat.dev, ino: stat.ino }; }
        catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError; }
        try { await connectToSocket(socketPath).then(s => { s.destroy(); throw new Error("Server recovered"); }); }
        catch (retryError) {
          const retryCode = (retryError as NodeJS.ErrnoException).code;
          if (retryCode !== "ENOENT" && retryCode !== "ECONNREFUSED" && retryCode !== "ENOTSOCK") throw retryError;
        }
        try {
          const current = fs.statSync(socketPath);
          if (stale && current.dev === stale.dev && current.ino === stale.ino) fs.unlinkSync(socketPath);
        } catch { /* Another client may have claimed it. */ }
      }
      const manager = new TerminalManager({
        mode: "interactive", role: "server", shell: options.shell,
        cols: options.cols, rows: options.rows, login: options.login,
        maxSessions: options.maxSessions, sessionIdleTimeout: options.sessionIdleTimeout,
      });
      const server = createToolProxyServer(socketPath, manager, undefined, options.piExtraOperators);
      try {
        if (!server.listening) await new Promise<void>((resolve, reject) => {
          server.once("listening", resolve);
          server.once("error", reject);
        });
        ownedManager = manager;
        ownedServer = server;
        const stat = fs.statSync(socketPath);
        ownedSocketIdentity = { dev: stat.dev, ino: stat.ino };
        return await connectToSocket(socketPath);
      } catch (startupError) {
        server.close();
        manager.dispose();
        // Another client may have won the bind race. Connect to that owner.
        if ((startupError as NodeJS.ErrnoException).code === "EADDRINUSE") {
          return connectToSocket(socketPath);
        }
        throw startupError;
      }
    }
  }

  async function reconnect(): Promise<void> {
    if (reconnecting || stopped) return;
    reconnecting = true;
    let attempt = 0;
    while (!stopped && !shutdownState.isShuttingDown() && !socket) {
      try {
        const next = await establish(attempt >= 3);
        if (stopped) { next.destroy(); break; }
        attachSocket(next);
        console.error("[terminal-toolkit] Socket reconnected");
        void notifyClientConnected(sendRequest, { title: options.title, piExtraOperators: options.piExtraOperators }).catch(() => {});
        break;
      } catch (error) {
        if (attempt === 0) console.error("[terminal-toolkit] Socket disconnected; reconnecting", error);
        const delay = Math.min(30000, attempt === 0 ? 1000 : 1000 * 2 ** Math.min(attempt, 5));
        await new Promise<void>(resolve => setTimeout(resolve, delay));
        attempt++;
      }
    }
    reconnecting = false;
  }

  try { attachSocket(await establish(true)); }
  catch (error) {
    console.error("[terminal-toolkit] Initial socket unavailable; retrying:", error);
    void reconnect();
  }

  // Create MCP server
  const server = new Server(
    {
      name: "terminal-toolkit",
      version: VERSION,
    },
    {
      capabilities: {
        tools: options.experimentToolsListChanged ? { listChanged: true } : {},
        resources: {},
        ...(options.experimentMcpEvents ? { events: {} } : {}),
        extensions: { "io.modelcontextprotocol/skills": {} },
      },
    }
  );

  if (options.experimentInitialize) enableInitializeExperiment(server);
  if (options.experimentToolsListChanged) enableToolsListChangedExperiment(server);
  if (options.experimentMcpEvents) enableMcpEventsExperiment(server);

  // Helper to send request to interactive terminal
  async function sendRequest(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (!socket || socket.destroyed) throw unavailable();
    const activeSocket = socket;
    const id = ++requestId;
    const request: SocketRequest = { id, method, params, requestContext: requestContextStorage.getStore() };

    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("Tool call aborted")); return; }
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        if (!pendingRequests.delete(id)) return;
        activeSocket.write(JSON.stringify({ id: ++requestId, method: "cancel", params: { requestId: id } }) + "\n");
        cleanup();
        reject(new Error("Tool call aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      pendingRequests.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
      activeSocket.write(JSON.stringify(request) + "\n", (error) => {
        if (error) {
          pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  // Adapt session metadata for this MCP endpoint, including codemode dispatch.
  async function dispatchTool(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const result = await sendRequest(method, params, signal);
    if (method !== "listSessions" || !isRemoteClient()) return result;
    const response = result as { content?: Array<{ type: string; text?: string }> };
    return { ...response, content: response.content?.map(item => {
      if (item.type !== "text" || !item.text) return item;
      try {
        const listing = JSON.parse(item.text);
        for (const session of listing.sessions ?? []) {
          if (session.isDefault) session.role = "client";
        }
        return { ...item, text: JSON.stringify(listing, null, 2) };
      } catch { return item; }
    }) };
  }

  registerSkills(server);

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: options.codemode ? [codemodeDefinition] : [...getMcpToolDefinitions(options.piExtraOperators), ...(options.skills ? skillDiscoveryDefinitions : [])],
  }));

  // Register call tool handler - proxy to socket
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const context = createRequestContext(request.params._meta);
    if (context.responseDeadline) {
      console.error("[terminal-toolkit] MCP response deadline", JSON.stringify({
        tool: name, timeoutMs: context.responseDeadline.timeoutMs,
        remainingMs: Math.max(0, context.responseDeadline.deadlineAt - Date.now()),
        upstreamDeadline: context.responseDeadline.upstreamDeadline,
      }));
    }

    return requestContextStorage.run(context, async () => {
    try {
      const result = options.codemode
        ? name === "codemode"
          ? await runCodemodeWithDispatch(args, getCodemodeToolDefinitions(options.piExtraOperators),
              (tool, params, signal) => dispatchTool(tool, params, signal), extra.signal, options.skills)
          : (() => { throw new Error(`Unknown tool: ${name}`); })()
        : limitToolResponse(await (options.skills && (name === 'searchSkills' || name === 'describeSkill') ? handleSkillDiscovery(name, args) : dispatchTool(name, args as Record<string, unknown>, extra.signal)) as { content?: Array<{ type: string; text?: string }> });
      return result as {
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
    });
  });

  // Connect MCP server to stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Notify the interactive terminal without blocking MCP startup.
  void notifyClientConnected(sendRequest, { title: options.title, piExtraOperators: options.piExtraOperators }).catch((error) => {
    console.error("Warning: Failed to notify interactive terminal about client connection:", error);
  });
}

/**
 * Connect to the interactive terminal's socket
 */
function connectToSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}
