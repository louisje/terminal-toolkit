import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getToolDefinitions, getCodemodeToolDefinitions, getToolNamespace, namespaceRegistry } from "../src/tools/definitions.ts";
import { handleOperatorTool } from "../src/tools/operators.ts";
import { handleRuntimeManagement } from "../src/tools/runtime.ts";
async function finishBackground(response: Awaited<ReturnType<typeof handleOperatorTool>>) {
  assert.equal(response.isError, undefined);
  const executionId = response.content[0].text.match(/executionId: ([\w-]+)/)?.[1];
  assert.ok(executionId);
  await handleRuntimeManagement("cancelExecution", { executionId });
  await handleRuntimeManagement("waitExecution", { executionId });
  await handleRuntimeManagement("removeExecution", { executionId });
}

test("tool definitions expose all operators by default", () => {
  const definitions = getToolDefinitions();
  assert.equal(definitions.length, 30);
  assert.deepEqual(definitions, getToolDefinitions(true));
  for (const name of ["read", "write", "edit", "python", "shell", "list", "grep", "find"]) {
    assert.ok(definitions.some(tool => tool.name === name), `${name} should be enabled by default`);
  }
});

test("namespace registry covers every tool and preserves enabled defaults", () => {
  const namespaces = Object.keys(namespaceRegistry);
  assert.deepEqual(namespaces, ["tools/core", "tools/runtime", "tools/pty", "tools/misc"]);
  assert.ok(Object.values(namespaceRegistry).every(config => config.defaultEnabled));
  const names = Object.values(namespaceRegistry).flatMap(config => [...config.toolNames]);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(new Set(names), new Set(getToolDefinitions(true).map(tool => tool.name)));
  for (const tool of getCodemodeToolDefinitions(true)) {
    assert.equal(tool.namespace, getToolNamespace(tool.name));
    assert.ok(namespaceRegistry[tool.namespace!].toolNames.some(name => name === tool.name));
  }
});

test("builtin skill paths support progressive read but never write", async () => {
  const uri = "builtin://skills/terminal-toolkit/SKILL.md";
  const result = await handleOperatorTool("read", { path: uri, offset: 1, limit: 3 });
  assert.ok(result.content[0]?.text.includes("---"));
  await assert.rejects(() => handleOperatorTool("write", {path:uri, content:"bad"}), /read-only/);
  await assert.rejects(() => handleOperatorTool("edit", {path:uri, edits:[{oldText:"---",newText:"bad"}]}), /read-only/);
  await assert.rejects(() => handleOperatorTool("read", {path:"builtin://skills/terminal-toolkit/../package.json"}), /Invalid builtin path/);
});

test("read, write, and edit implement the basic operator semantics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "terminal-toolkit-operators-"));
  const path = join(dir, "nested", "file.txt");
  try {
    await handleOperatorTool("write", { path, content: "one\ntwo\nthree" });
    const read = await handleOperatorTool("read", { path, offset: 2, limit: 1 });
    assert.equal(read.content[0]?.text, "two");
    await handleOperatorTool("edit", { path, edits: [{ oldText: "two", newText: "TWO" }, { oldText: "three", newText: "THREE" }] });
    assert.equal(await readFile(path, "utf8"), "one\nTWO\nTHREE");
    await assert.rejects(() => handleOperatorTool("edit", { path, edits: [{ oldText: "one", newText: "x" }, { oldText: "one\nTWO", newText: "y" }] }), /overlap/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("python runs source via stdin and reports failures", async () => {
  const ok = await handleOperatorTool("python", { code: "print(sum(range(100)))" });
  assert.equal(ok.content[0]?.text.trim(), "4950");
  const failed = await handleOperatorTool("python", { code: "raise ValueError('test failure')" });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0]?.text ?? "", /ValueError: test failure/);
  const timedOut = await handleOperatorTool("python", { code: "import time; time.sleep(2)", timeout: 0.05 });
  await finishBackground(timedOut);
});

test("shell returns output, exit failures, and background execution", async () => {
  const ok = await handleOperatorTool("shell", { command: "printf operator-ok" });
  assert.equal(ok.content[0]?.text, "operator-ok");

  const failed = await handleOperatorTool("shell", { command: "printf failed >&2; exit 7" });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0]?.text ?? "", /failed/);
  assert.match(failed.content[0]?.text ?? "", /code 7/);

  const timedOut = await handleOperatorTool("shell", { command: "sleep 1", timeout: 0.05 });
  await finishBackground(timedOut);
});


test("shell honors an explicitly configured shell", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell fixture");
  const dir = await mkdtemp(join(tmpdir(), "terminal-toolkit-shell-"));
  const shell = join(dir, "configured-shell");
  try {
    await writeFile(shell, "#!/bin/sh\nprintf 'configured-shell\\n' >&2\nexec /bin/sh \"$@\"\n", { mode: 0o755 });
    const response = await handleOperatorTool("shell", { command: "printf shell-ok" }, shell);
    assert.equal(response.content[0]?.text, "shell-okconfigured-shell\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shell uses the environment-selected shell by default", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell fixture");
  const dir = await mkdtemp(join(tmpdir(), "terminal-toolkit-shell-env-"));
  const shell = join(dir, "configured-shell");
  const previous = process.env.TERMINAL_TOOLKIT_SHELL;
  try {
    await writeFile(shell, "#!/bin/sh\nprintf 'env-shell\\n' >&2\nexec /bin/sh \"$@\"\n", { mode: 0o755 });
    process.env.TERMINAL_TOOLKIT_SHELL = shell;
    const response = await handleOperatorTool("shell", { command: "printf env-ok" });
    assert.equal(response.content[0]?.text, "env-okenv-shell\n");
  } finally {
    if (previous === undefined) delete process.env.TERMINAL_TOOLKIT_SHELL;
    else process.env.TERMINAL_TOOLKIT_SHELL = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
