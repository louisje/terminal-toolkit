import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";

export const createSessionSchema = z.object({
  shell: z.string().optional().describe("Shell to use for this session (default: $TERMINAL_TOOLKIT_SHELL, $SHELL, or /bin/bash)"),
  cols: z.number().int().positive().optional().describe("Terminal width in columns (default: 80)"),
  rows: z.number().int().positive().optional().describe("Terminal height in rows (default: 25)"),
});

export const createSessionTool = {
  name: "createSession",
  description: "Creates an additional headless PTY, never directly displayed in the user's terminal. It remains interactive through MCP tools, but cannot serve as a user-visible password prompt or terminal. Only the default session may be user-visible, depending on mode. First call getContent() without sessionId to inspect the default terminal. Reuse it only when clearly idle and available. Create an isolated terminal if someone is using it, a command/TUI is running, availability is unclear, or you need parallel work or a different shell/size. Do not send input or interrupt work in an occupied terminal. Returns session metadata; use the returned sessionId in subsequent type/sendKey/getContent/takeScreenshot calls to address this extra session.",
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
