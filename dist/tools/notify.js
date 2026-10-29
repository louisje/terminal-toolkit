import { z } from "zod";
import notifier from "node-notifier";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";
export const notifySchema = z.object({
    message: z.string().min(1).describe(TOOL_DESCRIPTIONS.notify.message),
    title: z
        .string()
        .optional()
        .default("Terminal MCP")
        .describe(TOOL_DESCRIPTIONS.notify.title),
    sound: z
        .boolean()
        .optional()
        .default(true)
        .describe(TOOL_DESCRIPTIONS.notify.sound),
});
export const notifyTool = {
    name: "notify",
    description: TOOL_DESCRIPTIONS.notify.main,
    inputSchema: {
        type: "object",
        properties: {
            message: {
                type: "string",
                description: TOOL_DESCRIPTIONS.notify.message,
            },
            title: {
                type: "string",
                description: TOOL_DESCRIPTIONS.notify.title,
                default: "Terminal MCP",
            },
            sound: {
                type: "boolean",
                description: TOOL_DESCRIPTIONS.notify.sound,
                default: true,
            },
        },
        required: ["message"],
    },
};
export async function handleNotify(_manager, args) {
    const parsed = notifySchema.parse(args);
    try {
        await new Promise((resolve, reject) => {
            notifier.notify({
                title: parsed.title,
                message: parsed.message,
                sound: parsed.sound,
                wait: false,
            }, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
        return {
            content: [
                {
                    type: "text",
                    text: `Notification sent: "${parsed.message}"`,
                },
            ],
        };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            content: [
                {
                    type: "text",
                    text: `Could not deliver desktop notification (this is expected in headless/CI environments without a desktop session): ${reason}. The message was: "${parsed.message}"`,
                },
            ],
        };
    }
}
//# sourceMappingURL=notify.js.map