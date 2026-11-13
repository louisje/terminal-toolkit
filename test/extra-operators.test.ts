import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getToolDefinitions } from "../src/tools/definitions.ts";
import { handleExtraOperatorTool } from "../src/tools/extra-operators.ts";

test("core operators are always enabled; extra operators are optional", () => {
  for (const [extra, expected] of [[false, 19], [true, 22]] as const) {
    const names = getToolDefinitions(extra).map((tool) => tool.name);
    assert.equal(names.length, expected);
    for (const name of ["read", "write", "edit", "shell"]) assert.ok(names.includes(name));
    for (const name of ["ls", "grep", "find"]) assert.equal(names.includes(name), extra);
  }
});
test("ls lists directories and respects limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-extra-"));
  try {
    await mkdir(join(dir, "folder"));
    await writeFile(join(dir, ".hidden"), "x");
    const result = await handleExtraOperatorTool("ls", { path: dir });
    assert.equal(result.content[0]?.text, ".hidden\nfolder/");
    const limited = await handleExtraOperatorTool("ls", { path: dir, limit: 1 });
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
