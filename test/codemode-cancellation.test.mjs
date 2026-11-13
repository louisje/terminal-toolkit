import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { handleOperatorTool } from '../src/tools/operators.ts';

// Aborting the host signal must cancel a running one-shot command.
test('shell operator respects abort signal', { timeout: 12000 }, async () => {
  const controller = new AbortController();
  const pending = handleOperatorTool('shell', { command: 'sleep 10' }, undefined, controller.signal);
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(pending, /Command aborted/);
});

test('codemode timeout aborts its in-flight tool signal', { timeout: 12000 }, async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({name:'timeout-test',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--headless','--codemode'],stderr:'pipe'}));
  try {
    const r = await client.callTool({name:'codemode',arguments:{code:'await tools.sleep({milliseconds:70000})',timeoutMs:250}});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /timed out|timeout|exceeded/i);
  } finally { await client.close(); }
});

test('sleep operator aborts immediately and leaves terminal management untouched', async () => {
  const { handleSleep } = await import('../src/tools/sleep.ts');
  const controller = new AbortController();
  const pending = handleSleep(undefined, {milliseconds:10000}, controller.signal);
  controller.abort();
  await assert.rejects(pending, /Sleep aborted/);
});

test('cancelled PTY calls do not dispatch input into an existing session', async () => {
  const { dispatchTool } = await import('../src/tools/index.ts');
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const manager = { write() { called = true; } };
  await assert.rejects(dispatchTool(manager, 'type', {text:'should-not-run'}, false, controller.signal), /Tool call aborted/);
  assert.equal(called, false);
});

test('shell abort kills background descendants, not only shell', {timeout:10000}, async () => {
  if (process.platform === 'win32') return;
  const {mkdtempSync, existsSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'tmcp-tree-abort-'));
  const marker=join(dir,'orphan-marker');
  try {
    const controller=new AbortController();
    const pending=handleOperatorTool('shell',{command:`(sleep 1; touch '${marker}') & wait`},undefined,controller.signal);
    setTimeout(()=>controller.abort(),100);
    await assert.rejects(pending,/Command aborted/);
    await new Promise(resolve=>setTimeout(resolve,1200));
    assert.equal(existsSync(marker),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
