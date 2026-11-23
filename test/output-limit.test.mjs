import { test } from "node:test";
import { strict as assert } from "node:assert";
import { limitTextBlock, limitToolResponse, limitReadResponse, limitResponseForTool } from "../src/tools/outputLimit.ts";
import { readResult } from "../src/tools/resultStore.ts";

test("text blocks are limited independently by UTF-8 bytes", () => {
  assert.equal(limitTextBlock("中".repeat(5461)), "中".repeat(5461));
  const saved = limitTextBlock("中".repeat(5462));
  assert.match(saved, /result:\/\//);
  assert.equal(readResult(saved.match(/result:\/\/[^. ]+/)[0]), "中".repeat(5462));
  const original = { isError: false, structuredContent: { long: "x".repeat(20000) }, content: [
    { type: "text", text: "ok" },
    { type: "text", text: "x".repeat(16385) },
    { type: "text", text: "still ok" },
    { type: "image", data: "x".repeat(20000), mimeType: "image/png" },
  ] };
  const result = limitToolResponse(original);
  assert.equal(result.isError, false);
  assert.equal(result.content[0].text, "ok");
  assert.equal(readResult(result.content[1].text.match(/result:\/\/[^. ]+/)[0]), "x".repeat(16385));
  assert.match(limitReadResponse(original).content[1].text, /suppressed/);
  assert.equal(result.content[2].text, "still ok");
  assert.equal(result.content[3].data.length, 20000);
  assert.equal(result.structuredContent.long.length, 20000);
});

test("Skills discovery and read suppress oversized output without creating result references", () => {
  const response = { content: [{ type: "text", text: "x".repeat(16385) }] };
  for (const name of ["read", "searchSkills", "describeSkill"]) {
    const text = limitResponseForTool(name, response).content[0].text;
    assert.match(text, /suppressed/);
    assert.doesNotMatch(text, /result:\/\//);
  }
  const text = limitResponseForTool("grep", response).content[0].text;
  assert.match(text, /result:\/\//);
});
