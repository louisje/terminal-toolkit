import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions } from "./definitions.js";
import { handleType } from "./type.js";
import { handleSendKey } from "./sendKey.js";
import { handleSleep } from "./sleep.js";
import { handleGetContent } from "./getContent.js";
import { handleGetBufferInfo } from "./getBufferInfo.js";
import { handleScreenshot } from "./screenshot.js";
import { handleStartRecording } from "./startRecording.js";
import { handleStopRecording } from "./stopRecording.js";
import { handleCreateSession } from "./createSession.js";
import { handleListSessions } from "./listSessions.js";
import { handleDestroySession } from "./destroySession.js";
import { handleResize } from "./resize.js";
import { handleGetClipboard } from "./getClipboard.js";
import { handleSetClipboard } from "./setClipboard.js";
import { handleNotify } from "./notify.js";
export function registerTools(server, manager) {
    // Register list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolDefinitions,
    }));
    // Register call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            switch (name) {
                case "type":
                    return await handleType(manager, args);
                case "sendKey":
                    return handleSendKey(manager, args);
                case "sleep":
                    return await handleSleep(manager, args);
                case "getContent":
                    return await handleGetContent(manager, args);
                case "getBufferInfo":
                    return handleGetBufferInfo(manager, args);
                case "takeScreenshot":
                    return handleScreenshot(manager, args);
                case "startRecording":
                    return handleStartRecording(manager, args);
                case "stopRecording":
                    return await handleStopRecording(manager, args);
                case "createSession":
                    return await handleCreateSession(manager, args);
                case "listSessions":
                    return handleListSessions(manager, args);
                case "destroySession":
                    return handleDestroySession(manager, args);
                case "resize":
                    return handleResize(manager, args);
                case "getClipboard":
                    return await handleGetClipboard(manager, args);
                case "setClipboard":
                    return await handleSetClipboard(manager, args);
                case "notify":
                    return await handleNotify(manager, args);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
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
}
//# sourceMappingURL=index.js.map