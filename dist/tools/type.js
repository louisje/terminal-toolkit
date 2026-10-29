import { z } from "zod";
import { getKeySequence } from "../utils/keys.js";
import { TOOL_DESCRIPTIONS, SESSION_ID_DESCRIPTION } from "./descriptions.js";
export const typeSchema = z.object({
    text: z.string().describe(TOOL_DESCRIPTIONS.type.text),
    autoSubmit: z.boolean().optional().default(false).describe(TOOL_DESCRIPTIONS.type.autoSubmit),
    sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION),
});
export const typeTool = {
    name: "type",
    description: TOOL_DESCRIPTIONS.type.main,
    inputSchema: {
        type: "object",
        properties: {
            text: {
                type: "string",
                description: TOOL_DESCRIPTIONS.type.text,
            },
            autoSubmit: {
                type: "boolean",
                description: TOOL_DESCRIPTIONS.type.autoSubmit,
                default: false,
            },
            sessionId: {
                type: "string",
                description: SESSION_ID_DESCRIPTION,
            },
        },
        required: ["text"],
    },
};
export async function handleType(manager, args) {
    const parsed = typeSchema.parse(args);
    manager.write(parsed.text, parsed.sessionId);
    if (parsed.autoSubmit) {
        // Send Enter key
        const enterSequence = getKeySequence("Enter");
        if (enterSequence) {
            manager.write(enterSequence, parsed.sessionId);
        }
        // Wait a brief moment for command to execute
        await new Promise(resolve => setTimeout(resolve, 250));
        // Get and return terminal content (visible only)
        const content = manager.getVisibleContent(parsed.sessionId);
        return {
            content: [
                {
                    type: "text",
                    text: content || "(empty terminal)",
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: `Typed ${parsed.text.length} character(s) to terminal`,
            },
        ],
    };
}
//# sourceMappingURL=type.js.map