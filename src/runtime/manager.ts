import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { killProcessTree } from "./processTree.js";
import { markInstance, reclaimStaleInstances } from "./retention.js";
import { ExecutionOutput, DEFAULT_OUTPUT_LIMIT } from "./output.js";
import { homedir } from "node:os";
import { join } from "node:path";

export type ExecutionStatus = "starting" | "running" | "completed" | "failed" | "cancelling" | "cancelled";
export interface ExecutionInfo {
  executionId: string;
  tool: "shell" | "python";
  status: ExecutionStatus;
  background: boolean;
  pid?: number;
  startedAt: number;
  detachedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdoutSize: number;
  stderrSize: number;
  error?: string;
  outputTruncated?: boolean;
  lastOutputAt?: number;
}
export interface ExecutionOptions {
  tool: ExecutionInfo["tool"];
  command: string;
  args?: string[];
  shell?: string;
  cwd: string;
  input?: string;
}
export interface Execution {
  info: ExecutionInfo;
  directory: string;
  ready: Promise<void>;
  done: Promise<void>;
  cancel(): void;
  detach(): void;
}



// Internal foundation only; public routing, quotas and retention follow in later phases.
export class ExecutionManager {
  private readonly entries = new Map<string, Execution>();
  private directory?: Promise<string>;
  private starting = 0;
  private closing = false;
  private reserved = 0;
  private readonly reservations = new Map<string, number>();
  private readonly removals = new Map<string, Promise<void>>();
  private sweepTimer?: ReturnType<typeof setInterval>;
  private sweeping?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  constructor(private readonly root = join(homedir(), ".local", "state", "terminal-toolkit", "executions"), private readonly outputLimit = DEFAULT_OUTPUT_LIMIT, private readonly totalLimit = 1024 * 1024 * 1024, private readonly concurrency = 16) {}

  private instanceDirectory(): Promise<string> {
    return this.directory ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await reclaimStaleInstances(this.root);
      const directory = await mkdtemp(join(this.root, "instance-"));
      try { await markInstance(directory); }
      catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      return directory;
    })();
  }

  get(id: string): Execution | undefined { return this.entries.get(id); }
  list(): Execution[] { return [...this.entries.values()]; }

  async start(options: ExecutionOptions, signal?: AbortSignal): Promise<Execution> {
    signal?.throwIfAborted();
    if (this.closing) throw new Error("Execution manager is shutting down");
    if (this.starting + this.list().filter(e => e.info.finishedAt === undefined).length >= this.concurrency) throw new Error("Concurrent execution limit reached");
    this.starting++;
    const id = randomUUID();
    let directory: string;
    try {
      await this.sweep();
      directory = join(await this.instanceDirectory(), id);
      await mkdir(directory, { mode: 0o700 });
      if (this.closing) { await rm(directory, { recursive: true, force: true }); throw new Error("Execution manager is shutting down"); }
    } finally { this.starting--; }
    this.sweepTimer ??= setInterval(() => { void this.sweep().catch(() => {}); }, 60_000).unref();
    let child: ChildProcess | undefined;
    let finishing = false;
    let output: ExecutionOutput | undefined;
    let collectors: Promise<void>[] = [];
    const info: ExecutionInfo = { executionId: id, tool: options.tool, status: "starting", background: false,
      startedAt: Date.now(), stdoutSize: 0, stderrSize: 0 };
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let doneResolve!: () => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // Consumers may await done instead of ready.
    void ready.catch(() => {});
    const done = new Promise<void>(resolve => { doneResolve = resolve; });
    const execution: Execution = { info, directory, ready, done, cancel: () => {
      if (finishing || info.finishedAt !== undefined || info.status === "cancelling") return;
      info.status = "cancelling";
      if (child?.pid) killProcessTree(child.pid);
    }, detach: () => {
      signal?.throwIfAborted();
      if (info.status === "cancelling") throw new Error("Execution cancelled");
      info.background = true;
      info.detachedAt ??= Date.now();
      signal?.removeEventListener("abort", onAbort);
    }};
    this.entries.set(id, execution);
    const onAbort = () => execution.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = async (code: number | null, exitSignal: NodeJS.Signals | null, error?: Error) => {
      if (finishing || info.finishedAt !== undefined) return;
      finishing = true;
      const cancelled = info.status === "cancelling";
      info.exitCode = code;
      info.signal = exitSignal;
      if (error) info.error = error.message;
      await Promise.all(collectors);
      if (output) {
        try { await output.close(); } catch (failure) { info.error ??= String(failure); }
        info.stdoutSize = output.sizes.stdout;
        info.stderrSize = output.sizes.stderr;
        info.outputTruncated = output.truncated;
        info.lastOutputAt = output.lastOutputAt;
      }
      info.status = cancelled ? "cancelled" : error || info.error || code !== 0 ? "failed" : "completed";
      info.finishedAt = Date.now();
      signal?.removeEventListener("abort", onAbort);
      doneResolve();
    };
    try {
      output = await ExecutionOutput.create(directory, this.outputLimit, bytes => {
        const count = Math.min(bytes, Math.max(0, this.totalLimit - this.reserved));
        this.reserved += count;
        this.reservations.set(id, (this.reservations.get(id) ?? 0) + count);
        return count;
      }, () => {
        if (!output) return;
        info.stdoutSize = output.sizes.stdout;
        info.stderrSize = output.sizes.stderr;
        info.outputTruncated = output.truncated;
        info.lastOutputAt = output.lastOutputAt;
      });
      if (this.closing) throw new Error("Execution manager is shutting down");
      signal?.throwIfAborted();
      child = spawn(options.command, options.args ?? [], { cwd: options.cwd, shell: options.shell,
        detached: process.platform !== "win32", windowsHide: true,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
      const capture = (name: "stdout" | "stderr", stream: NonNullable<ChildProcess["stdout"]>) =>
        output!.collect(name, stream).catch(error => {
          info.error ??= String(error);
          if (child?.pid) killProcessTree(child.pid);
        });
      collectors = [capture("stdout", child.stdout!), capture("stderr", child.stderr!)];
      child.once("spawn", () => {
        info.pid = child?.pid;
        if (info.status !== "cancelling") info.status = "running";
        else if (child?.pid) killProcessTree(child.pid);
        readyResolve();
      });
      child.once("error", error => { info.error = error.message; readyReject(error); });
      child.once("close", (code, exitSignal) => { void finish(code, exitSignal); });
      child.stdin?.on("error", () => { /* child may exit before consuming input */ });
      if (options.input !== undefined) child.stdin?.end(options.input);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      readyReject(failure);
      await finish(null, null, failure);
    }
    return execution;
  }

  async remove(id: string): Promise<void> {
    const pending = this.removals.get(id);
    if (pending) return pending;
    const execution = this.entries.get(id);
    if (!execution) throw new Error("Unknown execution");
    if (execution.info.finishedAt === undefined) throw new Error("Execution is still active");
    const removal = (async () => {
      await rm(execution.directory, { recursive: true, force: true });
      if (this.entries.delete(id)) {
        this.reserved -= this.reservations.get(id) ?? 0;
        this.reservations.delete(id);
      }
    })().finally(() => this.removals.delete(id));
    this.removals.set(id, removal);
    return removal;
  }

  sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      const completed = this.list().filter(e => e.info.background && e.info.finishedAt !== undefined)
        .sort((a,b) => a.info.finishedAt! - b.info.finishedAt!);
      for (let i = 0; i < completed.length; i++) {
        const e = completed[i];
        if (Date.now() - e.info.finishedAt! > 86_400_000 || completed.length - i > 100 || this.reserved + this.outputLimit > this.totalLimit)
          await this.remove(e.info.executionId).catch(() => {});
      }
    })().finally(() => { this.sweeping = undefined; });
    return this.sweeping;
  }

  cancelAll(): void {
    this.closing = true;
    for (const e of this.list()) e.cancel();
  }

  shutdown(): Promise<void> {
    return this.shutdownPromise ??= (async () => {
      this.cancelAll();
      if (this.sweepTimer) clearInterval(this.sweepTimer);
      while (this.starting) await new Promise(resolve => setTimeout(resolve, 10));
      await Promise.all(this.list().map(e => e.done));
      await this.sweeping;
      await Promise.allSettled(this.removals.values());
      if (this.directory) await rm(await this.directory, { recursive: true, force: true });
      this.entries.clear();
      this.reservations.clear();
      this.reserved = 0;
    })();
  }
}
