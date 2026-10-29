import * as crypto from "crypto";
import { Recorder } from "./recorder.js";
import { getDefaultRecordDir } from "../utils/platform.js";
/**
 * RecordingManager tracks and manages multiple recordings
 */
export class RecordingManager {
    recordings = new Map();
    defaultOptions;
    constructor(options) {
        this.defaultOptions = {
            mode: options?.mode ?? 'off',
            format: options?.format ?? 'v2',
            outputDir: options?.outputDir ?? getDefaultRecordDir(),
            idleTimeLimit: options?.idleTimeLimit ?? 2,
            maxDuration: options?.maxDuration ?? 3600, // 60 minutes default
            inactivityTimeout: options?.inactivityTimeout ?? 600, // 10 minutes default
        };
    }
    /**
     * Create a new recording
     * Returns the recorder instance
     */
    createRecording(options) {
        const id = this.generateId();
        const mergedOptions = {
            ...this.defaultOptions,
            ...options,
        };
        const recorder = new Recorder(id, mergedOptions.mode, mergedOptions.outputDir, mergedOptions.format, mergedOptions.idleTimeLimit, mergedOptions.maxDuration, mergedOptions.inactivityTimeout);
        this.recordings.set(id, recorder);
        return recorder;
    }
    /**
     * Get a recording by ID
     */
    getRecording(id) {
        return this.recordings.get(id);
    }
    /**
     * Check if a recording exists
     */
    hasRecording(id) {
        return this.recordings.has(id);
    }
    /**
     * Get all active recordings
     */
    getActiveRecordings() {
        return Array.from(this.recordings.values()).filter(r => r.isActive());
    }
    /**
     * Get the count of active recordings
     */
    getActiveCount() {
        return this.getActiveRecordings().length;
    }
    /**
     * Record output to all active recordings
     */
    recordOutputToAll(data) {
        for (const recorder of this.getActiveRecordings()) {
            recorder.recordOutput(data);
        }
    }
    /**
     * Record resize to all active recordings
     */
    recordResizeToAll(cols, rows) {
        for (const recorder of this.getActiveRecordings()) {
            recorder.recordResize(cols, rows);
        }
    }
    /**
     * Finalize a specific recording
     */
    async finalizeRecording(id, exitCode, stopReason) {
        const recorder = this.recordings.get(id);
        if (!recorder) {
            return undefined;
        }
        const metadata = await recorder.finalize(exitCode, stopReason);
        this.recordings.delete(id);
        return metadata;
    }
    /**
     * Finalize all active recordings
     * Returns array of metadata for all finalized recordings
     */
    async finalizeAll(exitCode, stopReason = 'session_exit') {
        const results = [];
        for (const [id, recorder] of this.recordings) {
            if (recorder.isActive()) {
                const metadata = await recorder.finalize(exitCode, stopReason);
                results.push(metadata);
            }
            this.recordings.delete(id);
        }
        return results;
    }
    /**
     * Get default recording mode
     */
    getDefaultMode() {
        return this.defaultOptions.mode;
    }
    /**
     * Get default output directory
     */
    getDefaultOutputDir() {
        return this.defaultOptions.outputDir;
    }
    /**
     * Check if auto-recording is enabled (mode !== 'off')
     */
    isAutoRecordingEnabled() {
        return this.defaultOptions.mode !== 'off';
    }
    generateId() {
        return crypto.randomBytes(8).toString('hex');
    }
}
//# sourceMappingURL=manager.js.map