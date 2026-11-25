import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export function enableTunnelPingExperiment(server: Server): void {
  const previous = server.fallbackNotificationHandler;
  server.fallbackNotificationHandler = async notification => {
    if (notification.method !== "notifications/tunnel/test_ping") {
      await previous?.(notification);
      return;
    }
    await server.notification({
      method: "notifications/tunnel/test_pong",
      params: notification.params,
    });
  };
}
