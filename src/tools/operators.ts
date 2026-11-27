import { readRange } from "./readRange.js";
import { runForeground } from "../runtime/foreground.js";
import { executionManager } from "./runtime.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isExecutionPath } from "../runtime/virtual.js";
import { z } from "zod";
import type { ToolDefinition } from "./definitions.js";
import { getDefaultShell } from "../utils/platform.js";
import { isResultPath } from "./resultStore.js";

const operatorCwd = process.cwd();



type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const readSchema = z.object({ path: z.string(), offset: z.number().int().refine(n => n !== 0).optional(), limit: z.number().int().positive().optional(), timeout: z.number().min(0).max(90).optional() });
const writeSchema = z.object({ path: z.string(), content: z.string() });
const editSchema = z.object({ path: z.string(), edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).min(1) });
const shellSchema = z.object({ command: z.string(), timeout: z.number().finite().nonnegative().optional() });
const pythonSchema = z.object({ code: z.string(), timeout: z.number().finite().nonnegative().optional() });

const result = (value: string, isError = false): TextResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

export const operatorToolDefinitions: ToolDefinition[] = [
  { name: "read", description: "Read a text file or result:// or execution:// virtual file; prefer read over shell cat/head/tail for routine inspection. offset is a 1-indexed line number or negative from EOF (-1 is last line). Metadata reports size in bytes and totalLines. Content exceeding 16 KiB is suppressed; narrow offset/limit. Timeout returns incomplete results.", inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer", description: "Nonzero; negative counts from EOF" }, limit: { type: "integer", minimum: 1 }, timeout: { type: "number", minimum: 0, maximum: 90, description: "Seconds, default 30; 0 disables tool timeout" } }, required: ["path"] } },
  { name: "write", description: "Create or replace a complete text file directly, creating parent directories and overwriting existing content. Prefer write over shell redirection or heredocs for whole-file writes.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit", description: "Modify an existing text file with exact unique non-overlapping string replacements. Prefer edit over shell sed -i or scripted replacements. Replacement-only: not an append/prepend primitive.", inputSchema: { type: "object", properties: { path: { type: "string" }, edits: { type: "array", items: { type: "object", properties: { oldText: { type: "string" }, newText: { type: "string" } }, required: ["oldText", "newText"] } } }, required: ["path", "edits"] } },
  { name: "python", description: "Execute Python code directly in a fresh stateless python3 process, with source supplied through stdin (no shell heredoc). Uses the Terminal Toolkit startup working directory. Waits up to timeout seconds (default 90, maximum 90); 0 or expiry returns an executionId for background management. Use getExecution or waitExecution to inspect it. Prefer read/write/edit for routine file modifications.", inputSchema: { type: "object", properties: { code: { type: "string" }, timeout: { type: "number", minimum: 0, description: "Foreground wait in seconds (default 90, maximum 90; 0 starts in background)" } }, required: ["code"] } },
  { name: "shell", description: "Execute commands, not routine file reads or edits: prefer read/write/edit instead of shell cat, redirection, heredocs, or sed -i. Run a one-shot non-interactive command in a fresh stateless subprocess using the configured Terminal Toolkit shell in the terminal-toolkit startup working directory. Returns stdout/stderr after completion; timeout is foreground wait (default 90 seconds, maximum 90). Zero or expiry returns an executionId; use getExecution or waitExecution to inspect background work. Use PTY for long-running compilation, builds, and tests to inspect live progress, as well as for persistent shell state, interaction, or TTY behavior.", inputSchema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "number", minimum: 0, description: "Foreground wait in seconds (default 90, maximum 90; 0 starts in background)" } }, required: ["command"] } },
];

const localPath = (path: string): string => resolve(operatorCwd, path);

export async function handleOperatorTool(name: string, args: unknown, shell = getDefaultShell(), signal?: AbortSignal): Promise<TextResult> {
  if (signal?.aborted) throw new Error("Tool call aborted");
  switch (name) {
    case "read": {
      const parsed = readSchema.parse(args);
      return readRange(parsed, signal);
    }
    case "write": {
      const parsed = writeSchema.parse(args);
      if (parsed.path.startsWith("builtin://") || isResultPath(parsed.path) || isExecutionPath(parsed.path)) throw new Error("Virtual paths are read-only");
      const target = localPath(parsed.path);
      await mkdir(dirname(target), { recursive: true });
      if (signal?.aborted) throw new Error("Tool call aborted");
      await writeFile(target, parsed.content, "utf8");
      return result(`Wrote ${parsed.path}`);
    }
    case "edit": {
      const parsed = editSchema.parse(args);
      if (parsed.path.startsWith("builtin://") || isResultPath(parsed.path) || isExecutionPath(parsed.path)) throw new Error("Virtual paths are read-only");
      const target = localPath(parsed.path);
      const original = await readFile(target, "utf8");
      const ranges: Array<{ start: number; end: number; newText: string }> = [];
      for (const edit of parsed.edits) {
        if (!edit.oldText) throw new Error("Each oldText must be non-empty");
        const first = original.indexOf(edit.oldText);
        if (first < 0) throw new Error(`oldText was not found in ${parsed.path}`);
        if (first !== original.lastIndexOf(edit.oldText)) throw new Error(`oldText must match exactly once in ${parsed.path}`);
        ranges.push({ start: first, end: first + edit.oldText.length, newText: edit.newText });
      }
      ranges.sort((a, b) => a.start - b.start);
      for (let i = 1; i < ranges.length; i++) if (ranges[i - 1].end > ranges[i].start) throw new Error("Edits must not overlap");
      let updated = original;
      for (const edit of [...ranges].reverse()) updated = updated.slice(0, edit.start) + edit.newText + updated.slice(edit.end);
      if (signal?.aborted) throw new Error("Tool call aborted");
      await writeFile(target, updated, "utf8");
      return result(`Edited ${parsed.path}`);
    }
    case "shell": {
      const parsed = shellSchema.parse(args);
      return runForeground(executionManager, { tool: "shell", command: parsed.command, shell, cwd: operatorCwd }, parsed.timeout, signal);
    }
    case "python": {
      const parsed = pythonSchema.parse(args);
      return runForeground(executionManager, { tool: "python", command: "python3", args: ["-u", "-"], input: parsed.code, cwd: operatorCwd }, parsed.timeout, signal);
    }
    default: throw new Error(`Unknown operator tool: ${name}`);
  }
}
