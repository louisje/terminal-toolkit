import { z } from "zod";
import { SESSION_ID_DESCRIPTION } from "./descriptions.js";
export const resizeSchema = z.object({
    cols: z.number().int().positive().describe("New terminal width in columns"),
    rows: z.number().int().positive().describe("New terminal height in rows"),
    sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION),
});
export const resizeTool = {
    name: "resize",
    description: "Resize the terminal to the specified dimensions. Affects both the virtual terminal and the underlying PTY process.",
    inputSchema: {
        type: "object",
        properties: {
            cols: {
                type: "number",
                description: "New terminal width in columns",
            },
            rows: {
                type: "number",
                description: "New terminal height in rows",
            },
            sessionId: {
                type: "string",
                description: SESSION_ID_DESCRIPTION,
            },
        },
        required: ["cols", "rows"],
    },
};
export function handleResize(manager, args) {
    const parsed = resizeSchema.parse(args);
    manager.resize(parsed.cols, parsed.rows, parsed.sessionId);
    return {
        content: [
            {
                type: "text",
                text: `Terminal resized to ${parsed.cols}x${parsed.rows}`,
            },
        ],
    };
}
//# sourceMappingURL=resize.js.map