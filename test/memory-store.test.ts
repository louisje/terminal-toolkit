import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRequestContext, requestContextStorage } from "../src/requestContext.js";
import { handleOperatorTool } from "../src/tools/operators.js";
import { handleExtraOperatorTool } from "../src/tools/extra-operators.js";

const path = "memory://scratchpad.md";
const run = (id: string, fn: () => Promise<void>) => requestContextStorage.run(createRequestContext({"openai/session": id}), fn);
test("scratchpad isolates concurrent conversations and supports core operations", async () => {
  await Promise.all(["A", "B"].map(id => run(id, async () => {
    await assert.rejects(handleOperatorTool("read", {path}), /not found/);
    await handleOperatorTool("write", {path, content: id + "\nnext"});
    await handleOperatorTool("edit", {path, edits: [{oldText:"next", newText:"done"}]});
    assert.equal((await handleOperatorTool("read", {path})).content[0].text, id + "\ndone");
    assert.equal((await handleOperatorTool("read", {path, offset:-1})).content[0].text, "done");
    assert.equal((await handleExtraOperatorTool("list", {path:"memory://"})).content[0].text, "scratchpad.md");
    assert.equal((await handleExtraOperatorTool("find", {path:"memory://", pattern:"*.md"})).content[0].text, path);
    assert.match((await handleExtraOperatorTool("grep", {path:"memory://", pattern:id})).content[0].text, /scratchpad.md:1:/);
    await assert.rejects(handleOperatorTool("write", {path, content:"中".repeat(6000)}), /16 KiB/);
    await assert.rejects(handleOperatorTool("write", {path:"memory://../scratchpad.md", content:"bad"}), /Only/);
    assert.equal((await handleOperatorTool("read", {path})).content[0].text, id + "\ndone");
  })));
  await assert.rejects(handleOperatorTool("read", {path}), /identity/);
  await assert.rejects(handleOperatorTool("write", {path, content:"bad"}), /identity/);
  await assert.rejects(handleExtraOperatorTool("list", {path:"memory://"}), /identity/);
});
