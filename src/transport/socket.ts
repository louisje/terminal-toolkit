import * as fs from "fs";
import { Server as NetServer, Socket } from "net";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
import { getStats } from "../utils/stats.js";

// Tool handlers
import { handleType } from "../tools/type.js";
import { handleSendKey } from "../tools/sendKey.js";
import { handleSleep } from "../tools/sleep.js";
import { handleGetContent } from "../tools/getContent.js";
import { handleGetBufferInfo } from "../tools/getBufferInfo.js";
import { handleScreenshot } from "../tools/screenshot.js";
import { handleStartRecording } from "../tools/startRecording.js";
import { handleStopRecording } from "../tools/stopRecording.js";
import { handleCreateSession } from "../tools/createSession.js";
import { handleListSessions } from "../tools/listSessions.js";
import { handleDestroySession } from "../tools/destroySession.js";
import { handleResize } from "../tools/resize.js";
import { handleGetClipboard } from "../tools/getClipboard.js";
import { handleSetClipboard } from "../tools/setClipboard.js";
import { handleNotify } from "../tools/notify.js";
import { handleOperatorTool } from "../tools/operators.js";
import { handleExtraOperatorTool } from "../tools/extra-operators.js";

interface SocketRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface SocketResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

const clientConnectedSchema = z.object({
  title: z.string().optional(),
  piOperators: z.boolean().optional(),
  piExtraOperators: z.boolean().optional(),
});

export type ClientConnectedParams = z.infer<typeof clientConnectedSchema>;

/**
 * Transport that communicates over a Unix socket connection
 * (Used for full MCP protocol when needed)
 */
export class SocketTransport implements Transport {
  private socket: Socket;
  private buffer = "";

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(socket: Socket) {
    this.socket = socket;

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.socket.on("error", (error) => {
      this.onerror?.(error);
    });

    this.socket.on("close", () => {
      this.onclose?.();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JSONRPCMessage;
          this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(new Error(`Failed to parse message: ${line}`));
        }
      }
    }
  }

  async start(): Promise<void> {
    // Socket is already connected
  }

  async close(): Promise<void> {
    this.socket.end();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(message) + "\n";
      this.socket.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Create a Unix socket server that accepts MCP connections
 */
export function createSocketServer(
  socketPath: string,
  onConnection: (transport: SocketTransport) => void
): NetServer {
  // Remove existing socket file if it exists
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Ignore if doesn't exist
  }

  const server = new NetServer((socket) => {
    const transport = new SocketTransport(socket);
    onConnection(transport);
  });

  server.listen(socketPath);

  return server;
}

/**
 * Create a simple request/response socket server for tool proxying
 * This is the protocol used between interactive mode and MCP client mode
 */
export function createToolProxyServer(
  socketPath: string,
  manager: TerminalManager,
  onClientConnected?: (params: ClientConnectedParams) => void,
  piOperators = false,
  piExtraOperators = false
): NetServer {
  // Limits apply to the new custom-event protocol without changing legacy tool payloads.
  const MAX_CUSTOM_EVENT_BYTES = 64 * 1024;
  const MAX_SUBSCRIPTIONS = 128;
  const MAX_PENDING_SOCKET_BYTES = 1024 * 1024;
  const PUBLISH_BURST = 20;
  const PUBLISH_REFILL_PER_SECOND = 10;
  const PROTOCOL_VERSION = 1;
  const PROTOCOL_CAPABILITIES = [
    "session.attach", "session.detach", "session.lifecycle",
    "event.custom", "event.sessionScope", "event.systemFilter",
    "event.rateLimit",
  ];
  let clientCount = 0;
  let nextConnectionId = 0;
  type SocketConnection = { socket: Socket; sessionId?: string; subscriptions: Set<string>; systemFilterEnabled: boolean };
  const connections = new Map<number, SocketConnection>();
  // A scoped subscription is distinct from its unscoped counterpart.
  const subscriptionKey = (topic: string, sessionId?: string): string =>
    JSON.stringify([topic, sessionId ?? null]);
  const broadcastClientCount = (): void => {
    const message = JSON.stringify({ event: "client.count", data: clientCount }) + "\n";
    for (const connection of connections.values()) {
      if (!connection.socket.destroyed) connection.socket.write(message);
    }
  };
  const unsubscribeSessionEvents = manager.onSessionEvent?.((event, sessionId) => {
    const message = JSON.stringify({ event, sessionId }) + "\n";
    for (const connection of connections.values()) {
      if (connection.socket.destroyed) continue;
      if (connection.systemFilterEnabled &&
          !connection.subscriptions.has(subscriptionKey(event)) &&
          !connection.subscriptions.has(subscriptionKey(event, sessionId))) continue;
      connection.socket.write(message);
    }
  });
  const server = new NetServer((socket) => {
    const connectionId = ++nextConnectionId;
    const connection: SocketConnection = { socket, subscriptions: new Set<string>(), systemFilterEnabled: false };
    connections.set(connectionId, connection);
    clientCount = connections.size;
    manager.setClientCount?.(clientCount);
    broadcastClientCount();
    let publishTokens = PUBLISH_BURST;
    let lastPublishRefill = performance.now();
    let buffer = "";
    const inflight = new Map<number, AbortController>();
    let attached = false;
    let attachedSessionId: string | undefined;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeExit: (() => void) | undefined;
    const detach = (): void => {
      attached = false;
      attachedSessionId = undefined;
      connection.sessionId = undefined;
      unsubscribeData?.();
      unsubscribeExit?.();
      unsubscribeData = undefined;
      unsubscribeExit = undefined;
    };
    let clientPiOperators = piOperators;
    let clientPiExtraOperators = piExtraOperators;

    socket.on("data", async (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const request = JSON.parse(line) as SocketRequest;
            if (request.method === "hello") {
              const requestedVersion = request.params?.protocolVersion;
              if (requestedVersion !== undefined && (!Number.isInteger(requestedVersion) || requestedVersion !== PROTOCOL_VERSION)) {
                if (!socket.destroyed) socket.write(JSON.stringify({
                  id: request.id, error: { message: "Unsupported socket protocol version" },
                }) + "\n");
                continue;
              }
              if (!socket.destroyed) socket.write(JSON.stringify({
                id: request.id,
                result: { protocolVersion: PROTOCOL_VERSION, capabilities: PROTOCOL_CAPABILITIES },
              }) + "\n");
              continue;
            }
            if (request.method === "subscribe" || request.method === "unsubscribe" || request.method === "publish") {
              const topic = request.params?.topic;
              const isCustomTopic = typeof topic === "string" && /^custom\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(topic);
              const isSystemTopic = topic === "session.created" || topic === "session.destroyed";
              if (!isCustomTopic && !(request.method !== "publish" && isSystemTopic)) {
                if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, error: { message: "Invalid custom event topic" } }) + "\n");
                continue;
              }
              const rawSessionId = request.params?.sessionId;
              if (rawSessionId !== undefined && (typeof rawSessionId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(rawSessionId))) {
                if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, error: { message: "Invalid sessionId" } }) + "\n");
                continue;
              }
              const sessionId = rawSessionId as string | undefined;
              const key = subscriptionKey(topic, sessionId);
              if (request.method === "subscribe" && !connection.subscriptions.has(key) && connection.subscriptions.size >= MAX_SUBSCRIPTIONS) {
                if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, error: { message: "Subscription limit reached" } }) + "\n");
                continue;
              }
              if (request.method === "publish") {
                const message = JSON.stringify({ event: topic, data: request.params?.data ?? null, source: connectionId, ...(sessionId ? { sessionId } : {}) }) + "\n";
                if (Buffer.byteLength(message, "utf8") > MAX_CUSTOM_EVENT_BYTES) {
                  if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, error: { message: "Custom event exceeds 64 KiB" } }) + "\n");
                  continue;
                }
                const now = performance.now();
                publishTokens = Math.min(PUBLISH_BURST, publishTokens + (now - lastPublishRefill) * PUBLISH_REFILL_PER_SECOND / 1000);
                lastPublishRefill = now;
                if (publishTokens < 1) {
                  if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, error: { message: "Custom event publish rate exceeded" } }) + "\n");
                  continue;
                }
                publishTokens -= 1;
                for (const subscriber of connections.values()) {
                  if (!subscriber.subscriptions.has(key) || subscriber.socket.destroyed) continue;
                  // A slow subscriber must not grow the server's output buffer indefinitely.
                  if (subscriber.socket.writableLength + Buffer.byteLength(message, "utf8") > MAX_PENDING_SOCKET_BYTES) {
                    subscriber.socket.destroy();
                    continue;
                  }
                  subscriber.socket.write(message);
                }
              }
              if (request.method === "subscribe") {
                connection.subscriptions.add(key);
                if (isSystemTopic) connection.systemFilterEnabled = true;
              }
              if (request.method === "unsubscribe") connection.subscriptions.delete(key);
              if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, result: { accepted: true } }) + "\n");
              continue;
            }
            if (request.method === "detach") {
              detach();
              if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, result: { detached: true } }) + "\n");
              continue;
            }
            if (request.method === "attach") {
              if (attached) continue;
              const requestedSessionId = request.params?.sessionId;
              if (requestedSessionId !== undefined && typeof requestedSessionId !== "string") throw new Error("sessionId must be a string");
              const sessionId = requestedSessionId || "default";
              const session = await manager.resolveSession(sessionId === "default" ? undefined : sessionId);
              attachedSessionId = sessionId;
              connection.sessionId = sessionId;
              attached = true;
              console.error(`[terminal-toolkit] Interactive client attached (clients: ${clientCount})`);
              // A snapshot lets a newly attached terminal see the existing prompt.
              const screen = session.takeScreenshot();
              const snapshot = session.getAnsiContent(true);
              socket.write(JSON.stringify({
                id: request.id,
                result: { snapshot, cursor: screen.cursor },
              }) + "\n");
              unsubscribeData = session.onData((output) => {
                if (attached && !socket.destroyed) {
                  socket.write(JSON.stringify({ event: "output", data: output, ...(attachedSessionId !== "default" ? { sessionId: attachedSessionId } : {}) }) + "\n");
                }
              });
              unsubscribeExit = session.onExit(() => {
                if (attached && !socket.destroyed) socket.end();
              });
              continue;
            }
            if (attached && request.method === "input") {
              manager.write(String(request.params?.data ?? ""), attachedSessionId === "default" ? undefined : attachedSessionId);
              continue;
            }
            if (attached && request.method === "terminalResize") {
              const cols = Number(request.params?.cols);
              const rows = Number(request.params?.rows);
              if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
                manager.resize(cols, rows, attachedSessionId === "default" ? undefined : attachedSessionId);
              }
              continue;
            }
            if (request.method === "cancel") {
              const target = request.params?.requestId;
              if (typeof target === "number") inflight.get(target)?.abort();
              continue;
            }
            const controller = new AbortController();
            inflight.set(request.id, controller);
            const response = await handleToolRequest(manager, request, onClientConnected, clientPiOperators, clientPiExtraOperators, (enabled) => {
              clientPiOperators = clientPiOperators || enabled;
            }, (enabled) => { clientPiExtraOperators = clientPiExtraOperators || enabled; }, controller.signal);
            inflight.delete(request.id);
            if (!controller.signal.aborted && !socket.destroyed) socket.write(JSON.stringify(response) + "\n");
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            socket.write(
              JSON.stringify({
                id: 0,
                error: { message: `Parse error: ${errorMessage}` },
              }) + "\n"
            );
          }
        }
      }
    });

    socket.on("close", () => {
      const wasAttached = attached;
      detach();
      connections.delete(connectionId);
      clientCount = connections.size;
      if (wasAttached) console.error(`[terminal-toolkit] Interactive client detached (clients: ${clientCount})`);
      manager.setClientCount?.(clientCount);
      broadcastClientCount();
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
    });
    socket.on("error", () => {
      // Client disconnected, ignore
    });
  });

  if (unsubscribeSessionEvents) server.on("close", unsubscribeSessionEvents);
  server.listen(socketPath);

  return server;
}

/**
 * Handle a tool request from the MCP client
 */
async function handleToolRequest(
  manager: TerminalManager,
  request: SocketRequest,
  onClientConnected?: (params: ClientConnectedParams) => void,
  piOperators = false,
  piExtraOperators = false,
  setClientPiOperators?: (enabled: boolean) => void,
  setClientPiExtraOperators?: (enabled: boolean) => void,
  signal?: AbortSignal
): Promise<SocketResponse> {
  const { id, method, params } = request;
  const stats = getStats();

  try {
    let result: unknown;

    // Lazily create the default PTY only for operations that need it.
    const ptyMethods = new Set([
      "type", "sendKey", "getContent", "getBufferInfo", "takeScreenshot",
      "startRecording", "stopRecording", "resize",
    ]);
    if (ptyMethods.has(method) && (params?.sessionId === undefined || params?.sessionId === "default")) {
      await manager.getSessionAsync();
    }

    switch (method) {
      case "ls":
      case "grep":
      case "find":
        if (!piExtraOperators) throw new Error("Unknown tool: " + method);
        result = await handleExtraOperatorTool(method, params);
        break;
      case "read":
      case "write":
      case "edit":
      case "shell":
        if (!piOperators) throw new Error(`Unknown tool: ${method}`);
        result = await handleOperatorTool(method, params, manager.getConfiguredShell(), signal);
        break;
      case "type":
        stats.recordToolCall("type");
        result = await handleType(manager, params);
        break;

      case "sendKey":
        stats.recordToolCall("sendKey");
        result = handleSendKey(manager, params);
        break;

      case "sleep":
        stats.recordToolCall("sleep");
        result = await handleSleep(manager, params, signal);
        break;

      case "getContent":
        stats.recordToolCall("getContent");
        result = await handleGetContent(manager, params);
        break;

      case "getBufferInfo":
        stats.recordToolCall("getBufferInfo");
        result = handleGetBufferInfo(manager, params);
        break;

      case "takeScreenshot":
        stats.recordToolCall("takeScreenshot");
        result = handleScreenshot(manager, params);
        break;

      case "startRecording":
        stats.recordToolCall("startRecording");
        result = handleStartRecording(manager, params);
        break;

      case "stopRecording":
        stats.recordToolCall("stopRecording");
        result = await handleStopRecording(manager, params);
        break;

      case "createSession":
        stats.recordToolCall("createSession");
        result = await handleCreateSession(manager, params);
        break;

      case "listSessions":
        stats.recordToolCall("listSessions");
        result = handleListSessions(manager, params);
        break;

      case "destroySession":
        stats.recordToolCall("destroySession");
        result = handleDestroySession(manager, params);
        break;

      case "resize":
        stats.recordToolCall("resize");
        result = handleResize(manager, params);
        break;

      case "getClipboard":
        stats.recordToolCall("getClipboard");
        result = await handleGetClipboard(manager, params);
        break;

      case "setClipboard":
        stats.recordToolCall("setClipboard");
        result = await handleSetClipboard(manager, params);
        break;

      case "notify":
        stats.recordToolCall("notify");
        result = await handleNotify(manager, params);
        break;

      case "clientConnected": {
        const parsed = clientConnectedSchema.parse(params ?? {});
        setClientPiOperators?.(parsed.piOperators === true);
        setClientPiExtraOperators?.(parsed.piExtraOperators === true);
        onClientConnected?.(parsed);
        result = { ok: true };
        break;
      }

      default:
        return {
          id,
          error: { message: `Unknown method: ${method}` },
        };
    }

    return { id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id,
      error: { message },
    };
  }
}
