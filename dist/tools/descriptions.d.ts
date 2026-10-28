/**
 * Shared tool descriptions to avoid duplication
 */
export declare const SESSION_ID_DESCRIPTION = "Target session ID. Omit to use the default session, which is already running \u2014 no need to call createSession first.";
export declare const TOOL_DESCRIPTIONS: {
    readonly type: {
        readonly main: "Send text input to the terminal. Use autoSubmit=true to execute commands in one call (recommended). Alternative: type text without autoSubmit, then use sendKey('Enter') for manual control. IMPORTANT: In zsh, avoid '!' inside double quotes - use single quotes instead (e.g., echo 'Hello!' not echo \"Hello!\").";
        readonly text: "The text to type into the terminal";
        readonly autoSubmit: "If true, automatically send Enter and return terminal content. Recommended for most commands.";
    };
    readonly sendKey: {
        readonly main: "Send a special key to the terminal (e.g., enter, tab, ctrl+c)";
        readonly key: "The key to send (e.g., enter, tab, escape, up, down, left, right, ctrl+c, ctrl+d)";
        readonly repeat: "Number of times to repeat the key (default: 1). Useful for pressing arrow keys or similar multiple times in one call.";
    };
    readonly sleep: {
        readonly main: "Pause execution for an extended duration. This is a BLOCKING operation - use ONLY when absolutely necessary for long-running processes (builds, installations, downloads) or waiting for slow background tasks. AVOID frequent calls. Not needed after autoSubmit or for fast commands.";
        readonly milliseconds: "Number of milliseconds to sleep (default: 5000 = 5 seconds). Use for operations that genuinely require waiting, not as a workaround.";
    };
    readonly getContent: {
        readonly main: "Get the current content of the terminal buffer. WARNING: Default visibleOnly=true only returns the viewport (~25 lines) and will truncate command output. Use visibleOnly=false or specify maxLines after running any command that produces output to avoid missing content.";
        readonly visibleOnly: "Controls data source: true = visible viewport only, false = full scrollback buffer. If omitted, defaults to true unless maxLines is specified (which implies false). Both visibleOnly and maxLines can be combined: e.g. visibleOnly=true with maxLines=10 returns the last 10 viewport lines.";
        readonly maxLines: "Maximum number of lines to return (default: 100 when reading scrollback). Applies to both viewport and scrollback content. Specifying maxLines alone automatically reads from scrollback. Set to 0 to return all lines.";
        readonly delay: "Optional delay in milliseconds before getting content (default: 0). Use this as a shortcut to avoid separate sleep() call when you need to wait briefly before reading output.";
    };
    readonly getBufferInfo: {
        readonly main: "Get metadata about the current terminal buffer, including total length, scrollback lines, and viewport rows";
    };
    readonly takeScreenshot: {
        readonly main: "Take a screenshot of the terminal showing current screen and cursor position";
    };
    readonly startRecording: {
        readonly main: "Start recording terminal output to an asciicast v2 file. Returns the recording ID and path where the file will be saved. Only one recording can be active at a time.";
        readonly format: "Recording format (default: v2, asciicast v2 format)";
        readonly mode: "Recording mode: always saves the recording, on-failure only saves if session exits with non-zero code (default: always)";
        readonly outputDir: "Directory to save the recording (default: ~/.local/state/terminal-toolkit/recordings, or TERMINAL_TOOLKIT_RECORD_DIR env var)";
        readonly idleTimeLimit: "Max seconds between events in the recording (default: 2). Caps idle time to prevent long pauses during playback.";
        readonly maxDuration: "Max recording duration in seconds (default: 3600 = 60 minutes). Recording will auto-stop when this limit is reached.";
        readonly inactivityTimeout: "Stop recording after N seconds of no terminal output (default: 600 = 10 minutes). Resets on each output event.";
    };
    readonly stopRecording: {
        readonly main: "Stop a recording and finalize the asciicast file. Returns metadata about the saved recording including the file path and duration.";
        readonly recordingId: "The recording ID returned by startRecording";
    };
    readonly getClipboard: {
        readonly main: "Get the current text content of the system clipboard (OS-wide, not terminal-specific). Requires a clipboard utility to be available on the host (e.g. xclip/xsel/wl-clipboard on Linux); fails in headless environments without one.";
    };
    readonly setClipboard: {
        readonly main: "Set the system clipboard to the given text, overwriting whatever is currently there. This affects the user's OS-wide clipboard, not just the terminal. Requires a clipboard utility to be available on the host (e.g. xclip/xsel/wl-clipboard on Linux); fails in headless environments without one.";
        readonly text: "The text to write to the clipboard";
    };
    readonly notify: {
        readonly main: "Send a desktop notification (OS-level popup/toast, not terminal output) to alert the human. Use this when a long-running task finishes, or when you need the user's input/decision and they may not be watching this conversation. Unlike terminal output, this is visible even if the user is focused on a different window or away from the screen. Silently degrades to a text-only response (no error thrown) in headless/CI environments without a desktop notification service.";
        readonly message: "The notification body text (e.g. 'Build finished' or 'Need your input: which option do you want?')";
        readonly title: "The notification title (default: 'Terminal Toolkit')";
        readonly sound: "Whether to play the OS notification sound (default: true). Set to false for quieter, less intrusive notifications.";
    };
};
//# sourceMappingURL=descriptions.d.ts.map