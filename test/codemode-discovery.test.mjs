import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function evaluate(code, pi = false, extra = false) {
  const client = new Client({ name: 'discovery-test', version: '1' });
  await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--headless','--codemode','--skills',...(extra ? ['--extra-core-operators'] : [])],stderr:'pipe'}));
  try {
    const result = await client.callTool({name:'codemode',arguments:{code}});
    assert.equal(result.isError, false, JSON.stringify(result));
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  } finally { await client.close(); }
}

test('legacy discovery globals are absent', {timeout:20000}, async () => {
  const result = await evaluate('text({searchTools:typeof searchTools,describeTool:typeof describeTool,describeNamespace:typeof describeNamespace,search:typeof search,describe:typeof describe})');
  assert.deepEqual(result, {searchTools:'undefined',describeTool:'undefined',describeNamespace:'undefined',search:'function',describe:'function'});
});

test('unified search and describe discover tools and skills without loading skill content', {timeout:60000}, async () => {
  const found = await evaluate('text(await search({namespace:"skills/*",name:"terminal-*" }))');
  assert.ok(found.some(s => s.namespace === 'skills/builtin' && s.name === 'terminal-toolkit'));
  const skill = await evaluate('text(await describe({namespace:"skills/builtin",name:"terminal-toolkit"}))');
  assert.equal(skill.source, 'builtin');
  assert.equal(skill.path, 'builtin://skills/terminal-toolkit/');
  assert.ok(skill.size > 0);
  assert.equal(Object.hasOwn(skill, 'content'), false);
  const ns = await evaluate('text(await describe({namespace:"skills/builtin"}))');
  assert.ok(ns.skills.some(s => s.name === 'terminal-toolkit'));
  const tool = await evaluate('text(await describe({namespace:"tools/core",name:"read"}))');
  assert.ok(tool.inputSchema.required.includes('path'));
  const read = await evaluate('text((await tools.read({path:"builtin://skills/terminal-toolkit/SKILL.md",limit:2})))');
  assert.match(read, /---/);
});

test('codemode discovery functions identify tools, schemas and namespace', {timeout:60000}, async () => {
  const found = await evaluate('text(await search({query:"type",limit:3,namespace:"tools/pty"}))');
  assert.ok(found.length <= 3 && found.length > 0);
  const tool = await evaluate('text(await describe({namespace:"tools/core",name:"shell"}))', true);
  assert.equal(tool.name, 'shell');
  assert.ok(tool.inputSchema.required.includes('command'));
  assert.equal(tool.namespace, 'tools/core');
  assert.equal(Object.hasOwn(tool, 'description'), false);
  assert.equal(found[0].namespace, 'tools/pty');
  assert.equal((await evaluate('text(await describe({namespace:"tools/core",name:"shell"}))')).name, 'shell');
  const ns = await evaluate('text(await describe({namespace:"tools/pty"}))');
  assert.equal(ns.namespace, 'tools/pty');
  assert.equal(ns.tools.some(t => t.name === 'shell'), false);
  assert.match(ns.instruction, /First call getContent/);
  assert.ok(ns.tools.every(t => t.name && t.description));
  assert.deepEqual(await evaluate('text(await search({query:"anything",namespace:"another"}))'), []);
});


test('discovery honors enabled operator sets and validates search options', {timeout:60000}, async () => {
  const none = await evaluate('text({names:(await search({namespace:"tools/*"})).map(t=>t.name), ns:await describe({namespace:"tools/pty"})})');
  assert.equal(none.names.includes('shell'), true);
  assert.ok(none.ns.tools.every(t => none.names.includes(t.name)));
  assert.equal((await evaluate('text(await search({query:"shell",namespace:"tools/*"}))')).some(t=>t.name==='shell'), true);
  const enabled = await evaluate('text({names:(await search({namespace:"tools/*"})).map(t=>t.name), ns:await describe({namespace:"tools/core"})})', true);
  assert.equal(enabled.names.includes('shell'), true);
  assert.ok(enabled.ns.tools.every(t => enabled.names.includes(t.name)));
  assert.equal((await evaluate('text(await search({query:"shell",namespace:"tools/*"}))', true)).some(t=>t.name==='shell'), true);
  assert.equal(await evaluate('text(await describe({namespace:"other"}))'), null);
  const invalid = await evaluate('try { await search({query:"shell",limit:0}) } catch(e) { text(e.message) }');
  assert.match(invalid, /positive/);
  const malformed = await evaluate('try { await search("bad") } catch(e) { text(e.message) }');
  assert.match(malformed, /options object/);
});

test('discovery descriptions stay short and detailed guidance appears only on demand', {timeout:20000}, async () => {
  const result = await evaluate('text({all:(await search({namespace:"tools/*"})).find(t=>t.name==="type"), searched:(await search({query:"type",namespace:"tools/*"}))[0], detail:await describe({namespace:"tools/pty",name:"type"})})');
  assert.ok(result.all.description);
  assert.ok(result.all.description.length < 100);
  assert.equal(result.searched.namespace, 'tools/pty');
  assert.match(result.detail.instruction, /autoSubmit/);
  assert.equal(Object.hasOwn(result.detail, 'description'), false);
});

test('search({namespace:"tools/*"}) with no arguments returns every enabled tool without the default search limit', {timeout:20000}, async () => {
  const all = await evaluate('text(await search({namespace:"tools/*"}))', true);
  assert.equal(all.length, 20);
  assert.ok(all.every(t => ['tools/core','tools/pty','tools/misc'].includes(t.namespace) && t.name && t.description));
  assert.ok(all.some(t => t.name === 'shell'));
  assert.deepEqual(await evaluate('text(await search({namespace:"tools/*"}))', true), all);
  const limited = await evaluate('text(await search({namespace:"tools/*",limit:5}))', true);
  assert.equal(limited.length, 5);
});

test('namespace discovery lists categories and filters tools', {timeout:20000}, async () => {
  const result = await evaluate('text({categories:(await search({namespace:"tools/*"})).map(x=>x.namespace).filter((x,i,a)=>a.indexOf(x)===i).map(name=>({name})),pty:await describe({namespace:"tools/pty"}),misc:await describe({namespace:"tools/misc"}),pi:await describe({namespace:"tools/core"}),filtered:await search({namespace:"tools/misc"})})', true);
  assert.deepEqual(new Set(result.categories.map(n => n.name)), new Set(['tools/core','tools/pty','tools/misc']));
  assert.ok(result.pi.tools.some(t => t.name === 'write'));
  assert.ok(result.pty.tools.some(t => t.name === 'createSession'));
  assert.ok(result.misc.tools.some(t => t.name === 'notify'));
  assert.ok(result.filtered.every(t => t.namespace === 'tools/misc'));
  assert.ok(result.pty.tools.every(t => !['write','shell','notify'].includes(t.name)));
});

test('extra Pi operators appear only when enabled and belong to tools/core', {timeout:20000}, async () => {
  const disabled = await evaluate('text((await search({namespace:"tools/*"})).map(t=>t.name))');
  assert.ok(['list','grep','find'].every(name => !disabled.includes(name)));
  const extra = await evaluate('text({all:await search({namespace:"tools/*"}),pi:await describe({namespace:"tools/core"})})', false, true);
  assert.ok(['list','grep','find'].every(name => extra.all.some(t => t.name === name && t.namespace === 'tools/core')));
  assert.ok(['list','grep','find'].every(name => extra.pi.tools.some(t => t.name === name)));
  assert.equal(extra.all.some(t => t.name === 'shell'), true);
  const both = await evaluate('text((await search({namespace:"tools/*"})).filter(t=>t.namespace==="tools/core").map(t=>t.name))', true, true);
  assert.ok(['read','write','edit','shell','list','grep','find'].every(name => both.includes(name)));
});
