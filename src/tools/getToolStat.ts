import { getToolStat } from "./stats.js";

export const getToolStatTool = {
  name: "getToolStat",
  description: "Get process-wide (default) or current-conversation tool call statistics for Codemode and ordinary MCP calls. Includes call counts, successes, errors, cancellations and durations. Use scope: conversation for isolated statistics; requires conversation identity. Counters reset on MCP endpoint restart; conversation counters expire after 24 hours idle.",
  inputSchema: {
    type: "object" as const,
    properties: {
      scope: { type: "string", enum: ["global", "conversation"] },
      category: { type: "string", enum: ["discovery", "tool"] },
      namespace: { type: "string" },
      sortBy: { type: "string", enum: ["calls", "name", "totalDurationMs"] },
      limit: { type: "integer", minimum: 1 },
    },
  },
};

export async function handleGetToolStat(args: unknown) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("getToolStat options must be an object");
  const { getToolDefinitions, getToolNamespace } = await import("./definitions.js");
  const namespaces = Object.fromEntries(getToolDefinitions(true).map(tool => [tool.name, getToolNamespace(tool.name)]));
  return getToolStat(args as Parameters<typeof getToolStat>[0], namespaces);
}
