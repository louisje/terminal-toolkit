/** Process-wide, bounded Codemode usage counters. No arguments or tool output are stored. */
type Counter = { calls: number; success: number; errors: number; cancelled: number; totalDurationMs: number; maxDurationMs: number };
type SearchCounter = { calls: number; zeroResults: number; totalResults: number };
const startedAt = new Date().toISOString();
const counters = new Map<string, Counter>();
const searches = new Map<string, SearchCounter>();
const describedTools = new Map<string, number>();
const describedNamespaces = new Map<string, number>();
let otherQueries = 0;
const MAX_QUERIES = 1000;
const MAX_QUERY_LENGTH = 256;

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
export function recordSearch(query: string, results: number) {
  const key = query.slice(0, MAX_QUERY_LENGTH);
  if (!searches.has(key) && searches.size >= MAX_QUERIES) { otherQueries++; return; }
  const stat = searches.get(key) ?? { calls: 0, zeroResults: 0, totalResults: 0 };
  stat.calls++;
  stat.totalResults += results;
  if (!results) stat.zeroResults++;
  searches.set(key, stat);
}
export function recordDescribeTool(name: string) { increment(describedTools, name); }
export function recordDescribeNamespace(name: string) { increment(describedNamespaces, name); }
export async function trackCall<T>(name: string, fn: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const stat = counters.get(name) ?? { calls: 0, success: 0, errors: 0, cancelled: 0, totalDurationMs: 0, maxDurationMs: 0 };
  counters.set(name, stat);
  stat.calls++;
  const start = performance.now();
  try {
    const result = await fn();
    stat.success++;
    return result;
  } catch (error) {
    if (signal?.aborted) stat.cancelled++;
    else stat.errors++;
    throw error;
  } finally {
    const elapsed = performance.now() - start;
    stat.totalDurationMs += elapsed;
    stat.maxDurationMs = Math.max(stat.maxDurationMs, elapsed);
  }
}
export function getToolStat(options: { category?: "discovery" | "tool"; namespace?: string; sortBy?: "calls" | "name" | "totalDurationMs"; limit?: number } = {}, namespaces: Record<string, string> = {}) {
  if (options.category !== undefined && !["discovery", "tool"].includes(options.category)) throw new Error("Invalid category");
  if (options.namespace !== undefined && typeof options.namespace !== "string") throw new Error("namespace must be a string");
  if (options.sortBy !== undefined && !["calls", "name", "totalDurationMs"].includes(options.sortBy)) throw new Error("Invalid sortBy");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) throw new Error("limit must be a positive integer");
  const entries = [...counters.entries()].filter(([name]) => {
    const discovery = ["searchTools", "describeTool", "describeNamespace", "getToolStat"].includes(name);
    return (!options.category || (options.category === "discovery") === discovery) && (!options.namespace || namespaces[name] === options.namespace);
  }).map(([name, stat]) => ({ name, ...(namespaces[name] ? { namespace: namespaces[name] } : {}), ...stat, avgDurationMs: stat.calls ? stat.totalDurationMs / stat.calls : 0 }));
  entries.sort((a, b) => options.sortBy === "name" ? a.name.localeCompare(b.name) : options.sortBy === "totalDurationMs" ? b.totalDurationMs - a.totalDurationMs : b.calls - a.calls);
  return {
    since: startedAt,
    totalCalls: entries.reduce((sum, e) => sum + e.calls, 0),
    tools: entries.slice(0, options.limit),
    ...(!options.category || options.category === "discovery" ? {
      discovery: {
        searchTools: { queries: [...searches.entries()].map(([query, stat]) => ({ query, ...stat, avgResults: stat.totalResults / stat.calls })).sort((a,b) => b.calls - a.calls).slice(0, options.limit), otherQueries },
        describeTool: Object.fromEntries(describedTools),
        describeNamespace: Object.fromEntries(describedNamespaces),
      },
    } : {}),
  };
}
