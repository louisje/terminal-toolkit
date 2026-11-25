import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createToolProxyServer } from '../src/transport/socket.ts';
import { TerminalManager } from '../src/terminal/index.ts';

for (const mode of ['headless','proxy']) {
  test(mode+' MCP warning detaches runtime tools', {timeout:20000}, async () => {
    const dir=await mkdtemp(join(tmpdir(),'tt-warning-e2e-'));
    const path=join(dir,'proxy.sock');
    const server=mode==='proxy'?createToolProxyServer(path,new TerminalManager()):undefined;
    if(server&&!server.listening) await new Promise(r=>server.once('listening',r));
    const client=new Client({name:'warning-test',version:'1'});
    const transport=new StdioClientTransport({command:process.execPath,args:['dist/index.js',...(server?['--mcp','--socket',path]:['--headless'])],stderr:'pipe'});
    const send=transport.send.bind(transport);
    let requestId;
    transport.send=msg=>{
      if(msg.method==='tools/call') requestId=msg.id;
      return send(msg);
    };
    const acks=[];
    client.fallbackNotificationHandler=async msg=>{if(msg.method==='notifications/tunnel/response_timeout_ack') acks.push(msg.params.requestId);};
    try {
      await client.connect(transport);
      for(const [name,args] of [['shell',{command:'sleep 2; echo done'}],['python',{code:'import time; time.sleep(2); print("done")'}]]){
        const pending=client.callTool({name,arguments:{...args,timeout:30}});
        const id=requestId;
        await new Promise(r=>setTimeout(r,100));
        await send({jsonrpc:'2.0',method:'notifications/tunnel/response_timeout_warning',params:{requestId:id,remainingMs:10000}});
        const result=await pending;
        assert.notEqual(result.isError,true,JSON.stringify(result));
        const executionId=result.content[0].text.match(/executionId: ([\w-]+)/)?.[1];
        assert.ok(executionId,JSON.stringify(result));
        assert.ok(acks.includes(id));
        const info=JSON.parse((await client.callTool({name:'getExecution',arguments:{executionId}})).content[0].text);
        assert.equal(info.background,true);
        await client.callTool({name:'cancelExecution',arguments:{executionId}});
      }
    } finally {
      await client.close().catch(()=>{});
      if(server) await new Promise(r=>server.close(r));
      await rm(dir,{recursive:true,force:true});
    }
  });
}
