import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handleGetClipboard } from "../src/tools/getClipboard.ts";
import { handleSetClipboard } from "../src/tools/setClipboard.ts";

/**
 * Real clipboard integration test. Opt in explicitly because it temporarily
 * replaces the user's OS-wide clipboard.
 *
 * RUN_CLIPBOARD_TEST=1 node --test --import tsx test/clipboard.test.ts
 */
test("clipboard read/write round-trip through the host backend", {
  skip: process.env.RUN_CLIPBOARD_TEST !== "1"
    ? "Set RUN_CLIPBOARD_TEST=1 to temporarily modify the system clipboard"
    : false,
}, async () => {
  const original = (await handleGetClipboard(null!, {})).content[0].text;
  const expected = `terminal-toolkit-clipboard-${randomUUID()}\n繁體中文 🎉\nsecond line`;
  try {
    const written = await handleSetClipboard(null!, { text: expected });
    assert.match(written.content[0].text, /Clipboard set/);
    const actual = (await handleGetClipboard(null!, {})).content[0].text;
    assert.equal(actual, expected);
  } finally {
    await handleSetClipboard(null!, { text: original });
  }
});
