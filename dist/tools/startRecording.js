import { z } from "zod";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";
export const startRecordingSchema = z.object({
    format: z.enum(['v2']).optional().default('v2'),
    mode: z.enum(['always', 'on-failure']).optional().default('always'),
    outputDir: z.string().optional(),
    idleTimeLimit: z.number().optional().default(2),
    maxDuration: z.number().optional().default(3600),
    inactivityTimeout: z.number().optional().default(600),
});
export const startRecordingTool = {
    name: "startRecording",
    description: TOOL_DESCRIPTIONS.startRecording.main,
    inputSchema: {
        type: "object",
        properties: {
            format: {
                type: "string",
                enum: ["v2"],
                description: TOOL_DESCRIPTIONS.startRecording.format,
            },
            mode: {
                type: "string",
                enum: ["always", "on-failure"],
                description: TOOL_DESCRIPTIONS.startRecording.mode,
            },
            outputDir: {
                type: "string",
                description: TOOL_DESCRIPTIONS.startRecording.outputDir,
            },
            idleTimeLimit: {
                type: "number",
                description: TOOL_DESCRIPTIONS.startRecording.idleTimeLimit,
            },
            maxDuration: {
                type: "number",
                description: TOOL_DESCRIPTIONS.startRecording.maxDuration,
            },
            inactivityTimeout: {
                type: "number",
                description: TOOL_DESCRIPTIONS.startRecording.inactivityTimeout,
            },
        },
        required: [],
    },
};
export function handleStartRecording(manager, args) {
    const parsed = startRecordingSchema.parse(args ?? {});
    const recordingManager = manager.getRecordingManager();
    // Check if there's already an active recording
    const activeRecordings = recordingManager.getActiveRecordings();
    if (activeRecordings.length > 0) {
        const existing = activeRecordings[0];
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        error: "A recording is already in progress",
                        activeRecordingId: existing.id,
                        activePath: existing.getFinalPath(),
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
    const recorder = recordingManager.createRecording({
        format: parsed.format,
        mode: parsed.mode,
        outputDir: parsed.outputDir ?? recordingManager.getDefaultOutputDir(),
        idleTimeLimit: parsed.idleTimeLimit,
        maxDuration: parsed.maxDuration,
        inactivityTimeout: parsed.inactivityTimeout,
    });
    // Get current dimensions and start recording
    const dimensions = manager.getDimensions();
    recorder.start(dimensions.cols, dimensions.rows, {
        TERM: 'xterm-256color',
    });
    // Build timeout message
    const timeoutParts = [];
    if (parsed.maxDuration > 0) {
        const mins = Math.floor(parsed.maxDuration / 60);
        timeoutParts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
    }
    if (parsed.inactivityTimeout > 0) {
        const mins = Math.floor(parsed.inactivityTimeout / 60);
        timeoutParts.push(`${mins} minute${mins !== 1 ? 's' : ''} of inactivity`);
    }
    const timeoutMessage = timeoutParts.length > 0
        ? `Recording will auto-stop after ${timeoutParts.join(' or ')}`
        : undefined;
    const result = {
        recordingId: recorder.id,
        path: recorder.getFinalPath(),
        format: parsed.format,
        mode: parsed.mode,
        maxDuration: parsed.maxDuration,
        inactivityTimeout: parsed.inactivityTimeout,
        message: timeoutMessage,
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
//# sourceMappingURL=startRecording.js.map