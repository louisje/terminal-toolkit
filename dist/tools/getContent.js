import { z } from "zod";
import { TOOL_DESCRIPTIONS, SESSION_ID_DESCRIPTION } from "./descriptions.js";
export const getContentSchema = z.object({
    visibleOnly: z
        .boolean()
        .optional()
        .describe(TOOL_DESCRIPTIONS.getContent.visibleOnly),
    maxLines: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(TOOL_DESCRIPTIONS.getContent.maxLines),
    delay: z
        .number()
        .finite()
        .nonnegative()
        .optional()
        .default(0)
        .describe(TOOL_DESCRIPTIONS.getContent.delay),
    sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION),
});
export const getContentTool = {
    name: "getContent",
    description: TOOL_DESCRIPTIONS.getContent.main,
    inputSchema: {
        type: "object",
        properties: {
            visibleOnly: {
                type: "boolean",
                description: TOOL_DESCRIPTIONS.getContent.visibleOnly,
            },
            maxLines: {
                type: "number",
                description: TOOL_DESCRIPTIONS.getContent.maxLines,
                minimum: 0,
            },
            delay: {
                type: "number",
                description: TOOL_DESCRIPTIONS.getContent.delay,
                default: 0,
                minimum: 0,
            },
            sessionId: {
                type: "string",
                description: SESSION_ID_DESCRIPTION,
            },
        },
        required: [],
    },
};
export async function handleGetContent(manager, args) {
    const parsed = getContentSchema.parse(args ?? {});
    // If delay is specified, sleep before getting content
    if (parsed.delay > 0) {
        await new Promise((resolve) => {
            setTimeout(resolve, parsed.delay);
        });
    }
    // visibleOnly and maxLines are orthogonal:
    // - visibleOnly: data source (viewport vs full scrollback)
    // - maxLines: cap on returned lines (applies to either source)
    //
    // Defaults:
    // - visibleOnly unset + maxLines unset → viewport, all lines
    // - visibleOnly unset + maxLines set   → scrollback (maxLines implies visibleOnly=false)
    // - visibleOnly true  + maxLines set   → viewport, last N lines
    // - visibleOnly false + maxLines unset → scrollback, last 100 lines
    // - visibleOnly false + maxLines set   → scrollback, last N lines
    const useVisible = parsed.visibleOnly === true
        || (parsed.visibleOnly === undefined && parsed.maxLines === undefined);
    // Determine effective maxLines:
    // - scrollback without explicit maxLines → default 100
    // - maxLines=0 → no limit (return everything)
    // - maxLines=N → cap at N lines
    const effectiveMaxLines = !useVisible && parsed.maxLines === undefined
        ? 100
        : parsed.maxLines;
    let content;
    if (useVisible) {
        content = manager.getVisibleContent(parsed.sessionId);
    }
    else {
        content = manager.getContent(parsed.sessionId);
    }
    // Apply maxLines cap (0 means unlimited)
    if (effectiveMaxLines !== undefined && effectiveMaxLines > 0) {
        const lines = content.split('\n');
        if (lines.length > effectiveMaxLines) {
            content = lines.slice(-effectiveMaxLines).join('\n');
        }
    }
    return {
        content: [
            {
                type: "text",
                text: content || "(empty terminal)",
            },
        ],
    };
}
//# sourceMappingURL=getContent.js.map