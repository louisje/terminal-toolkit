import { test } from "node:test";
import { strict as assert } from "node:assert";
import { enableMcpEventsExperiment } from "../src/mcpEventsExperiment.ts";

test("MCP Events experiment advertises one event and refuses unverified subscriptions", async () => {
  const handlers = new Map();
  const server = { setRequestHandler(schema, handler) {
    for (const method of ["events/list", "events/subscribe", "events/unsubscribe"]) {
      if (schema.safeParse({ method }).success) handlers.set(method, handler);
    }
  } };
  const oldError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    enableMcpEventsExperiment(server);
    assert.equal(handlers.size, 3);
    const catalog = await handlers.get("events/list")({ method: "events/list" });
    assert.equal(catalog.events[0].name, "terminal.test");
    assert.deepEqual(catalog.events[0].delivery, ["webhook"]);
    const secret = "whsec_dont-log-this";
    await assert.rejects(handlers.get("events/subscribe")({
      method: "events/subscribe",
      params: { name: "terminal.test", delivery: { mode: "webhook", url: "https://example.com", secret } },
    }), /not implemented/);
    assert.equal(JSON.stringify(logs).includes(secret), false);
    assert.deepEqual(await handlers.get("events/unsubscribe")({ method: "events/unsubscribe" }), {});
  } finally {
    console.error = oldError;
  }
});
