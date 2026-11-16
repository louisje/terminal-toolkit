import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enableMcpEventsExperiment, emitTerminalTest } from "../src/mcpEventsExperiment.ts";

test("MCP Events advertises terminal.test and validates subscriptions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tt-events-"));
  const oldState = process.env.TERMINAL_TOOLKIT_EVENTS_STATE;
  process.env.TERMINAL_TOOLKIT_EVENTS_STATE = join(dir, "subscriptions.json");
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
    const secret = "whsec_" + Buffer.alloc(32, 1).toString("base64");
    const subscribe = handlers.get("events/subscribe");
    await assert.rejects(subscribe({ method: "events/subscribe", params: {
      name: "terminal.test", arguments: {}, delivery: { mode: "webhook", url: "http://example.com", secret },
    } }), /HTTPS/);
    await assert.rejects(subscribe({ method: "events/subscribe", params: {
      name: "terminal.test", arguments: {}, delivery: { mode: "webhook", url: "https://127.0.0.1/callback", secret },
    } }), /HTTPS/);
    await assert.rejects(subscribe({ method: "events/subscribe", params: {
      name: "terminal.test", arguments: { unexpected: true }, delivery: { mode: "webhook", url: "https://example.com", secret },
    } }), /Invalid terminal.test/);
    const emitted = await emitTerminalTest("hello");
    assert.equal(emitted.attempted, 0);
    assert.equal(emitted.delivered, 0);
    assert.match(emitted.eventId, /^evt_/);
    assert.ok(Number.isFinite(Date.parse(emitted.timestamp)));
    assert.deepEqual(emitted.responses, []);
    await assert.rejects(emitTerminalTest("hello", "sub_missing"), /No active subscription/);
    assert.deepEqual(await handlers.get("events/unsubscribe")({ method: "events/unsubscribe", params: {
      name: "terminal.test", arguments: {}, delivery: { mode: "webhook", url: "https://example.com" },
    } }), {});
    assert.equal(JSON.stringify(logs).includes(secret), false);
  } finally {
    console.error = oldError;
    if (oldState === undefined) delete process.env.TERMINAL_TOOLKIT_EVENTS_STATE;
    else process.env.TERMINAL_TOOLKIT_EVENTS_STATE = oldState;
    await rm(dir, { recursive: true, force: true });
  }
});
