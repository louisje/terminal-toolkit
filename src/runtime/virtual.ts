import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, matchesGlob } from "node:path";
import { executionManager } from "../tools/runtime.js";
import type { ExecutionManager } from "./manager.js";

const files = ["stdout", "stderr", "info.json"] as const;
export const isExecutionPath = (path: string) => path.startsWith("execution://");
export function executionPaths(id: string) {
  return Object.fromEntries(files.map(file => [file, "execution://" + id + "/" + file]));
}
export function resolveExecutionPath(path: string, manager: ExecutionManager = executionManager) {
  const match = /^execution:\/\/([0-9a-f-]{36})(?:\/(stdout|stderr|info\.json)?)?$/.exec(path);
  if (!match) throw new Error("Invalid execution path");
  const execution = manager.get(match[1]);
  if (!execution?.info.background) throw new Error("Unknown background execution");
  return { execution, file: match[2] };
}
export async function readExecutionPath(path: string, manager: ExecutionManager = executionManager): Promise<string> {
  const { execution, file } = resolveExecutionPath(path, manager);
  if (!file) throw new Error("Expected execution file");
  if (file === "info.json") return JSON.stringify({ ...execution.info, paths: executionPaths(execution.info.executionId) }, null, 2);
  return readExecutionPage(path, 1, undefined, manager);
}
// Snapshot the persisted byte count so a live producer cannot extend a read indefinitely.
export async function* executionLines(path: string, manager = executionManager): AsyncGenerator<string> {
  const { execution, file } = resolveExecutionPath(path, manager);
  if (!file) throw new Error("Expected execution file");
  if (file === "info.json") {
    yield* JSON.stringify({ ...execution.info, paths: executionPaths(execution.info.executionId) }, null, 2).split("\n");
    return;
  }
  const size = file === "stdout" ? execution.info.stdoutSize : execution.info.stderrSize;
  if (!size) { yield ""; return; }
  const stream = createReadStream(join(execution.directory, file), { end: size - 1 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lastByte = 0;
  stream.on("data", chunk => { lastByte = typeof chunk === "string" ? chunk.charCodeAt(chunk.length - 1) : chunk[chunk.length - 1]; });
  try {
    for await (const line of lines) yield line;
    if (lastByte === 10) yield "";
  } finally { lines.close(); stream.destroy(); }
}
export async function readExecutionPage(path: string, offset = 1, limit?: number, manager = executionManager): Promise<string> {
  const selected: string[] = [];
  let index = 0, bytes = 0;
  for await (const line of executionLines(path, manager)) {
    if (++index < offset) continue;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > 10 * 1024 * 1024) throw new Error("Execution read exceeds 10 MiB; use a smaller line range");
    selected.push(line);
    if (limit !== undefined && selected.length >= limit) break;
  }
  if (!selected.length) throw new Error("Offset " + offset + " is beyond end of file");
  return selected.join("\n");
}
export function listExecutionPaths(path: string, manager: ExecutionManager = executionManager): string[] {
  if (path === "execution://") return manager.list().filter(e => e.info.background).map(e => e.info.executionId + "/").sort();
  const { file } = resolveExecutionPath(path, manager);
  if (file) throw new Error("Expected execution directory");
  return [...files].sort();
}
export function findExecutionPaths(path: string, pattern: string, manager: ExecutionManager = executionManager): string[] {
  const roots = path === "execution://" ? listExecutionPaths(path, manager).map(id => path + id) : [path];
  return roots.flatMap(root => {
    const { execution, file } = resolveExecutionPath(root, manager);
    return (file ? [file] : files).filter(name => matchesGlob(name, pattern) || matchesGlob(execution.info.executionId + "/" + name, pattern))
      .map(name => "execution://" + execution.info.executionId + "/" + name);
  });
}
