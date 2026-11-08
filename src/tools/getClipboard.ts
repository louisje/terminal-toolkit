import { TerminalManager } from "../terminal/index.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

export const getClipboardTool = {
  name: "getClipboard",
  description: TOOL_DESCRIPTIONS.getClipboard.main,
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export async function handleGetClipboard(
  _manager: TerminalManager,
  _args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { default: clipboardy } = await import("clipboardy");
  const text = await clipboardy.read();

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}
