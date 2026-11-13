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

/** Namespace metadata is centralized here so future per-namespace enablement
 * can be implemented without changing tool ownership or discovery semantics.
 * All namespaces remain enabled; this registry is not an access-control layer.
 */
export const namespaceRegistry = {
  "tools/core": {
    defaultEnabled: true,
    toolNames: ["read", "write", "edit", "shell", "ls", "grep", "find"],
  },
  "tools/pty": {
    defaultEnabled: true,
    toolNames: [
      "type", "sendKey", "getContent", "getBufferInfo", "takeScreenshot",
      "startRecording", "stopRecording", "createSession", "listSessions",
      "destroySession", "resize",
    ],
  },
  "tools/misc": {
    defaultEnabled: true,
    toolNames: ["getClipboard", "setClipboard", "notify", "sleep"],
  },
} as const;

export type ToolNamespace = keyof typeof namespaceRegistry;

const namespaceByTool = new Map<string, ToolNamespace>(
  (Object.entries(namespaceRegistry) as [ToolNamespace, (typeof namespaceRegistry)[ToolNamespace]][])
    .flatMap(([namespace, config]) => config.toolNames.map(name => [name, namespace] as const)),
);

export function getToolNamespace(name: string): ToolNamespace {
  // Preserve the previous fallback for unknown names.
  return namespaceByTool.get(name) ?? "tools/pty";
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  namespace?: ToolNamespace;
  name: string;
  description: string;
  instruction?: string;
  annotations?: ToolAnnotations;
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
export function getCodemodeToolDefinitions(piOperators = true, piExtraOperators = false): ToolDefinition[] {
  return getToolDefinitions(piOperators, piExtraOperators).map(tool => ({
    ...tool,
    namespace: getToolNamespace(tool.name),
    description: TOOL_SUMMARIES[tool.name] ?? tool.description,
    instruction: tool.description,
  }));
}

/** Standard MCP clients only see tools/list; include namespace guidance there. */
export function getMcpToolDefinitions(piOperators = true, piExtraOperators = false): ToolDefinition[] {
  return getToolDefinitions(piOperators, piExtraOperators).map(tool => ({
    ...tool,
    description: [tool.description, ...(getToolNamespace(tool.name) === "tools/pty" && ["type", "sendKey", "getContent", "createSession"].includes(tool.name) ? ["Before using the Primary Session, inspect getContent() and do not interrupt occupied terminals; additional sessions are headless."] : [])].join("\n\n"),
  }));
}

// MCP safety hints for each tool.
const READ_ONLY_TOOLS = new Set(["read", "ls", "grep", "find", "getContent", "getBufferInfo", "takeScreenshot", "listSessions", "getClipboard", "sleep"]);
const DESTRUCTIVE_TOOLS = new Set(["write", "edit", "shell", "type", "sendKey", "destroySession"]);
const IDEMPOTENT_TOOLS = new Set([...READ_ONLY_TOOLS, "resize", "setClipboard"]);
const OPEN_WORLD_TOOLS = new Set(["shell", "type", "sendKey"]);

export function getToolDefinitions(piOperators = true, piExtraOperators = false): ToolDefinition[] {
  return [...toolDefinitions, ...(piOperators ? operatorToolDefinitions : []), ...(piExtraOperators ? extraOperatorToolDefinitions : [])].map(tool => ({
    ...tool,
    annotations: {
      readOnlyHint: READ_ONLY_TOOLS.has(tool.name),
      destructiveHint: DESTRUCTIVE_TOOLS.has(tool.name),
      idempotentHint: IDEMPOTENT_TOOLS.has(tool.name),
      openWorldHint: OPEN_WORLD_TOOLS.has(tool.name),
    },
  }));
}

/**
 * Get just the tool names as an array
 */
export function getToolNames(): string[] {
  return toolDefinitions.map((t) => t.name);
}
