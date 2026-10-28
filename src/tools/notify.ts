import { z } from "zod";
import notifier from "node-notifier";
import { TerminalManager } from "../terminal/index.js";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";

export const notifySchema = z.object({
  message: z.string().min(1).describe(TOOL_DESCRIPTIONS.notify.message),
  title: z
    .string()
    .optional()
    .default("Terminal Toolkit")
    .describe(TOOL_DESCRIPTIONS.notify.title),
  sound: z
    .boolean()
    .optional()
    .default(true)
    .describe(TOOL_DESCRIPTIONS.notify.sound),
});

export type NotifyArgs = z.infer<typeof notifySchema>;

export const notifyTool = {
  name: "notify",
  description: TOOL_DESCRIPTIONS.notify.main,
  inputSchema: {
    type: "object" as const,
    properties: {
      message: {
        type: "string",
        description: TOOL_DESCRIPTIONS.notify.message,
      },
      title: {
        type: "string",
        description: TOOL_DESCRIPTIONS.notify.title,
        default: "Terminal Toolkit",
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

export async function handleNotify(
  _manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = notifySchema.parse(args);

  try {
    await new Promise<void>((resolve, reject) => {
      notifier.notify(
        {
          title: parsed.title,
          message: parsed.message,
          sound: parsed.sound,
          wait: false,
        },
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });

    return {
      content: [
        {
          type: "text",
          text: `Notification sent: "${parsed.message}"`,
        },
      ],
    };
  } catch (error) {
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
