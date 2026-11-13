import { test } from "node:test";
import { strict as assert } from "node:assert";
import { enableInitializeExperiment } from "../src/initializeExperiment.ts";

test("initialize experiment generates a new code for every initialize and preserves SDK result", async () => {
  let handler;
  const logs = [];
  const server = {
    setRequestHandler(_schema, callback) { handler = callback; },
    async _oninitialize() { return { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "terminal-toolkit", version: "test" }, instructions: "Base guidance" }; },
  };
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    enableInitializeExperiment(server);
    const first = await handler({ params: { protocolVersion: "2025-11-25" } });
    const second = await handler({ params: { protocolVersion: "2025-11-25" } });
    const extract = (value) => value.instructions.match(/TT-INIT-[0-9A-F]{8}/)?.[0];
    assert.ok(extract(first));
    assert.ok(extract(second));
    assert.notEqual(extract(first), extract(second));
    assert.match(first.instructions, /^Base guidance/);
    assert.deepEqual(first.capabilities, { tools: {} });
    assert.equal(first.protocolVersion, "2025-11-25");
    assert.ok(logs[0].includes(extract(first)));
    assert.ok(logs[1].includes(extract(second)));
    assert.equal(logs.length, 2);
  } finally { console.error = original; }
});
