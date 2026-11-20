import { getToolStat } from "./stats.js";
import { getToolNamespace, getToolDefinitions } from "./definitions.js";

export const getToolStatTool = {
  name: "getToolStat",
  description: "Get process-wide tool call statistics for Codemode and ordinary MCP calls. Includes call counts, successes, errors, cancellations and durations. Counters reset on server restart.",
  inputSchema: {
    type: "object" as const,
    properties: {
      category: { type: "string", enum: ["discovery", "tool"] },
      namespace: { type: "string" },
      sortBy: { type: "string", enum: ["calls", "name", "totalDurationMs"] },
      limit: { type: "integer", minimum: 1 },
    },
  },
};

export function handleGetToolStat(args: unknown) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("getToolStat options must be an object");
  const namespaces = Object.fromEntries(getToolDefinitions(true).map(tool => [tool.name, getToolNamespace(tool.name)]));
  return getToolStat(args as Parameters<typeof getToolStat>[0], namespaces);
}
