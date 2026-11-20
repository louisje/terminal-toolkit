import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('ordinary MCP calls share process-wide getToolStat counters', {timeout: 20000}, async () => {
  const client = new Client({name: 'mcp-stats-test', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: ['dist/index.js', '--headless'], stderr: 'pipe'}));
  try {
    const listed = await client.listTools();
    assert.ok(listed.tools.some(t => t.name === 'getToolStat'));
    await client.callTool({name: 'systemInfo', arguments: {}});
    const result = await client.callTool({name: 'getToolStat', arguments: {category: 'tool', namespace: 'tools/misc'}});
    assert.notEqual(result.isError, true);
    const stats = JSON.parse(result.content[0].text);
    assert.equal(stats.tools.find(t => t.name === 'systemInfo').calls, 1);
    assert.equal(stats.tools.find(t => t.name === 'getToolStat').calls, 1);
    assert.ok(stats.tools.every(t => t.namespace === 'tools/misc'));
  } finally { await client.close(); }
});
