/**
 * Shared tool definitions used by both MCP client, server, and UI.
 * Single source of truth — derived from individual tool modules.
 */
import { typeTool } from "./type.js";
import { sendKeyTool } from "./sendKey.js";
import { sleepTool } from "./sleep.js";
import { getContentTool } from "./getContent.js";
import { getBufferInfoTool } from "./getBufferInfo.js";
import { screenshotTool } from "./screenshot.js";
import { startRecordingTool } from "./startRecording.js";
import { stopRecordingTool } from "./stopRecording.js";
import { createSessionTool } from "./createSession.js";
import { listSessionsTool } from "./listSessions.js";
import { destroySessionTool } from "./destroySession.js";
import { resizeTool } from "./resize.js";
import { getClipboardTool } from "./getClipboard.js";
import { setClipboardTool } from "./setClipboard.js";
import { notifyTool } from "./notify.js";
export const toolDefinitions = [
    typeTool,
    sendKeyTool,
    sleepTool,
    getContentTool,
    getBufferInfoTool,
    screenshotTool,
    startRecordingTool,
    stopRecordingTool,
    createSessionTool,
    listSessionsTool,
    destroySessionTool,
    resizeTool,
    getClipboardTool,
    setClipboardTool,
    notifyTool,
];
/**
 * Get just the tool names as an array
 */
export function getToolNames() {
    return toolDefinitions.map((t) => t.name);
}
//# sourceMappingURL=definitions.js.map