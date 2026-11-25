import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { enableTunnelPingExperiment } from "../src/tunnelPingExperiment.js";

test("tunnel ping echoes requestId as an independent notification", async () => {
  const server = new Server({ name: "test", version: "1" }, { capabilities: {} });
  let fallback = false;
  server.fallbackNotificationHandler = async () => { fallback = true; };
  enableTunnelPingExperiment(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await b.start();
  try {
    const pong = new Promise<unknown>(resolve => { b.onmessage = resolve; });
    await b.send({ jsonrpc: "2.0", method: "notifications/tunnel/test_ping", params: { requestId: 42 } });
    assert.deepEqual(await pong, { jsonrpc: "2.0", method: "notifications/tunnel/test_pong", params: { requestId: 42 } });
    await b.send({ jsonrpc: "2.0", method: "notifications/other" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fallback, true);
  } finally {
    await server.close();
    await b.close();
  }
});
