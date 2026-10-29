import { z } from "zod";
import { TOOL_DESCRIPTIONS, SESSION_ID_DESCRIPTION } from "./descriptions.js";
import { renderTerminalToPng } from "../utils/render.js";
export const screenshotSchema = z.object({
    format: z.enum(["text", "ansi", "png"]).optional().describe("Output format: 'text' (default) returns plain JSON, 'ansi' returns text with ANSI color codes, 'png' returns a color screenshot image"),
    sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION),
});
export const screenshotTool = {
    name: "takeScreenshot",
    description: TOOL_DESCRIPTIONS.takeScreenshot.main,
    inputSchema: {
        type: "object",
        properties: {
            format: {
                type: "string",
                enum: ["text", "ansi", "png"],
                description: "Output format: 'text' (default) plain JSON, 'ansi' for colored text with ANSI codes, 'png' for color screenshot image",
            },
            sessionId: {
                type: "string",
                description: SESSION_ID_DESCRIPTION,
            },
        },
        required: [],
    },
};
export function handleScreenshot(manager, args) {
    const parsed = screenshotSchema.parse(args);
    const format = parsed.format || "text";
    if (format === "ansi") {
        const content = manager.getAnsiContent(true, parsed.sessionId);
        const buffer = manager.getTerminal(parsed.sessionId).buffer.active;
        const result = {
            content,
            cursor: { x: buffer.cursorX, y: buffer.cursorY },
            dimensions: {
                cols: manager.getDimensions(parsed.sessionId).cols,
                rows: manager.getDimensions(parsed.sessionId).rows,
            },
        };
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    if (format === "png") {
        const terminal = manager.getTerminal(parsed.sessionId);
        const pngBuffer = renderTerminalToPng(terminal);
        return {
            content: [
                {
                    type: "image",
                    data: pngBuffer.toString("base64"),
                    mimeType: "image/png",
                },
            ],
        };
    }
    // Default text format
    const screenshot = manager.takeScreenshot(parsed.sessionId);
    const result = {
        content: screenshot.content,
        cursor: screenshot.cursor,
        dimensions: screenshot.dimensions,
    };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}
//# sourceMappingURL=screenshot.js.map