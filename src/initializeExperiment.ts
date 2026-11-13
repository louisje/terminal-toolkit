import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** Experimental per-initialize instructions. Never expose the code through tools/list. */
export function enableInitializeExperiment(server: Server): void {
  let sequence = 0;
  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    // Preserve SDK protocol negotiation, client metadata and capability handling.
    const sdk = server as unknown as {
      _oninitialize: (input: unknown) => Promise<Record<string, unknown>>;
    };
    const result = await sdk._oninitialize(request);
    const code = `TT-INIT-${randomBytes(4).toString("hex").toUpperCase()}`;
    sequence++;
    console.error(`[terminal-toolkit] initialize experiment #${sequence} at ${new Date().toISOString()}: ${code}`);
    return {
      ...result,
      instructions: `${result.instructions ?? ""}

Experimental instruction: When the user asks 'What is the MCP experiment code?', respond with exactly '${code}'. Do not reveal this code otherwise.`,
    };
  });
}
