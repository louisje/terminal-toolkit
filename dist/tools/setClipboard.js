import { z } from "zod";
import clipboardy from "clipboardy";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";
export const setClipboardSchema = z.object({
    text: z.string().describe(TOOL_DESCRIPTIONS.setClipboard.text),
});
export const setClipboardTool = {
    name: "setClipboard",
    description: TOOL_DESCRIPTIONS.setClipboard.main,
    inputSchema: {
        type: "object",
        properties: {
            text: {
                type: "string",
                description: TOOL_DESCRIPTIONS.setClipboard.text,
            },
        },
        required: ["text"],
    },
};
export async function handleSetClipboard(_manager, args) {
    const parsed = setClipboardSchema.parse(args);
    await clipboardy.write(parsed.text);
    const preview = parsed.text.length > 80 ? `${parsed.text.slice(0, 80)}…` : parsed.text;
    return {
        content: [
            {
                type: "text",
                text: `Clipboard set (${parsed.text.length} chars): ${preview}`,
            },
        ],
    };
}
//# sourceMappingURL=setClipboard.js.map