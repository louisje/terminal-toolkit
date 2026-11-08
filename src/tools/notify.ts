import { z } from "zod";
import notifier from "node-notifier";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);

/** Android Node builds in Termux expose android and TERMUX_VERSION. */
export function isTermuxEnvironment(platform = process.platform, env = process.env): boolean {
  return platform === "android" && (Boolean(env.TERMUX_VERSION) || Boolean(env.PREFIX?.includes("com.termux")));
}

export function termuxNotificationCommands(args: NotifyArgs): Array<{ command: string; args: string[] }> {
  const parsed = notifySchema.parse(args);
  return [
    {
      command: "termux-notification",
      args: ["--title", parsed.title, "--content", parsed.message, ...(parsed.sound ? ["--sound"] : [])],
    },
    { command: "termux-toast", args: [parsed.message] },
  ];
}

export async function handleNotify(
  _manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const parsed = notifySchema.parse(args);

  if (isTermuxEnvironment()) {
    // Termux:API requests share the Android broadcast bridge; serialize them
    // to avoid a notification request blocking the subsequent Toast response.
    const failures: string[] = [];
    for (const { command, args } of termuxNotificationCommands(parsed)) {
      try {
        await execFileAsync(command, args, { timeout: 15000 });
      } catch (error) {
        failures.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) {
      return {
        content: [{ type: "text", text: `Termux notification delivery failed: ${failures.join("; ")}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: `Notification and toast sent: "${parsed.message}"` }] };
  }

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
          if (error) reject(error);
          else resolve();
        }
      );
    });

    return {
      content: [{ type: "text", text: `Notification sent: "${parsed.message}"` }],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `Could not deliver desktop notification: ${reason}. The message was: "${parsed.message}"`,
      }],
      isError: true,
    };
  }
}
