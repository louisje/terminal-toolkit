import { z } from "zod";
import { TOOL_DESCRIPTIONS } from "./descriptions.js";
export const stopRecordingSchema = z.object({
    recordingId: z.string(),
});
export const stopRecordingTool = {
    name: "stopRecording",
    description: TOOL_DESCRIPTIONS.stopRecording.main,
    inputSchema: {
        type: "object",
        properties: {
            recordingId: {
                type: "string",
                description: TOOL_DESCRIPTIONS.stopRecording.recordingId,
            },
        },
        required: ["recordingId"],
    },
};
export async function handleStopRecording(manager, args) {
    const parsed = stopRecordingSchema.parse(args);
    const recordingManager = manager.getRecordingManager();
    const recorder = recordingManager.getRecording(parsed.recordingId);
    if (!recorder) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: Recording not found: ${parsed.recordingId}`,
                },
            ],
            isError: true,
        };
    }
    if (!recorder.isActive()) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: Recording already finalized: ${parsed.recordingId}`,
                },
            ],
            isError: true,
        };
    }
    // Finalize with exit code 0 (explicit stop means success)
    const metadata = await recordingManager.finalizeRecording(parsed.recordingId, 0, 'explicit');
    if (!metadata) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: Failed to finalize recording: ${parsed.recordingId}`,
                },
            ],
            isError: true,
        };
    }
    const result = {
        recordingId: metadata.id,
        path: metadata.path,
        durationMs: metadata.durationMs,
        bytesWritten: metadata.bytesWritten,
        saved: metadata.saved,
        mode: metadata.mode,
        stopReason: metadata.stopReason,
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
//# sourceMappingURL=stopRecording.js.map