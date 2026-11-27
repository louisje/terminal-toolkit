/** Bounded, process-local working memory, scoped to the current request identity. */
import { requestContextStorage } from "../requestContext.js";

const MAX_BYTES = 16 * 1024;
const MAX_SESSIONS = 256;
const TTL_MS = 24 * 60 * 60 * 1000;
const PATH = "memory://scratchpad.md";
const entries = new Map<string, { text: string; touched: number }>();

export function isMemoryPath(path: string): boolean { return path.startsWith("memory://"); }

function scope(): string {
  const context = requestContextStorage.getStore();
  if (!context?.conversationId) throw new Error("memory:// requires a conversation identity");
  const now = Date.now();
  for (const [key, entry] of entries) if (now - entry.touched >= TTL_MS) entries.delete(key);
  return JSON.stringify([context.provider, context.organizationId, context.subjectId, context.conversationId]);
}
function validate(path: string): void {
  if (path !== PATH) throw new Error("Only memory://scratchpad.md is supported");
}
export function readMemory(path: string): string {
  validate(path);
  const entry = entries.get(scope());
  if (!entry) throw new Error("Scratchpad not found; create it with write()");
  entry.touched = Date.now();
  return entry.text;
}
export function writeMemory(path: string, text: string): void {
  validate(path);
  const key = scope();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Scratchpad exceeds 16 KiB; summarize before writing");
  if (!entries.has(key) && entries.size >= MAX_SESSIONS) throw new Error("Scratchpad capacity reached; retry after idle expiration");
  entries.set(key, { text, touched: Date.now() });
}
export function listMemory(path: string): string[] {
  if (path !== "memory://") throw new Error("Expected memory:// root");
  const entry = entries.get(scope());
  if (!entry) return [];
  entry.touched = Date.now();
  return ["scratchpad.md"];
}
