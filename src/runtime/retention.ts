import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function markInstance(directory: string): Promise<void> {
  await writeFile(join(directory, "owner.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: "wx" });
}

// Only remove marked directories whose owner is demonstrably absent.
// Unknown markers, permission errors and reused PIDs are retained.
export async function reclaimStaleInstances(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("instance-")) continue;
    const directory = join(root, entry.name);
    try {
      const owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          await rm(directory, { recursive: true, force: true });
      }
    } catch { /* missing or invalid marker, or concurrent removal */ }
  }
}
