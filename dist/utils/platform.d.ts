/**
 * Get the default recording directory.
 * Uses XDG_STATE_HOME or falls back to ~/.local/state/terminal-toolkit/recordings.
 * Can be overridden with TERMINAL_TOOLKIT_RECORD_DIR environment variable.
 */
export declare function getDefaultRecordDir(): string;
/**
 * Get the default IPC path for cross-platform communication.
 * Uses named pipes on Windows, Unix sockets elsewhere.
 * Can be overridden with TERMINAL_TOOLKIT_SOCKET environment variable.
 */
export declare function getDefaultSocketPath(): string;
/**
 * Resolve the IPC path, allowing a CLI-provided path to override env/defaults.
 */
export declare function resolveSocketPath(socketPath?: string): string;
/**
 * Get the default terminal columns.
 * Priority: TERMINAL_TOOLKIT_COLS env var → fallback (120).
 */
export declare function getDefaultCols(): number;
/**
 * Get the default terminal rows.
 * Priority: TERMINAL_TOOLKIT_ROWS env var → fallback (40).
 */
export declare function getDefaultRows(): number;
/**
 * Get the default shell for the current platform.
 * Priority: TERMINAL_TOOLKIT_SHELL → SHELL/COMSPEC → fallback.
 */
export declare function getDefaultShell(): string;
//# sourceMappingURL=platform.d.ts.map