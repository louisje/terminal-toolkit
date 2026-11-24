import { z } from "zod";
import { ExecutionManager } from "../runtime/manager.js";
import type { RuntimeResult } from "../runtime/foreground.js";
import type { ToolDefinition } from "./definitions.js";
import { executionPaths } from "../runtime/virtual.js";
const metadata = (info: import("../runtime/manager.js").ExecutionInfo) => ({ ...info, paths: executionPaths(info.executionId) });

export const executionManager = new ExecutionManager();
export const runtimeManagementNames = ["listExecutions", "getExecution", "waitExecution", "cancelExecution", "removeExecution"] as const;
const id = { type: "string", description: "Execution ID returned by shell or python" };
const statuses = ["starting", "running", "completed", "failed", "cancelling", "cancelled"] as const;
export const runtimeManagementDefinitions: ToolDefinition[] = [
  { name: "listExecutions", description: "List retained background executions, optionally filtered by status.", inputSchema: { type: "object", properties: { status: { type: "string", enum: statuses } } } },
  ...runtimeManagementNames.slice(1).map(name => ({
    name, description: ({ getExecution: "Inspect execution status and metadata.", waitExecution: "Wait for execution completion; timeout returns current status without cancelling.", cancelExecution: "Request termination of an execution process tree.", removeExecution: "Remove a finished execution and its output." } as Record<string,string>)[name],
    inputSchema: { type: "object" as const, properties: { executionId: id, ...(name === "waitExecution" ? { timeout: { type: "number", minimum: 0, description: "Wait seconds, default 30, maximum 50" } } : {}) }, required: ["executionId"] },
  })),
];
const result = (value: unknown): RuntimeResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export async function handleRuntimeManagement(name: string, args: unknown, signal?: AbortSignal, manager = executionManager): Promise<RuntimeResult> {
  signal?.throwIfAborted();
  if (name === "listExecutions") {
    const { status } = z.object({ status: z.enum(statuses).optional() }).parse(args);
    return result(manager.list().filter(e => e.info.background && (!status || e.info.status === status)).map(e => e.info));
  }
  const { executionId, timeout } = z.object({ executionId: z.string().uuid(), timeout: z.number().finite().nonnegative().optional() }).parse(args);
  const e = manager.get(executionId);
  if (!e?.info.background) throw new Error("Unknown background execution");
  switch (name) {
    case "getExecution": return result(metadata(e.info));
    case "cancelExecution": e.cancel(); return result(e.info);
    case "removeExecution": await manager.remove(executionId); return result({ executionId, removed: true });
    case "waitExecution": {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        if (timeout !== 0 && e.info.finishedAt === undefined) await Promise.race([
          e.done,
          new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(timeout ?? 30, 50) * 1000); }),
          new Promise<never>((_, reject) => {
            abort = () => reject(new Error("Tool call aborted"));
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
          }),
        ]);
        return result(metadata(e.info));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
      }
    }
    default: throw new Error("Unknown runtime management tool");
  }
}
