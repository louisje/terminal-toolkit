import * as pty from "node-pty";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
import { getDefaultShell } from "../utils/platform.js";
// Custom prompt indicator for terminal-mcp.
// Includes "mcp" so it's unmistakable — many shell themes (oh-my-zsh,
// starship, etc.) already use ⚡ on its own and a bare lightning bolt
// would blend in. Used both as the rendered text and as the idempotency
// sentinel by the precmd hook.
const PROMPT_INDICATOR = "⚡ mcp";
/**
 * Terminal session that combines node-pty with xterm.js headless
 * for full terminal emulation
 */
export class TerminalSession {
    ptyProcess;
    terminal;
    disposed = false;
    dataListeners = [];
    exitListeners = [];
    resizeListeners = [];
    rcFile = null;
    zdotdir = null;
    titleFile = null;
    /**
     * Private constructor - use TerminalSession.create() instead
     */
    constructor() { }
    /**
     * Factory method to create a TerminalSession
     * Use this instead of the constructor to support async sandbox initialization
     */
    static async create(options = {}) {
        const session = new TerminalSession();
        await session.initialize(options);
        return session;
    }
    /**
     * Set up shell-specific prompt customization
     * Returns args to pass to shell and env modifications
     */
    setupShellPrompt(shellName, extraEnv, startupBanner, login) {
        const env = {
            TERMINAL_MCP: "1",
            ...extraEnv,
        };
        // Escape banner for use in shell scripts
        const escapeBannerForShell = (banner) => {
            // Escape single quotes and backslashes for shell
            return banner.replace(/'/g, "'\\''");
        };
        if (shellName === "bash" || shellName === "sh") {
            // Create temp rcfile that sources user's config then prepends our marker
            // to PS1 every prompt (so themes that rebuild PS1 in PROMPT_COMMAND can't
            // clobber it) and sets the terminal title.
            //
            // In login mode, source ~/.bash_profile (or ~/.bash_login or ~/.profile)
            // like a real login shell would. In non-login mode, source ~/.bashrc.
            const homeDir = os.homedir();
            const bannerCmd = startupBanner ? `printf '%s\\n' '${escapeBannerForShell(startupBanner)}'` : "";
            this.titleFile = path.join(os.tmpdir(), `terminal-mcp-title-${process.pid}`);
            fs.writeFileSync(this.titleFile, "terminal-mcp");
            let sourceUserConfig;
            if (login) {
                // Mimic bash login shell sourcing order:
                // /etc/profile, then first of ~/.bash_profile, ~/.bash_login, ~/.profile
                sourceUserConfig = `
[ -f /etc/profile ] && source /etc/profile
if [ -f "${homeDir}/.bash_profile" ]; then
  source "${homeDir}/.bash_profile"
elif [ -f "${homeDir}/.bash_login" ]; then
  source "${homeDir}/.bash_login"
elif [ -f "${homeDir}/.profile" ]; then
  source "${homeDir}/.profile"
fi`;
            }
            else {
                sourceUserConfig = `
# Source user's bashrc if it exists
[ -f "${homeDir}/.bashrc" ] && source "${homeDir}/.bashrc"`;
            }
            const bashrcContent = `
${sourceUserConfig}
# Title file for dynamic title updates from MCP clients
_TERMINAL_MCP_TITLE_FILE="${this.titleFile}"
# Set initial terminal title
printf '\\033]0;[terminal-mcp]\\a'
# Prepend a marker to PS1 every prompt and refresh the title.
# Re-runs each PROMPT_COMMAND so themes that rebuild PS1 keep the marker.
_terminal_mcp_prompt_marker() {
  local _title="terminal-mcp"
  [ -f "\$_TERMINAL_MCP_TITLE_FILE" ] && _title="\$(< "\$_TERMINAL_MCP_TITLE_FILE")"
  printf '\\033]0;[%s] %s\\a' "\$_title" "\${PWD/#$HOME/'~'}"
  case "$PS1" in
    *"${PROMPT_INDICATOR}"*) ;;
    *) PS1="\\[\\033[30;43m\\] ${PROMPT_INDICATOR} \\[\\033[0m\\] $PS1" ;;
  esac
}
case "\${PROMPT_COMMAND:-}" in
  *_terminal_mcp_prompt_marker*) ;;
  *) PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND; }_terminal_mcp_prompt_marker" ;;
esac
# Print startup banner
${bannerCmd}
`;
            this.rcFile = path.join(os.tmpdir(), `terminal-mcp-bashrc-${process.pid}`);
            fs.writeFileSync(this.rcFile, bashrcContent);
            return { args: ["--rcfile", this.rcFile], env };
        }
        if (shellName === "zsh") {
            // Create temp ZDOTDIR with .zshrc that sources user's config then registers
            // a precmd hook (running LAST) that prepends our marker. This survives
            // theme regenerators like powerlevel10k / starship that rebuild PROMPT
            // every precmd.
            const homeDir = os.homedir();
            this.zdotdir = path.join(os.tmpdir(), `terminal-mcp-zsh-${process.pid}`);
            fs.mkdirSync(this.zdotdir, { recursive: true });
            if (!this.titleFile) {
                this.titleFile = path.join(os.tmpdir(), `terminal-mcp-title-${process.pid}`);
                fs.writeFileSync(this.titleFile, "terminal-mcp");
            }
            const bannerCmd = startupBanner ? `printf '%s\\n' '${escapeBannerForShell(startupBanner)}'` : "";
            // In login mode, create .zprofile to source user's login configs
            if (login) {
                const zprofileContent = `
# Source system zprofile
[ -f /etc/zprofile ] && source /etc/zprofile
# Source user's zprofile if it exists
[ -f "${homeDir}/.zprofile" ] && source "${homeDir}/.zprofile"
`;
                fs.writeFileSync(path.join(this.zdotdir, ".zprofile"), zprofileContent);
            }
            const zshrcContent = `
# Reset ZDOTDIR so nested zsh uses normal config
export ZDOTDIR="${homeDir}"
# Source user's zshrc if it exists
[ -f "${homeDir}/.zshrc" ] && source "${homeDir}/.zshrc"
# Title file for dynamic title updates from MCP clients
_TERMINAL_MCP_TITLE_FILE="${this.titleFile}"
# Set initial terminal title
print -Pn '\\e]0;[terminal-mcp]\\a'
# Prepend a marker to PROMPT every precmd and refresh the title.
# Registers AFTER user's zshrc so this hook fires after p10k/starship
# regenerate PROMPT.
autoload -Uz add-zsh-hook
_terminal_mcp_prompt_marker() {
  local _title="terminal-mcp"
  [ -f "\$_TERMINAL_MCP_TITLE_FILE" ] && _title="\$(< "\$_TERMINAL_MCP_TITLE_FILE")"
  print -Pn "\\e]0;[\$_title] %~\\a"
  if [[ "$PROMPT" != *"${PROMPT_INDICATOR}"* ]]; then
    PROMPT="%K{yellow}%F{black} ${PROMPT_INDICATOR} %f%k $PROMPT"
  fi
}
add-zsh-hook precmd _terminal_mcp_prompt_marker
# Print startup banner
${bannerCmd}
`;
            fs.writeFileSync(path.join(this.zdotdir, ".zshrc"), zshrcContent);
            // In login mode, also create .zlogin to source user's .zlogin
            if (login) {
                const zloginContent = `
[ -f "${homeDir}/.zlogin" ] && source "${homeDir}/.zlogin"
`;
                fs.writeFileSync(path.join(this.zdotdir, ".zlogin"), zloginContent);
            }
            env.ZDOTDIR = this.zdotdir;
            // Pass -l to zsh in login mode so it reads .zprofile and .zlogin
            return { args: login ? ["-l"] : [], env };
        }
        // PowerShell (pwsh is PowerShell Core, powershell is Windows PowerShell)
        if (shellName === "powershell" ||
            shellName === "powershell.exe" ||
            shellName === "pwsh" ||
            shellName === "pwsh.exe") {
            env.TERMINAL_MCP_PROMPT = "1";
            return { args: ["-NoLogo"], env };
        }
        // Windows cmd.exe
        if (shellName === "cmd" || shellName === "cmd.exe") {
            env.PROMPT = `$E[30;43m ${PROMPT_INDICATOR} $E[0m $P$G `;
            return { args: [], env };
        }
        // For other shells, just set env vars and hope for the best
        env.PS1 = `${PROMPT_INDICATOR}$ `;
        return { args: [], env };
    }
    /**
     * Initialize the terminal session
     * This is called by the create() factory method
     */
    async initialize(options) {
        const cols = options.cols ?? 80;
        const rows = options.rows ?? 25;
        const shell = options.shell ?? getDefaultShell();
        // Create headless terminal emulator
        this.terminal = new Terminal({
            cols,
            rows,
            scrollback: 1000,
            allowProposedApi: true,
        });
        // Determine shell type and set up custom prompt
        const shellName = path.basename(shell);
        const { args, env } = this.setupShellPrompt(shellName, options.env, options.startupBanner, options.login);
        // Determine spawn command - may be wrapped by sandbox
        let spawnCmd = shell;
        let spawnArgs = args;
        if (options.sandboxController?.isActive()) {
            const wrapped = await options.sandboxController.wrapShellCommand(shell, args);
            spawnCmd = wrapped.cmd;
            spawnArgs = wrapped.args;
            if (process.env.DEBUG_SANDBOX) {
                console.error("[sandbox-debug] Spawn command:", spawnCmd);
                console.error("[sandbox-debug] Spawn args:", spawnArgs.join(" "));
                console.error("[sandbox-debug] CWD:", options.cwd ?? process.cwd());
            }
        }
        // Spawn PTY process
        this.ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
            name: "xterm-256color",
            cols,
            rows,
            cwd: options.cwd ?? process.cwd(),
            env: { ...process.env, ...env },
        });
        // Pipe PTY output to terminal emulator and listeners
        this.ptyProcess.onData((data) => {
            if (!this.disposed) {
                this.terminal.write(data);
                // Notify all data listeners
                for (const listener of this.dataListeners) {
                    listener(data);
                }
            }
        });
        this.ptyProcess.onExit(({ exitCode }) => {
            this.disposed = true;
            for (const listener of this.exitListeners) {
                listener(exitCode);
            }
        });
    }
    /**
     * Subscribe to PTY output data
     */
    onData(listener) {
        this.dataListeners.push(listener);
    }
    /**
     * Subscribe to PTY exit
     */
    onExit(listener) {
        this.exitListeners.push(listener);
    }
    /**
     * Subscribe to terminal resize events
     */
    onResize(listener) {
        this.resizeListeners.push(listener);
    }
    /**
     * Write data to the terminal (simulates typing)
     */
    write(data) {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        this.ptyProcess.write(data);
    }
    /**
     * Get the current terminal buffer content as plain text
     */
    getContent(maxLines) {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        const buffer = this.terminal.buffer.active;
        const lines = [];
        // Get all lines from the buffer (including scrollback)
        for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line) {
                lines.push(line.translateToString(true));
            }
        }
        // Trim trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
            lines.pop();
        }
        if (maxLines && maxLines > 0 && lines.length > maxLines) {
            return lines.slice(-maxLines).join("\n");
        }
        return lines.join("\n");
    }
    /**
     * Get terminal content with ANSI color escape sequences preserved.
     * Reads the xterm.js cell buffer and reconstructs SGR sequences.
     */
    getAnsiContent(visibleOnly = false) {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        const buffer = this.terminal.buffer.active;
        const lines = [];
        const startLine = visibleOnly ? buffer.baseY : 0;
        const endLine = visibleOnly ? buffer.baseY + this.terminal.rows : buffer.length;
        for (let y = startLine; y < endLine; y++) {
            const line = buffer.getLine(y);
            if (!line) {
                lines.push("");
                continue;
            }
            let lineStr = "";
            let lastFg = -999;
            let lastFgMode = -999;
            let lastBg = -999;
            let lastBgMode = -999;
            let lastBold = false;
            let lastDim = false;
            let lastItalic = false;
            let lastUnderline = false;
            for (let x = 0; x < line.length; x++) {
                const cell = line.getCell(x);
                if (!cell)
                    continue;
                const char = cell.getChars();
                const fg = cell.getFgColor();
                const fgMode = cell.getFgColorMode();
                const bg = cell.getBgColor();
                const bgMode = cell.getBgColorMode();
                const bold = cell.isBold() === 1;
                const dim = cell.isDim() === 1;
                const italic = cell.isItalic() === 1;
                const underline = cell.isUnderline() === 1;
                const attrChanged = fg !== lastFg || fgMode !== lastFgMode ||
                    bg !== lastBg || bgMode !== lastBgMode ||
                    bold !== lastBold || dim !== lastDim ||
                    italic !== lastItalic || underline !== lastUnderline;
                if (attrChanged) {
                    const sgr = [];
                    // Reset if we had any prior styling
                    if (lastFgMode !== -999)
                        sgr.push("0");
                    if (bold)
                        sgr.push("1");
                    if (dim)
                        sgr.push("2");
                    if (italic)
                        sgr.push("3");
                    if (underline)
                        sgr.push("4");
                    // Foreground
                    if (fgMode === 0x1000000) {
                        // P16
                        sgr.push(fg < 8 ? `${30 + fg}` : `${90 + fg - 8}`);
                    }
                    else if (fgMode === 0x2000000) {
                        // P256
                        sgr.push(`38;5;${fg}`);
                    }
                    else if (fgMode === 0x3000000) {
                        // RGB
                        sgr.push(`38;2;${(fg >> 16) & 0xFF};${(fg >> 8) & 0xFF};${fg & 0xFF}`);
                    }
                    // Background
                    if (bgMode === 0x1000000) {
                        sgr.push(bg < 8 ? `${40 + bg}` : `${100 + bg - 8}`);
                    }
                    else if (bgMode === 0x2000000) {
                        sgr.push(`48;5;${bg}`);
                    }
                    else if (bgMode === 0x3000000) {
                        sgr.push(`48;2;${(bg >> 16) & 0xFF};${(bg >> 8) & 0xFF};${bg & 0xFF}`);
                    }
                    if (sgr.length > 0) {
                        lineStr += `\x1b[${sgr.join(";")}m`;
                    }
                    lastFg = fg;
                    lastFgMode = fgMode;
                    lastBg = bg;
                    lastBgMode = bgMode;
                    lastBold = bold;
                    lastDim = dim;
                    lastItalic = italic;
                    lastUnderline = underline;
                }
                lineStr += char || " ";
            }
            // Reset at end of line if we emitted any SGR
            if (lastFgMode !== -999) {
                lineStr += "\x1b[0m";
            }
            lines.push(lineStr);
        }
        // Trim trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
            lines.pop();
        }
        return lines.join("\n");
    }
    /**
   * Get metadata about the current terminal buffer
   */
    getBufferInfo() {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        const buffer = this.terminal.buffer.active;
        return {
            length: buffer.length,
            scrollbackLines: buffer.baseY,
            viewportRows: this.terminal.rows,
        };
    }
    /**
     * Get only the visible viewport content
     */
    getVisibleContent() {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        const buffer = this.terminal.buffer.active;
        const lines = [];
        const baseY = buffer.baseY;
        for (let i = 0; i < this.terminal.rows; i++) {
            const line = buffer.getLine(baseY + i);
            if (line) {
                lines.push(line.translateToString(true));
            }
        }
        return lines.join("\n");
    }
    /**
     * Take a screenshot of the terminal state
     */
    takeScreenshot() {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        const buffer = this.terminal.buffer.active;
        return {
            content: this.getVisibleContent(),
            cursor: {
                x: buffer.cursorX,
                y: buffer.cursorY,
            },
            dimensions: {
                cols: this.terminal.cols,
                rows: this.terminal.rows,
            },
        };
    }
    /**
     * Clear the terminal screen
     */
    clear() {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        this.terminal.clear();
    }
    /**
     * Resize the terminal
     */
    resize(cols, rows) {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        this.terminal.resize(cols, rows);
        this.ptyProcess.resize(cols, rows);
        // Notify all resize listeners
        for (const listener of this.resizeListeners) {
            listener(cols, rows);
        }
    }
    /**
     * Check if the session is still active
     */
    isActive() {
        return !this.disposed;
    }
    /**
     * Get the underlying xterm.js Terminal instance for direct buffer access.
     * Used by the color screenshot renderer.
     */
    getTerminal() {
        if (this.disposed) {
            throw new Error("Terminal session has been disposed");
        }
        return this.terminal;
    }
    /**
     * Get terminal dimensions
     */
    getDimensions() {
        return {
            cols: this.terminal.cols,
            rows: this.terminal.rows,
        };
    }
    /**
     * Dispose of the terminal session
     */
    dispose() {
        if (!this.disposed) {
            this.disposed = true;
            this.ptyProcess.kill();
            this.terminal.dispose();
            // Clean up temp rc files
            if (this.rcFile) {
                try {
                    fs.unlinkSync(this.rcFile);
                }
                catch {
                    // Ignore cleanup errors
                }
            }
            if (this.zdotdir) {
                try {
                    fs.rmSync(this.zdotdir, { recursive: true });
                }
                catch {
                    // Ignore cleanup errors
                }
            }
            if (this.titleFile) {
                try {
                    fs.unlinkSync(this.titleFile);
                }
                catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
    /**
     * Update the terminal title prefix. The shell's precmd hook will pick
     * this up on the next prompt.
     */
    setTitle(title) {
        if (this.titleFile) {
            fs.writeFileSync(this.titleFile, title);
        }
    }
    /**
     * Get the path to the title file (if any).
     */
    getTitleFile() {
        return this.titleFile;
    }
}
//# sourceMappingURL=session.js.map