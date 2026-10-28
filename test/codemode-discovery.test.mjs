import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function evaluate(code, pi = false) {
  const client = new Client({ name: 'discovery-test', version: '1' });
  await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--headless','--codemode',...(pi ? ['--pi-operators'] : [])],stderr:'pipe'}));
  try {
    const result = await client.callTool({name:'codemode',arguments:{code}});
    assert.equal(result.isError, false, JSON.stringify(result));
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  } finally { await client.close(); }
}

test('codemode discovery functions identify tools, schemas and namespace', {timeout:20000}, async () => {
  const found = await evaluate('text(await searchTools("terminal", {limit:3, namespace:"terminal"}))');
  assert.ok(found.length <= 3 && found.length > 0);
  const tool = await evaluate('text(await describeTool("shell"))', true);
  assert.equal(tool.name, 'shell');
  assert.ok(tool.inputSchema.required.includes('command'));
  assert.equal(tool.namespace, 'terminal');
  assert.equal(Object.hasOwn(tool, 'description'), false);
  assert.equal(found[0].namespace, 'terminal');
  assert.equal(await evaluate('text(await describeTool("shell"))'), null);
  const ns = await evaluate('text(await describeNamespace("terminal"))');
  assert.equal(ns.name, 'terminal');
  assert.equal(ns.tools.some(t => t.name === 'shell'), false);
  assert.match(ns.instruction, /First call getContent/);
  assert.ok(ns.tools.every(t => t.name && t.description));
  assert.deepEqual(await evaluate('text(await searchTools("anything", {namespace:"another"}))'), []);
});


test('discovery honors enabled operator sets and validates search options', {timeout:30000}, async () => {
  const none = await evaluate('text({names:(await searchTools()).map(t=>t.name), ns:await describeNamespace("terminal")})');
  assert.equal(none.names.includes('shell'), false);
  assert.deepEqual(none.names, none.ns.tools.map(t => t.name));
  assert.equal((await evaluate('text(await searchTools("shell"))')).some(t=>t.name==='shell'), false);
  const enabled = await evaluate('text({names:(await searchTools()).map(t=>t.name), ns:await describeNamespace("terminal-toolkit")})', true);
  assert.equal(enabled.names.includes('shell'), true);
  assert.deepEqual(enabled.names, enabled.ns.tools.map(t => t.name));
  assert.equal((await evaluate('text(await searchTools("shell"))', true)).some(t=>t.name==='shell'), true);
  assert.equal(await evaluate('text(await describeNamespace("other"))'), null);
  const invalid = await evaluate('try { await searchTools("shell", {limit:0}) } catch(e) { text(e.message) }');
  assert.match(invalid, /positive integer/);
  const malformed = await evaluate('try { await searchTools("shell", "bad") } catch(e) { text(e.message) }');
  assert.match(malformed, /options must be an object/);
});

test('discovery descriptions stay short and detailed guidance appears only on demand', {timeout:20000}, async () => {
  const result = await evaluate('text({all:(await searchTools()).find(t=>t.name==="type"), searched:(await searchTools("type"))[0], detail:await describeTool("type")})');
  assert.ok(result.all.description);
  assert.ok(result.all.description.length < 100);
  assert.equal(result.searched.namespace, 'terminal');
  assert.match(result.detail.instruction, /autoSubmit/);
  assert.equal(Object.hasOwn(result.detail, 'description'), false);
});

test('searchTools() with no arguments returns every enabled tool without the default search limit', {timeout:20000}, async () => {
  const all = await evaluate('text(await searchTools())', true);
  assert.equal(all.length, 19);
  assert.ok(all.every(t => t.namespace === 'terminal' && t.name && t.description));
  assert.ok(all.some(t => t.name === 'shell'));
  assert.deepEqual(await evaluate('text(await searchTools(""))', true), all);
  const limited = await evaluate('text(await searchTools("", {limit:5}))', true);
  assert.equal(limited.length, 5);
});
