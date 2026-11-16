import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";

type Subscription = { id: string; name: string; url: string; secret: string; refreshBefore: string };
const stateFile = () => process.env.TERMINAL_TOOLKIT_EVENTS_STATE || join(homedir(), ".local", "state", "terminal-toolkit", "mcp-events-experiment.json");
const blocked = new BlockList();
for (const [ip, bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked.addSubnet(ip,bits,"ipv4");

async function readSubscriptions(): Promise<Subscription[]> {
  try {
    const raw = JSON.parse(await fs.readFile(stateFile(), "utf8"));
    return Array.isArray(raw) ? raw.filter((s): s is Subscription => typeof s?.id === "string" && typeof s?.url === "string" && typeof s?.secret === "string" && typeof s?.refreshBefore === "string") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function saveSubscriptions(subs: Subscription[]): Promise<void> {
  const path = stateFile();
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + randomUUID();
  try {
    await fs.writeFile(tmp, JSON.stringify(subs), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, path);
  } finally { await fs.rm(tmp, { force: true }); }
}
function signingKey(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) throw new Error("Invalid signing secret");
  const value = secret.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid signing secret");
  const key = Buffer.from(value, "base64");
  if (key.length < 24 || key.length > 64 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) throw new Error("Invalid signing secret");
  return key;
}
function callbackURL(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !url.hostname || isIP(url.hostname)) throw new Error("Invalid HTTPS callback URL");
  return url;
}
async function publicAddress(url: URL): Promise<string> {
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(({ address }) => blocked.check(address, "ipv4"))) throw new Error("Callback resolves to a non-public address");
  return addresses[0].address;
}
function sign(secret: string, id: string, timestamp: string, body: string): string {
  return "v1," + createHmac("sha256", signingKey(secret)).update(id + "." + timestamp + "." + body).digest("base64");
}
async function postSigned(sub: Subscription, id: string, body: string): Promise<{ status: number; body: string }> {
  const url = callbackURL(sub.url);
  const address = await publicAddress(url);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "POST",
      timeout: 10000,
      lookup: (_host, _opts, cb) => cb(null, address, 4),
      headers: {
        "Content-Type": "application/json", "webhook-id": id,
        "webhook-timestamp": timestamp, "webhook-signature": sign(sub.secret, id, timestamp, body),
        "X-MCP-Subscription-Id": sub.id, "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { data += chunk; if (data.length > 4096) req.destroy(new Error("Callback response too large")); });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("timeout", () => req.destroy(new Error("Callback timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
async function verify(sub: Subscription): Promise<void> {
  const challenge = randomUUID();
  const result = await postSigned(sub, "msg_verification_" + randomUUID(), JSON.stringify({ type: "verification", challenge }));
  let echoed: unknown;
  try { echoed = JSON.parse(result.body).challenge; } catch { /* invalid callback response */ }
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(typeof echoed === "string" ? echoed : "");
  if (result.status < 200 || result.status >= 300 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Callback challenge failed");
}

/** Experimental single-user event delivery. The CLI and MCP process share a local state file. */
export async function emitTerminalTest(message: string): Promise<{ delivered: number; attempted: number }> {
  if (!message || Buffer.byteLength(message) > 8192) throw new Error("Message must be 1–8192 bytes");
  const subs = (await readSubscriptions()).filter(s => s.name === "terminal.test" && Date.parse(s.refreshBefore) > Date.now());
  const event = { eventId: "evt_" + randomUUID(), name: "terminal.test", timestamp: new Date().toISOString(), data: { message }, cursor: null };
  const body = JSON.stringify(event);
  let delivered = 0;
  for (const sub of subs) {
    try {
      const result = await postSigned(sub, event.eventId, body);
      if (result.status >= 200 && result.status < 300) delivered++;
      else console.error("[terminal-toolkit] event delivery rejected", { status: result.status });
    } catch (error) {
      console.error("[terminal-toolkit] event delivery failed", { error: String(error) });
    }
  }
  return { delivered, attempted: subs.length };
}
export function enableMcpEventsExperiment(server: Server): void {
  const schema = (method: string) => z.object({ method: z.literal(method), params: z.record(z.unknown()).optional() });
  server.setRequestHandler(schema("events/list"), async () => ({
    events: [{ name: "terminal.test", description: "Manually triggered test message", delivery: ["webhook"], inputSchema: { type: "object", properties: {}, additionalProperties: false }, payloadSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } }],
  }));
  server.setRequestHandler(schema("events/subscribe"), async request => {
    const params = request.params as Record<string, unknown> | undefined;
    const delivery = params?.delivery as Record<string, unknown> | undefined;
    if (params?.name !== "terminal.test" || !params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments) || Object.keys(params.arguments).length !== 0 || delivery?.mode !== "webhook" || typeof delivery.url !== "string" || typeof delivery.secret !== "string") throw new Error("Invalid terminal.test subscription");
    callbackURL(delivery.url);
    signingKey(delivery.secret);
    const id = "sub_" + createHash("sha256").update(JSON.stringify(["terminal.test", delivery.url, {}])).digest("hex").slice(0, 32);
    const refreshBefore = new Date(Date.now() + Math.min(typeof params.ttlMs === "number" && params.ttlMs > 0 ? params.ttlMs : 86400000, 86400000)).toISOString();
    const sub = { id, name: "terminal.test", url: delivery.url, secret: delivery.secret, refreshBefore };
    await verify(sub);
    const subs = (await readSubscriptions()).filter(s => s.id !== id && Date.parse(s.refreshBefore) > Date.now());
    await saveSubscriptions([...subs, sub]);
    console.error("[terminal-toolkit] experiment: terminal.test subscribed", { id });
    return { id, refreshBefore, cursor: null, truncated: false };
  });
  server.setRequestHandler(schema("events/unsubscribe"), async request => {
    const params = request.params as Record<string, unknown> | undefined;
    const delivery = params?.delivery as Record<string, unknown> | undefined;
    if (params?.name !== "terminal.test" || typeof delivery?.url !== "string") throw new Error("Invalid unsubscribe");
    const id = "sub_" + createHash("sha256").update(JSON.stringify(["terminal.test", delivery.url, {}])).digest("hex").slice(0, 32);
    await saveSubscriptions((await readSubscriptions()).filter(s => s.id !== id));
    console.error("[terminal-toolkit] experiment: terminal.test unsubscribed", { id });
    return {};
  });
}
