---
name: terminal-toolkit
description: |
  Use terminal-toolkit instead of Bash when the user's real shell matters: its cwd,
  exported environment (including PATH), aliases, and tmux state persist, while
  built-in Bash runs a fresh subprocess. Also prefer it for interactive input,
  observable or risky commands, TUI/TTY programs, or when Bash is unavailable.
---

# Terminal Toolkit: When to Use the User's Real Shell Instead of Bash

## Default rule

When Pi operators are enabled, use `read`, `write`, and `edit` for direct text-file
operations and `shell` for short one-shot, non-interactive commands. These avoid
unnecessary PTY interaction and return their result directly.

Use the PTY/session tools when the user's real shell matters. The five reasons below
are the main cases for switching from the stateless operators to the persistent PTY.
If Pi operators are not exposed by the MCP server, use the agent's own ordinary Bash
facility where available and apply the same decision rule.

## The five reasons to switch

### 1. Environment continuity

terminal-toolkit's PTY tools drive the same session the user has been working in — their
current directory, exported environment variables, shell aliases, and tmux state
all persist across calls. The Pi `shell` operator is a fresh, stateless subprocess using Terminal Toolkit's configured shell every time, as are typical agent-provided Bash tools. If the user just `cd`'d or `export`'d something in their own
terminal and expects the next command to pick that up, switch to terminal-toolkit even
if nothing is technically broken — staying consistent with the user's actual working
state is itself the reason.

### 2. Interactive / credential situations

Whenever a command needs a sudo password, an SSH/login prompt, or any mid-execution
human input (`npm login`, `gh pr create`, `git push` over HTTPS asking for
credentials), proactively switch to terminal-toolkit so the **human types the secret
directly into their own terminal**. Never ask the user to paste a password into
chat, and never try to work around or suppress the prompt.

### 3. Observability / transparency to the user

terminal-toolkit is a terminal the user can literally watch, live. For any sequence of
commands where visibility or trust matters — risky changes, destructive operations,
or anything the user should be able to see happening in real time rather than only
read about afterward in a summary — that's a reason to prefer it, independent of
whether the command technically requires a TTY.

### 4. TUI / TTY requirements

Programs that need a real terminal: `vim`, `less`, `htop`, `kubectl edit`, color
output, progress bars, `fzf`, `watch`, or anything that needs to be observed while
still running. This category is already covered in full detail by the MCP server's
own `instructions` field (delivered to every MCP client on connect) — see
`src/server.ts`'s `SERVER_INSTRUCTIONS` in this repo for the exact, up-to-date list.
Deliberately not re-copied here so this file doesn't drift out of sync with it.

### 5. Built-in Bash is unavailable

When the agent's built-in Bash tool is unavailable, disabled, or cannot execute the
required command, use terminal-toolkit as the fallback terminal instead of stopping solely
because Bash cannot be used.

## Long-running compilation, builds, and tests

Prefer the persistent PTY for lengthy `npm run build`, `cargo build`, `make`, integration tests, or full test suites, even without interactive input. Observe intermediate logs and failures with `getContent` while the process runs. Use `shell` for quick checks and short tests that finish promptly.

## Pi operators

When `--pi-operators` is enabled, four additional tools are exposed:

- `read`: read text files directly; `offset` is a 1-indexed line number.
- `write`: overwrite a text file and create missing parent directories.
- `edit`: exact, unique, non-overlapping string replacement against the original
  file. It is not an append/prepend primitive; include surrounding text when needed
  to anchor insertion at the beginning or end.
- `shell`: run one independent, non-interactive subprocess using Terminal Toolkit's configured shell from
  terminal-toolkit's startup working directory. It waits for completion and returns
  stdout/stderr directly, with an optional timeout. It does not inherit PTY cwd,
  exports, aliases, or other state changed during the terminal session.

Prefer these operators for routine file work and quick one-shot commands. Do not use the
PTY `type` → `getContent` loop merely to emulate what an operator can do directly.

## Session visibility

Only the default session can be directly visible to the user, and only in interactive mode. In headless mode, the default session is not directly visible either. Every additional session created by `createSession()` is a headless PTY: tools can drive its stdin and read its output, but it is never displayed directly in the user's terminal. For commands requiring a human to watch or type a password, use an available user-visible default session. Do not assume an extra session lets the user respond to prompts. A headless PTY is still suitable for long-running builds and tests when only the AI needs to inspect partial output.

## PTY tool workflow

First call `getContent()` without `sessionId` to check whether the default terminal
is already in use. Reuse it only when clearly idle and available. If someone is
using it, a command/TUI is running, or availability is unclear, call
`createSession()` and pass the returned `sessionId` to subsequent terminal calls.
Do not send input or interrupt work in an occupied terminal.

Basic loop in the chosen session: `type(<command>)` → `sendKey('Enter')` → `getContent()` to read the
result. For TUI programs, use `sendKey` for navigation and `takeScreenshot` to
inspect cursor position and on-screen state.

Multi-session: omit `sessionId` to drive the default session, or call
`createSession` for an isolated PTY to run parallel work (e.g. a build in one
session, diagnostics in another). The default session cannot be destroyed.

Default PTY/tool list: `type`, `sendKey`, `sleep`, `getContent`, `getBufferInfo`,
`takeScreenshot`, `startRecording`, `stopRecording`, `createSession`,
`listSessions`, `destroySession`, `resize`, `getClipboard`, `setClipboard`,
`notify` (OS-level desktop notification — useful to alert the user when a
long-running command finishes while they're not watching). With `--pi-operators`,
`read`, `write`, `edit`, and `shell` are additionally available.

## Anti-patterns

- Don't ask the user to paste a sudo/SSH password into chat — switch to
  terminal-toolkit so they type it themselves.
- Don't drive the PTY for routine, invisible one-off commands where none of the five
  reasons above apply — use the Pi `shell` operator when available (or the agent's
  ordinary Bash facility otherwise).
- Don't silently keep using Bash after the user has visibly changed their own shell
  state (cd, export, activating a venv) mid-session — that's the continuity case.

## Codemode (`--codemode`)

This opt-in mode exposes **only one MCP function**, `codemode`. The other Terminal
MCP operators remain available *inside* its QuickJS script as `tools.<name>(args)`;
`--pi-operators` and `--pi-extra-operators` still independently govern which tools
exist. The server instructions continue to explain safe PTY/session selection.

Example (`code` argument to `codemode`):

```javascript
const all = await searchTools(); // all tools, with descriptions
text(all);
const matches = await searchTools("shell", { namespace: "terminal", limit: 5 });
text(matches);
text(await describeNamespace("terminal")); // instructions and tool descriptions
const shell = await describeTool("shell"); // null unless --pi-operators is enabled
text(shell?.inputSchema);
// In an operator-enabled connection:
// text(await tools.shell({ command: "git status --short" }));
```

`searchTools()` lists all currently available tools with names, namespaces, and
descriptions; pass a query to filter the results. `describeNamespace("terminal")`
provides namespace instructions and available tools with descriptions.
`describeTool(name)` provides the tool-specific instruction and input schema,
without repeating the description already available during discovery. Use
descriptions to discover tools and instructions to learn how to invoke them.
Only `text()`, `image()`, explicit return values and errors are returned to the
agent; do not dump large intermediate results. Use `Promise.allSettled()` for
independent calls where partial failures are acceptable. QuickJS has no direct
filesystem/network access, but injected tools retain their host permissions.
A new JavaScript execution starts for each call; terminal sessions persist.

The package requires Node.js >=22.19.0. The Claude Code plugin launcher is
`bootstrap.cjs`, and the bundled Worker/WASM assets belong alongside
`dist/index.js`. The MCP client may enable Codemode by passing `--codemode`
to the existing server command.

Cancellation cannot undo a completed file edit or a command's side effects.
A stopped script also does not imply that a PTY session has been terminated.
