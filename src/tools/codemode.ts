/** Opt-in QuickJS orchestration around the existing Terminal Toolkit tools. */
import { CodemodeSandbox, loadQuickJSWasm, type CodemodeTool } from "@earendil-works/pi-codemode";
import { fileURLToPath } from "node:url";
import type { TerminalManager } from "../terminal/index.js";
import { getCodemodeToolDefinitions, type ToolDefinition } from "./definitions.js";
import { dispatchTool } from "./index.js";
import { getServerInstructions } from "../server.js";

export const codemodeDefinition: ToolDefinition = {
  name: "codemode",
  description: `Run JavaScript as an async function body in an isolated QuickJS sandbox (not JSON or a code fence). Top-level await works.
- Call tools with await tools.<name>({ ...args }); calls resolve to text or structured output and throw on failure.
- Discover all tool summaries with await searchTools(), or search by keyword with await searchTools(query, {limit?, namespace?}). Read await describeNamespace("terminal") for terminal-wide instructions, and await describeTool(name) for tool usage guidance and inputSchema.
- Emit meaningful results with text(value), image(value), or top-level return; nested tool calls are not automatically emitted.
- Use Promise.allSettled for independent calls and filter verbose results before emitting.
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
    namespace: "terminal",
    description: definition.description,
    instruction: definition.instruction,
    inputSchema: definition.inputSchema,
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
  const globals: CodemodeTool[] = [
    {
      name: "searchTools", spread: true,
      execute: (args) => {
        const [query, rawOptions] = args as [unknown, unknown];
        if (rawOptions !== null && rawOptions !== undefined && (typeof rawOptions !== "object" || Array.isArray(rawOptions))) throw new Error("searchTools() options must be an object");
        const options = rawOptions as {limit?: number; namespace?: string} | undefined;
        if (query !== undefined && typeof query !== "string") throw new Error("searchTools() expects a query string");
        if (options?.limit !== undefined && (typeof options.limit !== "number" || !Number.isInteger(options.limit) || options.limit <= 0)) throw new Error("searchTools() limit must be a positive integer");
        if (options?.namespace !== undefined && typeof options.namespace !== "string") throw new Error("searchTools() namespace must be a string");
        if (options?.namespace && options.namespace !== "terminal" && options.namespace !== "terminal-toolkit") return [];
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        return summaries.map(d => ({ name: d.name, namespace: d.namespace, description: d.description, score: words.reduce((score, w) => score + (d.name.toLowerCase().includes(w) ? 4 : 0) + (d.description.toLowerCase().includes(w) ? 1 : 0), 0) }))
          .filter(d => !words.length || d.score > 0).sort((a,b) => b.score - a.score)
          .slice(0, options?.limit ?? (words.length ? 10 : undefined)).map(({ name, namespace, description }) => ({ name, namespace, description }));
      },
    },
    {
      name: "describeTool", spread: true,
      execute: (args) => {
        const [name] = args as unknown[];
        if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
        const tool = summaries.find(d => d.name === name);
        return tool ? { name: tool.name, namespace: tool.namespace, ...(tool.instruction ? { instruction: tool.instruction } : {}), inputSchema: tool.inputSchema } : null;
      },
    },
    {
      name: "describeNamespace", spread: true,
      execute: (args) => {
        const [name] = args as unknown[];
        if (typeof name !== "string") throw new Error("describeNamespace() expects a namespace name");
        return name === "terminal" || name === "terminal-toolkit"
          ? { name: "terminal", instruction: namespaceInstruction, tools: summaries.map(({name, description}) => ({name, description})) }
          : null;
      },
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
