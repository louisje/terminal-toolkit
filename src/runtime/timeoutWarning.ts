import { AsyncLocalStorage } from "node:async_hooks";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export const timeoutWarningScope = new AsyncLocalStorage<AbortSignal>();
// Runtime operators opt in; other tools (including codemode) remain unchanged.
export const supportsTimeoutWarning = (name: string) => name === "shell" || name === "python" || name === "waitExecution";

export function installTimeoutWarning(server: Server) {
  const pending = new Map<string | number, AbortController>();
  const previous = server.fallbackNotificationHandler;
  server.fallbackNotificationHandler = async notification => {
    if (notification.method !== "notifications/tunnel/response_timeout_warning") {
      await previous?.(notification);
      return;
    }
    const id = notification.params?.requestId;
    if (typeof id !== "string" && typeof id !== "number") return;
    const controller = pending.get(id);
    if (!controller || controller.signal.aborted) return;
    // ACK is best effort; never wait for it before detaching.
    const ack = server.notification({ method: "notifications/tunnel/response_timeout_ack", params: { requestId: id } });
    controller.abort();
    await ack.catch(() => {});
  };
  return async function withWarning<T>(id: string | number, name: string, execute: () => Promise<T>): Promise<T> {
    if (!supportsTimeoutWarning(name)) return execute();
    const controller = new AbortController();
    pending.set(id, controller);
    try {
      return await timeoutWarningScope.run(controller.signal, execute);
    } finally {
      if (pending.get(id) === controller) pending.delete(id);
    }
  };
}
