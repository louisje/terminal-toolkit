import { test } from "node:test";
import { strict as assert } from "node:assert";
import { limitTextBlock, limitToolResponse } from "../src/tools/outputLimit.ts";

test("text blocks are limited independently by UTF-8 bytes", () => {
  assert.equal(limitTextBlock("中".repeat(2730)), "中".repeat(2730));
  assert.match(limitTextBlock("中".repeat(2731)), /exceeded the 8 KiB/);
  const original = { isError: false, structuredContent: { long: "x".repeat(10000) }, content: [
    { type: "text", text: "ok" },
    { type: "text", text: "x".repeat(8193) },
    { type: "text", text: "still ok" },
    { type: "image", data: "x".repeat(12000), mimeType: "image/png" },
  ] };
  const result = limitToolResponse(original);
  assert.equal(result.isError, false);
  assert.equal(result.content[0].text, "ok");
  assert.match(result.content[1].text, /exceeded the 8 KiB/);
  assert.equal(result.content[2].text, "still ok");
  assert.equal(result.content[3].data.length, 12000);
  assert.equal(result.structuredContent.long.length, 10000);
});
