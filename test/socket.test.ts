import test from "node:test";
import assert from "node:assert/strict";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { once } from "events";
import { createToolProxyServer } from "../src/transport/socket.ts";
import { TerminalManager } from "../src/terminal/index.js";

test("createToolProxyServer forwards clientConnected notifications to the interactive notifier", async () => {
  const socketPath = path.join(os.tmpdir(), `terminal-toolkit-test-${process.pid}-${Date.now()}.sock`);
  const notifications: Array<{ title?: string }> = [];
  const server = createToolProxyServer(
    socketPath,
    {} as TerminalManager,
    (params) => notifications.push(params)
  );

  const socketsToClose: net.Socket[] = [];

  try {
    if (!server.listening) {
      await once(server, "listening");
    }

    const client = net.createConnection(socketPath);
    socketsToClose.push(client);
    await once(client, "connect");

    const responsePromise = new Promise<string>((resolve, reject) => {
      let buffer = "";
      client.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        if (lines[0]) {
          resolve(lines[0]);
        }
      });
      client.on("error", reject);
    });

    client.write(JSON.stringify({
      id: 1,
      method: "clientConnected",
      params: { title: "Augment" },
    }) + "\n");

    const response = JSON.parse(await responsePromise) as { id: number; result?: unknown };

    assert.equal(response.id, 1);
    assert.deepEqual(response.result, { ok: true });
    assert.deepEqual(notifications, [{ title: "Augment" }]);
  } finally {
    for (const socket of socketsToClose) {
      socket.destroy();
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.unlink(socketPath).catch(() => undefined);
  }
});
test("socket extra operators require independent per-connection opt-in", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-extra-socket-"));
  const socketPath = path.join(dir, "proxy.sock");
  const server = createToolProxyServer(socketPath, {} as TerminalManager);
  const clients: net.Socket[] = [];
  try {
    if (!server.listening) await once(server, "listening");
    async function connect() {
      const socket = net.createConnection(socketPath);
      clients.push(socket);
      await once(socket, "connect");
      let buffer = "";
      const pending = new Map<number, (value: any) => void>();
      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) if (line) {
          const response = JSON.parse(line);
          pending.get(response.id)?.(response);
          pending.delete(response.id);
        }
      });
      return (id: number, method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve) => {
        pending.set(id, resolve);
        socket.write(JSON.stringify({ id, method, params }) + "\n");
      });
    }
    const a = await connect();
    const b = await connect();
    assert.match((await a(1, "ls", { path: dir })).error.message, /Unknown tool/);
    assert.deepEqual((await a(2, "clientConnected", { piExtraOperators: true })).result, { ok: true });
    assert.ok((await a(3, "ls", { path: dir })).result);
    assert.match((await a(4, "read", { path: socketPath })).error.message, /Unknown tool/);
    assert.match((await b(5, "ls", { path: dir })).error.message, /Unknown tool/);
    await b(6, "clientConnected", { piOperators: true });
    assert.match((await b(7, "ls", { path: dir })).error.message, /Unknown tool/);
    assert.ok((await b(8, "read", { path: path.join(dir, "missing") })).error);
    await b(9, "clientConnected", { piExtraOperators: true });
    assert.ok((await b(10, "ls", { path: dir })).result);
  } finally {
    clients.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
