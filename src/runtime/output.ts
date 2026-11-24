import { open, type FileHandle } from "node:fs/promises";
import type { Readable } from "node:stream";
import { join } from "node:path";

export const DEFAULT_OUTPUT_LIMIT = 100 * 1024 * 1024;
export class ExecutionOutput {
  reserved = 0;
  readonly sizes = { stdout: 0, stderr: 0 };
  truncated = false;
  lastOutputAt?: number;
  constructor(private readonly files: Record<"stdout" | "stderr", FileHandle>, private readonly limit: number, private readonly reserveGlobal: (bytes: number) => number, private readonly onProgress: () => void) {}

  static async create(directory: string, limit: number, reserveGlobal: (bytes: number) => number, onProgress: () => void): Promise<ExecutionOutput> {
    const stdout = await open(join(directory, "stdout"), "wx", 0o600);
    try {
      const stderr = await open(join(directory, "stderr"), "wx", 0o600);
      return new ExecutionOutput({ stdout, stderr }, limit, reserveGlobal, onProgress);
    } catch (error) { await stdout.close(); throw error; }
  }

  async collect(name: "stdout" | "stderr", stream: Readable): Promise<void> {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      this.lastOutputAt = Date.now();
      const count = this.reserveGlobal(Math.min(chunk.length, Math.max(0, this.limit - this.reserved)));
      this.reserved += count;
      if (count < chunk.length) this.truncated = true;
      let offset = 0;
      while (offset < count) {
        const { bytesWritten } = await this.files[name].write(chunk, offset, count - offset);
        if (!bytesWritten) throw new Error("Output write made no progress");
        offset += bytesWritten;
        this.sizes[name] += bytesWritten;
        this.onProgress();
      }
      this.onProgress();
    }
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(Object.values(this.files).map(file => file.close()));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
