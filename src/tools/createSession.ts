import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";

export const createSessionSchema = z.object({
  shell: z.string().optional().describe("Shell to use for this session (default: $TERMINAL_TOOLKIT_SHELL, $SHELL, or /bin/bash)"),
  cols: z.number().int().positive().optional().describe("Terminal width in columns (default: 80)"),
  rows: z.number().int().positive().optional().describe("Terminal height in rows (default: 25)"),
});

export const createSessionTool = {
  name: "createSession",
  description: "Create an isolated headless PTY session for parallel work, a busy Primary Session, or a different shell/size. The session is never directly visible to the user and cannot provide a user-visible password prompt. Returns a sessionId for subsequent terminal calls.",
  inputSchema: {
    type: "object" as const,
    properties: {
      shell: {
        type: "string",
        description: "Shell to use for this session (default: $TERMINAL_TOOLKIT_SHELL, $SHELL, or /bin/bash)",
      },
      cols: {
        type: "number",
        description: "Terminal width in columns (default: 80)",
      },
      rows: {
        type: "number",
        description: "Terminal height in rows (default: 25)",
      },
    },
    required: [],
  },
};

export async function handleCreateSession(
  manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = createSessionSchema.parse(args ?? {});
  const metadata = await manager.createSession(parsed);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(metadata, null, 2),
      },
    ],
  };
}
