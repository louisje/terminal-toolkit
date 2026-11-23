import { test } from "node:test";
import { strict as assert } from "node:assert";
import { limitToolResponse, limitReadResponse } from "../src/tools/outputLimit.ts";
import { readResult } from "../src/tools/resultStore.ts";
import { handleOperatorTool } from "../src/tools/operators.ts";
import { handleExtraOperatorTool } from "../src/tools/extra-operators.ts";

const pathFrom = (message) => message.match(/result:\/\/[0-9a-f-]{36}/)?.[0];

test("oversized entity can be read by line and searched through VFS", async () => {
  const text = Array.from({ length: 3000 }, (_, i) => i === 1234 ? "needle unique" : "line " + i).join("\n");
  const response = limitToolResponse({ content: [{type:"text",text}, {type:"text",text:"small"}, {type:"image",data:"abc"}] });
  const path = pathFrom(response.content[0].text);
  assert.ok(path);
  assert.equal(readResult(path), text);
  assert.equal(response.content[1].text, "small");
  assert.equal(response.content[2].data, "abc");
  const read = await handleOperatorTool("read", { path, offset: 1235, limit: 1 });
  assert.equal(read.content[0].text, "needle unique");
  const grep = await handleExtraOperatorTool("grep", { path, pattern: "needle" });
  assert.match(grep.content[0].text, /:1235:needle unique/);
  await assert.rejects(handleOperatorTool("write", {path,content:"x"}), /read-only/);
  await assert.rejects(handleOperatorTool("edit", {path,edits:[{oldText:"line",newText:"x"}]}), /read-only/);
  assert.match(limitReadResponse({content:[{type:"text",text}]}).content[0].text, /suppressed/);
  assert.throws(() => readResult("result://invalid"), /Invalid/);
});
