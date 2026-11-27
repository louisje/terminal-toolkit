import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleOperatorTool } from "../src/tools/operators.js";
import { storeResult } from "../src/tools/resultStore.js";
import { limitResponseForTool } from "../src/tools/outputLimit.js";

test("read range metadata, negative offsets and suppression", async () => {
  const dir = await mkdtemp(join(tmpdir(), "read-range-"));
  try {
    const path = join(dir, "file");
    const value = "first\n" + "中".repeat(30000) + "\nlast";
    await writeFile(path, value);
    for (const source of [path, storeResult(value)!]) {
      const read = async (offset: number, limit?: number) => limitResponseForTool("read", await handleOperatorTool("read", {path: source, offset, limit}));
      const tail = await read(-1);
      assert.equal(tail.content[0].text, "last");
      assert.deepEqual(JSON.parse(tail.content[1].text.replace("[read-metadata] ", "")), {size: Buffer.byteLength(value), totalLines: 3});
      assert.equal((await read(-100, 1)).content[0].text, "first");
      const large = await read(2, 1);
      assert.match(large.content[0].text, /suppressed/);
      assert.equal(large.content[1].text, tail.content[1].text);
      await assert.rejects(read(0));
      await assert.rejects(read(4), /beyond end/);
    }
    await writeFile(path, "x\n".repeat(1000000));
    const timeout = await handleOperatorTool("read", {path, offset: -1, timeout: 0.001});
    assert.match(timeout.content[1].text, /"timedOut":true/);
    const controller = new AbortController();
    const pending = handleOperatorTool("read", {path}, undefined, controller.signal);
    controller.abort();
    await assert.rejects(pending, /aborted/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
