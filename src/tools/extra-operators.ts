import { spawn } from "node:child_process";
import { opendir } from "node:fs/promises";
import { resolve, relative, matchesGlob } from "node:path";
import { isExecutionPath, searchExecutionPaths, executionLines } from "../runtime/virtual.js";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { z } from "zod";
import type { ToolDefinition } from "./definitions.js";
import { isMemoryPath, listMemory, readMemory } from "./memoryStore.js";
import { isResultPath, readResult } from "./resultStore.js";

const cwd = process.cwd();
const output = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const hint = (name: string) => new Error((name === "fd" ? "fd/fdfind" : name) + " not found on PATH. Install manually: macOS: brew install " + (name === "rg" ? "ripgrep" : "fd") + "; Ubuntu/Debian: sudo apt install " + (name === "rg" ? "ripgrep" : "fd-find") + "; Termux: pkg install " + (name === "rg" ? "ripgrep" : "fd"));
const capped = (value: string) => Buffer.byteLength(value) > 51200 ? Buffer.from(value).subarray(0, 51200).toString("utf8") + "\n[50KB limit reached]" : value;
const GREP_LIMIT = 51200;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
class GrepOutput {
  private lines: string[] = [];
  private bytes = 0;
  private truncated = false;
  add(line: string): boolean {
    const separator = this.lines.length ? 1 : 0;
    const available = GREP_LIMIT - this.bytes - separator;
    const bytes = Buffer.byteLength(line);
    if (bytes > available) {
      if (available > 0) this.lines.push(Buffer.from(line).subarray(0, available).toString("utf8").replace(/\uFFFD$/, ""));
      this.truncated = true;
      return false;
    }
    this.lines.push(line); this.bytes += bytes + separator;
    return true;
  }
  text(): string {
    return (this.lines.join("\n") || "No matches found") + (this.truncated ? "\n[50KB limit reached; results truncated]" : "");
  }
}
// Consume complete records only; stop the child and wait for close on every exit.
async function run(binary: string, args: string[], signal: AbortSignal, consume: (line: string) => boolean, allowNoMatch = false): Promise<void> {
  if (signal.aborted) return;
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let pending = "", stderr = "", stopped = false, failure: unknown;
    const stop = () => { if (!stopped) { stopped = true; child.kill("SIGKILL"); } };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (stopped) return;
      try {
        pending += data;
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end).replace(/\r$/, "");
          pending = pending.slice(end + 1);
          if (!consume(line)) { stop(); return; }
        }
        if (Buffer.byteLength(pending) > 8 * 1024 * 1024) throw new Error("Search record exceeded 8MB processing limit");
      } catch (error) { failure = error; stop(); }
    });
    child.stderr.on("data", (data: Buffer) => { if (stderr.length < 8192) stderr += data.toString(); });
    child.on("error", error => { failure = error; });
    child.on("close", code => {
      signal.removeEventListener("abort", stop);
      if (failure) { fail(failure); return; }
      if (stopped || signal.aborted) { done(); return; }
      if (code !== 0 && !(allowNoMatch && code === 1)) { fail(new Error(stderr.trim() || binary + " exited with code " + code)); return; }
      try { if (pending) consume(pending); done(); } catch (error) { fail(error); }
    });
    if (signal.aborted) stop();
  });
}
async function runSearch(names: string[], args: string[], signal: AbortSignal, consume: (line: string) => boolean, allowNoMatch = false) {
  for (const name of names) {
    try { await run(name, args, signal, consume, allowNoMatch); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw hint(names[0]);
}
function* resultLines(text: string): Generator<string> {
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    if (end < 0) { yield text.slice(start); return; }
    yield text.slice(start, end);
    start = end + 1;
  }
}
const timeoutSchema = z.number().min(0).max(90).optional();
const timeoutProperty = { type: "number", minimum: 0, maximum: 90, description: "Seconds, default 30; 0 disables tool timeout. Timeout returns incomplete partial results." };
const lsSchema = z.object({ timeout: timeoutSchema, path: z.string().optional(), limit: z.number().int().positive().optional() });
const findSchema = z.object({ timeout: timeoutSchema, pattern: z.string(), path: z.string().optional(), limit: z.number().int().positive().optional() });
const grepSchema = z.object({ timeout: timeoutSchema, pattern: z.string(), path: z.string().optional(), glob: z.string().optional(), ignoreCase: z.boolean().optional(), literal: z.boolean().optional(), context: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() });
export const extraOperatorToolDefinitions: ToolDefinition[] = [
  { name: "list", description: "List directory entries alphabetically, including dotfiles, with / for directories (default 500 entries). Supports execution:// and memory:// directories.", inputSchema: { type: "object", properties: { timeout: timeoutProperty, path: { type: "string" }, limit: { type: "integer", minimum: 1 } } } },
  { name: "grep", description: "Search text with rg, respecting .gitignore; also supports result://, execution:// and memory://scratchpad.md virtual files. Output is capped at 50 KiB. Requires system ripgrep for local paths; never installs it.", inputSchema: { type: "object", properties: { timeout: timeoutProperty, pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, ignoreCase: { type: "boolean" }, literal: { type: "boolean" }, context: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1 } }, required: ["pattern"] } },
  { name: "find", description: "Find files by glob using fd or fdfind, respecting .gitignore; supports execution:// and memory:// virtual paths; never installs dependencies.", inputSchema: { type: "object", properties: { timeout: timeoutProperty, pattern: { type: "string" }, path: { type: "string" }, limit: { type: "integer", minimum: 1 } }, required: ["pattern"] } },
];
export async function handleExtraOperatorTool(name: string, args: unknown, parent?: AbortSignal) {
  if (parent?.aborted) throw new Error("Tool call aborted");
  const timeout = z.object({ timeout: timeoutSchema }).parse(args).timeout ?? 30;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  const timer = timeout > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout * 1000) : undefined;
  try {
    const result = await search(name, args, controller.signal);
    if (parent?.aborted) throw new Error("Tool call aborted");
    if (timedOut) {
      const value = result.content[0].text || "No results collected before timeout";
      return output((value.startsWith("No matches found") || value.startsWith("No files found matching pattern") ? "No results collected before timeout" : value) + "\n[search-status timedOut=true incomplete=true; search stopped before completion]");
    }
    return result;
  } catch (error) {
    if (parent?.aborted) throw new Error("Tool call aborted");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}
async function search(name: string, args: unknown, signal: AbortSignal) {
  if (name === "list") {
    const params = lsSchema.parse(args);
    if (params.path && isMemoryPath(params.path)) return output(listMemory(params.path).join("\n"));
    if (params.path && isExecutionPath(params.path)) {
      const entries: string[] = [];
      for await (const entry of searchExecutionPaths(params.path, "*", signal, true)) entries.push(entry);
      const limit = params.limit ?? 500;
      return output(capped(entries.sort().slice(0, limit).join("\n") + (entries.length > limit ? "\n[" + limit + " entries limit reached]" : "")));
    }
    const dir = resolve(cwd, params.path || ".");
    const limit = params.limit ?? 500;
    const entries: string[] = [];
    const directory = await opendir(dir);
    for await (const entry of directory) {
      if (signal.aborted) break;
      entries.push(entry.name + (entry.isDirectory() ? "/" : ""));
    }
    entries.sort((a, b) => { const x = a.replace(/\/$/, ""), y = b.replace(/\/$/, ""); return x < y ? -1 : x > y ? 1 : 0; });
    return output(capped(entries.slice(0, limit).join("\n") + (entries.length > limit ? "\n[" + limit + " entries limit reached]" : "")));
  }
  if (name === "find") {
    const params = findSchema.parse(args);
    if (params.path && isMemoryPath(params.path)) {
      const entries = listMemory(params.path).filter(path => matchesGlob(path, params.pattern));
      return output(entries.map(path => "memory://" + path).join("\n") || "No files found matching pattern");
    }
    if (params.path && isExecutionPath(params.path)) {
      const collected = new GrepOutput();
      const limit = params.limit ?? 1000;
      let count = 0;
      for await (const entry of searchExecutionPaths(params.path, params.pattern, signal)) {
        count++;
        if (!collected.add(entry) || count >= limit) break;
      }
      return output(count ? collected.text() + (count >= limit ? "\n[entries limit reached]" : "") : "No files found matching pattern");
    }
    const target = resolve(cwd, params.path || ".");
    const commandArgs = ["--glob", "--color=never", "--hidden", "--max-results", String(params.limit ?? 1000)];
    let pattern = params.pattern;
    if (pattern.includes("/")) {
      commandArgs.push("--full-path");
      if (!pattern.startsWith("/") && !pattern.startsWith("**/")) pattern = "**/" + pattern;
    }
    commandArgs.push("--", pattern, target);
    const collected = new GrepOutput();
    let count = 0;
    await runSearch(["fd", "fdfind"], commandArgs, signal, line => {
      count++;
      return collected.add(line.startsWith(target) ? relative(target, line) : line);
    });
    return output(count ? collected.text() + (count >= (params.limit ?? 1000) ? "\n[entries limit reached]" : "") : "No files found matching pattern");
  }
  if (name === "grep") {
    const params = grepSchema.parse(args);
    if (params.path && (isExecutionPath(params.path) || isResultPath(params.path) || isMemoryPath(params.path))) {
      const paths = isExecutionPath(params.path) ? searchExecutionPaths(params.path, "*", signal) : params.path === "memory://" ? listMemory(params.path).map(path => "memory://" + path) : [params.path];
      const regex = new RegExp(params.literal ? escapeRegex(params.pattern) : params.pattern, params.ignoreCase ? "i" : "");
      const collected = new GrepOutput();
      let remaining = params.limit ?? 100;
      for await (const path of paths) {
        if (signal.aborted) break;
        if ((isExecutionPath(path) || isMemoryPath(path)) && params.glob && !matchesGlob(path.split("/").at(-1)!, params.glob)) continue;
        const context = params.context ?? 0;
        const previous: { index: number; line: string; bytes: number }[] = [];
        let index = 0, last = 0, after = 0, previousBytes = 0;
        const append = (i: number, line: string, match: boolean) => {
          if (i <= last) return true;
          last = i;
          return collected.add(path + (match ? ":" : "-") + i + ":" + line);
        };
        const source = isExecutionPath(path) ? executionLines(path, undefined, signal) : resultLines(isMemoryPath(path) ? readMemory(path) : readResult(path));
        for await (const line of source) {
          if (index > 0 && index % 128 === 0) await yieldLoop();
          if (signal.aborted) return output(collected.text());
          index++;
          if (remaining > 0 && regex.test(line)) {
            for (const p of previous) if (!append(p.index, p.line, false)) return output(collected.text());
            if (!append(index, line, true)) return output(collected.text());
            remaining--; after = context;
          } else if (after > 0) {
            if (!append(index, line, false)) return output(collected.text());
            after--;
          }
          if (context) {
            const bytes = Buffer.byteLength(line) + 1;
            previous.push({ index, line, bytes }); previousBytes += bytes;
            while (previous.length > context || (previousBytes > GREP_LIMIT && previous.length > 1)) previousBytes -= previous.shift()!.bytes;
          }
          if (!remaining && !after) break;
        }
        if (!remaining) break;
      }
      return output(collected.text() + (!remaining ? "\n[" + (params.limit ?? 100) + " matches limit reached]" : ""));
    }
    const commandArgs = ["--json", "--line-buffered", "--color=never", "--hidden"];
    if (params.ignoreCase) commandArgs.push("--ignore-case");
    if (params.literal) commandArgs.push("--fixed-strings");
    if (params.context !== undefined) commandArgs.push("--context", String(params.context));
    if (params.glob) commandArgs.push("--glob", params.glob);
    commandArgs.push("--", params.pattern, resolve(cwd, params.path || "."));
    const limit = params.limit ?? 100;
    const collected = new GrepOutput();
    let matches = 0;
    await runSearch(["rg"], commandArgs, signal, line => {
      if (!line) return true;
      const event = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (event.type !== "match" && event.type !== "context") return true;
      if (event.type === "match") {
        if (matches >= limit) return false;
        matches++;
      }
      const file = event.data?.path?.text ?? "";
      const relativePath = relative(resolve(cwd, params.path || "."), file) || file;
      const lineNumber = event.data?.line_number ?? 0;
      const content = (event.data?.lines?.text ?? "").replace(/\r?\n$/, "");
      return collected.add(relativePath + (event.type === "match" ? ":" : "-") + lineNumber + ":" + content);
    }, true);
    if (matches === 0) return output("No matches found");
    return output(collected.text() + (matches >= limit ? "\n[" + limit + " matches limit reached]" : ""));
  }
  throw new Error("Unknown extra operator tool: " + name);
}