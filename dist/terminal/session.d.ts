import xtermHeadless from "@xterm/headless";
declare const Terminal: typeof xtermHeadless.Terminal;
import type { SandboxController } from "../sandbox/index.js";
export interface TerminalSessionOptions {
    cols?: number;
    rows?: number;
    shell?: string;
    login?: boolean;
    cwd?: string;
    env?: Record<string, string>;
    startupBanner?: string;
    sandboxController?: SandboxController;
}
export interface ScreenshotResult {
    content: string;
    cursor: {
        x: number;
        y: number;
    };
    dimensions: {
        cols: number;
        rows: number;
    };
}
export interface BufferInfoResult {
    length: number;
    scrollbackLines: number;
    viewportRows: number;
}
/**
 * Terminal session that combines node-pty with xterm.js headless
 * for full terminal emulation
 */
export declare class TerminalSession {
    private ptyProcess;
    private terminal;
    private disposed;
    private dataListeners;
    private exitListeners;
    private resizeListeners;
    private rcFile;
    private zdotdir;
    private titleFile;
    /**
     * Private constructor - use TerminalSession.create() instead
     */
    private constructor();
    /**
     * Factory method to create a TerminalSession
     * Use this instead of the constructor to support async sandbox initialization
     */
    static create(options?: TerminalSessionOptions): Promise<TerminalSession>;
    private shellPath;
    /**
     * Set up shell-specific prompt customization
     * Returns args to pass to shell and env modifications
     */
    private setupShellPrompt;
    /**
     * Initialize the terminal session
     * This is called by the create() factory method
     */
    private initialize;
    /**
     * Subscribe to PTY output data
     */
    onData(listener: (data: string) => void): void;
    /**
     * Subscribe to PTY exit
     */
    onExit(listener: (code: number) => void): void;
    /**
     * Subscribe to terminal resize events
     */
    onResize(listener: (cols: number, rows: number) => void): void;
    /**
     * Write data to the terminal (simulates typing)
     */
    write(data: string): void;
    /**
     * Get the current terminal buffer content as plain text
     */
    getContent(maxLines?: number): string;
    /**
     * Get terminal content with ANSI color escape sequences preserved.
     * Reads the xterm.js cell buffer and reconstructs SGR sequences.
     */
    getAnsiContent(visibleOnly?: boolean): string;
    /**
   * Get metadata about the current terminal buffer
   */
    getBufferInfo(): BufferInfoResult;
    /**
     * Get only the visible viewport content
     */
    getVisibleContent(): string;
    /**
     * Take a screenshot of the terminal state
     */
    takeScreenshot(): ScreenshotResult;
    /**
     * Clear the terminal screen
     */
    clear(): void;
    /**
     * Resize the terminal
     */
    resize(cols: number, rows: number): void;
    /**
     * Check if the session is still active
     */
    isActive(): boolean;
    /**
     * Get the underlying xterm.js Terminal instance for direct buffer access.
     * Used by the color screenshot renderer.
     */
    getTerminal(): InstanceType<typeof Terminal>;
    /**
     * Get terminal dimensions
     */
    getDimensions(): {
        cols: number;
        rows: number;
    };
    /**
     * Dispose of the terminal session
     */
    dispose(): void;
    /**
     * Update the terminal title prefix. The shell's precmd hook will pick
     * this up on the next prompt.
     */
    setTitle(title: string): void;
    /**
     * Get the path to the title file (if any).
     */
    getTitleFile(): string | null;
}
export {};
//# sourceMappingURL=session.d.ts.map