import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./definitions.js";
import { getDefaultShell } from "../utils/platform.js";

const operatorCwd = process.cwd();

// Match Pi Coding Agent's process-group/tree termination behavior.
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const killer = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", detached: true, windowsHide: true });
    killer.once("error", () => {});
    killer.unref();
  } else {
    try { process.kill(-pid, "SIGKILL"); }
    catch { try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ } }
  }
}

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const readSchema = z.object({ path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().optional() });
const writeSchema = z.object({ path: z.string(), content: z.string() });
const editSchema = z.object({ path: z.string(), edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).min(1) });
const shellSchema = z.object({ command: z.string(), timeout: z.number().positive().optional() });

const result = (value: string, isError = false): TextResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

export const operatorToolDefinitions: ToolDefinition[] = [
  { name: "read", description: "Read a text file directly without using the PTY or shell. offset is a 1-indexed line number.", inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1 } }, required: ["path"] } },
  { name: "write", description: "Write a text file directly, creating parent directories and overwriting the file. Prefer this over shell redirection for whole-file writes.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit", description: "Apply exact unique non-overlapping string replacements against a file's original content. This is replacement-only, not an append/prepend primitive.", inputSchema: { type: "object", properties: { path: { type: "string" }, edits: { type: "array", items: { type: "object", properties: { oldText: { type: "string" }, newText: { type: "string" } }, required: ["oldText", "newText"] } } }, required: ["path", "edits"] } },
  { name: "shell", description: "Execute a one-shot non-interactive command in a fresh stateless subprocess using the configured Terminal Toolkit shell in the terminal-toolkit startup working directory. Returns stdout/stderr after completion; prefer for quick one-shot commands. Use PTY for long-running compilation, builds, and tests to inspect live progress, as well as for persistent shell state, interaction, or TTY behavior.", inputSchema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "number", description: "Timeout in seconds" } }, required: ["command"] } },
];

const localPath = (path: string): string => resolve(operatorCwd, path);

export async function handleOperatorTool(name: string, args: unknown, shell = getDefaultShell(), signal?: AbortSignal): Promise<TextResult> {
  if (signal?.aborted) throw new Error("Tool call aborted");
  switch (name) {
    case "read": {
      const parsed = readSchema.parse(args);
      const lines = (await readFile(localPath(parsed.path), "utf8")).split("\n");
      const start = (parsed.offset ?? 1) - 1;
      if (start >= lines.length) throw new Error(`Offset ${parsed.offset} is beyond end of file`);
      return result(lines.slice(start, parsed.limit === undefined ? undefined : start + parsed.limit).join("\n"));
    }
    case "write": {
      const parsed = writeSchema.parse(args);
      const target = localPath(parsed.path);
      await mkdir(dirname(target), { recursive: true });
      if (signal?.aborted) throw new Error("Tool call aborted");
      await writeFile(target, parsed.content, "utf8");
      return result(`Wrote ${parsed.path}`);
    }
    case "edit": {
      const parsed = editSchema.parse(args);
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
      if (signal?.aborted) throw new Error("Command aborted");
      let timedOut = false;
      const child = spawn(parsed.command, { cwd: operatorCwd, shell, detached: process.platform !== "win32",
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stop = () => { if (child.pid) killProcessTree(child.pid); };
      const onAbort = () => stop();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) stop();
      const timer = parsed.timeout === undefined ? undefined : setTimeout(() => { timedOut = true; stop(); }, parsed.timeout * 1000);
      let stdout = "";
      let stderr = "";
      let exceeded = false;
      const maxBuffer = 10 * 1024 * 1024;
      const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
        if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) { exceeded = true; stop(); }
      };
      child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        if (signal?.aborted) throw new Error("Command aborted");
        const output = `${stdout}${stderr}`;
        if (timedOut) return result(`${output}${output ? "\n" : ""}Command timed out after ${parsed.timeout} second(s).`, true);
        if (exceeded) return result("Command output exceeded 10 MiB buffer.", true);
        if (code !== 0) return result(`${output}${output ? "\n" : ""}Command exited with code ${code ?? "unknown"}.`, true);
        return result(output);
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    default: throw new Error(`Unknown operator tool: ${name}`);
  }
}
