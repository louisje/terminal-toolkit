/** Opt-in QuickJS orchestration around the existing Terminal Toolkit tools. */
import { CodemodeSandbox, loadQuickJSWasm, type CodemodeTool } from "@earendil-works/pi-codemode";
import { fileURLToPath } from "node:url";
import type { TerminalManager } from "../terminal/index.js";
import { getCodemodeToolDefinitions, type ToolDefinition } from "./definitions.js";
import { dispatchTool } from "./index.js";
import { namespaceRegistryGuidance } from "./namespaceGuidance.js";
import { trackCall, recordSearch, recordDescribe } from "./stats.js";

import { limitTextBlock } from "./outputLimit.js";
import { skillCatalog } from "../skills.js";

export const codemodeDefinition: ToolDefinition = {
  name: "codemode",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  description: `Run JavaScript as an async function body in an isolated QuickJS sandbox (not JSON or a code fence). Top-level await works.
- Call tools with await tools.<name>({ ...args }); calls resolve to text or structured output and throw on failure.
- tools/core: read files with read, create/replace with write, modify existing files with edit; use shell for commands, not routine file edits.
- tools/pty: persistent interactive terminal sessions and long-running work; tools/misc: clipboard, notifications, and timing.
- At the beginning of each conversation, run await search({namespace: "skills/*"}) once to check for available Skills; if any are returned, inspect relevant Skills and read their SKILL.md as needed. If none are returned (--skills may be disabled), proceed with ordinary tool discovery. Do not repeat initial Skills discovery on every call.
- Discovery search() returns at most 100 matches per call (default 100; larger limits are capped). Narrow filters when more matches exist.
- Discover tools with await search({query?, namespace?, name?, limit?}); namespace and name support * and ? wildcards. Use await describe({namespace, name?}) for details. With --skills enabled, these functions also discover Skills (metadata and paths only); read SKILL.md progressively using tools.read({path, offset?, limit?}). Built-in Skills use read-only builtin://skills/<skill>/SKILL.md paths. Before PTY operations, describe({namespace:"tools/pty"}).
- Emit meaningful results with text(value), image(value), or top-level return; nested tool calls are not automatically emitted.
- Use Promise.allSettled for independent calls and filter verbose results before emitting.
- Inspect process-wide tool usage through tools/misc getToolStat: await tools.getToolStat({}); counters reset on server restart.
- Each text() block is limited to 16 KiB (UTF-8); oversized blocks become warnings. Top-level return is unrestricted.
- No Node.js globals, direct filesystem/network access, or timers. Tool calls use the host's existing permissions.`,
  inputSchema: { type: "object", properties: { code: { type: "string", description: "JavaScript body; use await tools.name(args) and text(result)." }, timeoutMs: { type: "integer", minimum: 1, maximum: 60000, description: "Execution deadline in milliseconds (default 60000)." } }, required: ["code"] },
};

type ToolResult = { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean; structuredContent?: unknown };

export async function runCodemodeWithDispatch(
  args: unknown,
  definitions: ToolDefinition[],
  dispatch: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
  skillsEnabled = false,
) {
  const code = (args as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string" || !code.trim()) throw new Error("codemode requires nonempty code");
  const requestedTimeout = (args as { timeoutMs?: unknown }).timeoutMs;
  if (requestedTimeout !== undefined && (!Number.isInteger(requestedTimeout) || Number(requestedTimeout) < 1 || Number(requestedTimeout) > 60_000)) {
    throw new Error("codemode timeoutMs must be an integer between 1 and 60000");
  }
  const timeoutMs = requestedTimeout === undefined ? 60_000 : Number(requestedTimeout);
  const summaries = definitions.map(definition => ({
    name: definition.name,
    namespace: definition.namespace,
    description: definition.description,
    instruction: definition.instruction,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
  }));
  const tools: CodemodeTool[] = definitions.map((definition) => ({
    name: definition.name,
    description: summaries.find(d => d.name === definition.name)!.description,
    inputSchema: definition.inputSchema,
    execute: async (value, context) => {
      const result = await dispatch(definition.name, (value ?? {}) as Record<string, unknown>, context.signal) as ToolResult;
      if (result.isError) throw new Error(result.content?.filter(c => c.type === "text").map(c => c.text).join("\n") || `Tool ${definition.name} failed`);
      if (result.structuredContent !== undefined) return result.structuredContent;
      const content = result.content ?? [];
      if (content.length === 1 && content[0].type === "text") return content[0].text;
      return content;
    },
  }));
  const matchGlob = (value: string, pattern?: string) => !pattern || new RegExp("^" + pattern.split(/([*?])/).map(part => part === "*" ? ".*" : part === "?" ? "." : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$", "i").test(value);
  const globals: CodemodeTool[] = [
    {
      name: "search", spread: true,
      execute: (args) => trackCall("search", async () => {
        const [options = {}] = args as [{query?: string; namespace?: string; name?: string; limit?: number}?];
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("search() expects an options object");
        const { query, namespace, name, limit } = options;
        if ([query, namespace, name].some(v => v !== undefined && typeof v !== "string")) throw new Error("search() filters must be strings");
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("search() limit must be positive");
        const skills = skillsEnabled ? await skillCatalog() : [];
        const entries = [...summaries.map(({name, namespace, description}) => ({name, namespace, description, kind:"tool"})), ...skills.map(({name,namespace,description}) => ({name,namespace,description,kind:"skill"}))];
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const found = entries.filter(item => matchGlob(item.namespace ?? "", namespace) && matchGlob(item.name, name) && words.every(w => (item.name + " " + item.description).toLowerCase().includes(w)));
        recordSearch(query ?? "", found.length);
        return found.slice(0, Math.min(limit ?? 100, 100));
      }),
    },
    {
      name: "describe", spread: true,
      execute: (args) => trackCall("describe", async () => {
        const [options] = args as [{namespace?:string; name?:string}?];
        if (!options || typeof options !== "object" || Array.isArray(options) || typeof options.namespace !== "string") throw new Error("describe() requires namespace");
        if (options.name !== undefined && typeof options.name !== "string") throw new Error("describe() name must be a string");
        recordDescribe(options.namespace + (options.name ? "/" + options.name : ""));
        const skills = skillsEnabled ? await skillCatalog() : [];
        if (options.namespace.startsWith("skills/")) {
          const members = skills.filter(s => s.namespace === options.namespace);
          if (options.name) return members.find(s => s.name === options.name) ?? null;
          return members.length ? {namespace:options.namespace, skills:members.map(({name,description,size}) => ({name,description,size}))} : null;
        }
        const members = summaries.filter(s => s.namespace === options.namespace);
        if (options.name) {
          const tool = members.find(s => s.name === options.name);
          return tool ? {namespace:tool.namespace,name:tool.name,instruction:tool.instruction,inputSchema:tool.inputSchema,annotations:tool.annotations} : null;
        }
        const guidance = namespaceRegistryGuidance[options.namespace as keyof typeof namespaceRegistryGuidance];
        return members.length ? {namespace:options.namespace,...guidance,tools:members.map(({name,description}) => ({name,description}))} : null;
      }),
    },
  ];
  const sandbox = new CodemodeSandbox({
    timeoutMs,
    tools,
    globals,
    wasm: loadQuickJSWasm(fileURLToPath(new URL("./quickjs.wasm", import.meta.url))),
    workerUrl: new URL("./codemode-worker.js", import.meta.url),
  });
  try {
    const result = await sandbox.execute(code, { signal });
    const content = result.output.map(item => item.type === "text"
      ? { type: "text" as const, text: limitTextBlock(item.text, "Codemode text() output") }
      : { type: "image" as const, data: item.data, mimeType: item.mimeType });
    if (result.ok && result.value !== undefined) content.push({ type: "text", text: JSON.stringify(result.value) });
    if (!result.ok) content.push({ type: "text", text: result.error.stack ?? result.error.message });
    return { content, isError: !result.ok };
  } finally {
    await sandbox.close();
  }
}

export function runCodemode(manager: TerminalManager, args: unknown, piExtraOperators: boolean, signal?: AbortSignal, skillsEnabled = false) {
  return runCodemodeWithDispatch(args, getCodemodeToolDefinitions(piExtraOperators),
    (name, params, callSignal) => dispatchTool(manager, name, params, piExtraOperators, callSignal), signal, skillsEnabled);
}
