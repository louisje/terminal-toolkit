import { spawn, spawnSync } from "node:child_process";
import { readdir, lstat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./definitions.js";

const cwd = process.cwd();
const output = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const executable = (names: string[]) => names.find((name) => !spawnSync(name, ["--version"], { stdio: "ignore" }).error);
const hint = (name: string) => new Error((name === "fd" ? "fd/fdfind" : name) + " not found on PATH. Install manually: macOS: brew install " + (name === "rg" ? "ripgrep" : "fd") + "; Ubuntu/Debian: sudo apt install " + (name === "rg" ? "ripgrep" : "fd-find") + "; Termux: pkg install " + (name === "rg" ? "ripgrep" : "fd"));
const capped = (value: string) => Buffer.byteLength(value) > 51200 ? Buffer.from(value).subarray(0, 51200).toString("utf8") + "\n[50KB limit reached]" : value;
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
  { name: "list", description: "List directory entries alphabetically, including dotfiles, with / for directories (default 500 entries).", inputSchema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer", minimum: 1 } } } },
  { name: "grep", description: "Search text with rg, respecting .gitignore; requires system ripgrep, never installs it.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, ignoreCase: { type: "boolean" }, literal: { type: "boolean" }, context: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1 } }, required: ["pattern"] } },
  { name: "find", description: "Find files by glob using fd or fdfind, respecting .gitignore; never installs dependencies.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, limit: { type: "integer", minimum: 1 } }, required: ["pattern"] } },
];
export async function handleExtraOperatorTool(name: string, args: unknown) {
  if (name === "list") {
    const params = lsSchema.parse(args);
    const dir = resolve(cwd, params.path || ".");
    const entries = (await readdir(dir)).sort();
    const limit = params.limit ?? 500;
    const lines = await Promise.all(entries.slice(0, limit).map(async (entry) => entry + ((await lstat(resolve(dir, entry))).isDirectory() ? "/" : "")));
    return output(capped(lines.join("\n") + (entries.length > limit ? "\n[" + limit + " entries limit reached]" : "")));
  }
  if (name === "find") {
    const params = findSchema.parse(args);
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
    const lines: string[] = [];
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
      lines.push(relativePath + (event.type === "match" ? ":" : "-") + lineNumber + ":" + content);
    }
    if (matches === 0) return output("No matches found");
    return output(capped(lines.join("\n") + (matches >= limit ? "\n[" + limit + " matches limit reached]" : "")));
  }
  throw new Error("Unknown extra operator tool: " + name);
}
