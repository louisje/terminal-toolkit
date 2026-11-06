/** Version of the internal NDJSON socket protocol, independent of MCP. */
export const SOCKET_PROTOCOL_VERSION = 1;

export const SOCKET_PROTOCOL_CAPABILITIES = Object.freeze([
  "session.attach",
  "session.detach",
  "session.lifecycle",
  "event.custom",
  "event.sessionScope",
  "event.systemFilter",
  "event.rateLimit",
]);

export function negotiateSocketProtocol(requestedVersion: unknown):
  | { result: { protocolVersion: number; capabilities: readonly string[] } }
  | { error: { message: string } } {
  if (requestedVersion !== undefined && requestedVersion !== SOCKET_PROTOCOL_VERSION) {
    return { error: { message: "Unsupported socket protocol version" } };
  }
  return {
    result: {
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      capabilities: SOCKET_PROTOCOL_CAPABILITIES,
    },
  };
}
