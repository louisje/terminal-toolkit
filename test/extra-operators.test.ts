import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getToolDefinitions } from "../src/tools/definitions.ts";
import { handleExtraOperatorTool } from "../src/tools/extra-operators.ts";
import { storeResult } from "../src/tools/resultStore.ts";
import { executionManager } from "../src/tools/runtime.ts";

test("grep shares the 50 KiB output limit across all sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-grep-size-"));
  const content = ("needle " + "x".repeat(12000) + "\n").repeat(100);
  const execution = await executionManager.start({tool:"shell",command:process.execPath,args:["-e","process.stdout.write(('needle '+'x'.repeat(12000)+'\\n').repeat(100))"],cwd:dir});
  try {
    await execution.ready; execution.detach(); await execution.done;
    const file = join(dir,"sample.txt");
    await writeFile(file,content);
    for (const path of [file,storeResult(content)!, "execution://"+execution.info.executionId+"/stdout"]) {
      const small = (await handleExtraOperatorTool("grep",{path,pattern:"needle",limit:2})).content[0].text;
      assert.ok(Buffer.byteLength(small)>24000 && Buffer.byteLength(small)<51200);
      assert.doesNotMatch(small,/results truncated/);
      const large = (await handleExtraOperatorTool("grep",{path,pattern:"needle"})).content[0].text;
      assert.match(large,/50KB limit reached/);
      assert.ok(Buffer.byteLength(large)<=51200+100);
    }
  } finally { execution.cancel(); await execution.done; await executionManager.remove(execution.info.executionId); await rm(dir,{recursive:true,force:true}); }
});

test("core operators are always enabled; extra operators are optional", () => {
  for (const [extra, expected] of [[false, 27], [true, 30]] as const) {
    const names = getToolDefinitions(extra).map((tool) => tool.name);
    assert.equal(names.length, expected);
    for (const name of ["read", "write", "edit", "shell"]) assert.ok(names.includes(name));
    for (const name of ["list", "grep", "find"]) assert.equal(names.includes(name), extra);
  }
});
test("list lists directories and respects limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-extra-"));
  try {
    await mkdir(join(dir, "folder"));
    await writeFile(join(dir, ".hidden"), "x");
    const result = await handleExtraOperatorTool("list", { path: dir });
    assert.equal(result.content[0]?.text, ".hidden\nfolder/");
    const limited = await handleExtraOperatorTool("list", { path: dir, limit: 1 });
    assert.match(limited.content[0]?.text ?? "", /limit reached/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("grep searches text with line numbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-extra-"));
  try {
    await writeFile(join(dir, "sample.txt"), "alpha\nbeta\nalpha\n");
    const result = await handleExtraOperatorTool("grep", { pattern: "alpha", path: dir });
    assert.match(result.content[0]?.text ?? "", /1:alpha/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("find uses installed fd to search glob patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-find-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "sample.ts"), "export const ok = true;\n");
    await writeFile(join(dir, "src", "sample.txt"), "not typescript\n");
    const found = await handleExtraOperatorTool("find", { path: dir, pattern: "*.ts" });
    assert.match(found.content[0]?.text ?? "", /sample\.ts/);
    assert.doesNotMatch(found.content[0]?.text ?? "", /sample\.txt/);
    const nested = await handleExtraOperatorTool("find", { path: dir, pattern: "src/*.ts" });
    assert.match(nested.content[0]?.text ?? "", /sample\.ts/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("grep limit counts matches, not context lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-grep-limit-"));
  try {
    await writeFile(join(dir, "sample.txt"), "before\nneedle one\nbetween\nneedle two\nafter\n");
    const result = await handleExtraOperatorTool("grep", { pattern: "needle", path: dir, context: 1, limit: 1 });
    const text = result.content[0]?.text ?? "";
    assert.match(text, /needle one/);
    assert.doesNotMatch(text, /needle two/);
    assert.match(text, /1 matches limit reached/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("find and grep respect .gitignore inside git repositories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-ignore-"));
  try {
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".gitignore"), "ignored.txt\n");
    await writeFile(join(dir, "ignored.txt"), "unique_test_needle\n");
    await writeFile(join(dir, "visible.txt"), "unique_test_needle\n");
    const found = (await handleExtraOperatorTool("find", { path: dir, pattern: "*.txt" })).content[0]?.text ?? "";
    assert.match(found, /visible\.txt/);
    assert.doesNotMatch(found, /ignored\.txt/);
    const matched = (await handleExtraOperatorTool("grep", { path: dir, pattern: "unique_test_needle" })).content[0]?.text ?? "";
    assert.match(matched, /visible\.txt/);
    assert.doesNotMatch(matched, /ignored\.txt/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("find and grep report no matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-no-match-"));
  try {
    assert.equal((await handleExtraOperatorTool("find", { path: dir, pattern: "*.nonexistent" })).content[0]?.text, "No files found matching pattern");
    assert.equal((await handleExtraOperatorTool("grep", { path: dir, pattern: "nonexistent" })).content[0]?.text, "No matches found");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
