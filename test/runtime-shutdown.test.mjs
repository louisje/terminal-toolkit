import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const mode of ["headless","owned-socket"]) {
  test(mode + " shutdown terminates detached execution", {timeout:20000,skip:process.platform==="win32"}, async () => {
    const dir = await mkdtemp(join(tmpdir(),"tt-runtime-shutdown-"));
    const client = new Client({name:"runtime-shutdown",version:"1.0.0"});
    let pid;
    try {
      await client.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js",...(mode==="headless"?["--headless"]:["--socket",join(dir,"mcp.sock")])],stderr:"pipe"}));
      const result = await client.callTool({name:"shell",arguments:{command:"exec sleep 120",timeout:0}});
      assert.notEqual(result.isError,true,JSON.stringify(result));
      const executionId = result.content[0].text.match(/executionId: ([\w-]+)/)[1];
      const info = JSON.parse((await client.callTool({name:"getExecution",arguments:{executionId}})).content[0].text);
      pid=info.pid;
      assert.ok(pid>0);
      process.kill(pid,0);
      await client.close();
      for(let i=0;i<100;i++){
        try {process.kill(pid,0);} catch(error){if(error.code==="ESRCH"){pid=undefined;break;}throw error;}
        await new Promise(r=>setTimeout(r,30));
      }
      assert.equal(pid,undefined,"detached process survived server shutdown");
    } finally {
      await client.close().catch(()=>{});
      if(pid) try{process.kill(pid,"SIGKILL");}catch{}
      await rm(dir,{recursive:true,force:true});
    }
  });
}
