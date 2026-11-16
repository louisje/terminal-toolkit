import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";

/** Discovery-only experiment: never accept unverified subscriptions. */
export function enableMcpEventsExperiment(server: Server): void {
  const schema = (method: string) => z.object({ method: z.literal(method), params: z.record(z.unknown()).optional() });
  server.setRequestHandler(schema("events/list"), async () => {
    console.error("[terminal-toolkit] experiment: events/list received");
    return { events: [{ name: "terminal.test", description: "Experimental event; delivery not enabled", delivery: ["webhook"], inputSchema: { type: "object", properties: {}, additionalProperties: false }, payloadSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } }] };
  });
  server.setRequestHandler(schema("events/subscribe"), async (request) => {
    console.error("[terminal-toolkit] experiment: events/subscribe received", { name: request.params?.name });
    throw new Error("Experimental event delivery and callback verification not implemented");
  });
  server.setRequestHandler(schema("events/unsubscribe"), async () => {
    console.error("[terminal-toolkit] experiment: events/unsubscribe received");
    return {};
  });
}
