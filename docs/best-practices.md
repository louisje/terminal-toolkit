# Terminal Toolkit Best Practices

## Choose PTY or stateless shell

With `--pi-operators`, prefer `shell({command: "git status --short"})` for quick, non-interactive one-off commands and short tests. The configured shell may be Bash, zsh, or another shell; each invocation is a fresh process and does not inherit PTY state.

Prefer PTY (`type` and `getContent`) for lengthy compiles, builds, and test suites, **even when they do not request user input**. PTY lets you inspect partial output, failure details, and progress while the command is still running. It is also required for interactive prompts, TUIs, and ongoing shell state. Use `read`, `write`, and `edit` for direct text-file operations.

## 🎯 Quick Guide for Efficient Usage

### ⭐ Use `autoSubmit` for Command Execution

**RECOMMENDED:** Execute commands in a single call with `autoSubmit: true`

```typescript
// ✅ Good: One call, instant result
type({ text: "uptime", autoSubmit: true })

// ❌ Avoid: Multiple calls for simple commands
type({ text: "uptime" })
sendKey({ key: "Enter" })
sleep({ milliseconds: 2000 })  // Unnecessary!
getContent()
```

### ⚡ Minimize Sleep Time

Most commands complete **instantly** - don't sleep unnecessarily!

```typescript
// ✅ Good: No sleep needed for fast commands
type({ text: "pwd", autoSubmit: true })
type({ text: "ls -la", autoSubmit: true })
type({ text: "uptime", autoSubmit: true })

// ❌ Bad: Wasting time on fast commands
type({ text: "pwd", autoSubmit: true })
sleep({ milliseconds: 2000 })  // Why sleep for pwd?
```

### 📊 When to Use Each Tool

| Tool | Best Use Case | Avoid |
|------|---------------|-------|
| `type(cmd, autoSubmit=true)` | Execute any command | Adding unnecessary `sleep()` after |
| `type(text)` + `sendKey()` | Interactive input, multi-step | Simple one-off commands |
| `sleep(N)` | Long builds, downloads | After every command |
| `getContent()` | Manual content check | After `autoSubmit=true` (already returns content) |

### ✅ When to Use `sleep()`

**Use `sleep()` ONLY for:**
- 🔨 Build processes: `npm run build`, `make`, `cargo build`
- 📦 Package installations: `npm install`, `pip install`, `brew install`
- 🌐 Downloads: `curl`, `wget`, long file transfers
- ⏳ Background tasks that genuinely take time
- 🤔 Operations where timing is critical

**DON'T use `sleep()` for:**
- ❌ Fast commands: `ls`, `pwd`, `cd`, `echo`, `cat`, `uptime`
- ❌ After `type(cmd, autoSubmit=true)` - it already waits 250ms
- ❌ As a workaround - frequent `sleep()` calls indicate a problem

### 🚀 Example: Efficient Workflow

```typescript
// ✅ Efficient: 3 commands, ~300ms total
type({ text: "pwd", autoSubmit: true })
type({ text: "ls -la", autoSubmit: true })
type({ text: "uptime", autoSubmit: true })

// ❌ Inefficient: 3 commands + 6 seconds of sleeping
type({ text: "pwd", autoSubmit: true })
sleep({ milliseconds: 2000 })  // Wasted 2 seconds
type({ text: "ls -la", autoSubmit: true })
sleep({ milliseconds: 2000 })  // Wasted 2 seconds
type({ text: "uptime", autoSubmit: true })
sleep({ milliseconds: 2000 })  // Wasted 2 seconds
```

### 💡 Special Cases

**Interactive Input (e.g., password prompts):**
```typescript
// Don't use autoSubmit for interactive prompts
type({ text: "sudo something" })
sendKey({ key: "Enter" })
sleep({ milliseconds: 1000 })  // Sleep for prompt to appear
type({ text: "password" })
sendKey({ key: "Enter" })
```

**Long-running Process:**
```typescript
// Use autoSubmit, then sleep appropriately
type({ text: "npm install", autoSubmit: true })
sleep({ milliseconds: 30000 })  // Justified - installation takes time

type({ text: "npm run build", autoSubmit: true })
sleep({ milliseconds: 10000 })  // Justified - build takes time
```

**Multi-line Input:**
```typescript
// Type multiple lines without executing
type({ text: "cat > file.txt" })
sendKey({ key: "Enter" })
type({ text: "Line 1" })
sendKey({ key: "Enter" })
type({ text: "Line 2" })
sendKey({ key: "Enter" })
sendKey({ key: "Ctrl+D" })  // EOF
```

## 📈 Performance Impact

Using `autoSubmit` and avoiding unnecessary `sleep()` can dramatically improve efficiency:

| Approach | Time | Tool Calls |
|----------|------|------------|
| With `autoSubmit`, no unnecessary sleeps | ~100ms | 1 |
| Without `autoSubmit`, with sleeps | ~2-5s | 3-4 |

**Speed improvement: 20-50x faster!** ⚡

## 🎓 Summary

1. **Default to `autoSubmit: true`** for command execution
2. **Only use `sleep()` when commands genuinely require extended time**
3. **Don't sleep after `autoSubmit`** - it already includes a brief wait (250ms)
4. **Save time by avoiding unnecessary tool calls**

Happy terminal automation! 🚀
