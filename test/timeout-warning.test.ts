import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { installTimeoutWarning, timeoutWarningScope } from "../src/runtime/timeoutWarning.ts";

test("warning acknowledges only matching opted-in active requests", { timeout: 5000 }, async () => {
  const server = new Server({name:"test",version:"1"}, {capabilities:{}});
  const withWarning = installTimeoutWarning(server);
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await b.start();
  const received: unknown[] = [];
  b.onmessage = msg => received.push(msg);
  const send = async (id: number) => {
    await b.send({jsonrpc:"2.0",method:"notifications/tunnel/response_timeout_warning",params:{requestId:id,remainingMs:10000}});
    await new Promise(resolve => setImmediate(resolve));
  };
  try {
    const pending = withWarning(42,"shell",async () => {
      const signal = timeoutWarningScope.getStore()!;
      await new Promise<void>(resolve => signal.addEventListener("abort",()=>resolve(),{once:true}));
    });
    await send(43);
    assert.equal(received.length,0);
    await send(42);
    await pending;
    assert.deepEqual(received,[{jsonrpc:"2.0",method:"notifications/tunnel/response_timeout_ack",params:{requestId:42}}]);
    await send(42);
    await withWarning(44,"read",async()=>{ await send(44); });
    assert.equal(received.length,1);
  } finally { await server.close(); await b.close(); }
});
