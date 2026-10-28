# Tools Reference

Terminal Toolkit exposes PTY tools and optional Pi-style operators. This document describes the terminal tools and the optional stateless shell operator.

## Overview

| Tool | Description |
|------|-------------|
| [`type`](#type) | Send text input to the terminal |
| [`sendKey`](#sendkey) | Send special keys and key combinations |
| [`sleep`](#sleep) | Block execution for long-running operations (builds, downloads) |
| [`getContent`](#getcontent) | Retrieve terminal buffer content |
| [`getBufferInfo`](#getbufferinfo) | Retrieve terminal buffer metadata |
| [`takeScreenshot`](#takescreenshot) | Capture terminal state with metadata |
| [`startRecording`](#startrecording) | Start recording terminal output |
| [`stopRecording`](#stoprecording) | Stop recording and save file |

---

## Session visibility

The default session may be directly visible to the human in interactive mode, but not in headless mode. Sessions created with `createSession()` are always headless PTYs. They support interactive terminal tools but do not display output or prompts directly to the user. Use a free user-visible default session for direct human interaction, and extra headless sessions for isolated/parallel work and AI-observed builds.

## shell (optional: `--pi-operators`)

Runs one non-interactive command in a fresh subprocess using the configured Terminal Toolkit shell, **not necessarily Bash**. It uses the server startup working directory, not the current PTY directory. The call waits until the command finishes and does not retain environment variables, aliases, or cwd across invocations.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `command` | string | Yes | Command to run |
| `timeout` | number | No | Timeout in seconds |

Returns stdout/stderr, with a tool error for failed exit, timeout, or output overflow. Prefer for quick checks and short tests. **Use PTY for long-running compiles, builds, and test suites** even without interaction, so progress and intermediate failures remain observable. PTY is also appropriate for TUI programs, prompts, and persistent shell state.

In codemode, invoke `await tools.shell({command: "git status --short"})`. This operator is exposed only when `--pi-operators` is enabled.

---

## type

Send text input to the terminal, simulating keyboard typing.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | The text to type into the terminal |

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "Typed N character(s) to terminal"
    }
  ]
}
```

### Example

**Request:**
```json
{
  "name": "type",
  "arguments": {
    "text": "ls -la"
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Typed 6 character(s) to terminal"
    }
  ]
}
```

### Notes

- Text is written directly to the PTY without any interpretation
- Does not automatically press Enter; use `sendKey` with "Enter" to execute commands
- Can include newlines (`\n`) and tabs (`\t`) in the text
- For special keys like Ctrl+C, use `sendKey` instead

---

## sendKey

Send special keys or key combinations to the terminal.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | Yes | - | The key name to send |
| `repeat` | number | No | `1` | Number of times to repeat the key |

### Available Keys

#### Control Keys
| Key | Description |
|-----|-------------|
| `Enter` | Enter/Return key |
| `Tab` | Tab key |
| `Escape` | Escape key |
| `Backspace` | Backspace key |
| `Delete` | Delete key |

#### Arrow Keys
| Key | Description |
|-----|-------------|
| `ArrowUp` | Up arrow |
| `ArrowDown` | Down arrow |
| `ArrowLeft` | Left arrow |
| `ArrowRight` | Right arrow |

#### Navigation Keys
| Key | Description |
|-----|-------------|
| `Home` | Home key |
| `End` | End key |
| `PageUp` | Page Up |
| `PageDown` | Page Down |
| `Insert` | Insert key |

#### Function Keys
| Key | Description |
|-----|-------------|
| `F1` - `F12` | Function keys 1-12 |

#### Ctrl Combinations
| Key | Description |
|-----|-------------|
| `Ctrl+A` - `Ctrl+Z` | Control key combinations |
| `Ctrl+C` | Interrupt signal (SIGINT) |
| `Ctrl+D` | End of file / logout |
| `Ctrl+L` | Clear screen |
| `Ctrl+Z` | Suspend process (SIGTSTP) |
| `Ctrl+[` | Escape (alternative) |
| `Ctrl+\\` | Quit signal (SIGQUIT) |
| `Ctrl+Space` | Null character |

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "Sent key: KeyName"
    }
  ]
}
```

### Example

**Request:**
```json
{
  "name": "sendKey",
  "arguments": {
    "key": "Ctrl+C"
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Sent key: Ctrl+C"
    }
  ]
}
```

**Repeat example (press ArrowDown 5 times):**
```json
{
  "name": "sendKey",
  "arguments": {
    "key": "ArrowDown",
    "repeat": 5
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Sent key: ArrowDown (repeated 5 times)"
    }
  ]
}
```

### Error Handling

If an unknown key is provided:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Unknown key: \"InvalidKey\". Available keys include: Enter, Tab, Escape, ..."
    }
  ],
  "isError": true
}
```

---

## getContent

Retrieve the terminal buffer content as plain text.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `visibleOnly` | boolean | No | `true` | If true, return only the visible viewport |
| `maxLines` | number | No | `100` | Maximum number of lines to return when `visibleOnly` is `false`. Set to `0` to return the full buffer |
| `delay` | number | No | `0` | Delay in milliseconds before getting content. Use as shortcut to avoid separate sleep() call |

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "Terminal content here..."
    }
  ]
}
```

### Example

**Request (scrollback, last 100 lines by default):**
```json
{
  "name": "getContent",
  "arguments": {
    "visibleOnly": false
  }
}
```

**Request (full scrollback):**
```json
{
  "name": "getContent",
  "arguments": {
    "visibleOnly": false,
    "maxLines": 0
  }
}
```

**Request (visible viewport only):**
```json
{
  "name": "getContent",
  "arguments": {
    "visibleOnly": true
  }
}
```

**Request (with delay for slow commands):**
```json
{
  "name": "getContent",
  "arguments": {
    "delay": 2000
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "user@host:~$ ls -la\ntotal 48\ndrwxr-xr-x  12 user user 4096 Jan 22 10:00 .\n..."
    }
  ]
}
```

### Notes

- Returns `"(empty terminal)"` if the terminal is empty
- By default, returns only the visible viewport (up to terminal height)
- Set `visibleOnly: false` to read from scrollback history; by default this returns only the last `100` lines
- Set `maxLines: 0` with `visibleOnly: false` to include the full scrollback history (up to 1000 lines)
- Trailing empty lines are trimmed from the output
- `maxLines` is ignored when `visibleOnly: true`
- **delay parameter**: Use to wait briefly before reading output, avoiding extra tool call. Common for commands that need time to produce output

---

## getBufferInfo

Retrieve metadata about the current terminal buffer without returning the buffer text itself.

### Parameters

None.

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"length\": 125,\n  \"scrollbackLines\": 100,\n  \"viewportRows\": 25\n}"
    }
  ]
}
```

The text content is a JSON string with the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `length` | number | Total active buffer lines, including scrollback and viewport |
| `scrollbackLines` | number | Number of lines above the visible viewport |
| `viewportRows` | number | Current viewport height in terminal rows |

### Example

**Request:**
```json
{
  "name": "getBufferInfo",
  "arguments": {}
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"length\": 125,\n  \"scrollbackLines\": 100,\n  \"viewportRows\": 25\n}"
    }
  ]
}
```

### Notes

- Use this when you only need buffer size metadata, not the actual terminal text
- `length` is a raw buffer metric and may include blank lines in the active buffer
- `scrollbackLines` excludes the currently visible viewport
- `viewportRows` matches the current terminal height

---

## takeScreenshot

Capture the current terminal state. Supports three output formats for different use cases.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | string | No | `text` | Output format: `text`, `ansi`, or `png` |

### Formats

#### `text` (default)

Returns plain text content with cursor position and dimensions. Color information is stripped.

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"content\": \"user@host:~$ █\",\n  \"cursor\": { \"x\": 14, \"y\": 0 },\n  \"dimensions\": { \"cols\": 120, \"rows\": 40 }\n}"
    }
  ]
}
```

#### `ansi`

Returns content with ANSI color escape codes preserved. Reconstructs SGR sequences from the terminal's cell buffer, supporting 16-color, 256-color, 24-bit truecolor, bold, dim, italic, and underline attributes.

**Request:**
```json
{
  "name": "takeScreenshot",
  "arguments": { "format": "ansi" }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"content\": \"\\u001b[31mERROR\\u001b[0m: file not found\",\n  \"cursor\": { \"x\": 0, \"y\": 1 },\n  \"dimensions\": { \"cols\": 120, \"rows\": 40 }\n}"
    }
  ]
}
```

#### `png`

Returns a color screenshot as a PNG image with full ANSI color rendering, One Dark theme, and macOS-style window chrome. Requires `@resvg/resvg-js` to be installed.

**Request:**
```json
{
  "name": "takeScreenshot",
  "arguments": { "format": "png" }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "image",
      "data": "<base64-encoded PNG>",
      "mimeType": "image/png"
    }
  ]
}
```

### Response Fields (text and ansi formats)

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Visible terminal content (plain or ANSI-colored) |
| `cursor.x` | number | Cursor column position (0-indexed) |
| `cursor.y` | number | Cursor row position (0-indexed) |
| `dimensions.cols` | number | Terminal width in columns |
| `dimensions.rows` | number | Terminal height in rows |

### Use Cases

- **`text`**: Read command output, check cursor position, verify dimensions
- **`ansi`**: Capture colored output for logs, diagnostics, or re-rendering in a terminal
- **`png`**: Generate visual screenshots for documentation, sharing, or visual verification

---

## sleep

Blocking pause operation for extended durations. **Use ONLY when absolutely necessary** for long-running processes. Avoid frequent calls.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `milliseconds` | number | No | Number of milliseconds to sleep. Defaults to `5000` (5 seconds). |

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "Slept for 5 seconds"
    }
  ]
}
```

### Example

**Request:**
```json
{
  "name": "sleep",
  "arguments": {
    "milliseconds": 10000
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Slept for 10 seconds"
    }
  ]
}
```

### Notes

- **Use sparingly**: Only for genuine long-running operations (builds, installations, downloads)
- **Not for fast commands**: Commands like `ls`, `pwd`, `cd` complete instantly
- **Not after autoSubmit**: `type()` with `autoSubmit=true` already includes a brief wait
- **Indicator of problems**: Frequent `sleep()` calls suggest architectural issues

---

## startRecording

Start recording terminal output to an asciicast v2 file. Only one recording can be active at a time.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | string | No | `v2` | Recording format (asciicast v2) |
| `mode` | string | No | `always` | `always` or `on-failure` |
| `outputDir` | string | No | XDG default | Directory to save recording |
| `idleTimeLimit` | number | No | `2` | Max seconds between events |

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"recordingId\": \"63f64b587bd8817a\",\n  \"path\": \"/Users/you/.local/state/terminal-toolkit/recordings/terminal-1769449938208-63f64b587bd8817a.cast\",\n  \"format\": \"v2\",\n  \"mode\": \"always\"\n}"
    }
  ]
}
```

### Example

**Request:**
```json
{
  "name": "startRecording",
  "arguments": {}
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"recordingId\": \"63f64b587bd8817a\",\n  \"path\": \"/Users/you/.local/state/terminal-toolkit/recordings/terminal-1769449938208-63f64b587bd8817a.cast\",\n  \"format\": \"v2\",\n  \"mode\": \"always\"\n}"
    }
  ]
}
```

### Error Handling

If a recording is already active:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"error\": \"A recording is already in progress\",\n  \"activeRecordingId\": \"abc123\",\n  \"activePath\": \"/path/to/recording.cast\"\n}"
    }
  ],
  "isError": true
}
```

### Notes

- Only one recording can be active at a time
- Default output directory: `~/.local/state/terminal-toolkit/recordings/`
- Override with `TERMINAL_TOOLKIT_RECORD_DIR` environment variable
- See [Recording Documentation](recording.md) for full details

---

## stopRecording

Stop an active recording and finalize the asciicast file.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `recordingId` | string | Yes | The recording ID returned by `startRecording` |

### Returns

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"recordingId\": \"63f64b587bd8817a\",\n  \"path\": \"/path/to/recording.cast\",\n  \"durationMs\": 62186,\n  \"bytesWritten\": 11752,\n  \"saved\": true,\n  \"mode\": \"always\"\n}"
    }
  ]
}
```

### Example

**Request:**
```json
{
  "name": "stopRecording",
  "arguments": {
    "recordingId": "63f64b587bd8817a"
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"recordingId\": \"63f64b587bd8817a\",\n  \"path\": \"/Users/you/.local/state/terminal-toolkit/recordings/terminal-1769449938208-63f64b587bd8817a.cast\",\n  \"durationMs\": 62186,\n  \"bytesWritten\": 11752,\n  \"saved\": true,\n  \"mode\": \"always\"\n}"
    }
  ]
}
```

### Error Handling

If recording not found:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Recording not found: invalid-id"
    }
  ],
  "isError": true
}
```

If recording already finalized:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Recording already finalized: 63f64b587bd8817a"
    }
  ],
  "isError": true
}
```

### Notes

- The recording file is written to disk when `stopRecording` is called
- If `mode` is `on-failure`, the file is only saved if exit code is non-zero
- A metadata file (`.meta.json`) is also created alongside the recording
- See [Recording Documentation](recording.md) for full details

---

## Error Handling

All tools return errors in a consistent format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Description of what went wrong"
    }
  ],
  "isError": true
}
```

### Common Errors

| Error | Cause |
|-------|-------|
| `Terminal session has been disposed` | The terminal session was closed |
| `Unknown key: "..."` | Invalid key name passed to `sendKey` |
| `Unknown tool: "..."` | Tool name not recognized |

---

## Tool Workflow Examples

### Running a Command

```
1. type: {"text": "echo hello world"}
2. sendKey: {"key": "Enter"}
3. getContent: {}  // Read the output
```

### Navigating a TUI Application

```
1. type: {"text": "htop"}
2. sendKey: {"key": "Enter"}
3. takeScreenshot: {}  // See the interface
4. sendKey: {"key": "ArrowDown"}  // Navigate
5. sendKey: {"key": "F10"}  // Quit
```

### Interrupting a Running Process

```
1. type: {"text": "sleep 100"}
2. sendKey: {"key": "Enter"}
3. sendKey: {"key": "Ctrl+C"}  // Interrupt
4. getContent: {}  // Verify interrupted
```

### Recording a Session

```
1. startRecording: {}
   → Returns recordingId: "abc123"

2. type: {"text": "echo 'Demo recording'"}
3. sendKey: {"key": "Enter"}
4. getContent: {}

5. stopRecording: {"recordingId": "abc123"}
   → Recording saved to ~/.local/state/terminal-toolkit/recordings/

6. Play with: asciinema play <path-to-recording.cast>
```
