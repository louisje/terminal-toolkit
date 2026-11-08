import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

export const setClipboardSchema = z.object({
  text: z.string().describe(TOOL_DESCRIPTIONS.setClipboard.text),
});

export type SetClipboardArgs = z.infer<typeof setClipboardSchema>;

export const setClipboardTool = {
  name: "setClipboard",
  description: TOOL_DESCRIPTIONS.setClipboard.main,
  inputSchema: {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description: TOOL_DESCRIPTIONS.setClipboard.text,
      },
    },
    required: ["text"],
  },
};

export async function handleSetClipboard(
  _manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = setClipboardSchema.parse(args);
  const { default: clipboardy } = await import("clipboardy");
  await clipboardy.write(parsed.text);

  const preview =
    parsed.text.length > 80 ? `${parsed.text.slice(0, 80)}…` : parsed.text;

  return {
    content: [
      {
        type: "text",
        text: `Clipboard set (${parsed.text.length} chars): ${preview}`,
      },
    ],
  };
}
