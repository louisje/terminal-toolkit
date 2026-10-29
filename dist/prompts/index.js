import { ListPromptsRequestSchema, GetPromptRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
const TOOL_USAGE_PROMPT = `# Terminal MCP Tool Usage Guide

## Overview
This MCP server provides tools to interact with a terminal emulator. Use these tools to execute commands and read output.

The terminal session is automatically initialized when the server starts - you can immediately start using tools (type, sendKey, getContent, etc.) without any setup step.

**Do NOT call createSession() first.** A default session already exists and is the implicit target of every tool call that omits \`sessionId\`. createSession() is only for the rare case where you need a SECOND, independent terminal running alongside the default one (e.g. two concurrent processes, or a different shell/size).

## When to prefer this server
Prefer terminal-mcp over plain non-interactive shell tools whenever the command:
- needs sudo or otherwise prompts for a password (the human can type it interactively into this PTY)
- prompts the user for input during execution (ssh login, git push over HTTPS, npm login, etc.)
- runs a TUI (vim, nano, less, more, htop, top, man, kubectl edit, gh pr create)
- needs line-buffered TTY behavior (colors, progress bars, fzf, watch)
- must be observed while still running (long-running build, server, REPL)

## Tools

### type
Send text input to the terminal. Text is written exactly as provided - no Enter key is sent automatically.

To execute a command, use type() followed by sendKey('Enter').

**Example workflow:**
1. type('ls -la') - types the command
2. sendKey('Enter') - executes it
3. getContent() - reads the output

### sendKey
Send a special key or key combination to the terminal.

**Common keys:** Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight

**Navigation:** Home, End, PageUp, PageDown

**Control sequences:**
- Ctrl+C - interrupt current process
- Ctrl+D - EOF/exit
- Ctrl+Z - suspend process
- Ctrl+L - clear screen
- Ctrl+A - move to start of line
- Ctrl+E - move to end of line

**Function keys:** F1-F12

**Repeat:** Use the \`repeat\` parameter (default: 1) to press the same key multiple times in one call. Example: sendKey({ key: "ArrowDown", repeat: 5 })

### getContent
Get terminal content as plain text. Use after sending commands to see output.

**IMPORTANT - Truncation warning:** With no arguments, only the visible viewport (~40 lines) is returned. Command output beyond that is silently lost.

**Rule of thumb:**
- After running any command: use maxLines: 100 or visibleOnly: false to read scrollback
- Checking interactive UI state (prompts, editors, menus): no arguments needed

**Shorthand:** Specifying maxLines alone implies visibleOnly: false. No need to set both.
visibleOnly and maxLines are independent - visibleOnly controls the data source, maxLines caps the line count.

Set delay (milliseconds) to wait before reading - avoids a separate sleep() call.

**Examples:**
- getContent() - viewport only (~40 lines), for checking prompts/UI
- getContent({maxLines: 100}) - last 100 lines from scrollback
- getContent({maxLines: 0}) - full buffer
- getContent({visibleOnly: true, maxLines: 10}) - last 10 lines of viewport

### getBufferInfo
Get lightweight metadata about the terminal buffer as structured JSON.

Returns:
- length: total active buffer lines
- scrollbackLines: lines above the current viewport
- viewportRows: current terminal height in rows

Use this when you need to know how much history is available without reading the buffer text.

**Example with delay:**
1. type('npm install')
2. sendKey('Enter')
3. getContent({visibleOnly: false, delay: 5000}) - waits 5 seconds, then reads scrollback output

### takeScreenshot
Capture terminal state as structured JSON with:
- content: visible text
- cursor: {x, y} position
- dimensions: {cols, rows}

Use when you need cursor position (e.g., for interactive apps, editors) or terminal dimensions. For simple command output, prefer getContent().

### startRecording
Start recording terminal output to an asciicast v2 file for playback with asciinema.

**Returns:** Recording ID and file path

**Example:**
- Start recording: startRecording({mode: 'always'})
- Perform terminal operations
- Stop recording: stopRecording({recordingId: '...'})

### stopRecording
Stop a recording and finalize the asciicast file.

**Arguments:** recordingId (returned from startRecording)

**Returns:** Metadata about the saved recording including file path and duration

### getClipboard
Get the current text content of the system clipboard (OS-wide, not terminal-specific).

Requires a clipboard utility on the host (e.g. xclip/xsel/wl-clipboard on Linux); fails in headless environments without one.

### setClipboard
Set the system clipboard to the given text, overwriting whatever is currently there.

**Arguments:** text (the string to write to the clipboard)

**Note:** This affects the user's OS-wide clipboard, not just the terminal.

### notify
Send an OS-level desktop notification (popup/toast), not terminal output.

Use this when a long-running task finishes, or when you need the user's input/decision, especially if they may not be watching this conversation right now. This is visible even if the user is focused on a different window.

**Arguments:** message (required), title (default: "Terminal MCP"), sound (default: true)

**Note:** Degrades gracefully to a text-only response in headless/CI environments without a desktop notification service - it will not throw an error.
`;
const prompts = [
    {
        name: "tool-usage",
        description: "Instructions for effectively using terminal-mcp tools",
    },
];
export function registerPrompts(server) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts,
    }));
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name } = request.params;
        if (name === "tool-usage") {
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: TOOL_USAGE_PROMPT,
                        },
                    },
                ],
            };
        }
        throw new Error(`Unknown prompt: ${name}`);
    });
}
//# sourceMappingURL=index.js.map