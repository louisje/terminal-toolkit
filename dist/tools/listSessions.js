import { z } from "zod";
export const listSessionsSchema = z.object({});
export const listSessionsTool = {
    name: "listSessions",
    description: "List all active terminal sessions, including the default session. Returns session metadata and the configured limits.",
    inputSchema: {
        type: "object",
        properties: {},
        required: [],
    },
};
export function handleListSessions(manager, _args) {
    const result = manager.listSessions();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}
//# sourceMappingURL=listSessions.js.map