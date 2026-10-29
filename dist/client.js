import * as net from "net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./utils/version.js";
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions } from "./tools/definitions.js";
export async function notifyClientConnected(sendRequest, options) {
    const params = options.title === undefined ? undefined : { title: options.title };
    await sendRequest("clientConnected", params);
}
/**
 * MCP Client Mode - connects to existing terminal socket and serves MCP over stdio
 */
export async function startMcpClientMode(socketPath, options = {}) {
    // Connect to the interactive terminal's socket
    const socket = await connectToSocket(socketPath);
    // Create MCP server
    const server = new Server({
        name: "terminal-mcp",
        version: VERSION,
    }, {
        capabilities: {
            tools: {},
        },
    });
    // Request ID counter
    let requestId = 0;
    // Pending requests waiting for responses
    const pendingRequests = new Map();
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
                    const response = JSON.parse(line);
                    const pending = pendingRequests.get(response.id);
                    if (pending) {
                        pendingRequests.delete(response.id);
                        if (response.error) {
                            pending.reject(new Error(response.error.message));
                        }
                        else {
                            pending.resolve(response.result);
                        }
                    }
                }
                catch {
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
        console.error("Socket closed");
        process.exit(1);
    });
    // Helper to send request to interactive terminal
    async function sendRequest(method, params) {
        const id = ++requestId;
        const request = { id, method, params };
        return new Promise((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
            socket.write(JSON.stringify(request) + "\n", (error) => {
                if (error) {
                    pendingRequests.delete(id);
                    reject(error);
                }
            });
        });
    }
    // Notify the interactive terminal that a client connected
    try {
        await notifyClientConnected(sendRequest, { title: options.title });
    }
    catch (error) {
        console.error("Warning: Failed to notify interactive terminal about client connection:", error);
        // Continue anyway - this is not critical
    }
    // Register list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolDefinitions,
    }));
    // Register call tool handler - proxy to socket
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const result = await sendRequest(name, args);
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Connect MCP server to stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
/**
 * Connect to the interactive terminal's socket
 */
function connectToSocket(socketPath) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
            resolve(socket);
        });
        socket.on("error", (error) => {
            if (error.code === "ENOENT") {
                reject(new Error(`No tmcp session found at ${socketPath}.\n` +
                    `Start an interactive session first by running: tmcp`));
            }
            else if (error.code === "ECONNREFUSED") {
                reject(new Error(`Connection refused to ${socketPath}.\n` +
                    `The tmcp session may have crashed. Try restarting it.`));
            }
            else {
                reject(error);
            }
        });
    });
}
//# sourceMappingURL=client.js.map