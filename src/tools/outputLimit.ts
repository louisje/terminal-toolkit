/** Per-text-entity response guard; non-text content and structuredContent are untouched. */
import { storeResult } from "./resultStore.js";
export const MAX_TEXT_BLOCK_BYTES = 16 * 1024;

type OutputPolicy = "unlimited" | "suppress" | "store";
const toolPolicies: Readonly<Record<string, OutputPolicy>> = {
  read: "suppress", searchSkills: "unlimited", describeSkill: "unlimited",
};
const suppressed = "This block was suppressed to protect the context window. Please narrow the request, filter, or summarize the output. Do not repeat operations that may have side effects.";

function limitTextBlock(text: string, context: string, policy: OutputPolicy): string {
  if (policy === "unlimited" || Buffer.byteLength(text, "utf8") <= MAX_TEXT_BLOCK_BYTES) return text;
  const status = text.includes("[search-status timedOut=true incomplete=true;") ? "\n[search-status timedOut=true incomplete=true; search stopped before completion]" : "";
  if (policy === "suppress") return `${context} exceeded the 16 KiB text block limit. ${suppressed}${status}`;
  const path = storeResult(text);
  return path ? `${context} exceeded 16 KiB (${Buffer.byteLength(text, "utf8")} bytes). Full text saved at ${path}. Use read({path, offset, limit}) or grep({path, pattern}) to inspect it.${status}` : `${context} exceeded the in-memory result store capacity. Narrow the request; output was not retained.${status}`;
}

export function limitCodemodeText(text: string): string {
  return limitTextBlock(text, "Codemode text() output", "suppress");
}

/** Shared policy for ordinary MCP tools; Codemode text uses suppression only. */
export function limitResponseForTool<T extends { content?: Array<{ type: string; text?: string }> }>(name: string, result: T): T {
  return limitToolResponse(result, Object.hasOwn(toolPolicies, name) ? toolPolicies[name] : "store");
}

function limitToolResponse<T extends { content?: Array<{ type: string; text?: string }> }>(result: T, policy: OutputPolicy): T {
  if (policy === "unlimited" || !result.content) return result;
  return { ...result, content: result.content.map(item => item.type === "text" && typeof item.text === "string"
    ? { ...item, text: limitTextBlock(item.text, "Tool output", policy) } : item) } as T;
}
