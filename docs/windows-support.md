# Windows Support

This document describes the changes made to support Windows in terminal-toolkit.

## Overview

Terminal-mcp now supports Windows with cmd.exe as the default shell. The following issues were addressed:

## Issues and Solutions

### 1. node-pty Package Compatibility

**Issue:** The original `node-pty-prebuilt-multiarch` package had build/compatibility issues on Windows, and later `@homebridge/node-pty-prebuilt-multiarch` added restrictive Node.js version caps.

**Solution:** Switched to Microsoft's official `node-pty` package which has no engine restrictions and works with newer Node.js versions.

```json
// package.json
"node-pty": "^1.2.0-beta.8"
```

This version includes prebuilt binaries for all platforms (Windows, macOS, Linux) on both x64 and arm64 architectures.

### 2. Socket Path for Windows

**Issue:** Unix sockets (`/tmp/terminal-toolkit.sock`) don't work on Windows.

**Solution:** Use Windows named pipes instead. The `getDefaultSocketPath()` function in `src/utils/platform.ts` returns the appropriate path based on platform:

- **Unix/Mac:** `/tmp/terminal-toolkit.sock`
- **Windows:** `\\.\pipe\terminal-toolkit`

### 3. Default Shell Detection

**Issue:** Need to detect the correct default shell per platform.

**Solution:** The `getDefaultShell()` function in `src/utils/platform.ts` returns:

- **Unix/Mac:** `$SHELL` environment variable or `/bin/bash`
- **Windows:** `cmd.exe`

### 4. Startup Banner Getting Cleared

**Issue:** On Windows, the startup banner printed before the shell started would get cleared/overwritten when cmd.exe initialized.

**Solution:** Platform-specific banner display:

- **Unix/Mac:** Banner is printed via the shell's rc file (bashrc/zshrc) after shell initialization
- **Windows:** Banner is printed to stdout after detecting the first prompt (`⚡`) in the shell output, then sends `\r` (Enter) to get a fresh prompt

```typescript
// src/index.ts
if (isWindows && !bannerShown && data.includes("⚡")) {
  bannerShown = true;
  process.stdout.write("\n" + startupBanner + "\n");
  session.write("\r");  // Send Enter for fresh prompt
}
```

### 5. /info Command Not Working

**Issue:** The `/info` command detection relied on buffering stdin and checking for the command before passing to the shell. On Windows:
- Each character was immediately written to cmd.exe
- By the time Enter was pressed, `/info` was already sent to the shell
- cmd.exe would show: `'/info' is not recognized as an internal or external command`

**Solution:** Removed the `/info` command entirely. Instead:
- MCP configuration is now shown directly in the startup banner
- The banner includes the JSON config that users can copy/paste
- This approach is cleaner and works consistently across all platforms

### 6. Enter Key Handling

**Issue:** On Windows, the Enter key sends `\r` (carriage return), not `\n` (newline).

**Solution:** When triggering a fresh prompt after showing the banner on Windows, use `\r` instead of `\n`:

```typescript
session.write("\r");  // Not "\n"
```

## Platform-Specific Code Paths

### Shell Prompt Setup (`src/terminal/session.ts`)

| Shell | Setup Method |
|-------|-------------|
| bash/sh | Temp rcfile with `--rcfile` flag, includes banner via `printf` |
| zsh | Temp ZDOTDIR with `.zshrc`, includes banner via `printf` |
| PowerShell | `-NoLogo` flag, env var for prompt |
| cmd.exe | `PROMPT` env var set to `⚡ $P$G` |

### Banner Display (`src/index.ts`)

| Platform | Method |
|----------|--------|
| Unix/Mac | Printed via shell rc file during shell startup |
| Windows | Printed to stdout after first prompt appears |

## Testing Checklist

When testing Windows support, verify:

- [ ] `terminal-toolkit` starts without errors
- [ ] Startup banner displays correctly and doesn't get cleared
- [ ] MCP configuration JSON is visible and copyable
- [ ] Fresh prompt appears after banner
- [ ] MCP tools work: `takeScreenshot`, `type`, `sendKey`, `getContent`, `getBufferInfo`
- [ ] Special keys work (Enter, Ctrl+C, arrows, etc.)
- [ ] Terminal resize works
- [ ] Clean exit on shell close
