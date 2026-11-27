import { StringDecoder } from "node:string_decoder";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { resolveBuiltinSkillPath } from "../skills.js";
import { isExecutionPath, resolveExecutionPath, executionPaths } from "../runtime/virtual.js";
import { isResultPath, readResult } from "./resultStore.js";
import { isMemoryPath, readMemory } from "./memoryStore.js";
import { MAX_TEXT_BLOCK_BYTES } from "./outputLimit.js";

type Args = { path: string; offset?: number; limit?: number; timeout?: number };
const cwd = process.cwd();

export async function readRange(args: Args, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timeout = args.timeout ?? 30;
  const timer = timeout ? setTimeout(abort, timeout * 1000) : undefined;
  const signal = controller.signal;
  let size: number | null = null, totalLines: number | null = null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let memory: Buffer | undefined;
  let oversized = false;
  const offset = args.offset ?? 1;
  try {
    let path = args.path;
    if (isMemoryPath(path)) memory = Buffer.from(readMemory(path));
    else if (isResultPath(path)) memory = Buffer.from(readResult(path));
    else if (isExecutionPath(path)) {
      const { execution, file } = resolveExecutionPath(path);
      if (!file) throw new Error("Expected execution file");
      if (file === "info.json") memory = Buffer.from(JSON.stringify({ ...execution.info, paths: executionPaths(execution.info.executionId) }, null, 2));
      else {
        size = file === "stdout" ? execution.info.stdoutSize : execution.info.stderrSize;
        path = join(execution.directory, file);
        if (!size) memory = Buffer.alloc(0);
      }
    } else path = path.startsWith("builtin://") ? await resolveBuiltinSkillPath(path) : resolve(cwd, path);
    if (memory) size = memory.length;
    else {
      handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("Expected regular file");
      size ??= stat.size;
    }
    const length = size;
    const chunk = Buffer.alloc(64 * 1024);
    async function scan(consume: (data: Buffer, position: number) => void) {
      for (let pos = 0; pos < length && !signal.aborted;) {
        const n = Math.min(chunk.length, length - pos);
        const data = memory ? memory.subarray(pos, pos + n) : chunk.subarray(0, (await handle!.read(chunk, 0, n, pos)).bytesRead);
        if (!data.length) throw new Error("File changed during read");
        consume(data, pos);
        pos += data.length;
        await yieldLoop();
      }
    }
    let lines = 1;
    let start = offset > 0 ? offset : 1;
    let line = 1;
    const pieces: Buffer[] = [];
    let bytes = 0;
    const collect = (data: Buffer) => {
      let begin = 0;
      for (let i = 0; i <= data.length; i++) {
        if (i < data.length && data[i] !== 10) continue;
        if (line >= start && (args.limit === undefined || line < start + args.limit)) {
          const end = i < data.length && (args.limit === undefined || line + 1 < start + args.limit) ? i + 1 : i;
          const part = data.subarray(begin, end);
          bytes += part.length;
          if (bytes <= MAX_TEXT_BLOCK_BYTES) { if (part.length) pieces.push(Buffer.from(part)); }
          else oversized = true;
        }
        if (i < data.length) line++;
        begin = i + 1;
      }
    };
    await scan(data => {
      for (const byte of data) if (byte === 10) lines++;
      if (offset > 0) collect(data);
    });
    if (!signal.aborted) {
      totalLines = lines;
      if (offset < 0) {
        start = Math.max(1, lines + offset + 1);
        await scan(collect);
      }
      if (start > lines) throw new Error("Offset " + offset + " is beyond end of file");
    }
    const decoder = new StringDecoder("utf8");
    const selected = decoder.write(Buffer.concat(pieces)) + (signal.aborted ? "" : decoder.end());
    if (parent?.aborted) throw new Error("Tool call aborted");
    const metadata = { size, totalLines, ...(signal.aborted ? { timedOut: true, incomplete: true } : {}) };
    return { content: [
      { type: "text" as const, text: oversized ? "Tool output exceeded the 16 KiB text block limit. Content suppressed; narrow offset/limit." : selected },
      { type: "text" as const, text: "[read-metadata] " + JSON.stringify(metadata) },
    ] };
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    await handle?.close();
  }
}
