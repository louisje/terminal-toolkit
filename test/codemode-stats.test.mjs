import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('getToolStat aggregates discovery and tool usage across codemode calls', { timeout: 20000 }, async () => {
  const client = new Client({ name: 'stats-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--headless', '--codemode', '--pi-operators'], stderr: 'pipe' }));
  const evaluate = async code => {
    const result = await client.callTool({ name: 'codemode', arguments: { code } });
    assert.equal(result.isError, false, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  try {
    await evaluate('text({a:await searchTools("shell"),b:await describeTool("shell"),c:await describeNamespace("tools/pi")})');
    await evaluate('text(JSON.stringify(await tools.shell({command:"printf ok"})))');
    const stats = await evaluate('text(await getToolStat())');
    assert.equal(stats.discovery.searchTools.queries.find(q => q.query === 'shell').calls, 1);
    assert.equal(stats.discovery.describeTool.shell, 1);
    assert.equal(stats.discovery.describeNamespace['tools/pi'], 1);
    assert.equal(stats.tools.find(t => t.name === 'shell').calls, 1);
    assert.equal(stats.tools.find(t => t.name === 'searchTools').calls, 1);
    const filtered = await evaluate('text(await getToolStat({category:"tool",namespace:"tools/pi"}))');
    assert.ok(filtered.tools.some(t => t.name === 'shell'));
    assert.ok(filtered.tools.every(t => t.namespace === 'tools/pi'));
    assert.equal(filtered.discovery, undefined);
    const later = await evaluate('text(await getToolStat({category:"discovery"}))');
    assert.ok(later.tools.find(t => t.name === 'getToolStat').calls >= 2);
  } finally { await client.close(); }
});
