import { SandboxPermissions } from "./config.js";
export type SandboxPlatform = "darwin" | "linux" | "win32" | "unsupported";
export interface SandboxStatus {
    enabled: boolean;
    platform: SandboxPlatform;
    reason?: string;
}
/**
 * Controller that wraps sandbox-runtime for terminal-toolkit
 * Manages sandbox lifecycle and command wrapping
 */
export declare class SandboxController {
    private initialized;
    private permissions;
    private platform;
    constructor();
    /**
     * Get the current platform
     */
    getPlatform(): SandboxPlatform;
    /**
     * Check if sandboxing is supported on this platform
     */
    isSupported(): boolean;
    /**
     * Check if Linux dependencies are available
     */
    checkLinuxDependencies(): {
        supported: boolean;
        message?: string;
    };
    /**
     * Clean up sandbox artifacts left by previous runs.
     *
     * Workaround for sandbox-runtime bug: when sandbox binds /dev/null to .claude,
     * it leaves a 0-byte file artifact. On the next run, sandbox-runtime tries to
     * create .claude/commands inside this file, which fails with "Not a directory".
     *
     * This removes the .claude artifact if it's a 0-byte file (not a real directory).
     */
    cleanupSandboxArtifacts(): void;
    /**
     * Convert our permission model to sandbox-runtime config format
     */
    private toSandboxConfig;
    /**
     * Initialize the sandbox with given permissions
     * Returns status indicating whether sandbox is active
     */
    initialize(permissions: SandboxPermissions): Promise<SandboxStatus>;
    /**
     * Wrap a shell command with sandbox restrictions
     * Returns the wrapped command string to execute
     */
    wrapShellCommand(shell: string, args: string[]): Promise<{
        cmd: string;
        args: string[];
    }>;
    /**
     * Check if sandbox is currently active
     */
    isActive(): boolean;
    /**
     * Get current permissions (if initialized)
     */
    getPermissions(): SandboxPermissions | null;
    /**
     * Cleanup sandbox resources
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=controller.d.ts.map