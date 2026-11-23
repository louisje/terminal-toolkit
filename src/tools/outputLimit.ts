/** Per-text-entity response guard; non-text content and structuredContent are untouched. */
import { storeResult } from "./resultStore.js";
export const MAX_TEXT_BLOCK_BYTES = 16 * 1024;

export function limitTextBlock(text: string, context = "Tool output"): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_BLOCK_BYTES) return text;
  const path = storeResult(text);
  return path ? `${context} exceeded 16 KiB (${Buffer.byteLength(text, "utf8")} bytes). Full text saved at ${path}. Use read({path, offset, limit}) or grep({path, pattern}) to inspect it.` : `${context} exceeded the in-memory result store capacity. Narrow the request; output was not retained.`;
}

export function limitReadResponse<T extends { content?: Array<{ type: string; text?: string }> }>(result: T): T {
  if (!result.content) return result;
  return { ...result, content: result.content.map(item => item.type === "text" && typeof item.text === "string" && Buffer.byteLength(item.text, "utf8") > MAX_TEXT_BLOCK_BYTES
    ? { ...item, text: "Tool output exceeded the 16 KiB text block limit. This block was suppressed to protect the context window. Please narrow the request, filter, or summarize the output. Do not repeat operations that may have side effects." } : item) } as T;
}

/** Response policy: Skills discovery and read() retain suppression; other tools use the result store. */
export function limitResponseForTool<T extends { content?: Array<{ type: string; text?: string }> }>(name: string, result: T): T {
  return (name === "read" || name === "searchSkills" || name === "describeSkill")
    ? limitReadResponse(result) : limitToolResponse(result);
}

export function limitToolResponse<T extends { content?: Array<{ type: string; text?: string }> }>(result: T): T {
  if (!result.content) return result;
  return { ...result, content: result.content.map(item => item.type === "text" && typeof item.text === "string"
    ? { ...item, text: limitTextBlock(item.text) } : item) } as T;
}
