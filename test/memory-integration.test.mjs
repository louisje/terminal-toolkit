import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {createToolProxyServer} from "../src/transport/socket.ts";
import {TerminalManager} from "../src/terminal/index.ts";

test("working memory across direct/socket MCP and Codemode", {skip:process.platform==="win32",timeout:60000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"memory-integration-"));
  const socketPath=join(dir,"sock");
  let server;
  try {
    server=createToolProxyServer(socketPath,new TerminalManager(),undefined,true);
    await new Promise(r=>server.once("listening",r));
    for(const socket of [false,true]) for(const codemode of [false,true]){
      const client=new Client({name:"memory-test",version:"1"});
      await client.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js",...(socket?["--mcp","--socket",socketPath]:["--headless"]),...(codemode?["--codemode"]:[])],env:{...process.env},stderr:"pipe"}));
      try {
        const path="memory://scratchpad.md";
        const call=(name,args,id)=>client.callTool({...codemode?{name:"codemode",arguments:{code:"text(await tools."+name+"("+JSON.stringify(args)+"))"}}:{name,arguments:args},...(id?{_meta:{"openai/session":id}}:{})});
        const a="A-"+socket+"-"+codemode, b="B-"+socket+"-"+codemode;
        for(const id of [a,b]){
          const missing=await call("read",{path},id);
          assert.match(missing.content[0].text,/not found/);
          assert.notEqual((await call("write",{path,content:id},id)).isError,true);
        }
        for(const id of [a,b]){
          const result=await call("read",{path},id);
          assert.notEqual(result.isError,true);
          assert.ok(result.content[0].text.startsWith(id),result.content[0].text);
        }
        assert.match((await call("read",{path})).content[0].text,/identity/);
        const stat=async(id,scope)=>JSON.parse((await call("getToolStat",{scope},id)).content[0].text);
        for(const id of [a,b]){
          const local=await stat(id,"conversation");
          assert.equal(local.scope,"conversation");
          assert.equal(local.tools.find(t=>t.name==="read").calls,2);
          assert.equal(local.tools.find(t=>t.name==="write").calls,1);
        }
        const global=await stat(a,"global");
        assert.equal(global.tools.find(t=>t.name==="read").calls,5);
        assert.match((await call("getToolStat",{scope:"conversation"})).content[0].text,/identity/);
      } finally {await client.close();}
    }
  } finally {if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
