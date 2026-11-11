import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function withClient(codemode, callback) {
  const client = new Client({ name: 'annotations-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--headless', ...(codemode ? ['--codemode'] : []), '--extra-core-operators'], stderr: 'pipe' }));
  try { return await callback(client); } finally { await client.close(); }
}

test('MCP tools/list includes explicit safety annotations', { timeout: 20000 }, async () => {
  await withClient(false, async client => {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 15);
    for (const tool of tools) {
      for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'])
        assert.equal(typeof tool.annotations?.[key], 'boolean', `${tool.name}.${key}`);
    }
    const byName = Object.fromEntries(tools.map(t => [t.name, t.annotations]));
    for (const name of ['read', 'ls', 'grep', 'find', 'getContent', 'getBufferInfo', 'takeScreenshot', 'listSessions', 'getClipboard', 'sleep'])
      assert.equal(byName[name].readOnlyHint, true, name);
    for (const name of ['write', 'edit', 'shell', 'type', 'sendKey', 'setClipboard', 'notify', 'createSession', 'destroySession'])
      assert.equal(byName[name].readOnlyHint, false, name);
    assert.equal(byName.shell.openWorldHint, true);
    assert.equal(byName.write.destructiveHint, true);
  });
});

test('codemode is non-read-only and describeTool exposes nested annotations', { timeout: 20000 }, async () => {
  await withClient(true, async client => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'codemode');
    assert.equal(tools[0].annotations.readOnlyHint, false);
    assert.equal(tools[0].annotations.openWorldHint, true);
    const result = await client.callTool({ name: 'codemode', arguments: { code: 'text({read:await describeTool("read"),shell:await describeTool("shell")})' } });
    assert.equal(result.isError, false, JSON.stringify(result));
    const details = JSON.parse(result.content[0].text);
    assert.equal(details.read.annotations.readOnlyHint, true);
    assert.equal(details.shell.annotations.readOnlyHint, false);
    assert.equal(details.shell.annotations.openWorldHint, true);
  });
});
