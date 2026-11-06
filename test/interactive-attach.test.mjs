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

test("client.count broadcasts on connect and disconnect", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-count-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  const clients = [];
  const messages = [];
  try {
    await initialize(owner);
    for (let i = 0; i < 2; i++) {
      const client = net.createConnection(socketPath);
      clients.push(client);
      let buffer = "";
      const received = [];
      messages.push(received);
      client.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line) received.push(JSON.parse(line));
      });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await waitFor(() => received.some(m => m.event === "client.count" && m.data === i + 2));
    }
    await waitFor(() => messages[0].some(m => m.event === "client.count" && m.data === 3));
    clients[1].destroy();
    await waitFor(() => messages[0].some(m => m.event === "client.count" && m.data === 2));
  } finally {
    for (const client of clients) client.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("detach and reattach reuse one socket without closing the PTY", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-detach-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  let client;
  try {
    await initialize(owner);
    client = net.createConnection(socketPath);
    const messages = [];
    let buffer = "";
    client.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) messages.push(JSON.parse(line));
    });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    const send = (id, method, params) => client.write(JSON.stringify({ id, method, params }) + "\n");
    send(10, "attach");
    await waitFor(() => messages.some(m => m.id === 10));
    send(11, "detach");
    await waitFor(() => messages.some(m => m.id === 11 && m.result?.detached === true));
    assert.equal(client.destroyed, false);
    send(12, "attach");
    await waitFor(() => messages.some(m => m.id === 12));
    send(0, "input", { data: "echo reattached-ok\r" });
    await waitFor(() => messages.some(m => m.event === "output" && m.data.includes("reattached-ok")));
    assert.equal(owner.exit, null);
  } finally {
    client?.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("session lifecycle events reach connected socket clients", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-session-events-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  let client;
  try {
    await initialize(owner);
    client = net.createConnection(socketPath);
    const messages = [];
    let buffer = "";
    client.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) messages.push(JSON.parse(line));
    });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    client.write(JSON.stringify({ id: 30, method: "createSession", params: {} }) + "\n");
    await waitFor(() => messages.some(m => m.id === 30));
    await waitFor(() => messages.some(m => m.event === "session.created"));
    const sessionId = messages.find(m => m.event === "session.created").sessionId;
    assert.ok(sessionId);
    client.write(JSON.stringify({ id: 31, method: "destroySession", params: { sessionId } }) + "\n");
    await waitFor(() => messages.some(m => m.event === "session.destroyed" && m.sessionId === sessionId));
  } finally {
    client?.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("custom pubsub delivers only to subscribers and rejects system topics", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-pubsub-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  const clients = [];
  const messages = [];
  try {
    await initialize(owner);
    for (let i = 0; i < 2; i++) {
      const client = net.createConnection(socketPath);
      clients.push(client);
      let buffer = "";
      const received = [];
      messages.push(received);
      client.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line) received.push(JSON.parse(line));
      });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
    }
    const send = (index, id, method, topic, data) =>
      clients[index].write(JSON.stringify({ id, method, params: { topic, data } }) + "\n");
    send(0, 40, "subscribe", "custom.notice");
    await waitFor(() => messages[0].some(m => m.id === 40));
    send(1, 41, "publish", "custom.notice", { message: "hello" });
    await waitFor(() => messages[0].some(m => m.event === "custom.notice"));
    assert.deepEqual(messages[0].find(m => m.event === "custom.notice").data, { message: "hello" });
    assert.equal(messages[1].some(m => m.event === "custom.notice"), false);
    send(1, 42, "publish", "client.count", 999);
    await waitFor(() => messages[1].some(m => m.id === 42));
    assert.ok(messages[1].find(m => m.id === 42).error);
    send(0, 43, "unsubscribe", "custom.notice");
    await waitFor(() => messages[0].some(m => m.id === 43));
    send(1, 44, "publish", "custom.notice", "after-unsubscribe");
    await waitFor(() => messages[1].some(m => m.id === 44));
    assert.equal(messages[0].some(m => m.event === "custom.notice" && m.data === "after-unsubscribe"), false);
  } finally {
    for (const client of clients) client.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("custom event limits reject oversized messages and excess subscriptions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-pubsub-limits-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  let client;
  try {
    await initialize(owner);
    client = net.createConnection(socketPath);
    const messages = [];
    let buffer = "";
    client.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) messages.push(JSON.parse(line));
    });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    const send = (id, method, params) => client.write(JSON.stringify({ id, method, params }) + "\n");
    send(50, "publish", { topic: "custom.large", data: "x".repeat(65536) });
    await waitFor(() => messages.some(m => m.id === 50));
    assert.match(messages.find(m => m.id === 50).error.message, /64 KiB/);
    for (let i = 0; i < 129; i++) {
      send(100 + i, "subscribe", { topic: "custom.topic" + i });
    }
    await waitFor(() => messages.some(m => m.id === 228));
    assert.ok(messages.find(m => m.id === 227).result?.accepted);
    assert.match(messages.find(m => m.id === 228).error.message, /Subscription limit/);
    send(230, "unsubscribe", { topic: "custom.topic0" });
    await waitFor(() => messages.some(m => m.id === 230));
    send(231, "subscribe", { topic: "custom.topic128" });
    await waitFor(() => messages.some(m => m.id === 231));
    assert.ok(messages.find(m => m.id === 231).result?.accepted);
  } finally {
    client?.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("custom publish rate limit is per connection", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-rate-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  const clients = [];
  const messages = [];
  try {
    await initialize(owner);
    for (let i = 0; i < 2; i++) {
      const client = net.createConnection(socketPath);
      clients.push(client);
      let buffer = "";
      const received = [];
      messages.push(received);
      client.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line) received.push(JSON.parse(line));
      });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
    }
    for (let i = 0; i < 25; i++) {
      clients[0].write(JSON.stringify({ id: 300 + i, method: "publish", params: { topic: "custom.rate", data: i } }) + "\n");
    }
    await waitFor(() => messages[0].filter(m => m.id >= 300 && m.id < 325).length === 25);
    const results = messages[0].filter(m => m.id >= 300 && m.id < 325);
    assert.equal(results.filter(m => m.result?.accepted).length, 20);
    assert.equal(results.filter(m => /rate exceeded/.test(m.error?.message ?? "")).length, 5);
    clients[1].write(JSON.stringify({ id: 400, method: "publish", params: { topic: "custom.rate" } }) + "\n");
    await waitFor(() => messages[1].some(m => m.id === 400));
    assert.ok(messages[1].find(m => m.id === 400).result?.accepted);
  } finally {
    for (const client of clients) client.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("session-scoped custom events stay isolated from global and other sessions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-scoped-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  const clients = [];
  const messages = [];
  try {
    await initialize(owner);
    for (let i = 0; i < 3; i++) {
      const client = net.createConnection(socketPath);
      clients.push(client);
      let buffer = "";
      const received = [];
      messages.push(received);
      client.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line) received.push(JSON.parse(line));
      });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
    }
    const send = (index, id, method, params) =>
      clients[index].write(JSON.stringify({ id, method, params }) + "\n");
    send(0, 500, "subscribe", { topic: "custom.notice", sessionId: "alpha" });
    send(1, 501, "subscribe", { topic: "custom.notice", sessionId: "beta" });
    send(2, 502, "subscribe", { topic: "custom.notice" });
    await Promise.all(messages.map((received, i) =>
      waitFor(() => received.some(m => m.id === 500 + i))));
    send(2, 503, "publish", { topic: "custom.notice", sessionId: "alpha", data: "alpha-only" });
    await waitFor(() => messages[0].some(m => m.event === "custom.notice"));
    await waitFor(() => messages[2].some(m => m.id === 503));
    assert.equal(messages[0].find(m => m.event === "custom.notice").sessionId, "alpha");
    assert.equal(messages[1].some(m => m.event === "custom.notice"), false);
    assert.equal(messages[2].some(m => m.event === "custom.notice"), false);
    send(2, 504, "publish", { topic: "custom.notice", data: "global-only" });
    await waitFor(() => messages[2].some(m => m.event === "custom.notice"));
    assert.equal(messages[0].filter(m => m.event === "custom.notice").length, 1);
    send(0, 505, "publish", { topic: "custom.notice", sessionId: 12 });
    await waitFor(() => messages[0].some(m => m.id === 505));
    assert.match(messages[0].find(m => m.id === 505).error.message, /sessionId/);
  } finally {
    for (const client of clients) client.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("system event subscriptions filter lifecycle events while legacy clients receive broadcasts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-system-filter-"));
  const socketPath = path.join(dir, "socket");
  const owner = spawnNode(["dist/index.js", "--mcp", "--socket", socketPath]);
  const clients = [];
  const messages = [];
  try {
    await initialize(owner);
    for (let i = 0; i < 2; i++) {
      const client = net.createConnection(socketPath);
      clients.push(client);
      let buffer = "";
      const received = [];
      messages.push(received);
      client.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line) received.push(JSON.parse(line));
      });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
    }
    const send = (i, id, method, params) =>
      clients[i].write(JSON.stringify({ id, method, params }) + "\n");
    send(0, 600, "subscribe", { topic: "session.destroyed", sessionId: "other" });
    await waitFor(() => messages[0].some(m => m.id === 600));
    send(1, 601, "createSession", {});
    await waitFor(() => messages[1].some(m => m.event === "session.created"));
    const sessionId = messages[1].find(m => m.event === "session.created").sessionId;
    assert.equal(messages[0].some(m => m.event === "session.created"), false);
    send(0, 602, "subscribe", { topic: "session.destroyed", sessionId });
    await waitFor(() => messages[0].some(m => m.id === 602));
    send(1, 603, "destroySession", { sessionId });
    await waitFor(() => messages[0].some(m => m.event === "session.destroyed" && m.sessionId === sessionId));
    send(0, 604, "publish", { topic: "session.destroyed", sessionId, data: "fake" });
    await waitFor(() => messages[0].some(m => m.id === 604));
    assert.ok(messages[0].find(m => m.id === 604).error);
  } finally {
    for (const client of clients) client.destroy();
    owner.child.stdin.end();
    await waitFor(() => owner.exit, { timeoutMs: 5000 }).catch(() => owner.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});
