// src/utils/shutdown.ts
var CLEANUP_TIMEOUT_MS = 2e3;
function installStdioShutdownHandlers({ cleanup }) {
  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const hardExit = setTimeout(() => process.exit(code), CLEANUP_TIMEOUT_MS);
    hardExit.unref();
    const exitAfterStdoutDrain = () => {
      process.stdout.write("", () => process.exit(code));
    };
    Promise.resolve().then(cleanup).catch((err) => {
      console.error("[terminal-toolkit] Shutdown cleanup failed:", err);
    }).finally(exitAfterStdoutDrain);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGHUP", () => shutdown(0));
  process.stdin.on("end", () => shutdown(0));
  process.stdin.on("close", () => shutdown(0));
  process.on("exit", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      void Promise.resolve(cleanup()).catch(() => {
      });
    } catch {
    }
  });
  return { isShuttingDown: () => shuttingDown };
}
export {
  installStdioShutdownHandlers
};
