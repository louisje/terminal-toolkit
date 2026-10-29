import { z } from "zod";
export const destroySessionSchema = z.object({
    sessionId: z.string().describe("ID of the session to destroy"),
});
export const destroySessionTool = {
    name: "destroySession",
    description: "Destroy a terminal session by ID. The default session cannot be destroyed.",
    inputSchema: {
        type: "object",
        properties: {
            sessionId: {
                type: "string",
                description: "ID of the session to destroy",
            },
        },
        required: ["sessionId"],
    },
};
export function handleDestroySession(manager, args) {
    const parsed = destroySessionSchema.parse(args);
    const result = manager.destroySession(parsed.sessionId);
    return {
        content: [
            {
                type: "text",
                text: result.message,
            },
        ],
        isError: !result.success,
    };
}
//# sourceMappingURL=destroySession.js.map