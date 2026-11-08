import test from "node:test";
import assert from "node:assert/strict";
import { notifySchema, isTermuxEnvironment, termuxNotificationCommands } from "../src/tools/notify.ts";

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


test("Termux detection requires Android and a Termux environment", () => {
  assert.equal(isTermuxEnvironment("android", { TERMUX_VERSION: "0.119" } as NodeJS.ProcessEnv), true);
  assert.equal(isTermuxEnvironment("android", { PREFIX: "/data/data/com.termux/files/usr" } as NodeJS.ProcessEnv), true);
  assert.equal(isTermuxEnvironment("linux", { TERMUX_VERSION: "0.119" } as NodeJS.ProcessEnv), false);
  assert.equal(isTermuxEnvironment("android", {} as NodeJS.ProcessEnv), false);
});

test("Termux notification sends notification and toast without extra options", () => {
  const commands = termuxNotificationCommands({ message: "繁體中文 'test'\nnext", sound: false, title: "Toolkit" });
  assert.deepEqual(commands, [
    { command: "termux-notification", args: ["--title", "Toolkit", "--content", "繁體中文 'test'\nnext"] },
    { command: "termux-toast", args: ["繁體中文 'test'\nnext"] },
  ]);
  assert.ok(termuxNotificationCommands({ message: "hi" })[0].args.includes("--sound"));
});

test("Termux notification integration (opt in)", {
  skip: process.env.RUN_NOTIFY_TEST !== "1" ? "Set RUN_NOTIFY_TEST=1 to display a real notification and toast" : false,
}, async () => {
  const { handleNotify } = await import("../src/tools/notify.ts");
  const result = await handleNotify(null!, { title: "Terminal Toolkit", message: "Notification + Toast 測試", sound: false });
  assert.equal(result.isError, undefined, JSON.stringify(result));
});
