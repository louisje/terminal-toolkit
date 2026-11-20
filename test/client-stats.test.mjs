import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('socket MCP client owns tool statistics instead of forwarding getToolStat', {timeout: 15000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-client-stats-'));
  const socketPath = join(dir, 'server.sock');
  const forwarded = [];
  const server = net.createServer(socket => {
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const req = JSON.parse(line);
        if (typeof req.id !== 'number') continue;
        forwarded.push(req.method);
        if (req.method === 'systemInfo') socket.write(JSON.stringify({id:req.id,result:{content:[{type:'text',text:'{}'}]}})+'\n');
        else socket.write(JSON.stringify({id:req.id,error:{message:'unexpected method: '+req.method}})+'\n');
      }
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  const client = new Client({name:'client-stats-test',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','--mcp','--socket',socketPath],stderr:'pipe'}));
    const first = await client.callTool({name:'getToolStat',arguments:{}});
    assert.notEqual(first.isError,true);
    await client.callTool({name:'systemInfo',arguments:{}});
    const result = await client.callTool({name:'getToolStat',arguments:{}});
    assert.notEqual(result.isError,true);
    const stats = JSON.parse(result.content[0].text);
    assert.equal(stats.tools.find(x=>x.name==='systemInfo').calls,1);
    assert.equal(stats.tools.find(x=>x.name==='getToolStat').calls,2);
    assert.deepEqual(forwarded.filter(x=>x==='getToolStat'),[]);
  } finally {
    await client.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
