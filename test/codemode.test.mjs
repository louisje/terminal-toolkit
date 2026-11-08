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
  } finally {
    await client.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    manager.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
