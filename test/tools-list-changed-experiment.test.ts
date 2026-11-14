import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { enableToolsListChangedExperiment } from "../src/toolsListChangedExperiment.js";

test("experiment sends tools/list_changed after initialized", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: "test-server", version: "1" }, { capabilities: { tools: { listChanged: true } } });
  const client = new Client({ name: "test-client", version: "1" }, { capabilities: {} });
  const notifications: unknown[] = [];
  client.setNotificationHandler(ToolListChangedNotificationSchema, (message) => { notifications.push(message); });
  enableToolsListChangedExperiment(server);
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    await new Promise((resolve) => setTimeout(resolve, 2150));
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], { method: "notifications/tools/list_changed" });
  } finally {
    await client.close();
    await server.close();
  }
});
