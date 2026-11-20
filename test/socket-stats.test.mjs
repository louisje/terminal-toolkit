import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createToolProxyServer } from '../src/transport/socket.ts';
import { TerminalManager } from '../src/terminal/index.js';

test('socket proxy dispatches getToolStat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-socket-stats-'));
  const server = createToolProxyServer(join(dir, 'proxy.sock'), new TerminalManager());
  let socket;
  try {
    if (!server.listening) await once(server, 'listening');
    socket = connect(join(dir, 'proxy.sock'));
    await once(socket, 'connect');
    const response = new Promise((resolve, reject) => {
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk.toString();
        while (buffer.includes('\n')) {
          const idx = buffer.indexOf('\n');
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line) {
            const message = JSON.parse(line);
            if (message.id === 1) resolve(message);
          }
        }
      });
      socket.on('error', reject);
    });
    socket.write(JSON.stringify({ id: 1, method: 'getToolStat', params: { namespace: 'tools/misc' } }) + '\n');
    const reply = await response;
    assert.equal(reply.id, 1);
    assert.equal(reply.error, undefined);
    const stats = JSON.parse(reply.result.content[0].text);
    assert.ok(Array.isArray(stats.tools));
  } finally {
    socket?.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
