import { z } from "zod";
export const createSessionSchema = z.object({
    shell: z.string().optional().describe("Shell to use for this session (default: $SHELL or /bin/bash)"),
    cols: z.number().int().positive().optional().describe("Terminal width in columns (default: 80)"),
    rows: z.number().int().positive().optional().describe("Terminal height in rows (default: 25)"),
});
export const createSessionTool = {
    name: "createSession",
    description: "OPTIONAL — a default terminal session is already running and ready to use; do NOT call this before your first type/sendKey/getContent call. Only use createSession when you specifically need an ADDITIONAL, isolated terminal (e.g. running a second concurrent process, or a different shell/size) alongside the default one. Returns session metadata; use the returned sessionId in subsequent type/sendKey/getContent/takeScreenshot calls to address this extra session.",
    inputSchema: {
        type: "object",
        properties: {
            shell: {
                type: "string",
                description: "Shell to use for this session (default: $SHELL or /bin/bash)",
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
export async function handleCreateSession(manager, args) {
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
//# sourceMappingURL=createSession.js.map