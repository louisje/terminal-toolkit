import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, cpSync, rmSync, symlinkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('Claude plugin bootstrap runs the bundled codemode without project node_modules', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmcp-plugin-test-'));
  try {
    mkdirSync(join(dir, 'dist', 'node_modules'), { recursive: true });
    for (const file of ['index.js', 'codemode-worker.js', 'quickjs.wasm']) {
      cpSync(join(root, 'dist', file), join(dir, 'dist', file));
    }
    cpSync(join(root, 'bootstrap.cjs'), join(dir, 'bootstrap.cjs'));
    cpSync(join(root, 'skills'), join(dir, 'skills'), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    // Exercise the required native dependency without an external npm download.
    // Keep optional resvg declared: bootstrap must start without a network install.
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
    symlinkSync(join(root, 'node_modules', 'node-pty'), join(dir, 'dist', 'node_modules', 'node-pty'), 'junction');
    const client = new Client({ name: 'plugin-test', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [join(dir, 'bootstrap.cjs'), '--headless', '--codemode', '--pi-operators'],
        cwd: dir,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'TERMINAL_TOOLKIT')),
        stderr: 'pipe',
      }));
      assert.deepEqual((await client.listTools()).tools.map(x => x.name), ['codemode']);
      const result = await client.callTool({
        name: 'codemode',
        arguments: { code: 'text(await tools.shell({command:"printf plugin-ok"}))' },
      });
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.equal(result.content[0].text, 'plugin-ok');
    } finally {
      await client.close().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
