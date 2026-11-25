import test from "node:test";
import assert from "node:assert/strict";
import { withToolWatchdog, TOOL_WATCHDOG_MS } from "../src/tools/watchdog.ts";

test("watchdog preserves normal results and errors", async () => {
  assert.equal(TOOL_WATCHDOG_MS, 100_000);
  assert.equal(await withToolWatchdog("read", () => 42), 42);
  const error = new Error("original");
  await assert.rejects(withToolWatchdog("read", () => { throw error; }), e => e === error);
});

test("watchdog returns even if tool ignores cancellation; other calls proceed", async () => {
  let signal!: AbortSignal;
  let finish!: (value: string) => void;
  const pending = withToolWatchdog("shell", s => {
    signal = s;
    return new Promise<string>(resolve => { finish = resolve; });
  }, undefined, 20);
  assert.equal(await withToolWatchdog("read", () => "ok"), "ok");
  await assert.rejects(pending, /Tool 'shell' exceeded the .* safety deadline. Cancellation requested/);
  assert.equal(signal.aborted, true);
  finish("late result");
});

test("watchdog preserves parent cancellation and does not cancel completed calls", async () => {
  const parent = new AbortController();
  const pending = withToolWatchdog("sleep", signal => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("original cancellation")), { once: true });
  }), parent.signal);
  await Promise.resolve();
  parent.abort();
  await assert.rejects(pending, /original cancellation/);
  let completed!: AbortSignal;
  await withToolWatchdog("read", signal => { completed = signal; }, undefined, 10);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(completed.aborted, false);
});
