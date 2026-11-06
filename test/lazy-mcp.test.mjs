import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnNode, initialize, callTool, findResponse, waitFor } from "./helpers.mjs";

async function withMcp(codemode, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-lazy-"));
  const socket = path.join(dir, "terminal.sock");
  const args = ["dist/index.js", "--mcp", "--socket", socket, ...(codemode ? ["--codemode"] : [])];
  const first = spawnNode(args);
  let second;
  try {
    await initialize(first);
    await fn({ first, socket, connect: async () => {
      second = spawnNode(args);
      await initialize(second);
      return second;
    } });
  } finally {
    for (const child of [second, first]) {
      if (!child) continue;
      child.child.stdin.end();
      await waitFor(() => child.exit, { timeoutMs: 5000 }).catch(() => child.child.kill());
    }
    await rm(dir, { recursive: true, force: true });
  }
}
async function sessions(state, id, codemode) {
  if (codemode) callTool(state, id, "codemode", { code: "text(await tools.listSessions({}))" });
  else callTool(state, id, "listSessions");
  const response = await waitFor(() => findResponse(state, id), { timeoutMs: 10000 });
  assert.ok(!response.result?.isError, JSON.stringify(response));
  const raw = response.result.content.map(x => x.text ?? "").join("\n");
  return JSON.parse(raw);
}
test("MCP creates a lazy default session and reports the attached client", async () => {
  await withMcp(false, async ({ first, connect }) => {
    const initial = await sessions(first, 10, false);
    assert.equal(initial.sessions[0].mode, "uninitialized");
    assert.equal(initial.sessions[0].role, "server");
    assert.equal(initial.sessions[0].clientCount, 1);
    const second = await connect();
    const remote = await sessions(second, 11, false);
    assert.equal(remote.sessions[0].role, "client");
    assert.equal(remote.sessions[0].mode, "uninitialized");
    assert.equal(remote.sessions[0].clientCount, 2);
    const again = await sessions(first, 12, false);
    assert.equal(again.sessions[0].clientCount, 2);
  });
});
test("codemode sees client role without creating a default PTY", async () => {
  await withMcp(true, async ({ first, connect }) => {
    const second = await connect();
    const remote = await sessions(second, 20, true);
    assert.equal(remote.sessions[0].role, "client");
    assert.equal(remote.sessions[0].mode, "uninitialized");
    assert.equal(remote.sessions[0].clientCount, 2);
    const owner = await sessions(first, 21, true);
    assert.equal(owner.sessions[0].role, "server");
  });
});

test("first terminal operation initializes default while listing does not", async () => {
  await withMcp(false, async ({ first }) => {
    const before = await sessions(first, 30, false);
    assert.equal(before.sessions[0].mode, "uninitialized");
    callTool(first, 31, "type", { text: "echo lazy-session-ready\n" });
    const typed = await waitFor(() => findResponse(first, 31), { timeoutMs: 10000 });
    assert.ok(!typed.result?.isError, JSON.stringify(typed));
    const after = await sessions(first, 32, false);
    assert.equal(after.sessions[0].mode, "interactive");
    assert.equal(after.sessions[0].role, "server");
    assert.equal(after.sessions[0].clientCount, 1);
  });
});

test("disconnecting a client decrements the socket connection count", async () => {
  await withMcp(false, async ({ first, connect }) => {
    const second = await connect();
    assert.equal((await sessions(first, 40, false)).sessions[0].clientCount, 2);
    second.child.stdin.end();
    await waitFor(() => second.exit);
    const current = await sessions(first, 41, false);
    assert.equal(current.sessions[0].clientCount, 1);
  });
});

test("multiple concurrent default operations initialize only one session", async () => {
  await withMcp(false, async ({ first }) => {
    callTool(first, 50, "type", { text: "echo concurrent\n" });
    callTool(first, 51, "getContent");
    for (const id of [50, 51]) {
      const response = await waitFor(() => findResponse(first, id));
      assert.ok(!response.result?.isError, JSON.stringify(response));
    }
    const listing = await sessions(first, 52, false);
    assert.equal(listing.sessions.filter(x => x.isDefault).length, 1);
    assert.equal(listing.sessions[0].mode, "interactive");
  });
});

test("new owner starts after previous owner exits and releases socket", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-restart-"));
  const socket = path.join(dir, "terminal.sock");
  const args = ["dist/index.js", "--mcp", "--socket", socket];
  const first = spawnNode(args);
  let next;
  try {
    await initialize(first);
    assert.equal((await sessions(first, 60, false)).sessions[0].role, "server");
    first.child.stdin.end();
    await waitFor(() => first.exit);
    next = spawnNode(args);
    await initialize(next);
    const listing = await sessions(next, 61, false);
    assert.equal(listing.sessions[0].role, "server");
    assert.equal(listing.sessions[0].mode, "uninitialized");
  } finally {
    for (const state of [next, first]) {
      if (!state || state.exit) continue;
      state.child.stdin.end();
      await waitFor(() => state.exit, { timeoutMs: 3000 }).catch(() => state.child.kill());
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale socket path is reclaimed when the prior server is gone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-stale-"));
  const socket = path.join(dir, "terminal.sock");
  // A stale socket pathname with no listener must not prevent startup.
  await writeFile(socket, "stale");
  const state = spawnNode(["dist/index.js", "--mcp", "--socket", socket]);
  try {
    await initialize(state);
    const listing = await sessions(state, 70, false);
    assert.equal(listing.sessions[0].role, "server");
    assert.equal(listing.sessions[0].mode, "uninitialized");
  } finally {
    state.child.stdin.end();
    await waitFor(() => state.exit, { timeoutMs: 3000 }).catch(() => state.child.kill());
    await rm(dir, { recursive: true, force: true });
  }
});

test("attached MCP client exits when its socket owner dies unexpectedly", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tt-owner-dies-"));
  const socket = path.join(dir, "terminal.sock");
  const args = ["dist/index.js", "--mcp", "--socket", socket];
  const owner = spawnNode(args);
  let client;
  try {
    await initialize(owner);
    client = spawnNode(args);
    await initialize(client);
    assert.equal((await sessions(client, 80, false)).sessions[0].role, "client");
    owner.child.kill("SIGKILL");
    await waitFor(() => owner.exit);
    await waitFor(() => client.exit, { timeoutMs: 5000 });
    assert.equal(client.exit.code, 1);
    assert.match(client.stderr, /Socket closed/);
  } finally {
    for (const state of [client, owner]) {
      if (state && !state.exit) state.child.kill("SIGKILL");
    }
    await rm(dir, { recursive: true, force: true });
  }
});
