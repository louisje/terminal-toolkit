import clipboardy from "clipboardy";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";
export const getClipboardTool = {
    name: "getClipboard",
    description: TOOL_DESCRIPTIONS.getClipboard.main,
    inputSchema: {
        type: "object",
        properties: {},
        required: [],
    },
};
export async function handleGetClipboard(_manager, _args) {
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
//# sourceMappingURL=getClipboard.js.map