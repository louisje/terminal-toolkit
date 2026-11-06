import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnNode, initialize, waitFor } from "./helpers.mjs";

test("interactive attach shares PTY and disconnect leaves server alive", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-attach-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  let client;
  try {
    await initialize(owner);
    client = net.createConnection(socketPath);
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    let buffer = "";
    const messages = [];
    client.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) messages.push(JSON.parse(line));
    });
    client.write(JSON.stringify({ id: 1, method: "attach" }) + "\n");
    await waitFor(() => messages.find(m => m.id === 1), { timeoutMs: 10000 });
    client.write(JSON.stringify({ id: 0, method: "input", params: { data: "echo attached-terminal-ok\r" } }) + "\n");
    await waitFor(() => messages.some(m => m.event === "output" && m.data.includes("attached-terminal-ok")), { timeoutMs: 10000 });
    client.destroy();
    assert.equal(owner.exit, null, "detaching must not kill server");
  } finally {
    client?.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("TTY client attaches to existing interactive server and detaches independently", async () => {
  const pty = await import("node-pty");
  const dir = await mkdtemp(path.join(tmpdir(), "tt-tty-attach-"));
  const socketPath = path.join(dir, "socket");
  const env = { ...process.env };
  delete env.TERMINAL_TOOLKIT;
  const owner = pty.spawn(process.execPath, ["dist/index.js", "--socket", socketPath, "--shell", "/bin/bash"], {
    cwd: process.cwd(), cols: 80, rows: 24, env,
  });
  let client;
  let ownerOutput = "";
  let clientOutput = "";
  owner.onData(data => { ownerOutput += data; });
  try {
    const { existsSync } = await import("node:fs");
    await waitFor(() => existsSync(socketPath), { timeoutMs: 12000 });
    client = pty.spawn(process.execPath, ["dist/index.js", "--socket", socketPath], {
      cwd: process.cwd(), cols: 80, rows: 24, env,
    });
    client.onData(data => { clientOutput += data; });
    await waitFor(() => clientOutput.includes("mcp"), { timeoutMs: 12000 });
    client.write("echo shared-tty-output\r");
    await waitFor(() => ownerOutput.includes("shared-tty-output") && clientOutput.includes("shared-tty-output"), { timeoutMs: 10000 });
    // The Ctrl-] shortcut must close only the attached client.
    client.write("\x1d");
    await waitFor(() => clientOutput.includes("[terminal-toolkit] Detached"), { timeoutMs: 10000 });
    owner.write("echo server-survived-detach\r");
    await waitFor(() => ownerOutput.includes("server-survived-detach"), { timeoutMs: 10000 });
  } finally {
    client?.kill();
    owner.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("occupied but unreachable socket never gets unlinked by a failed contender", async () => {
  const pty = await import("node-pty");
  const { existsSync, unlinkSync } = await import("node:fs");
  const dir = await mkdtemp(path.join(tmpdir(), "tt-occupied-"));
  const socketPath = path.join(dir, "socket");
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(socketPath, resolve);
  });
  // A bound Unix socket can remain listening after its filesystem entry is removed.
  unlinkSync(socketPath);
  const env = { ...process.env };
  delete env.TERMINAL_TOOLKIT;
  const contender = pty.spawn(process.execPath, ["dist/index.js", "--socket", socketPath, "--shell", "/bin/bash"], {
    cwd: process.cwd(), cols: 80, rows: 24, env,
  });
  let output = "";
  contender.onData(data => { output += data; });
  try {
    await waitFor(() => existsSync(socketPath), { timeoutMs: 12000 });
    // The contender can safely become the new owner of this now-free path.
    contender.write("echo contender-running\r");
    await waitFor(() => output.includes("contender-running"), { timeoutMs: 10000 });
  } finally {
    contender.kill();
    blocker.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a conflicting socket path is not removed on startup failure", async () => {
  const pty = await import("node-pty");
  const { writeFileSync, readFileSync } = await import("node:fs");
  const dir = await mkdtemp(path.join(tmpdir(), "tt-conflict-"));
  const socketPath = path.join(dir, "socket");
  writeFileSync(socketPath, "do-not-remove");
  const env = { ...process.env };
  delete env.TERMINAL_TOOLKIT;
  const contender = pty.spawn(process.execPath, ["dist/index.js", "--socket", socketPath, "--shell", "/bin/bash"], {
    cwd: process.cwd(), cols: 80, rows: 24, env,
  });
  let output = "";
  contender.onData(data => { output += data; });
  try {
    await waitFor(() => output.includes("already bound") || output.includes("EADDRINUSE"), { timeoutMs: 12000 });
    assert.equal(readFileSync(socketPath, "utf8"), "do-not-remove");
  } finally {
    contender.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
