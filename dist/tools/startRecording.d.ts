import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
export declare const startRecordingSchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["v2"]>>>;
    mode: z.ZodDefault<z.ZodOptional<z.ZodEnum<["always", "on-failure"]>>>;
    outputDir: z.ZodOptional<z.ZodString>;
    idleTimeLimit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    maxDuration: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    inactivityTimeout: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    mode: "always" | "on-failure";
    format: "v2";
    idleTimeLimit: number;
    maxDuration: number;
    inactivityTimeout: number;
    outputDir?: string | undefined;
}, {
    mode?: "always" | "on-failure" | undefined;
    format?: "v2" | undefined;
    outputDir?: string | undefined;
    idleTimeLimit?: number | undefined;
    maxDuration?: number | undefined;
    inactivityTimeout?: number | undefined;
}>;
export declare const startRecordingTool: {
    name: string;
    description: "Start recording terminal output to an asciicast v2 file. Returns the recording ID and path where the file will be saved. Only one recording can be active at a time.";
    inputSchema: {
        type: "object";
        properties: {
            format: {
                type: string;
                enum: string[];
                description: "Recording format (default: v2, asciicast v2 format)";
            };
            mode: {
                type: string;
                enum: string[];
                description: "Recording mode: always saves the recording, on-failure only saves if session exits with non-zero code (default: always)";
            };
            outputDir: {
                type: string;
                description: "Directory to save the recording (default: ~/.local/state/terminal-toolkit/recordings, or TERMINAL_TOOLKIT_RECORD_DIR env var)";
            };
            idleTimeLimit: {
                type: string;
                description: "Max seconds between events in the recording (default: 2). Caps idle time to prevent long pauses during playback.";
            };
            maxDuration: {
                type: string;
                description: "Max recording duration in seconds (default: 3600 = 60 minutes). Recording will auto-stop when this limit is reached.";
            };
            inactivityTimeout: {
                type: string;
                description: "Stop recording after N seconds of no terminal output (default: 600 = 10 minutes). Resets on each output event.";
            };
        };
        required: never[];
    };
};
export declare function handleStartRecording(manager: TerminalManager, args: unknown): {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
};
//# sourceMappingURL=startRecording.d.ts.map