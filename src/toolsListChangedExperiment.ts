import { Server } from "@modelcontextprotocol/sdk/server/index.js";

/** Opt-in experiment: emit one tool-list change notification after MCP initialization. */
export function enableToolsListChangedExperiment(server: Server): void {
  const previous = server.oninitialized;
  server.oninitialized = () => {
    previous?.();
    // Send after initialization, independently of any tools/call handler.
    const timer = setTimeout(() => {
      void server.notification({ method: "notifications/tools/list_changed" })
        .then(() => console.error("[terminal-toolkit] experiment: sent idle notifications/tools/list_changed"))
        .catch((error: unknown) => console.error("[terminal-toolkit] experiment: tools/list_changed failed:", error));
    }, 2000);
    timer.unref();
  };
}
