import type { Socket } from "node:net";

const MAX_CUSTOM_EVENT_BYTES = 64 * 1024;
const MAX_SUBSCRIPTIONS = 128;
const MAX_PENDING_SOCKET_BYTES = 1024 * 1024;
const PUBLISH_BURST = 20;
const PUBLISH_REFILL_PER_SECOND = 10;

export type EventMethod = "subscribe" | "unsubscribe" | "publish";

export interface BrokerConnection {
  socket: Socket;
  subscriptions: Set<string>;
  systemFilterEnabled: boolean;
  publishTokens: number;
  lastPublishRefill: number;
}

export function createBrokerConnection(socket: Socket): BrokerConnection {
  return {
    socket, subscriptions: new Set(), systemFilterEnabled: false,
    publishTokens: PUBLISH_BURST, lastPublishRefill: performance.now(),
  };
}

/** Release connection-owned broker state on socket disconnect. */
export function disposeBrokerConnection(connection: BrokerConnection): void {
  connection.subscriptions.clear();
  connection.systemFilterEnabled = false;
  connection.publishTokens = 0;
}

export const subscriptionKey = (topic: string, sessionId?: string): string =>
  JSON.stringify([topic, sessionId ?? null]);

export function acceptsSystemEvent(connection: BrokerConnection, event: string, sessionId: string): boolean {
  return !connection.systemFilterEnabled ||
    connection.subscriptions.has(subscriptionKey(event)) ||
    connection.subscriptions.has(subscriptionKey(event, sessionId));
}

export function handleBrokerRequest(
  method: EventMethod,
  params: Record<string, unknown> | undefined,
  connectionId: number,
  connection: BrokerConnection,
  connections: Iterable<BrokerConnection>,
): { result: { accepted: true } } | { error: { message: string } } {
  const topic = params?.topic;
  const isCustomTopic = typeof topic === "string" && /^custom\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(topic);
  const isSystemTopic = topic === "session.created" || topic === "session.destroyed";
  if (!isCustomTopic && !(method !== "publish" && isSystemTopic)) {
    return { error: { message: "Invalid custom event topic" } };
  }
  const rawSessionId = params?.sessionId;
  if (rawSessionId !== undefined && (typeof rawSessionId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(rawSessionId))) {
    return { error: { message: "Invalid sessionId" } };
  }
  const sessionId = rawSessionId as string | undefined;
  const key = subscriptionKey(topic as string, sessionId);
  if (method === "subscribe" && !connection.subscriptions.has(key) && connection.subscriptions.size >= MAX_SUBSCRIPTIONS) {
    return { error: { message: "Subscription limit reached" } };
  }
  if (method === "publish") {
    const message = JSON.stringify({ event: topic, data: params?.data ?? null, source: connectionId, ...(sessionId ? { sessionId } : {}) }) + "\n";
    const messageBytes = Buffer.byteLength(message, "utf8");
    if (messageBytes > MAX_CUSTOM_EVENT_BYTES) {
      return { error: { message: "Custom event exceeds 64 KiB" } };
    }
    const now = performance.now();
    connection.publishTokens = Math.min(PUBLISH_BURST, connection.publishTokens + (now - connection.lastPublishRefill) * PUBLISH_REFILL_PER_SECOND / 1000);
    connection.lastPublishRefill = now;
    if (connection.publishTokens < 1) {
      return { error: { message: "Custom event publish rate exceeded" } };
    }
    connection.publishTokens -= 1;
    for (const subscriber of connections) {
      if (!subscriber.subscriptions.has(key) || subscriber.socket.destroyed) continue;
      if (subscriber.socket.writableLength + messageBytes > MAX_PENDING_SOCKET_BYTES) {
        subscriber.socket.destroy();
        continue;
      }
      subscriber.socket.write(message);
    }
  }
  if (method === "subscribe") {
    connection.subscriptions.add(key);
    if (isSystemTopic) connection.systemFilterEnabled = true;
  }
  if (method === "unsubscribe") connection.subscriptions.delete(key);
  return { result: { accepted: true } };
}
