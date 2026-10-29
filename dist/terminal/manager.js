import { randomBytes } from "crypto";
import { TerminalSession } from "./session.js";
import { RecordingManager } from "../recording/index.js";
import { getDefaultRecordDir } from "../utils/platform.js";
const DEFAULT_MAX_SESSIONS = 5;
const DEFAULT_SESSION_IDLE_TIMEOUT = 600; // 10 minutes
/**
 * Manages one or more terminal sessions in a single process.
 *
 * The "default" session is created lazily on first access and is never
 * idle-evicted; it's what the existing single-session API operates on
 * when no sessionId is passed. Additional sessions can be created via
 * createSession() and addressed by ID.
 */
export class TerminalManager {
    sessions = new Map();
    defaultSessionId = null;
    defaultSessionPromise = null;
    idleCheckInterval = null;
    options;
    sandboxController;
    recordingManager;
    autoRecordingId = null;
    maxSessions;
    sessionIdleTimeoutMs;
    constructor(options = {}) {
        this.options = options;
        this.sandboxController = options.sandboxController;
        this.recordingManager = new RecordingManager({
            mode: options.record ?? 'off',
            outputDir: options.recordDir ?? getDefaultRecordDir(),
            format: options.recordFormat ?? 'v2',
            idleTimeLimit: options.idleTimeLimit ?? 2,
            maxDuration: options.maxDuration ?? 3600,
            inactivityTimeout: options.inactivityTimeout ?? 600,
        });
        this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
        this.sessionIdleTimeoutMs = (options.sessionIdleTimeout ?? DEFAULT_SESSION_IDLE_TIMEOUT) * 1000;
        // Periodic idle cleanup for non-default sessions
        this.idleCheckInterval = setInterval(() => this.cleanupIdleSessions(), 60 * 1000);
        this.idleCheckInterval.unref();
    }
    // ---------------------------------------------------------------------------
    // Session lookup helpers
    // ---------------------------------------------------------------------------
    generateSessionId() {
        while (true) {
            const id = randomBytes(3).toString("hex").slice(0, 5);
            if (!this.sessions.has(id))
                return id;
        }
    }
    touchSession(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (entry) {
            entry.lastActivity = Date.now();
            entry.metadata.lastActivityAt = new Date().toISOString();
        }
    }
    cleanupIdleSessions() {
        const now = Date.now();
        // Snapshot to avoid mutation-during-iteration
        for (const [sessionId, entry] of Array.from(this.sessions.entries())) {
            if (entry.isDefault)
                continue;
            if (now - entry.lastActivity > this.sessionIdleTimeoutMs) {
                entry.session.dispose();
                this.sessions.delete(sessionId);
            }
        }
    }
    /**
     * Wire recording hooks onto a session so its output is captured by any
     * active recordings.
     */
    wireRecording(session) {
        session.onData((data) => this.recordingManager.recordOutputToAll(data));
        session.onResize((cols, rows) => this.recordingManager.recordResizeToAll(cols, rows));
    }
    // ---------------------------------------------------------------------------
    // Default session (single-session API surface)
    // ---------------------------------------------------------------------------
    /**
     * Get or create the default session. Idempotent and concurrency-safe.
     */
    async getSessionAsync() {
        if (this.defaultSessionId) {
            const entry = this.sessions.get(this.defaultSessionId);
            if (entry && entry.session.isActive()) {
                this.touchSession(this.defaultSessionId);
                return entry.session;
            }
            this.defaultSessionId = null;
        }
        if (this.defaultSessionPromise) {
            return this.defaultSessionPromise;
        }
        this.defaultSessionPromise = (async () => {
            const session = await TerminalSession.create({
                ...this.options,
                sandboxController: this.sandboxController,
            });
            const id = this.generateSessionId();
            const dims = session.getDimensions();
            const now = new Date().toISOString();
            const entry = {
                session,
                metadata: {
                    sessionId: id,
                    shell: this.options.shell ?? process.env.SHELL ?? "/bin/bash",
                    cols: dims.cols,
                    rows: dims.rows,
                    createdAt: now,
                    lastActivityAt: now,
                    isDefault: true,
                },
                lastActivity: Date.now(),
                isDefault: true,
            };
            this.sessions.set(id, entry);
            this.defaultSessionId = id;
            this.wireRecording(session);
            return session;
        })();
        try {
            return await this.defaultSessionPromise;
        }
        finally {
            this.defaultSessionPromise = null;
        }
    }
    getCurrentSession() {
        if (!this.defaultSessionId)
            return null;
        const entry = this.sessions.get(this.defaultSessionId);
        return entry && entry.session.isActive() ? entry.session : null;
    }
    /**
     * @deprecated Use getSessionAsync(). Throws if the default session
     * hasn't been created yet.
     */
    getSession() {
        const session = this.getCurrentSession();
        if (!session) {
            throw new Error("Session not initialized. Call initSession() first.");
        }
        return session;
    }
    async initSession() {
        const session = await this.getSessionAsync();
        if (this.options.record && this.options.record !== 'off') {
            this.startAutoRecording();
        }
        return session;
    }
    startAutoRecording() {
        if (this.autoRecordingId)
            return;
        const recorder = this.recordingManager.createRecording({
            mode: this.options.record,
            outputDir: this.options.recordDir ?? getDefaultRecordDir(),
            format: this.options.recordFormat ?? 'v2',
            idleTimeLimit: this.options.idleTimeLimit ?? 2,
            maxDuration: this.options.maxDuration ?? 3600,
            inactivityTimeout: this.options.inactivityTimeout ?? 600,
        });
        const session = this.getCurrentSession();
        const dimensions = session?.getDimensions() ?? { cols: 80, rows: 25 };
        recorder.start(dimensions.cols, dimensions.rows, {
            SHELL: this.options.shell ?? process.env.SHELL,
            TERM: 'xterm-256color',
        });
        this.autoRecordingId = recorder.id;
    }
    // ---------------------------------------------------------------------------
    // Multi-session API
    // ---------------------------------------------------------------------------
    /**
     * Create a new non-default session.
     */
    async createSession(opts = {}) {
        if (this.sessions.size >= this.maxSessions) {
            throw new Error(`Maximum session limit reached (${this.maxSessions}). ` +
                `Destroy an existing session or raise --max-sessions.`);
        }
        const id = this.generateSessionId();
        const session = await TerminalSession.create({
            ...this.options,
            shell: opts.shell ?? this.options.shell,
            cols: opts.cols ?? this.options.cols,
            rows: opts.rows ?? this.options.rows,
            // Created sessions don't share the interactive startup banner
            startupBanner: undefined,
            sandboxController: this.sandboxController,
        });
        const dims = session.getDimensions();
        const now = new Date().toISOString();
        const metadata = {
            sessionId: id,
            shell: opts.shell ?? this.options.shell ?? process.env.SHELL ?? "/bin/bash",
            cols: dims.cols,
            rows: dims.rows,
            createdAt: now,
            lastActivityAt: now,
            isDefault: false,
        };
        this.sessions.set(id, {
            session,
            metadata,
            lastActivity: Date.now(),
            isDefault: false,
        });
        this.wireRecording(session);
        return metadata;
    }
    destroySession(sessionId) {
        const entry = this.sessions.get(sessionId);
        if (!entry) {
            return { success: false, message: `Session '${sessionId}' not found` };
        }
        if (entry.isDefault) {
            return {
                success: false,
                message: `Session '${sessionId}' is the default session and cannot be destroyed`,
            };
        }
        entry.session.dispose();
        this.sessions.delete(sessionId);
        return { success: true, message: `Session '${sessionId}' destroyed` };
    }
    listSessions() {
        const sessions = [];
        for (const [sessionId, entry] of Array.from(this.sessions.entries())) {
            if (entry.session.isActive()) {
                sessions.push({ ...entry.metadata });
            }
            else {
                this.sessions.delete(sessionId);
            }
        }
        return {
            sessions,
            maxSessions: this.maxSessions,
            sessionIdleTimeout: this.sessionIdleTimeoutMs / 1000,
        };
    }
    /**
     * Resolve a session by ID. If sessionId is omitted/undefined, returns the
     * default session (creating it if needed).
     */
    async resolveSession(sessionId) {
        if (!sessionId) {
            return this.getSessionAsync();
        }
        const entry = this.sessions.get(sessionId);
        if (!entry) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        if (!entry.session.isActive()) {
            this.sessions.delete(sessionId);
            throw new Error(`Session '${sessionId}' is no longer active`);
        }
        this.touchSession(sessionId);
        return entry.session;
    }
    /**
     * Synchronous variant of resolveSession() — requires the session to
     * already exist. Throws if not created yet (used by sync tool handlers).
     */
    resolveSessionSync(sessionId) {
        if (!sessionId) {
            return this.getSession();
        }
        const entry = this.sessions.get(sessionId);
        if (!entry) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        if (!entry.session.isActive()) {
            this.sessions.delete(sessionId);
            throw new Error(`Session '${sessionId}' is no longer active`);
        }
        this.touchSession(sessionId);
        return entry.session;
    }
    // ---------------------------------------------------------------------------
    // Single-session shortcuts (now sessionId-aware)
    // ---------------------------------------------------------------------------
    hasActiveSession() {
        return this.getCurrentSession() !== null;
    }
    write(data, sessionId) {
        this.resolveSessionSync(sessionId).write(data);
    }
    getContent(sessionId) {
        return this.resolveSessionSync(sessionId).getContent();
    }
    getVisibleContent(sessionId) {
        return this.resolveSessionSync(sessionId).getVisibleContent();
    }
    getBufferInfo(sessionId) {
        return this.resolveSessionSync(sessionId).getBufferInfo();
    }
    getAnsiContent(visibleOnly = false, sessionId) {
        return this.resolveSessionSync(sessionId).getAnsiContent(visibleOnly);
    }
    getTerminal(sessionId) {
        return this.resolveSessionSync(sessionId).getTerminal();
    }
    takeScreenshot(sessionId) {
        return this.resolveSessionSync(sessionId).takeScreenshot();
    }
    clear(sessionId) {
        this.resolveSessionSync(sessionId).clear();
    }
    resize(cols, rows, sessionId) {
        this.resolveSessionSync(sessionId).resize(cols, rows);
    }
    getDimensions(sessionId) {
        return this.resolveSessionSync(sessionId).getDimensions();
    }
    /**
     * Update the terminal title prefix for the default session.
     * The shell's precmd hook reads this from a file on each prompt.
     */
    setTitle(title) {
        const session = this.getCurrentSession();
        if (session) {
            session.setTitle(title);
        }
    }
    // ---------------------------------------------------------------------------
    // Recording / lifecycle
    // ---------------------------------------------------------------------------
    getRecordingManager() {
        return this.recordingManager;
    }
    async finalizeRecordings(exitCode) {
        return this.recordingManager.finalizeAll(exitCode);
    }
    dispose() {
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
            this.idleCheckInterval = null;
        }
        for (const [, entry] of this.sessions) {
            entry.session.dispose();
        }
        this.sessions.clear();
        this.defaultSessionId = null;
    }
    async disposeAsync() {
        this.dispose();
        if (this.sandboxController) {
            await this.sandboxController.cleanup();
        }
    }
    getSandboxController() {
        return this.sandboxController;
    }
}
//# sourceMappingURL=manager.js.map