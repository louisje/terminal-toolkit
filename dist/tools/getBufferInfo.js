import { z } from "zod";
import { TOOL_DESCRIPTIONS, SESSION_ID_DESCRIPTION } from "./descriptions.js";
export const getBufferInfoSchema = z.object({
    sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION),
});
export const getBufferInfoTool = {
    name: "getBufferInfo",
    description: TOOL_DESCRIPTIONS.getBufferInfo.main,
    inputSchema: {
        type: "object",
        properties: {
            sessionId: {
                type: "string",
                description: SESSION_ID_DESCRIPTION,
            },
        },
        required: [],
    },
};
export function handleGetBufferInfo(manager, args) {
    const parsed = getBufferInfoSchema.parse(args ?? {});
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(manager.getBufferInfo(parsed.sessionId), null, 2),
            },
        ],
    };
}
//# sourceMappingURL=getBufferInfo.js.map