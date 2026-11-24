import { spawn, spawnSync } from "node:child_process";
import { readdir, lstat } from "node:fs/promises";
import { resolve, relative, matchesGlob } from "node:path";
import { isExecutionPath, listExecutionPaths, findExecutionPaths, executionLines } from "../runtime/virtual.js";
import { z } from "zod";
import type { ToolDefinition } from "./definitions.js";
import { isResultPath, readResult } from "./resultStore.js";

const cwd = process.cwd();
const output = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const executable = (names: string[]) => names.find((name) => !spawnSync(name, ["--version"], { stdio: "ignore" }).error);
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
async function run(binary: string, args: string[], empty: string, allowNoMatch = false, rawOutput = false): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    let outputBytes = 0;
    child.stdout.on("data", (data: Buffer) => {
      outputBytes += data.length;
      if (outputBytes > 8 * 1024 * 1024) { child.kill(); return; }
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => { if (stderr.length < 8192) stderr += data.toString(); });
    child.on("error", fail);
    child.on("close", (code) => outputBytes > 8 * 1024 * 1024 ? fail(new Error("Search output exceeded 8MB processing limit; narrow the search")) : code === 0 || (allowNoMatch && code === 1) ? done(rawOutput ? (stdout.trimEnd() || empty) : capped(stdout.trimEnd() || empty)) : fail(new Error(stderr.trim() || binary + " exited with code " + code)));
  });
}
const lsSchema = z.object({ path: z.string().optional(), limit: z.number().int().positive().optional() });
const findSchema = z.object({ pattern: z.string(), path: z.string().optional(), limit: z.number().int().positive().optional() });
const grepSchema = z.object({ pattern: z.string(), path: z.string().optional(), glob: z.string().optional(), ignoreCase: z.boolean().optional(), literal: z.boolean().optional(), context: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() });
export const extraOperatorToolDefinitions: ToolDefinition[] = [
  { name: "list", description: "List directory entries alphabetically, including dotfiles, with / for directories (default 500 entries). Supports execution:// directories.", inputSchema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer", minimum: 1 } } } },
  { name: "grep", description: "Search text with rg, respecting .gitignore; also supports result:// and execution:// virtual files. Output is capped at 50 KiB. Requires system ripgrep for local paths; never installs it.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, ignoreCase: { type: "boolean" }, literal: { type: "boolean" }, context: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1 } }, required: ["pattern"] } },
  { name: "find", description: "Find files by glob using fd or fdfind, respecting .gitignore; supports execution:// virtual paths; never installs dependencies.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, limit: { type: "integer", minimum: 1 } }, required: ["pattern"] } },
];
export async function handleExtraOperatorTool(name: string, args: unknown) {
  if (name === "list") {
    const params = lsSchema.parse(args);
    if (params.path && isExecutionPath(params.path)) return output(capped(listExecutionPaths(params.path).slice(0, params.limit ?? 500).join("\n")));
    const dir = resolve(cwd, params.path || ".");
    const entries = (await readdir(dir)).sort();
    const limit = params.limit ?? 500;
    const lines = await Promise.all(entries.slice(0, limit).map(async (entry) => entry + ((await lstat(resolve(dir, entry))).isDirectory() ? "/" : "")));
    return output(capped(lines.join("\n") + (entries.length > limit ? "\n[" + limit + " entries limit reached]" : "")));
  }
  if (name === "find") {
    const params = findSchema.parse(args);
    if (params.path && isExecutionPath(params.path)) return output(capped(findExecutionPaths(params.path, params.pattern).slice(0, params.limit ?? 1000).join("\n") || "No files found matching pattern"));
    const binary = executable(["fd", "fdfind"]);
    if (!binary) throw hint("fd");
    const target = resolve(cwd, params.path || ".");
    const commandArgs = ["--glob", "--color=never", "--hidden", "--max-results", String(params.limit ?? 1000)];
    let pattern = params.pattern;
    if (pattern.includes("/")) {
      commandArgs.push("--full-path");
      if (!pattern.startsWith("/") && !pattern.startsWith("**/")) pattern = "**/" + pattern;
    }
    commandArgs.push("--", pattern, target);
    const raw = await run(binary, commandArgs, "No files found matching pattern", false, true);
    if (raw === "No files found matching pattern") return output(raw);
    return output(capped(raw.split("\n").map((line) => line.startsWith(target) ? relative(target, line) : line).join("\n")));
  }
  if (name === "grep") {
    const params = grepSchema.parse(args);
    if (params.path && (isExecutionPath(params.path) || isResultPath(params.path))) {
      const paths = isExecutionPath(params.path) ? findExecutionPaths(params.path, "*").filter(path => !params.glob || matchesGlob(path.split("/").at(-1)!, params.glob)) : [params.path];
      const regex = new RegExp(params.literal ? escapeRegex(params.pattern) : params.pattern, params.ignoreCase ? "i" : "");
      const collected = new GrepOutput();
      let remaining = params.limit ?? 100;
      for (const path of paths) {
        const context = params.context ?? 0;
        const previous: { index: number; line: string; bytes: number }[] = [];
        let index = 0, last = 0, after = 0, previousBytes = 0;
        const append = (i: number, line: string, match: boolean) => {
          if (i <= last) return true;
          last = i;
          return collected.add(path + (match ? ":" : "-") + i + ":" + line);
        };
        const source = isExecutionPath(path) ? executionLines(path) : readResult(path).split("\n");
        for await (const line of source) {
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
      return output(collected.text());
    }
    const binary = executable(["rg"]);
    if (!binary) throw hint("rg");
    const commandArgs = ["--json", "--color=never", "--hidden"];
    if (params.ignoreCase) commandArgs.push("--ignore-case");
    if (params.literal) commandArgs.push("--fixed-strings");
    if (params.context !== undefined) commandArgs.push("--context", String(params.context));
    if (params.glob) commandArgs.push("--glob", params.glob);
    commandArgs.push("--", params.pattern, resolve(cwd, params.path || "."));
    const raw = await run(binary, commandArgs, "No matches found", true, true);
    if (raw === "No matches found") return output(raw);
    const limit = params.limit ?? 100;
    const collected = new GrepOutput();
    let matches = 0;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (event.type !== "match" && event.type !== "context") continue;
      if (event.type === "match") {
        if (matches >= limit) break;
        matches++;
      }
      const file = event.data?.path?.text ?? "";
      const relativePath = relative(resolve(cwd, params.path || "."), file) || file;
      const lineNumber = event.data?.line_number ?? 0;
      const content = (event.data?.lines?.text ?? "").replace(/\r?\n$/, "");
      if (!collected.add(relativePath + (event.type === "match" ? ":" : "-") + lineNumber + ":" + content)) return output(collected.text());
    }
    if (matches === 0) return output("No matches found");
    return output(collected.text() + (matches >= limit ? "\n[" + limit + " matches limit reached]" : ""));
  }
  throw new Error("Unknown extra operator tool: " + name);
}
