// Runs every *.test.mjs in this directory via node:test.
//
// Not a glob in the npm script: quoted globs need Node 21+'s own expansion,
// unquoted ones need a POSIX shell (so they break on Windows), and bare
// `node --test` scans far more of the tree than we want. Listing the files
// explicitly works the same way everywhere.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const allFiles = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.mjs") || f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join("test", f));

const requested = process.argv.slice(2);
const files = requested.length === 0 ? allFiles : requested.map((arg) => {
  const normalized = arg.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  if (!allFiles.some((file) => path.basename(file) === basename)) {
    console.error(`Unknown test file: ${arg}`);
    process.exit(1);
  }
  return path.join("test", basename);
});

if (files.length === 0) {
  console.error("No test files found in test/");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", "--import", "tsx", ...files], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
