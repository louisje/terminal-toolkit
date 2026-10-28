import test from "node:test";
import assert from "node:assert/strict";
import { notifySchema } from "../src/tools/notify.ts";

test("notifySchema requires a non-empty message", () => {
  assert.throws(() => notifySchema.parse({}));
  assert.throws(() => notifySchema.parse({ message: "" }));
});

test("notifySchema defaults title and sound", () => {
  const parsed = notifySchema.parse({ message: "hello" });
  assert.equal(parsed.title, "Terminal Toolkit");
  assert.equal(parsed.sound, true);
});

test("notifySchema accepts custom title and sound", () => {
  const parsed = notifySchema.parse({
    message: "hello",
    title: "Custom",
    sound: false,
  });
  assert.equal(parsed.title, "Custom");
  assert.equal(parsed.sound, false);
});
