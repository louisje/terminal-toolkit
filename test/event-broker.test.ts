import test from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "node:net";
import {
  acceptsSystemEvent, createBrokerConnection, handleBrokerRequest, subscriptionKey,
} from "../src/transport/event-broker.js";

function mockSocket() {
  const writes: string[] = [];
  let destroyed = false;
  let writableLength = 0;
  const socket = {
    get destroyed() { return destroyed; },
    get writableLength() { return writableLength; },
    write(message: string) { writes.push(message); return true; },
    destroy() { destroyed = true; return socket; },
  } as unknown as Socket;
  return { socket, writes, get destroyed() { return destroyed; }, set pending(value: number) { writableLength = value; } };
}

test("subscriptions are scoped and can be removed independently", () => {
  const receiver = mockSocket();
  const sender = mockSocket();
  const a = createBrokerConnection(receiver.socket);
  const b = createBrokerConnection(sender.socket);
  const request = (method: "subscribe" | "unsubscribe" | "publish", params: Record<string, unknown>) =>
    handleBrokerRequest(method, params, 2, b, [a, b]);
  handleBrokerRequest("subscribe", { topic: "custom.msg", sessionId: "alpha" }, 1, a, [a, b]);
  handleBrokerRequest("subscribe", { topic: "custom.msg" }, 1, a, [a, b]);
  request("publish", { topic: "custom.msg", sessionId: "beta" });
  assert.equal(receiver.writes.length, 0);
  request("publish", { topic: "custom.msg", sessionId: "alpha" });
  request("publish", { topic: "custom.msg" });
  assert.equal(receiver.writes.length, 2);
  assert.equal(JSON.parse(receiver.writes[0]).sessionId, "alpha");
  handleBrokerRequest("unsubscribe", { topic: "custom.msg", sessionId: "alpha" }, 1, a, [a, b]);
  request("publish", { topic: "custom.msg", sessionId: "alpha" });
  request("publish", { topic: "custom.msg" });
  assert.equal(receiver.writes.length, 3);
  assert.equal(a.subscriptions.has(subscriptionKey("custom.msg")), true);
});

test("system event filter preserves legacy behavior and rejects forged events", () => {
  const c = createBrokerConnection(mockSocket().socket);
  assert.equal(acceptsSystemEvent(c, "session.created", "a"), true);
  handleBrokerRequest("subscribe", { topic: "session.destroyed", sessionId: "a" }, 1, c, [c]);
  assert.equal(acceptsSystemEvent(c, "session.created", "a"), false);
  assert.equal(acceptsSystemEvent(c, "session.destroyed", "a"), true);
  assert.equal(acceptsSystemEvent(c, "session.destroyed", "b"), false);
  assert.match(handleBrokerRequest("publish", { topic: "session.destroyed" }, 1, c, [c]).error?.message ?? "", /Invalid/);
});

test("token bucket refills over elapsed time and is isolated per connection", () => {
  const a = createBrokerConnection(mockSocket().socket);
  const b = createBrokerConnection(mockSocket().socket);
  const publish = (c: typeof a) => handleBrokerRequest("publish", { topic: "custom.rate" }, 1, c, []);
  for (let i = 0; i < 20; i++) assert.ok(publish(a).result);
  assert.match(publish(a).error?.message ?? "", /rate exceeded/);
  assert.ok(publish(b).result);
  a.lastPublishRefill -= 1000;
  assert.ok(publish(a).result);
  assert.ok(a.publishTokens >= 8 && a.publishTokens <= 10);
});

test("slow subscribers are disconnected without blocking other subscribers", () => {
  const slow = mockSocket();
  const fast = mockSocket();
  const publisher = mockSocket();
  const a = createBrokerConnection(slow.socket);
  const b = createBrokerConnection(fast.socket);
  const c = createBrokerConnection(publisher.socket);
  for (const receiver of [a, b]) {
    handleBrokerRequest("subscribe", { topic: "custom.notice" }, 1, receiver, [a, b, c]);
  }
  slow.pending = 1024 * 1024;
  const result = handleBrokerRequest("publish", { topic: "custom.notice", data: "hello" }, 3, c, [a, b, c]);
  assert.ok(result.result);
  assert.equal(slow.destroyed, true);
  assert.equal(fast.destroyed, false);
  assert.equal(fast.writes.length, 1);
});

test("subscription cap, duplicate subscription, payload cap and validation", () => {
  const c = createBrokerConnection(mockSocket().socket);
  for (let i = 0; i < 128; i++) {
    assert.ok(handleBrokerRequest("subscribe", { topic: `custom.t${i}` }, 1, c, [c]).result);
  }
  assert.ok(handleBrokerRequest("subscribe", { topic: "custom.t0" }, 1, c, [c]).result);
  assert.match(handleBrokerRequest("subscribe", { topic: "custom.extra" }, 1, c, [c]).error?.message ?? "", /limit/);
  assert.match(handleBrokerRequest("publish", { topic: "custom.t0", data: "x".repeat(65536) }, 1, c, [c]).error?.message ?? "", /64 KiB/);
  assert.match(handleBrokerRequest("subscribe", { topic: "custom.ok", sessionId: 42 }, 1, c, [c]).error?.message ?? "", /sessionId/);
});
