import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {createToolProxyServer} from "../src/transport/socket.ts";
import {TerminalManager} from "../src/terminal/index.ts";

test("MCP search partial timeout and cancellation across local/socket and direct/Codemode", {skip:process.platform==="win32",timeout:30000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"search-integration-"));
  const oldPath=process.env.PATH;
  const pidPath=join(dir,"pid");
  const socketPath=join(dir,"sock");
  let server;
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn) {
    for(let i=0;i<200;i++){if(await fn())return;await pause(20);}
    assert.fail("condition not reached");
  }
  const dead=pid=>{try{process.kill(pid,0);return false;}catch(e){return e.code==="ESRCH";}};
  try {
    const event=JSON.stringify({type:"match",data:{path:{text:join(dir,"sample")},line_number:1,lines:{text:"needle\n"}}});
    await writeFile(join(dir,"rg"),"#!"+process.execPath+"\nrequire('node:fs').writeFileSync("+JSON.stringify(pidPath)+",String(process.pid));console.log("+JSON.stringify(event)+");setInterval(()=>{},1000);\n");
    await chmod(join(dir,"rg"),0o755);
    process.env.PATH=dir+":"+oldPath;
    server=createToolProxyServer(socketPath,new TerminalManager(),undefined,true);
    await new Promise(r=>server.once("listening",r));
    for(const socket of [false,true]) for(const codemode of [false,true]){
      console.log(`mode socket=${socket} codemode=${codemode}`);
      const client=new Client({name:"search-test",version:"1"});
      await client.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js",...(socket?["--mcp","--socket",socketPath]:["--headless"]),...(codemode?["--codemode"]:[])],env:{...process.env},stderr:"pipe"}));
      try {
        const request=timeout=>{const params={path:dir,pattern:"needle",timeout};return codemode?{name:"codemode",arguments:{code:"text(await tools.grep("+JSON.stringify(params)+"))"}}:{name:"grep",arguments:params};};
        const partial=await client.callTool(request(0.8));
        assert.match(partial.content[0].text,/needle/);
        assert.match(partial.content[0].text,/timedOut=true incomplete=true/);
        const oldPid=Number(await readFile(pidPath,"utf8"));
        assert.ok(dead(oldPid));
        const controller=new AbortController();
        const pending=client.callTool(request(0),undefined,{signal:controller.signal});
        const rejected=assert.rejects(pending);
        let pid;
        await waitFor(async()=>{pid=Number(await readFile(pidPath,"utf8"));return pid!==oldPid;});
        controller.abort();
        await rejected;
        await waitFor(()=>dead(pid));
        console.log(`cancelled pid=${pid}`);
      } finally {await client.close();}
    }
  } finally {if(server)await new Promise(r=>server.close(r));process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});}
});
