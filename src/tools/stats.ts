/** Global and conversation-scoped counters for MCP and Codemode. Discovery query text is retained. */
type Counter = { calls: number; success: number; errors: number; cancelled: number; totalDurationMs: number; maxDurationMs: number };
type SearchCounter = { calls: number; zeroResults: number; totalResults: number };
import { requestContextStorage } from "../requestContext.js";
function createStats() {
  return { startedAt: new Date().toISOString(), touched: Date.now(), active: 0,
    counters: new Map<string, Counter>(), searches: new Map<string, SearchCounter>(),
    descriptions: new Map<string, number>(), otherQueries: 0 };
}
type Stats = ReturnType<typeof createStats>;
const globalStats = createStats();
const conversations = new Map<string, Stats>();
const MAX_CONVERSATIONS = 256;
const TTL_MS = 24 * 60 * 60 * 1000;
function conversationStats(): Stats | undefined {
  const context = requestContextStorage.getStore();
  if (!context?.conversationId) return;
  const now = Date.now();
  for (const [key, value] of conversations)
    if (!value.active && now - value.touched >= TTL_MS) conversations.delete(key);
  const key = JSON.stringify([context.provider, context.organizationId, context.subjectId, context.conversationId]);
  let value = conversations.get(key);
  if (!value) {
    if (conversations.size >= MAX_CONVERSATIONS) return;
    value = createStats();
    conversations.set(key, value);
  }
  value.touched = now;
  return value;
}
function scopes(): Stats[] {
  const local = conversationStats();
  return local ? [globalStats, local] : [globalStats];
}
const MAX_QUERIES = 1000;
const MAX_QUERY_LENGTH = 256;

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
export function recordSearch(query: string, results: number) {
  for (const scope of scopes()) {
    const { searches } = scope;
    const key = query.slice(0, MAX_QUERY_LENGTH);
    if (!searches.has(key) && searches.size >= MAX_QUERIES) { scope.otherQueries++; continue; }
    const stat = searches.get(key) ?? { calls: 0, zeroResults: 0, totalResults: 0 };
    stat.calls++;
    stat.totalResults += results;
    if (!results) stat.zeroResults++;
    searches.set(key, stat);
  }
}
export function recordDescribe(name: string) { for (const scope of scopes()) increment(scope.descriptions, name); }
export async function trackCall<T>(name: string, fn: () => T | Promise<T>, signal?: AbortSignal, isFailure?: (result: T) => boolean): Promise<T> {
  const owners = scopes();
  const stats = owners.map(owner => {
    owner.active++;
    const { counters } = owner;
    const stat = counters.get(name) ?? { calls: 0, success: 0, errors: 0, cancelled: 0, totalDurationMs: 0, maxDurationMs: 0 };
    counters.set(name, stat);
    stat.calls++;
    return stat;
  });
  const start = performance.now();
  try {
    const result = await fn();
    if (isFailure?.(result)) {
      if (signal?.aborted) stats.forEach(stat => stat.cancelled++);
      else stats.forEach(stat => stat.errors++);
    } else stats.forEach(stat => stat.success++);
    return result;
  } catch (error) {
    if (signal?.aborted) stats.forEach(stat => stat.cancelled++);
    else stats.forEach(stat => stat.errors++);
    throw error;
  } finally {
    const elapsed = performance.now() - start;
    for (const stat of stats) {
      stat.totalDurationMs += elapsed;
      stat.maxDurationMs = Math.max(stat.maxDurationMs, elapsed);
    }
    for (const owner of owners) { owner.active--; owner.touched = Date.now(); }
  }
}
export function getToolStat(options: { scope?: "global" | "conversation"; category?: "discovery" | "tool"; namespace?: string; sortBy?: "calls" | "name" | "totalDurationMs"; limit?: number } = {}, namespaces: Record<string, string> = {}) {
  if (options.category !== undefined && !["discovery", "tool"].includes(options.category)) throw new Error("Invalid category");
  if (options.namespace !== undefined && typeof options.namespace !== "string") throw new Error("namespace must be a string");
  if (options.sortBy !== undefined && !["calls", "name", "totalDurationMs"].includes(options.sortBy)) throw new Error("Invalid sortBy");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) throw new Error("limit must be a positive integer");
  if (options.scope !== undefined && !["global", "conversation"].includes(options.scope)) throw new Error("Invalid scope");
  const scope = options.scope ?? "global";
  const selected = scope === "global" ? globalStats : conversationStats();
  if (!selected) throw new Error("Conversation statistics require a conversation identity and available capacity");
  const { counters, searches, descriptions, otherQueries, startedAt } = selected;
  const entries = [...counters.entries()].filter(([name]) => {
    const discovery = ["search", "describe"].includes(name);
    return (!options.category || (options.category === "discovery") === discovery) && (!options.namespace || namespaces[name] === options.namespace);
  }).map(([name, stat]) => ({ name, ...(namespaces[name] ? { namespace: namespaces[name] } : {}), ...stat, avgDurationMs: stat.calls ? stat.totalDurationMs / stat.calls : 0 }));
  entries.sort((a, b) => options.sortBy === "name" ? a.name.localeCompare(b.name) : options.sortBy === "totalDurationMs" ? b.totalDurationMs - a.totalDurationMs : b.calls - a.calls);
  return {
    scope,
    since: startedAt,
    totalCalls: entries.reduce((sum, e) => sum + e.calls, 0),
    tools: entries.slice(0, options.limit),
    ...(!options.category || options.category === "discovery" ? {
      discovery: {
        search: { queries: [...searches.entries()].map(([query, stat]) => ({ query, ...stat, avgResults: stat.totalResults / stat.calls })).sort((a,b) => b.calls - a.calls).slice(0, options.limit), otherQueries },
        describe: Object.fromEntries(descriptions),
      },
    } : {}),
  };
}
