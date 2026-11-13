import { createHmac, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  provider?: "openai";
  organizationId?: string;
  subjectId?: string;
  conversationId?: string;
}

// Set TERMINAL_TOOLKIT_IDENTITY_KEY to a shared secret for stable identifiers
// across MCP client processes/restarts. Without it, IDs are process-local.
const identityKey = process.env.TERMINAL_TOOLKIT_IDENTITY_KEY || randomBytes(32).toString("hex");
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

function fingerprint(kind: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return createHmac("sha256", identityKey).update(kind).update("\0").update(value).digest("hex");
}

export function createRequestContext(meta: unknown): RequestContext {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const fields = meta as Record<string, unknown>;
  const organizationId = fingerprint("openai/organization", fields["openai/organization"]);
  const subjectId = fingerprint("openai/subject", fields["openai/subject"]);
  const conversationId = fingerprint("openai/session", fields["openai/session"]);
  if (!organizationId && !subjectId && !conversationId) return {};
  return { provider: "openai", ...(organizationId ? { organizationId } : {}), ...(subjectId ? { subjectId } : {}), ...(conversationId ? { conversationId } : {}) };
}
