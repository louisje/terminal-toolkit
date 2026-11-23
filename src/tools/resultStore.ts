/** Process-local, bounded, read-only virtual tool results. */
import { randomUUID } from "node:crypto";

const MAX_BYTES = 64 * 1024 * 1024;
const TTL_MS = 60 * 60 * 1000;
type Entry = { text: string; bytes: number; expiresAt: number };
const entries = new Map<string, Entry>();
let totalBytes = 0;

function remove(id: string): void {
  const entry = entries.get(id);
  if (entry) { totalBytes -= entry.bytes; entries.delete(id); }
}
function prune(): void {
  const now = Date.now();
  for (const [id, entry] of entries) if (entry.expiresAt <= now) remove(id);
}
export function storeResult(text: string): string | undefined {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_BYTES) return undefined;
  prune();
  while (totalBytes + bytes > MAX_BYTES && entries.size) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    remove(oldest);
  }
  const id = randomUUID();
  entries.set(id, { text, bytes, expiresAt: Date.now() + TTL_MS });
  totalBytes += bytes;
  return `result://${id}`;
}
export function isResultPath(path: string): boolean { return path.startsWith("result://"); }
export function readResult(path: string): string {
  if (!/^result:\/\/[0-9a-f-]{36}$/.test(path)) throw new Error("Invalid virtual result path");
  prune();
  const id = path.slice("result://".length);
  const entry = entries.get(id);
  if (!entry) throw new Error("Virtual result not found or expired");
  // Refresh LRU ordering without extending the absolute lifetime.
  entries.delete(id);
  entries.set(id, entry);
  return entry.text;
}
