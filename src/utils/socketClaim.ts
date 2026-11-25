import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

// Publish a populated directory atomically. A live claim is never empty,
// so another rename cannot replace it. Dead claims are removed by their
// unique marker, then rmdir (never recursively remove a published claim).
export function trySocketClaim(socketPath: string): (() => void) | undefined {
  if (process.platform === "win32") return () => {}; // Named pipes have no stale filesystem pathname.
  const lock = socketPath + ".claim";
  const marker = process.pid + "-" + randomUUID();
  const candidate = lock + "." + marker;
  fs.mkdirSync(candidate, { mode: 0o700 });
  try {
    fs.writeFileSync(candidate + "/" + marker, "", { flag: "wx" });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.renameSync(candidate, lock);
        return () => {
          try { fs.unlinkSync(lock + "/" + marker); } catch { return; }
          try { fs.rmdirSync(lock); } catch { /* Another claimant may have arrived. */ }
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      }
      let entries: string[];
      try { entries = fs.readdirSync(lock); } catch { continue; }
      if (entries.length !== 1 || !/^\d+-[0-9a-f-]+$/.test(entries[0])) return undefined;
      const owner = Number(entries[0].split("-")[0]);
      if (!Number.isSafeInteger(owner) || owner <= 0) return undefined;
      try { process.kill(owner, 0); return undefined; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return undefined;
      }
      try { fs.unlinkSync(lock + "/" + entries[0]); } catch { continue; }
      try { fs.rmdirSync(lock); } catch { /* A new populated claim cannot be removed. */ }
    }
    return undefined;
  } finally {
    fs.rmSync(candidate, { recursive: true, force: true });
  }
}
