/** Last-resort protection for individual tool calls, not a tool timeout policy. */
export const TOOL_WATCHDOG_MS = 100_000;

export async function withToolWatchdog<T>(
  name: string,
  execute: (signal: AbortSignal) => T | Promise<T>,
  parent?: AbortSignal,
  timeoutMs = TOOL_WATCHDOG_MS,
): Promise<T> {
  if (parent?.aborted) throw new Error("Tool call aborted");
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Tool '${name}' exceeded the ${timeoutMs / 1000}-second safety deadline. Cancellation requested.`);
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    return await Promise.race([deadline, Promise.resolve().then(() => execute(controller.signal))]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}
