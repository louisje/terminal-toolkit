import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createToolProxyServer } from '../src/transport/socket.ts';
import { TerminalManager } from '../src/terminal/index.ts';

test('socket cancellation aborts an in-flight shell command', { timeout: 12000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmcp-socket-abort-'));
  const marker = join(dir, 'should-not-exist');
  const server = createToolProxyServer(join(dir, 'socket'), new TerminalManager(), undefined, true);
  let socket;
  try {
    await new Promise(resolve => server.once('listening', resolve));
    socket = connect(join(dir, 'socket'));
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write(JSON.stringify({id:1,method:'shell',params:{command:`sleep 2; touch '${marker}'`}}) + '\n');
    await new Promise(resolve => setTimeout(resolve, 100));
    socket.write(JSON.stringify({id:2,method:'cancel',params:{requestId:1}}) + '\n');
    await new Promise(resolve => setTimeout(resolve, 2400));
    assert.equal(existsSync(marker), false, 'cancelled shell must not finish delayed side effect');
  } finally {
    socket?.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});

test('socket warning detaches shell and python without cancelling', {timeout:12000}, async () => {
  const dir = mkdtempSync(join(tmpdir(),'tmcp-socket-warning-'));
  const server = createToolProxyServer(join(dir,'socket'),new TerminalManager(),undefined,true);
  let socket;
  try {
    await new Promise(resolve=>server.once('listening',resolve));
    socket=connect(join(dir,'socket'));
    await new Promise(resolve=>socket.once('connect',resolve));
    let buffer='';
    const responses=new Map();
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      let end;
      while((end=buffer.indexOf('\n'))>=0){
        const msg=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
        responses.set(msg.id,msg);
      }
    });
    const send=msg=>socket.write(JSON.stringify(msg)+'\n');
    for(const [id,method,params] of [[1,'shell',{command:'sleep 1; echo done'}],[3,'python',{code:'import time; time.sleep(1); print("done")'}]]){
      send({id,method,params:{...params,timeout:30}});
      send({id:id+1,method:'responseTimeoutWarning',params:{requestId:id}});
      for(let i=0;i<100&&!responses.has(id);i++) await new Promise(r=>setTimeout(r,20));
      const response=responses.get(id);
      assert.ok(response,method);
      assert.match(response.result.content[0].text,/executionId:/);
    }
  } finally {
    socket?.destroy();
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
