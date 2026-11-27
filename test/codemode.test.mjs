import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function connect(args) {
  const client = new Client({ name: 'codemode-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--headless', ...args], stderr: 'pipe' }));
  return client;
}

test('codemode exposes only one tool and invokes opted-in operators', { timeout: 20000 }, async () => {
  const client = await connect(['--codemode']);
  try {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['codemode']);
    const result = await client.callTool({ name: 'codemode', arguments: { code: 'text(await tools.shell({command:"printf codemode-ok"}))' } });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].text, 'codemode-ok');
    const names = await client.callTool({ name: 'codemode', arguments: { code: 'text(ALL_TOOLS.map(x=>x.name).includes("shell"))' } });
    assert.equal(names.content[0].text, 'true');
    const failure = await client.callTool({ name: 'codemode', arguments: { code: 'throw new Error("intentional")' } });
    assert.equal(failure.isError, true);
  } finally { await client.close(); }
});

test('codemode suppresses text output exceeding 16 KiB', { timeout: 20000 }, async () => {
  const client = await connect(['--codemode']);
  try {
    const small = await client.callTool({ name: 'codemode', arguments: { code: 'text("x".repeat(16384))' } });
    assert.equal(small.content[0].text.length, 16384);
    const large = await client.callTool({ name: 'codemode', arguments: { code: 'text("x".repeat(16385))' } });
    assert.match(large.content[0].text, /suppressed/);
    assert.doesNotMatch(large.content[0].text, /result:\/\//);
    const cumulative = await client.callTool({ name: 'codemode', arguments: { code: 'text("x".repeat(5000)); text("y".repeat(5000))' } });
    assert.equal(cumulative.content.length, 2);
    assert.equal(cumulative.content[0].text.length, 5000);
    assert.equal(cumulative.content[1].text.length, 5000);
    const mixed = await client.callTool({ name: "codemode", arguments: { code: `text("ok"); text("x".repeat(16385)); text("still ok")` } });
    assert.equal(mixed.content[0].text, "ok");
    assert.match(mixed.content[1].text, /suppressed/);
    assert.doesNotMatch(mixed.content[1].text, /result:\/\//);
    assert.equal(mixed.content[2].text, "still ok");
    const returned = await client.callTool({ name: 'codemode', arguments: { code: 'return "x".repeat(16385)' } });
    assert.equal(returned.content[0].text.length, 16387);
  } finally { await client.close(); }
});

test('codemode exposes core operators by default', { timeout: 20000 }, async () => {
  const client = await connect(['--codemode']);
  try {
    const result = await client.callTool({ name: 'codemode', arguments: { code: 'text(ALL_TOOLS.some(x=>x.name==="shell"))' } });
    assert.equal(result.content[0].text, 'true');
  } finally { await client.close(); }
});

test('codemode works through a real socket-connected MCP client', { timeout: 25000 }, async () => {
  const { createToolProxyServer } = await import('../src/transport/socket.ts');
  const { TerminalManager } = await import('../src/terminal/index.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'tmcp-codemode-'));
  const socketPath = join(dir, 'mcp.sock');
  const manager = new TerminalManager();
  const server = createToolProxyServer(socketPath, manager);
  await new Promise((resolve, reject) => server.listening ? resolve() : server.once('listening', resolve).once('error', reject));
  const client = new Client({ name: 'codemode-socket-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--socket', socketPath, '--codemode'], stderr: 'pipe' }));
    assert.deepEqual((await client.listTools()).tools.map(x => x.name), ['codemode']);
    const value = await client.callTool({ name: 'codemode', arguments: { code: 'text(await tools.shell({command:"printf socket-ok"}))' } });
    assert.equal(value.isError, false, JSON.stringify(value));
    assert.equal(value.content[0].text, 'socket-ok');
    const invoke = async code => {
      const r = await client.callTool({name:'codemode',arguments:{code}});
      assert.equal(r.isError,false,JSON.stringify(r));
      return r.content[0].text;
    };
    const detached = await invoke('text(await tools.shell({command:"sleep 1; printf background-ok",timeout:0}))');
    const executionId = detached.match(/executionId: ([\w-]+)/)[1];
    const args = JSON.stringify({executionId});
    await client.close();
    const second = new Client({name:'runtime-reconnect',version:'1.0.0'});
    try {
      await second.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--socket',socketPath],stderr:'pipe'}));
      const result = await second.callTool({name:'waitExecution',arguments:{executionId}});
      assert.notEqual(result.isError,true,JSON.stringify(result));
      const info = JSON.parse(result.content[0].text);
      assert.equal(info.status,'completed');
      const read = await second.callTool({name:'read',arguments:{path:info.paths.stdout}});
      assert.equal(read.content[0].text,'background-ok');
    } finally { await second.close(); }
    await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--socket',socketPath,'--codemode'],stderr:'pipe'}));
    const info = JSON.parse(await invoke('text(await tools.waitExecution('+args+'))'));
    assert.equal(info.status,'completed');
    const path = info.paths.stdout;
    assert.match(await invoke('text(await tools.read('+JSON.stringify({path})+'))'), /^background-ok\n\[read-metadata\]/);
    assert.match(await invoke('text(await tools.grep('+JSON.stringify({path,pattern:'background-ok'})+'))'),/background-ok/);
    await invoke('text(await tools.removeExecution('+args+'))');
    const saved = await client.callTool({ name: 'codemode', arguments: { code: 'text(Array.from({length:3000},(_,i)=>i===1234?"socket-needle":"line-"+i).join("\\n"))' } });
    assert.match(saved.content[0].text, /suppressed/);
    assert.doesNotMatch(saved.content[0].text, /result:\/\//);
    const virtualPath = 'result://00000000-0000-4000-8000-000000000000';
    for (const code of [`text(await tools.read({path:${JSON.stringify(virtualPath)}}))`, `text(await tools.grep({path:${JSON.stringify(virtualPath)},pattern:"socket-needle"}))`]) {
      const rejected = await client.callTool({ name: 'codemode', arguments: { code } });
      assert.equal(rejected.isError, true);
      assert.match(rejected.content[0].text, /not supported in Codemode/);
    }
  } finally {
    await client.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    manager.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
