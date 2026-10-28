import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
export declare const notifySchema: z.ZodObject<{
    message: z.ZodString;
    title: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    sound: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    title: string;
    sound: boolean;
}, {
    message: string;
    title?: string | undefined;
    sound?: boolean | undefined;
}>;
export type NotifyArgs = z.infer<typeof notifySchema>;
export declare const notifyTool: {
    name: string;
    description: "Send a desktop notification (OS-level popup/toast, not terminal output) to alert the human. Use this when a long-running task finishes, or when you need the user's input/decision and they may not be watching this conversation. Unlike terminal output, this is visible even if the user is focused on a different window or away from the screen. Silently degrades to a text-only response (no error thrown) in headless/CI environments without a desktop notification service.";
    inputSchema: {
        type: "object";
        properties: {
            message: {
                type: string;
                description: "The notification body text (e.g. 'Build finished' or 'Need your input: which option do you want?')";
            };
            title: {
                type: string;
                description: "The notification title (default: 'Terminal Toolkit')";
                default: string;
            };
            sound: {
                type: string;
                description: "Whether to play the OS notification sound (default: true). Set to false for quieter, less intrusive notifications.";
                default: boolean;
            };
        };
        required: string[];
    };
};
export declare function handleNotify(_manager: TerminalManager, args: unknown): Promise<{
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}>;
//# sourceMappingURL=notify.d.ts.map