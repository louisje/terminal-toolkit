import { test } from "node:test";
import { strict as assert } from "node:assert";
import { limitCodemodeText, limitResponseForTool } from "../src/tools/outputLimit.ts";
import { readResult } from "../src/tools/resultStore.ts";

test("text blocks are limited independently by UTF-8 bytes", () => {
  const emit = text => limitResponseForTool("shell", {content: [{type: "text", text}]}).content[0].text;
  assert.equal(emit("中".repeat(5461)), "中".repeat(5461));
  const saved = emit("中".repeat(5462));
  assert.match(saved, /result:\/\//);
  assert.equal(readResult(saved.match(/result:\/\/[^. ]+/)[0]), "中".repeat(5462));
  const original = { isError: false, structuredContent: { long: "x".repeat(20000) }, content: [
    { type: "text", text: "ok" },
    { type: "text", text: "x".repeat(16385) },
    { type: "text", text: "still ok" },
    { type: "image", data: "x".repeat(20000), mimeType: "image/png" },
  ] };
  const result = limitResponseForTool("shell", original);
  assert.equal(result.isError, false);
  assert.equal(result.content[0].text, "ok");
  assert.equal(readResult(result.content[1].text.match(/result:\/\/[^. ]+/)[0]), "x".repeat(16385));
  assert.match(limitResponseForTool("read", original).content[1].text, /suppressed/);
  assert.equal(result.content[2].text, "still ok");
  assert.equal(result.content[3].data.length, 20000);
  assert.equal(result.structuredContent.long.length, 20000);
});

test("Skills discovery is unlimited, read and Codemode text suppress, other tools store", () => {
  const response = { content: [{ type: "text", text: "x".repeat(16385) }] };
  for (const name of ["searchSkills", "describeSkill"]) {
    assert.equal(limitResponseForTool(name, response), response);
  }
  const suppressed = limitResponseForTool("read", response).content[0].text;
  assert.match(suppressed, /suppressed/);
  assert.doesNotMatch(suppressed, /result:\/\//);
  const emitted = limitCodemodeText(response.content[0].text);
  assert.match(emitted, /suppressed/);
  assert.doesNotMatch(emitted, /result:\/\//);
  const text = limitResponseForTool("grep", response).content[0].text;
  assert.match(text, /result:\/\//);
});
