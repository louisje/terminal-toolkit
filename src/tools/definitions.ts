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
import { operatorToolDefinitions } from "./operators.js";
import { extraOperatorToolDefinitions } from "./extra-operators.js";

export type ToolNamespace = "tools/pi" | "tools/pty" | "tools/misc";

export function getToolNamespace(name: string): ToolNamespace {
  if (["read", "write", "edit", "shell", "ls", "grep", "find"].includes(name)) return "tools/pi";
  if (["getClipboard", "setClipboard", "notify", "sleep"].includes(name)) return "tools/misc";
  return "tools/pty";
}

export interface ToolDefinition {
  namespace?: ToolNamespace;
  name: string;
  description: string;
  instruction?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const toolDefinitions: ToolDefinition[] = [
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

/** Explicit discovery summaries. Existing MCP descriptions remain the single source
 * of usage guidance; they are never split heuristically at runtime. */
const TOOL_SUMMARIES: Record<string, string> = {
  type: "Send text input to an interactive terminal session.",
  sendKey: "Send a key or keyboard shortcut to a terminal session.",
  sleep: "Pause execution for a specified duration.",
  getContent: "Read content from a terminal session buffer.",
  getBufferInfo: "Get terminal buffer and scrollback metadata.",
  takeScreenshot: "Capture a screenshot of a terminal session.",
  startRecording: "Start recording a terminal session.",
  stopRecording: "Stop and finalize a terminal recording.",
  createSession: "Create an isolated headless PTY session, not directly visible to the user.",
  listSessions: "List active terminal sessions.",
  destroySession: "Destroy an additional terminal session.",
  resize: "Resize a terminal session.",
  getClipboard: "Read the system clipboard.",
  setClipboard: "Write text to the system clipboard.",
  notify: "Send an operating-system notification.",
  read: "Read a text file.",
  write: "Write a text file.",
  edit: "Edit a file by exact string replacement.",
  shell: "Run a quick one-shot non-interactive command with the configured shell; prefer PTY for long builds and tests.",
  ls: "List directory entries.",
  grep: "Search file contents using ripgrep.",
  find: "Find files using fd or fdfind.",
};

/** Canonical split fields for codemode. Legacy MCP descriptions are retained
 * unchanged as instruction text, avoiding a second copy of usage guidance. */
export function getCodemodeToolDefinitions(piOperators = false, piExtraOperators = false): ToolDefinition[] {
  return getToolDefinitions(piOperators, piExtraOperators).map(tool => ({
    ...tool,
    namespace: getToolNamespace(tool.name),
    description: TOOL_SUMMARIES[tool.name] ?? tool.description,
    instruction: tool.description,
  }));
}

export function getToolDefinitions(piOperators = false, piExtraOperators = false): ToolDefinition[] {
  return [...toolDefinitions, ...(piOperators ? operatorToolDefinitions : []), ...(piExtraOperators ? extraOperatorToolDefinitions : [])];
}

/**
 * Get just the tool names as an array
 */
export function getToolNames(): string[] {
  return toolDefinitions.map((t) => t.name);
}
