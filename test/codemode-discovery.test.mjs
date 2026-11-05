import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function evaluate(code, pi = false, extra = false) {
  const client = new Client({ name: 'discovery-test', version: '1' });
  await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--headless','--codemode',...(pi ? ['--pi-operators'] : []),...(extra ? ['--pi-extra-operators'] : [])],stderr:'pipe'}));
  try {
    const result = await client.callTool({name:'codemode',arguments:{code}});
    assert.equal(result.isError, false, JSON.stringify(result));
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  } finally { await client.close(); }
}

test('codemode discovery functions identify tools, schemas and namespace', {timeout:20000}, async () => {
  const found = await evaluate('text(await searchTools("type", {limit:3, namespace:"tools/pty"}))');
  assert.ok(found.length <= 3 && found.length > 0);
  const tool = await evaluate('text(await describeTool("shell"))', true);
  assert.equal(tool.name, 'shell');
  assert.ok(tool.inputSchema.required.includes('command'));
  assert.equal(tool.namespace, 'tools/pi');
  assert.equal(Object.hasOwn(tool, 'description'), false);
  assert.equal(found[0].namespace, 'tools/pty');
  assert.equal(await evaluate('text(await describeTool("shell"))'), null);
  const ns = await evaluate('text(await describeNamespace("tools/pty"))');
  assert.equal(ns.name, 'tools/pty');
  assert.equal(ns.tools.some(t => t.name === 'shell'), false);
  assert.match(ns.instruction, /First call getContent/);
  assert.ok(ns.tools.every(t => t.name && t.description));
  assert.deepEqual(await evaluate('text(await searchTools("anything", {namespace:"another"}))'), []);
});


test('discovery honors enabled operator sets and validates search options', {timeout:30000}, async () => {
  const none = await evaluate('text({names:(await searchTools()).map(t=>t.name), ns:await describeNamespace("tools/pty")})');
  assert.equal(none.names.includes('shell'), false);
  assert.ok(none.ns.tools.every(t => none.names.includes(t.name)));
  assert.equal((await evaluate('text(await searchTools("shell"))')).some(t=>t.name==='shell'), false);
  const enabled = await evaluate('text({names:(await searchTools()).map(t=>t.name), ns:await describeNamespace("tools/pi")})', true);
  assert.equal(enabled.names.includes('shell'), true);
  assert.ok(enabled.ns.tools.every(t => enabled.names.includes(t.name)));
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
  assert.equal(result.searched.namespace, 'tools/pty');
  assert.match(result.detail.instruction, /autoSubmit/);
  assert.equal(Object.hasOwn(result.detail, 'description'), false);
});

test('searchTools() with no arguments returns every enabled tool without the default search limit', {timeout:20000}, async () => {
  const all = await evaluate('text(await searchTools())', true);
  assert.equal(all.length, 19);
  assert.ok(all.every(t => ['tools/pi','tools/pty','tools/misc'].includes(t.namespace) && t.name && t.description));
  assert.ok(all.some(t => t.name === 'shell'));
  assert.deepEqual(await evaluate('text(await searchTools(""))', true), all);
  const limited = await evaluate('text(await searchTools("", {limit:5}))', true);
  assert.equal(limited.length, 5);
});

test('namespace discovery lists categories and filters tools', {timeout:20000}, async () => {
  const result = await evaluate('text({categories:await describeNamespace(),pty:await describeNamespace("tools/pty"),misc:await describeNamespace("tools/misc"),pi:await describeNamespace("tools/pi"),filtered:await searchTools("",{namespace:"tools/misc"})})', true);
  assert.deepEqual(result.categories.map(n => n.name), ['tools/pi','tools/pty','tools/misc']);
  assert.ok(result.pi.tools.some(t => t.name === 'write'));
  assert.ok(result.pty.tools.some(t => t.name === 'createSession'));
  assert.ok(result.misc.tools.some(t => t.name === 'notify'));
  assert.ok(result.filtered.every(t => t.namespace === 'tools/misc'));
  assert.ok(result.pty.tools.every(t => !['write','shell','notify'].includes(t.name)));
});

test('extra Pi operators appear only when enabled and belong to tools/pi', {timeout:20000}, async () => {
  const disabled = await evaluate('text((await searchTools()).map(t=>t.name))');
  assert.ok(['ls','grep','find'].every(name => !disabled.includes(name)));
  const extra = await evaluate('text({all:await searchTools(),pi:await describeNamespace("tools/pi")})', false, true);
  assert.ok(['ls','grep','find'].every(name => extra.all.some(t => t.name === name && t.namespace === 'tools/pi')));
  assert.ok(['ls','grep','find'].every(name => extra.pi.tools.some(t => t.name === name)));
  assert.equal(extra.all.some(t => t.name === 'shell'), false);
  const both = await evaluate('text((await searchTools()).filter(t=>t.namespace==="tools/pi").map(t=>t.name))', true, true);
  assert.ok(['read','write','edit','shell','ls','grep','find'].every(name => both.includes(name)));
});
