import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { trySocketClaim } from "../src/utils/socketClaim.js";

test("socket claim excludes another claimant and recovers after owner death", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tt-claim-"));
  const socket = path.join(dir, "s");
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    'import { trySocketClaim } from "./src/utils/socketClaim.ts"; if (!trySocketClaim(process.argv[1])) process.exit(2); console.log("ready"); setInterval(()=>{},1000);', socket]);
  try {
    const [chunk] = await Promise.race([once(child.stdout!, "data"), once(child, "exit").then(() => { throw new Error("claim child exited"); })]);
    assert.match(String(chunk), /ready/);
    assert.equal(trySocketClaim(socket), undefined);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const release = trySocketClaim(socket);
    assert.ok(release);
    assert.equal(trySocketClaim(socket), undefined);
    release();
    const next = trySocketClaim(socket);
    assert.ok(next);
    next();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
