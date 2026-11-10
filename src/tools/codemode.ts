/** Opt-in QuickJS orchestration around the existing Terminal Toolkit tools. */
import { CodemodeSandbox, loadQuickJSWasm, type CodemodeTool } from "@earendil-works/pi-codemode";
import { fileURLToPath } from "node:url";
import type { TerminalManager } from "../terminal/index.js";
import { getCodemodeToolDefinitions, type ToolDefinition } from "./definitions.js";
import { dispatchTool } from "./index.js";
import { getServerInstructions } from "../server.js";
import { trackCall, recordSearch, recordDescribeTool, recordDescribeNamespace, getToolStat } from "./stats.js";

const MAX_CODEMODE_OUTPUT_BYTES = 8 * 1024;
const OUTPUT_LIMIT_WARNING = "Codemode output exceeded the 8 KiB limit. Output was suppressed to protect the context window. Please filter, summarize, or select only relevant data before calling text(). Do not repeat operations that may have side effects.";

export const codemodeDefinition: ToolDefinition = {
  name: "codemode",
  description: `Run JavaScript as an async function body in an isolated QuickJS sandbox (not JSON or a code fence). Top-level await works.
- Call tools with await tools.<name>({ ...args }); calls resolve to text or structured output and throw on failure.
- tools/core: read files with read, create/replace with write, modify existing files with edit; use shell for commands, not routine file edits.
- tools/pty: persistent interactive terminal sessions and long-running work; tools/misc: clipboard, notifications, and timing.
- Discover all tool summaries with await searchTools(), or search by keyword with await searchTools(query, {limit?, namespace?}). Use await describeNamespace() to discover tools/core, tools/pty, tools/misc; read await describeNamespace("tools/pty") for PTY instructions, and await describeTool(name) for tool usage guidance and inputSchema.
- Emit meaningful results with text(value), image(value), or top-level return; nested tool calls are not automatically emitted.
- Use Promise.allSettled for independent calls and filter verbose results before emitting.
- Total text output is limited to 8 KiB (UTF-8); filter or summarize large results before calling text().
- No Node.js globals, direct filesystem/network access, or timers. Tool calls use the host's existing permissions.`,
  inputSchema: { type: "object", properties: { code: { type: "string", description: "JavaScript body; use await tools.name(args) and text(result)." }, timeoutMs: { type: "integer", minimum: 1, maximum: 60000, description: "Execution deadline in milliseconds (default 60000)." } }, required: ["code"] },
};

type ToolResult = { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean; structuredContent?: unknown };

export async function runCodemodeWithDispatch(
  args: unknown,
  definitions: ToolDefinition[],
  dispatch: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
  namespaceInstruction = getServerInstructions(),
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
  }));
  const tools: CodemodeTool[] = definitions.map((definition) => ({
    name: definition.name,
    description: summaries.find(d => d.name === definition.name)!.description,
    inputSchema: definition.inputSchema,
    execute: async (value, context) => {
      const result = await trackCall(definition.name, async () => {
        const valueResult = await dispatch(definition.name, (value ?? {}) as Record<string, unknown>, context.signal) as ToolResult;
        if (valueResult.isError) throw new Error(valueResult.content?.filter(c => c.type === "text").map(c => c.text).join("\n") || `Tool ${definition.name} failed`);
        return valueResult;
      }, context.signal);
      if (result.structuredContent !== undefined) return result.structuredContent;
      const content = result.content ?? [];
      if (content.length === 1 && content[0].type === "text") return content[0].text;
      return content;
    },
  }));
  const namespaces = Object.fromEntries(definitions.filter(d => d.namespace).map(d => [d.name, d.namespace!]));
  const globals: CodemodeTool[] = [
    {
      name: "searchTools", spread: true,
      execute: (args) => trackCall("searchTools", () => {
        const [query, rawOptions] = args as [unknown, unknown];
        if (rawOptions !== null && rawOptions !== undefined && (typeof rawOptions !== "object" || Array.isArray(rawOptions))) throw new Error("searchTools() options must be an object");
        const options = rawOptions as {limit?: number; namespace?: string} | undefined;
        if (query !== undefined && typeof query !== "string") throw new Error("searchTools() expects a query string");
        if (options?.limit !== undefined && (typeof options.limit !== "number" || !Number.isInteger(options.limit) || options.limit <= 0)) throw new Error("searchTools() limit must be a positive integer");
        if (options?.namespace !== undefined && typeof options.namespace !== "string") throw new Error("searchTools() namespace must be a string");
        if (options?.namespace && !["tools/core", "tools/pty", "tools/misc"].includes(options.namespace)) { recordSearch(query ?? "", 0); return []; }
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const results = summaries.map(d => ({ name: d.name, namespace: d.namespace, description: d.description, score: words.reduce((score, w) => score + (d.name.toLowerCase().includes(w) ? 4 : 0) + (d.description.toLowerCase().includes(w) ? 1 : 0), 0) }))
          .filter(d => (!options?.namespace || d.namespace === options.namespace) && (!words.length || d.score > 0)).sort((a,b) => b.score - a.score)
          .slice(0, options?.limit ?? (words.length ? 10 : undefined)).map(({ name, namespace, description }) => ({ name, namespace, description }));
        recordSearch(query ?? "", results.length);
        return results;
      }),
    },
    {
      name: "describeTool", spread: true,
      execute: (args) => trackCall("describeTool", () => {
        const [name] = args as unknown[];
        if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
        recordDescribeTool(name);
        const tool = summaries.find(d => d.name === name);
        return tool ? { name: tool.name, namespace: tool.namespace, ...(tool.instruction ? { instruction: tool.instruction } : {}), inputSchema: tool.inputSchema } : null;
      }),
    },
    {
      name: "describeNamespace", spread: true,
      execute: (args) => trackCall("describeNamespace", () => {
        const [name] = args as unknown[];
        if (name !== undefined && typeof name !== "string") throw new Error("describeNamespace() expects a namespace name");
        recordDescribeNamespace(name ?? "(all)");
        const namespaces = [
          { name: "tools/core", description: "Dedicated file read/write/edit, search, and one-shot command execution.", instruction: "Use read to inspect text files, write to create or replace whole files (overwrites existing content), and edit for exact unique replacements in existing files. Prefer these dedicated tools over shell cat, echo/redirection, sed -i, or heredocs for routine file work. edit cannot append/prepend without a matching replacement. Use shell for actual command execution, pipelines, and external programs; use tools/pty for long-running builds, tests, and interactive work. Extra search tools require installed rg and fd/fdfind." },
          { name: "tools/pty", description: "Interactive PTY and terminal session management.", instruction: namespaceInstruction.split("\n\nPi operators are enabled.")[0].split("\n\nPi extra operators are enabled:")[0].trim() },
          { name: "tools/misc", description: "Clipboard, notifications, and timing utilities.", instruction: "Use clipboard tools for clipboard access, notify for notifications, and sleep for delays." },
        ];
        if (name === undefined) return namespaces.filter(ns => summaries.some(tool => tool.namespace === ns.name)).map(({name,description}) => ({name,description}));
        const ns = namespaces.find(ns => ns.name === name);
        return ns ? { ...ns, tools: summaries.filter(tool => tool.namespace === name).map(({name,description}) => ({name,description})) } : null;
      }),
    },
    {
      name: "getToolStat", spread: true,
      execute: (args) => trackCall("getToolStat", () => {
        const [options] = args as [unknown];
        if (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options))) throw new Error("getToolStat() options must be an object");
        return getToolStat((options ?? {}) as Parameters<typeof getToolStat>[0], namespaces);
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
      ? { type: "text" as const, text: item.text }
      : { type: "image" as const, data: item.data, mimeType: item.mimeType });
    if (result.ok && result.value !== undefined) content.push({ type: "text", text: JSON.stringify(result.value) });
    if (!result.ok) content.push({ type: "text", text: result.error.stack ?? result.error.message });
    const outputBytes = content.reduce((sum, item) => sum + (item.type === "text" ? Buffer.byteLength(item.text, "utf8") : 0), 0);
    if (outputBytes > MAX_CODEMODE_OUTPUT_BYTES) {
      return { content: [{ type: "text" as const, text: OUTPUT_LIMIT_WARNING }], isError: !result.ok };
    }
    return { content, isError: !result.ok };
  } finally {
    await sandbox.close();
  }
}

export function runCodemode(manager: TerminalManager, args: unknown, piOperators: boolean, piExtraOperators: boolean, signal?: AbortSignal) {
  return runCodemodeWithDispatch(args, getCodemodeToolDefinitions(piOperators, piExtraOperators),
    (name, params, callSignal) => dispatchTool(manager, name, params, piOperators, piExtraOperators, callSignal), signal,
    getServerInstructions({piOperators, piExtraOperators}));
}
