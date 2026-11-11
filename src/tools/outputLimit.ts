/** Soft per-text-block response guard; non-text content and structuredContent are untouched. */
export const MAX_TEXT_BLOCK_BYTES = 16 * 1024;

export function limitTextBlock(text: string, context = "Tool output"): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_BLOCK_BYTES) return text;
  return `${context} exceeded the 16 KiB text block limit. This block was suppressed to protect the context window. Please narrow the request, filter, or summarize the output. Do not repeat operations that may have side effects.`;
}

export function limitToolResponse<T extends { content?: Array<{ type: string; text?: string }> }>(result: T): T {
  if (!result.content) return result;
  return { ...result, content: result.content.map(item => item.type === "text" && typeof item.text === "string"
    ? { ...item, text: limitTextBlock(item.text) } : item) } as T;
}
