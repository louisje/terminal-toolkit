import * as fs from "fs";
import { Server as NetServer } from "net";
import { z } from "zod";
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
const clientConnectedSchema = z.object({
    title: z.string().optional(),
});
/**
 * Transport that communicates over a Unix socket connection
 * (Used for full MCP protocol when needed)
 */
export class SocketTransport {
    socket;
    buffer = "";
    onmessage;
    onerror;
    onclose;
    constructor(socket) {
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
    processBuffer() {
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    this.onmessage?.(message);
                }
                catch (error) {
                    this.onerror?.(new Error(`Failed to parse message: ${line}`));
                }
            }
        }
    }
    async start() {
        // Socket is already connected
    }
    async close() {
        this.socket.end();
    }
    async send(message) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(message) + "\n";
            this.socket.write(data, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
}
/**
 * Create a Unix socket server that accepts MCP connections
 */
export function createSocketServer(socketPath, onConnection) {
    // Remove existing socket file if it exists
    try {
        fs.unlinkSync(socketPath);
    }
    catch {
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
export function createToolProxyServer(socketPath, manager, onClientConnected) {
    // Remove existing socket file if it exists
    try {
        fs.unlinkSync(socketPath);
    }
    catch {
        // Ignore if doesn't exist
    }
    const server = new NetServer((socket) => {
        let buffer = "";
        socket.on("data", async (data) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const request = JSON.parse(line);
                        const response = await handleToolRequest(manager, request, onClientConnected);
                        socket.write(JSON.stringify(response) + "\n");
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        socket.write(JSON.stringify({
                            id: 0,
                            error: { message: `Parse error: ${errorMessage}` },
                        }) + "\n");
                    }
                }
            }
        });
        socket.on("error", () => {
            // Client disconnected, ignore
        });
    });
    server.listen(socketPath);
    return server;
}
/**
 * Handle a tool request from the MCP client
 */
async function handleToolRequest(manager, request, onClientConnected) {
    const { id, method, params } = request;
    const stats = getStats();
    try {
        let result;
        switch (method) {
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
                result = await handleSleep(manager, params);
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            id,
            error: { message },
        };
    }
}
//# sourceMappingURL=socket.js.map