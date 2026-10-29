/**
 * Simple stats tracking for terminal MCP sessions
 */
export class Stats {
    startTime;
    toolCalls;
    totalCalls;
    constructor() {
        this.startTime = Date.now();
        this.toolCalls = new Map();
        this.totalCalls = 0;
    }
    /**
     * Record a tool call
     */
    recordToolCall(toolName) {
        const current = this.toolCalls.get(toolName) || 0;
        this.toolCalls.set(toolName, current + 1);
        this.totalCalls++;
    }
    /**
     * Get uptime in seconds
     */
    getUptimeSeconds() {
        return Math.floor((Date.now() - this.startTime) / 1000);
    }
    /**
     * Get formatted uptime string
     */
    getFormattedUptime() {
        const seconds = this.getUptimeSeconds();
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        }
        else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        }
        else {
            return `${secs}s`;
        }
    }
    /**
     * Get total tool calls
     */
    getTotalCalls() {
        return this.totalCalls;
    }
    /**
     * Get tool calls breakdown
     */
    getToolCallsBreakdown() {
        return new Map(this.toolCalls);
    }
    /**
     * Get stats summary
     */
    getSummary() {
        const toolCalls = {};
        for (const [tool, count] of this.toolCalls) {
            toolCalls[tool] = count;
        }
        return {
            uptime: this.getFormattedUptime(),
            totalCalls: this.totalCalls,
            toolCalls,
        };
    }
}
// Global stats instance
let globalStats = null;
/**
 * Get or create the global stats instance
 */
export function getStats() {
    if (!globalStats) {
        globalStats = new Stats();
    }
    return globalStats;
}
/**
 * Reset stats (mainly for testing)
 */
export function resetStats() {
    globalStats = new Stats();
}
//# sourceMappingURL=stats.js.map