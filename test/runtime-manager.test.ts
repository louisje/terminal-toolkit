import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reclaimStaleInstances } from "../src/runtime/retention.ts";
import { ExecutionManager } from "../src/runtime/manager.ts";
import { DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, runForeground } from "../src/runtime/foreground.ts";
import { handleRuntimeManagement } from "../src/tools/runtime.ts";
import { readExecutionPath, readExecutionPage, listExecutionPaths, findExecutionPaths } from "../src/runtime/virtual.ts";

async function fixture(t: import("node:test").TestContext, limit?: number) {
  const root = await mkdtemp(join(tmpdir(), "tt-runtime-"));
  const manager = new ExecutionManager(root, limit);
  t.after(async () => {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  return manager;
}
const options = (code: string) => ({ tool: "shell" as const, command: process.execPath, args: ["-e", code], cwd: process.cwd() });

test("stale instance cleanup preserves live and unknown owners", async t => {
  const root = await mkdtemp(join(tmpdir(), "tt-stale-"));
  t.after(() => rm(root, {recursive:true,force:true}));
  for (const name of ["instance-live","instance-dead","instance-unknown"]) await mkdir(join(root,name));
  await writeFile(join(root,"instance-live","owner.json"),JSON.stringify({pid:process.pid}));
  await writeFile(join(root,"instance-dead","owner.json"),JSON.stringify({pid:2147483647}));
  await reclaimStaleInstances(root);
  assert.deepEqual((await readdir(root)).sort(),["instance-live","instance-unknown"]);
});
test("concurrent removals share cleanup", async t => {
  const manager = await fixture(t);
  const e = await manager.start(options("console.log('done')"));
  await e.ready; e.detach(); await e.done;
  await Promise.all([manager.remove(e.info.executionId),manager.remove(e.info.executionId)]);
  assert.equal(manager.get(e.info.executionId),undefined);
});
test("registry captures separate file-backed output and exit status", async t => {
  const manager = await fixture(t);
  const e = await manager.start(options("process.stdout.write('hello'); process.stderr.write('error'); process.exitCode=3"));
  await e.ready;
  await e.done;
  assert.equal(manager.get(e.info.executionId), e);
  assert.equal(e.info.status, "failed");
  assert.equal(e.info.exitCode, 3);
  assert.equal(e.info.stdoutSize, 5);
  assert.equal(await readFile(join(e.directory, "stdout"), "utf8"), "hello");
  assert.equal(await readFile(join(e.directory, "stderr"), "utf8"), "error");
  await manager.remove(e.info.executionId);
  assert.equal(manager.list().length, 0);
});

test("active execution cannot be removed; abort cancels it", async t => {
  const manager = await fixture(t);
  const controller = new AbortController();
  const e = await manager.start(options("setInterval(()=>{},1000)"), controller.signal);
  await e.ready;
  await assert.rejects(manager.remove(e.info.executionId), /still active/);
  controller.abort();
  await e.done;
  assert.equal(e.info.status, "cancelled");
});

test("spawn failure settles ready and done", async t => {
  const manager = await fixture(t);
  const e = await manager.start({ ...options(""), command: join(tmpdir(), "tt-nonexistent-executable") });
  await assert.rejects(e.ready);
  await e.done;
  assert.equal(e.info.status, "failed");
  assert.ok(e.info.error);
});

test("stdin is delivered and successful execution completes", async t => {
  const manager = await fixture(t);
  const e = await manager.start({ ...options("process.stdin.pipe(process.stdout)"), input: "測試" });
  await e.ready;
  await e.done;
  assert.equal(e.info.status, "completed");
  assert.equal(await readFile(join(e.directory, "stdout"), "utf8"), "測試");
});

test("combined output cap drains excess without killing the process", async t => {
  const manager = await fixture(t, 1024);
  const e = await manager.start(options("process.stdout.write('a'.repeat(200000)); process.stderr.write('b'.repeat(200000))"));
  await e.ready;
  await e.done;
  assert.equal(e.info.status, "completed");
  assert.equal(e.info.outputTruncated, true);
  assert.equal(e.info.stdoutSize + e.info.stderrSize, 1024);
  assert.ok(e.info.lastOutputAt);
});

test("zero timeout detaches and later parent cancellation does not kill execution", async t => {
  const manager = await fixture(t);
  const controller = new AbortController();
  const response = await runForeground(manager, options("setTimeout(()=>console.log('done'),100)"), 0, controller.signal);
  const e = manager.list()[0];
  assert.equal(e.info.background, true);
  assert.match(response.content[0].text, new RegExp(e.info.executionId));
  assert.equal(response.isError, undefined);
  controller.abort();
  await e.done;
  assert.equal(e.info.status, "completed");
  assert.equal(await readFile(join(e.directory, "stdout"), "utf8"), "done\n");
});

test("positive timeout detaches; foreground completion preserves output", async t => {
  const manager = await fixture(t);
  const response = await runForeground(manager, options("setTimeout(()=>{},200)"), 0.01);
  assert.match(response.content[0].text, /executionId:/);
  const e = manager.list()[0];
  await e.done;
  const normal = await runForeground(manager, options("console.log('ok')"), 5);
  assert.equal(normal.content[0].text, "ok\n");
  await assert.rejects(runForeground(manager, options(""), -1), /non-negative/);
});

test("foreground cancellation still terminates process", async t => {
  const manager = await fixture(t);
  const controller = new AbortController();
  const pending = runForeground(manager, options("setInterval(()=>{},1000)"), 5, controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, /Command aborted/); }
  finally { clearTimeout(timer); }
  await Promise.all(manager.list().map(e => e.done));
});

test("management tools inspect, wait, cancel and remove detached executions", async t => {
  const manager = await fixture(t);
  await runForeground(manager, options("setInterval(()=>{},1000)"), 0);
  const executionId = manager.list()[0].info.executionId;
  const call = async (name: string, args: unknown, signal?: AbortSignal) =>
    JSON.parse((await handleRuntimeManagement(name, args, signal, manager)).content[0].text);
  assert.equal((await call("listExecutions", {})).length, 1);
  assert.equal((await call("getExecution", { executionId })).status, "running");
  assert.equal((await call("waitExecution", { executionId, timeout: 0.01 })).status, "running");
  const controller = new AbortController();
  const waiting = call("waitExecution", { executionId }, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /aborted/);
  assert.equal((await call("getExecution", { executionId })).status, "running");
  await assert.rejects(call("removeExecution", { executionId }), /still active/);
  await call("cancelExecution", { executionId });
  assert.equal((await call("waitExecution", { executionId })).status, "cancelled");
  await call("removeExecution", { executionId });
  assert.equal((await call("listExecutions", {})).length, 0);
});

test("execution virtual paths expose output and metadata without traversal", async t => {
  const manager = await fixture(t);
  await runForeground(manager, options("console.log('hello')"), 0);
  const e = manager.list()[0];
  await e.done;
  const root = "execution://" + e.info.executionId;
  assert.deepEqual(listExecutionPaths(root, manager), ["info.json", "stderr", "stdout"]);
  assert.deepEqual(findExecutionPaths("execution://", "std*", manager).sort(), [root + "/stderr", root + "/stdout"]);
  assert.equal(await readExecutionPath(root + "/stdout", manager), "hello\n");
  assert.equal(JSON.parse(await readExecutionPath(root + "/info.json", manager)).status, "completed");
  await assert.rejects(readExecutionPath(root + "/../stdout", manager), /Invalid execution path/);
});

test("execution output pagination preserves line boundaries", async t => {
  const manager = await fixture(t);
  await runForeground(manager, options("process.stdout.write('first\\n第二行\\n'+ 'x'.repeat(1024)+'\\nlast\\n')"), 0);
  const e = manager.list()[0]; await e.done;
  const path = "execution://" + e.info.executionId + "/stdout";
  assert.equal(await readExecutionPage(path,2,1,manager),"第二行");
  assert.equal(await readExecutionPage(path,4,2,manager),"last\n");
  assert.equal(await readExecutionPage(path,5,1,manager),"");
  await assert.rejects(readExecutionPage(path,6,1,manager),/beyond end/);
  assert.equal(await readExecutionPage(path.replace("stdout","stderr"),1,1,manager),"");
});
test("global quota and concurrent limit protect active executions", async t => {
  const root = await mkdtemp(join(tmpdir(), "tt-quota-"));
  const manager = new ExecutionManager(root, 1024, 1500, 2);
  t.after(async () => { await manager.shutdown(); await rm(root, { recursive: true, force: true }); });
  const a = await manager.start(options("console.log('a'.repeat(2000));setInterval(()=>{},1000)"));
  const b = await manager.start(options("console.log('b'.repeat(2000));setInterval(()=>{},1000)"));
  await Promise.all([a.ready,b.ready]);
  await assert.rejects(manager.start(options("")), /Concurrent execution limit/);
  for (let i=0;i<100 && a.info.stdoutSize+b.info.stdoutSize<1500;i++) await new Promise(r=>setTimeout(r,20));
  assert.equal(a.info.stdoutSize+b.info.stdoutSize,1500);
  await manager.shutdown();
  assert.equal(a.info.status,"cancelled");
  assert.equal(b.info.status,"cancelled");
  assert.equal(manager.list().length,0);
  await assert.rejects(manager.start(options("")),/shutting down/);
});

test("timeout warning detaches without cancelling execution", async t => {
  const { timeoutWarningScope } = await import("../src/runtime/timeoutWarning.ts");
  const manager = await fixture(t);
  const warning = new AbortController();
  const cancellation = new AbortController();
  const pending = timeoutWarningScope.run(warning.signal, () =>
    runForeground(manager, options("setTimeout(()=>console.log('done'),500)"), 30, cancellation.signal));
  warning.abort();
  const response = await pending;
  const e = manager.list()[0];
  assert.match(response.content[0].text, new RegExp(e.info.executionId));
  assert.equal(e.info.background, true);
  cancellation.abort();
  await e.done;
  assert.equal(e.info.status, "completed");
  assert.equal(await readFile(join(e.directory, "stdout"), "utf8"), "done\n");
});

test("runtime wait policy is 90 seconds and early warning does not cancel waiting job", async t => {
  assert.equal(DEFAULT_WAIT_SECONDS, 90);
  assert.equal(MAX_WAIT_SECONDS, 90);
  const manager = await fixture(t);
  const e = await manager.start(options("setTimeout(()=>console.log('done'),5000)"));
  await e.ready; e.detach();
  const { timeoutWarningScope } = await import("../src/runtime/timeoutWarning.ts");
  for (const early of [true,false]) {
    const warning = new AbortController();
    if (early) warning.abort();
    const pending = timeoutWarningScope.run(warning.signal, () => handleRuntimeManagement("waitExecution", {executionId:e.info.executionId}, undefined, manager));
    if (!early) warning.abort();
    const result = await pending;
    assert.equal(JSON.parse(result.content[0].text).status,"running");
  }
  e.cancel(); await e.done;
});
