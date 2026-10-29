import { SandboxManager, } from "@anthropic-ai/sandbox-runtime";
import { expandPath } from "./config.js";
import * as fs from "fs";
import * as path from "path";
/**
 * Controller that wraps sandbox-runtime for terminal-mcp
 * Manages sandbox lifecycle and command wrapping
 */
export class SandboxController {
    initialized = false;
    permissions = null;
    platform;
    constructor() {
        // Get platform from Node
        const nodePlatform = process.platform;
        if (nodePlatform === "darwin" || nodePlatform === "linux" || nodePlatform === "win32") {
            this.platform = nodePlatform;
        }
        else {
            this.platform = "unsupported";
        }
    }
    /**
     * Get the current platform
     */
    getPlatform() {
        return this.platform;
    }
    /**
     * Check if sandboxing is supported on this platform
     */
    isSupported() {
        return SandboxManager.isSupportedPlatform();
    }
    /**
     * Check if Linux dependencies are available
     */
    checkLinuxDependencies() {
        if (this.platform !== "linux") {
            return { supported: true };
        }
        const depCheck = SandboxManager.checkDependencies();
        const supported = depCheck.errors.length === 0;
        const message = supported ? undefined : depCheck.errors.join("; ");
        return { supported, message };
    }
    /**
     * Clean up sandbox artifacts left by previous runs.
     *
     * Workaround for sandbox-runtime bug: when sandbox binds /dev/null to .claude,
     * it leaves a 0-byte file artifact. On the next run, sandbox-runtime tries to
     * create .claude/commands inside this file, which fails with "Not a directory".
     *
     * This removes the .claude artifact if it's a 0-byte file (not a real directory).
     */
    cleanupSandboxArtifacts() {
        const claudePath = path.join(process.cwd(), ".claude");
        try {
            const stat = fs.statSync(claudePath);
            // If .claude is a file (not directory) and 0 bytes, it's a sandbox artifact
            if (stat.isFile() && stat.size === 0) {
                fs.unlinkSync(claudePath);
                if (process.env.DEBUG_SANDBOX) {
                    console.error("[sandbox-debug] Cleaned up .claude artifact (0-byte file from previous sandbox run)");
                }
            }
        }
        catch {
            // File doesn't exist or can't be accessed - that's fine
        }
    }
    /**
     * Convert our permission model to sandbox-runtime config format
     */
    toSandboxConfig(permissions) {
        // Expand all paths
        const expandPaths = (paths) => paths.map((p) => expandPath(p));
        // Configure network based on mode
        let allowedDomains;
        const deniedDomains = [];
        switch (permissions.network.mode) {
            case "none":
                // Block all network by using empty allowed list
                allowedDomains = [];
                break;
            case "allowlist":
                allowedDomains = permissions.network.allowedDomains ?? [];
                break;
            case "all":
            default:
                // Allow all network access with wildcard
                allowedDomains = ["*"];
                break;
        }
        const config = {
            filesystem: {
                // Read/write paths go to allowWrite
                allowWrite: expandPaths(permissions.filesystem.readWrite),
                // Blocked paths go to denyRead (blocks both read and write)
                denyRead: expandPaths(permissions.filesystem.blocked),
                // Read-only paths: we want to allow read but deny write
                // Paths not in allowWrite are read-only by default
                denyWrite: [],
            },
            network: {
                allowedDomains,
                deniedDomains,
            },
            // Enable PTY support since we're spawning a shell
            allowPty: true,
        };
        return config;
    }
    /**
     * Initialize the sandbox with given permissions
     * Returns status indicating whether sandbox is active
     */
    async initialize(permissions) {
        // Check platform support
        if (!this.isSupported()) {
            return {
                enabled: false,
                platform: this.platform,
                reason: this.platform === "win32"
                    ? "Sandbox not available on Windows"
                    : `Platform ${this.platform} is not supported`,
            };
        }
        // Check Linux dependencies
        if (this.platform === "linux") {
            const depCheck = this.checkLinuxDependencies();
            if (!depCheck.supported) {
                return {
                    enabled: false,
                    platform: this.platform,
                    reason: depCheck.message ?? "Linux sandbox dependencies not available",
                };
            }
        }
        // Clean up any sandbox artifacts from previous runs
        // This works around a sandbox-runtime bug where .claude becomes a 0-byte file
        this.cleanupSandboxArtifacts();
        try {
            const config = this.toSandboxConfig(permissions);
            await SandboxManager.initialize(config, undefined, true);
            this.initialized = true;
            this.permissions = permissions;
            return {
                enabled: true,
                platform: this.platform,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                enabled: false,
                platform: this.platform,
                reason: `Failed to initialize sandbox: ${message}`,
            };
        }
    }
    /**
     * Wrap a shell command with sandbox restrictions
     * Returns the wrapped command string to execute
     */
    async wrapShellCommand(shell, args) {
        if (!this.initialized) {
            throw new Error("Sandbox not initialized");
        }
        // Build the full command string
        const fullCommand = [shell, ...args].join(" ");
        // Wrap with sandbox
        const sandboxedCommand = await SandboxManager.wrapWithSandbox(fullCommand, shell);
        // Debug: log the generated command
        if (process.env.DEBUG_SANDBOX) {
            console.error("[sandbox-debug] Generated command:", sandboxedCommand);
        }
        // The sandboxed command should be executed via shell
        // Return it as a shell -c command
        return {
            cmd: "/bin/sh",
            args: ["-c", sandboxedCommand],
        };
    }
    /**
     * Check if sandbox is currently active
     */
    isActive() {
        return this.initialized;
    }
    /**
     * Get current permissions (if initialized)
     */
    getPermissions() {
        return this.permissions;
    }
    /**
     * Cleanup sandbox resources
     */
    async cleanup() {
        if (this.initialized) {
            await SandboxManager.reset();
            this.initialized = false;
            this.permissions = null;
        }
    }
}
//# sourceMappingURL=controller.js.map