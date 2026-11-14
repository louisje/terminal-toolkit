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
  title?: string;
    piExtraOperators?: boolean;
  codemode?: boolean;
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
  // How long a socket close waits for a stdin EOF that would mark this as a
  // clean mutual shutdown rather than the interactive session dying alone.
  const SOCKET_CLOSE_GRACE_MS = 100;

  // Attach to an existing socket or own a new lazy socket-backed manager.
  let socket: net.Socket;
  let ownedManager: TerminalManager | undefined;
  let ownedServer: net.Server | undefined;
  const isRemoteClient = () => !ownedServer;
  try {
    socket = await connectToSocket(socketPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ECONNREFUSED" && code !== "ENOTSOCK") throw error;
    // macOS reports ENOTSOCK when a stale socket pathname is a regular file.
    // Only reclaim the path after a failed connection; never remove a live socket.
    if (code === "ECONNREFUSED" || code === "ENOTSOCK") fs.unlinkSync(socketPath);
    ownedManager = new TerminalManager({
      mode: "interactive", role: "server", shell: options.shell,
      cols: options.cols, rows: options.rows, login: options.login,
      maxSessions: options.maxSessions, sessionIdleTimeout: options.sessionIdleTimeout,
    });
    ownedServer = createToolProxyServer(socketPath, ownedManager, undefined, options.piExtraOperators);
    try {
      if (!ownedServer.listening) {
        await new Promise<void>((resolve, reject) => {
          ownedServer!.once("listening", resolve);
          ownedServer!.once("error", reject);
        });
      }
      socket = await connectToSocket(socketPath);
    } catch (startupError) {
      ownedServer.close();
      ownedManager.dispose();
      throw startupError;
    }
  }

  // Close our socket on MCP shutdown; release the manager and pathname only
  // when this process owns the server, never when attached to another owner.
  const shutdownState = installStdioShutdownHandlers({ cleanup: () => {
    socket.destroy();
    ownedServer?.close();
    ownedManager?.dispose();
    if (ownedServer) { try { fs.unlinkSync(socketPath); } catch { /* already removed */ } }
  } });

  // Create MCP server
  const server = new Server(
    {
      name: "terminal-toolkit",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        extensions: { "io.modelcontextprotocol/skills": {} },
      },
    }
  );

  if (options.experimentInitialize) enableInitializeExperiment(server);
  if (options.experimentToolsListChanged) enableToolsListChangedExperiment(server);

  // Request ID counter
  let requestId = 0;

  // Pending requests waiting for responses
  const pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  // Buffer for incoming data
  let buffer = "";

  // Handle responses from the interactive terminal
  socket.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line) as SocketResponse;
          const pending = pendingRequests.get(response.id);
          if (pending) {
            pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error.message);
    process.exit(1);
  });

  socket.on("close", () => {
    if (shutdownState.isShuttingDown()) return;
    // The interactive session and the MCP host often go away together (user
    // quits the terminal, host detaches). If the socket close is dequeued
    // first, exiting 1 immediately would mislabel a clean mutual teardown —
    // give an imminent stdin EOF a moment to start the clean shutdown instead.
    const graceTimer = setTimeout(() => {
      if (shutdownState.isShuttingDown()) return;
      console.error("Socket closed");
      process.exit(1);
    }, SOCKET_CLOSE_GRACE_MS);
    // stdin keeps the loop alive here, so this timer never needs to; unref'ing
    // it keeps that an implementation detail rather than a load-bearing one.
    graceTimer.unref();
  });

  // Helper to send request to interactive terminal
  async function sendRequest(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const id = ++requestId;
    const request: SocketRequest = { id, method, params, requestContext: requestContextStorage.getStore() };

    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("Tool call aborted")); return; }
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        if (!pendingRequests.delete(id)) return;
        socket.write(JSON.stringify({ id: ++requestId, method: "cancel", params: { requestId: id } }) + "\n");
        cleanup();
        reject(new Error("Tool call aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      pendingRequests.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
      socket.write(JSON.stringify(request) + "\n", (error) => {
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
    tools: options.codemode ? [codemodeDefinition] : getMcpToolDefinitions(options.piExtraOperators),
  }));

  // Register call tool handler - proxy to socket
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const context = createRequestContext(request.params._meta);

    return requestContextStorage.run(context, async () => {
    try {
      const result = options.codemode
        ? name === "codemode"
          ? await runCodemodeWithDispatch(args, getCodemodeToolDefinitions(options.piExtraOperators),
              (tool, params, signal) => dispatchTool(tool, params, signal), extra.signal)
          : (() => { throw new Error(`Unknown tool: ${name}`); })()
        : limitToolResponse(await dispatchTool(name, args as Record<string, unknown>, extra.signal) as { content?: Array<{ type: string; text?: string }> });
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
