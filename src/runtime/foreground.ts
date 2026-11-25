import { timeoutWarningScope } from "./timeoutWarning.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionManager, ExecutionOptions } from "./manager.js";

export const DEFAULT_WAIT_SECONDS = 30;
export const MAX_WAIT_SECONDS = 50;
const LEGACY_BUFFER_LIMIT = 10 * 1024 * 1024;
export type RuntimeResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const result = (text: string, isError = false): RuntimeResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

export async function runForeground(manager: ExecutionManager, options: ExecutionOptions, timeout = DEFAULT_WAIT_SECONDS, signal?: AbortSignal): Promise<RuntimeResult> {
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error("timeout must be a finite non-negative number");
  const execution = await manager.start(options, signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const warning = timeoutWarningScope.getStore();
  let onWarning: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await execution.ready;
    signal?.throwIfAborted();
    const completed = timeout === 0 ? false : await Promise.race([
      execution.done.then(() => true),
      new Promise<boolean>(resolve => {
        onWarning = () => resolve(false);
        warning?.addEventListener("abort", onWarning, { once: true });
        if (warning?.aborted) onWarning();
      }),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.min(timeout, MAX_WAIT_SECONDS) * 1000); }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Command aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
    signal?.throwIfAborted();
    if (!completed && (timeout === 0 || execution.info.finishedAt === undefined)) {
      execution.detach();
      return result("Execution moved to background.\n\nexecutionId: " + execution.info.executionId +
        "\n\nUse getExecution() to inspect its status and output paths, or waitExecution() to wait for completion.");
    }
    const info = execution.info;
    if (info.error) return result(info.error, true);
    if (info.stdoutSize + info.stderrSize > LEGACY_BUFFER_LIMIT || info.outputTruncated) return result("Command output exceeded 10 MiB buffer.", true);
    const output = (await readFile(join(execution.directory, "stdout"), "utf8")) + (await readFile(join(execution.directory, "stderr"), "utf8"));
    signal?.throwIfAborted();
    if (info.exitCode !== 0) return result(output + (output ? "\n" : "") + "Command exited with code " + (info.exitCode ?? "unknown") + ".", true);
    return result(output);
  } catch (error) {
    execution.cancel();
    if (signal?.aborted) throw new Error("Command aborted");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onWarning) warning?.removeEventListener("abort", onWarning);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (!execution.info.background) {
      // Cancellation may return before the child closes; cleanup follows completion.
      void execution.done.then(() => manager.remove(execution.info.executionId)).catch(() => {});
    }
  }
}
