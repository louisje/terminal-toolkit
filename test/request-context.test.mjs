import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequestContext, requestContextStorage } from "../src/requestContext.ts";

test("missing or unrelated metadata produces an anonymous context", () => {
  for (const value of [undefined, null, "", [], 42, {}, { "other/provider": "id" }]) {
    assert.deepEqual(createRequestContext(value), {});
  }
});

test("OpenAI identifiers are deterministic, isolated by field and never exposed raw", () => {
  const meta = {
    "openai/session": "shared-opaque-token",
    "openai/subject": "shared-opaque-token",
    "openai/organization": "shared-opaque-token",
  };
  const first = createRequestContext(meta);
  const second = createRequestContext(meta);
  assert.deepEqual(first, second);
  assert.equal(first.provider, "openai");
  for (const key of ["conversationId", "subjectId", "organizationId"]) {
    assert.match(first[key], /^[0-9a-f]{64}$/);
    assert.notEqual(first[key], "shared-opaque-token");
  }
  assert.equal(new Set([first.conversationId, first.subjectId, first.organizationId]).size, 3);
  assert.equal(JSON.stringify(first).includes("shared-opaque-token"), false);
});

test("conversations remain distinct for the same subject and organization", () => {
  const base = { "openai/subject": "person", "openai/organization": "team" };
  const a = createRequestContext({ ...base, "openai/session": "conversation-A" });
  const b = createRequestContext({ ...base, "openai/session": "conversation-B" });
  assert.notEqual(a.conversationId, b.conversationId);
  assert.equal(a.subjectId, b.subjectId);
  assert.equal(a.organizationId, b.organizationId);
});

test("invalid identifiers are ignored independently", () => {
  assert.deepEqual(createRequestContext({
    "openai/session": 42,
    "openai/subject": "valid",
    "openai/organization": {},
  }), { provider: "openai", subjectId: createRequestContext({ "openai/subject": "valid" }).subjectId });
  assert.deepEqual(createRequestContext({ "openai/session": "", "openai/subject": null }), {});
});

test("request context stays isolated across concurrent asynchronous operations", async () => {
  const a = createRequestContext({ "openai/session": "A" });
  const b = createRequestContext({ "openai/session": "B" });
  const barrier = Promise.withResolvers();
  const first = requestContextStorage.run(a, async () => {
    await barrier.promise;
    await Promise.resolve();
    assert.equal(requestContextStorage.getStore(), a);
  });
  const second = requestContextStorage.run(b, async () => {
    assert.equal(requestContextStorage.getStore(), b);
    barrier.resolve();
    await Promise.resolve();
    assert.equal(requestContextStorage.getStore(), b);
  });
  await Promise.all([first, second]);
  assert.equal(requestContextStorage.getStore(), undefined);
});
