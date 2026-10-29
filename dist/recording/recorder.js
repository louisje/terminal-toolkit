import * as fs from "fs";
import * as os from "os";
import * as path from "path";
/**
 * Recorder handles writing asciicast v2 format recordings
 *
 * Asciicast v2 format:
 * - First line: JSON header with version, dimensions, timestamp
 * - Subsequent lines: JSON arrays [time, type, data]
 *   - time: seconds since start (float)
 *   - type: "o" for output, "r" for resize
 *   - data: string content
 */
export class Recorder {
    id;
    mode;
    format;
    outputDir;
    tempPath;
    finalPath;
    writeStream = null;
    startTime = 0;
    bytesWritten = 0;
    finalized = false;
    idleTimeLimit;
    lastEventTime = 0;
    adjustedElapsed = 0;
    // Timeout settings
    maxDuration;
    inactivityTimeout;
    maxDurationTimer = null;
    inactivityTimer = null;
    stopReason = 'explicit';
    // Callback for auto-finalize events
    onAutoFinalize;
    constructor(id, mode, outputDir, format = 'v2', idleTimeLimit = 2, maxDuration = 3600, // 60 minutes default
    inactivityTimeout = 600 // 10 minutes default
    ) {
        this.id = id;
        this.mode = mode;
        this.format = format;
        this.outputDir = outputDir;
        this.idleTimeLimit = idleTimeLimit;
        this.maxDuration = maxDuration;
        this.inactivityTimeout = inactivityTimeout;
        // Generate temp and final paths
        const timestamp = Date.now();
        const filename = `terminal-${timestamp}-${id}.cast`;
        this.tempPath = path.join(os.tmpdir(), `terminal-mcp-recording-${id}.cast`);
        this.finalPath = path.join(outputDir, filename);
    }
    /**
     * Start the recording
     * Writes the asciicast header to the temp file
     */
    start(width, height, env) {
        if (this.writeStream) {
            throw new Error("Recording already started");
        }
        this.startTime = Date.now();
        // Ensure output directory exists
        fs.mkdirSync(this.outputDir, { recursive: true });
        // Create write stream to temp file
        this.writeStream = fs.createWriteStream(this.tempPath, { flags: 'w' });
        // Write header
        const header = {
            version: 2,
            width,
            height,
            timestamp: Math.floor(this.startTime / 1000),
        };
        if (env) {
            header.env = env;
        }
        this.writeLine(JSON.stringify(header));
        // Set up max duration timer
        if (this.maxDuration > 0) {
            this.maxDurationTimer = setTimeout(() => {
                this._autoFinalize('max_duration');
            }, this.maxDuration * 1000);
        }
        // Set up initial inactivity timer
        if (this.inactivityTimeout > 0) {
            this.inactivityTimer = setTimeout(() => {
                this._autoFinalize('inactivity');
            }, this.inactivityTimeout * 1000);
        }
    }
    /**
     * Record output data
     */
    recordOutput(data) {
        if (!this.writeStream || this.finalized) {
            return;
        }
        // Reset inactivity timer on each output event
        if (this.inactivityTimeout > 0 && this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = setTimeout(() => {
                this._autoFinalize('inactivity');
            }, this.inactivityTimeout * 1000);
        }
        const elapsed = this.getElapsedSeconds();
        const event = [elapsed, 'o', data];
        this.writeLine(JSON.stringify(event));
    }
    /**
     * Record terminal resize event
     */
    recordResize(cols, rows) {
        if (!this.writeStream || this.finalized) {
            return;
        }
        const elapsed = this.getElapsedSeconds();
        const event = [elapsed, 'r', `${cols}x${rows}`];
        this.writeLine(JSON.stringify(event));
    }
    /**
     * Finalize the recording
     * - For 'always' mode: move temp file to output dir
     * - For 'on-failure' mode: move if exitCode !== 0, delete otherwise
     *
     * Returns metadata about the recording
     */
    async finalize(exitCode, stopReason) {
        if (this.finalized) {
            throw new Error("Recording already finalized");
        }
        this.finalized = true;
        const endTime = Date.now();
        const durationMs = endTime - this.startTime;
        // Clear any active timers
        this.clearTimers();
        // Use provided stopReason or the internally tracked one
        const finalStopReason = stopReason ?? this.stopReason;
        // Close the write stream
        if (this.writeStream) {
            await new Promise((resolve, reject) => {
                this.writeStream.end((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }
        let saved = false;
        let finalPath = this.tempPath;
        // Determine whether to save based on mode and exit code
        const shouldSave = this.mode === 'always' ||
            (this.mode === 'on-failure' && exitCode !== 0 && exitCode !== null);
        if (shouldSave) {
            // Move temp file to final location
            try {
                fs.renameSync(this.tempPath, this.finalPath);
                finalPath = this.finalPath;
                saved = true;
            }
            catch (err) {
                // If rename fails (cross-device), copy and delete
                fs.copyFileSync(this.tempPath, this.finalPath);
                fs.unlinkSync(this.tempPath);
                finalPath = this.finalPath;
                saved = true;
            }
            // Write metadata sidecar file
            const metaPath = this.finalPath.replace(/\.cast$/, '.meta.json');
            const meta = {
                exitCode,
                durationMs,
                startTime: this.startTime,
                endTime,
                bytesWritten: this.bytesWritten,
                stopReason: finalStopReason,
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }
        else {
            // Delete temp file
            try {
                fs.unlinkSync(this.tempPath);
            }
            catch {
                // Ignore if already deleted
            }
        }
        return {
            id: this.id,
            path: saved ? finalPath : '',
            tempPath: this.tempPath,
            startTime: this.startTime,
            endTime,
            durationMs,
            bytesWritten: this.bytesWritten,
            exitCode,
            mode: this.mode,
            saved,
            stopReason: finalStopReason,
        };
    }
    /**
     * Check if recording is active
     */
    isActive() {
        return this.writeStream !== null && !this.finalized;
    }
    /**
     * Get the temp file path (for debugging/testing)
     */
    getTempPath() {
        return this.tempPath;
    }
    /**
     * Get the final file path
     */
    getFinalPath() {
        return this.finalPath;
    }
    getElapsedSeconds() {
        const now = Date.now();
        if (this.lastEventTime === 0) {
            // First event - just record the time
            this.lastEventTime = now;
            this.adjustedElapsed = (now - this.startTime) / 1000;
            return this.adjustedElapsed;
        }
        // Calculate actual idle time since last event
        const idleTime = (now - this.lastEventTime) / 1000;
        // Cap idle time if limit is set and exceeded
        if (this.idleTimeLimit > 0 && idleTime > this.idleTimeLimit) {
            // Only add the capped idle time to our adjusted elapsed
            this.adjustedElapsed += this.idleTimeLimit;
        }
        else {
            // Add actual idle time
            this.adjustedElapsed += idleTime;
        }
        this.lastEventTime = now;
        return this.adjustedElapsed;
    }
    writeLine(line) {
        if (this.writeStream) {
            const data = line + '\n';
            this.writeStream.write(data);
            this.bytesWritten += Buffer.byteLength(data, 'utf8');
        }
    }
    /**
     * Clear all active timers
     */
    clearTimers() {
        if (this.maxDurationTimer) {
            clearTimeout(this.maxDurationTimer);
            this.maxDurationTimer = null;
        }
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }
    /**
     * Auto-finalize the recording due to timeout
     * Called internally when max duration or inactivity timeout is reached
     */
    async _autoFinalize(reason) {
        if (this.finalized) {
            return;
        }
        this.stopReason = reason;
        const metadata = await this.finalize(null, reason);
        // Notify callback if registered
        if (this.onAutoFinalize) {
            this.onAutoFinalize(metadata);
        }
    }
    /**
     * Set callback for auto-finalize events (timeout triggered)
     */
    setOnAutoFinalize(callback) {
        this.onAutoFinalize = callback;
    }
    /**
     * Get timeout configuration and remaining time
     */
    getTimeoutInfo() {
        const elapsedSeconds = this.startTime > 0 ? (Date.now() - this.startTime) / 1000 : 0;
        const remainingMaxDuration = this.maxDuration > 0 ? Math.max(0, this.maxDuration - elapsedSeconds) : -1;
        return {
            maxDuration: this.maxDuration,
            inactivityTimeout: this.inactivityTimeout,
            elapsedSeconds,
            remainingMaxDuration,
        };
    }
}
//# sourceMappingURL=recorder.js.map