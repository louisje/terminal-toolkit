import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connect(flags) {
  const client = new Client({name:"skill-discovery-test",version:"1.0"});
  await client.connect(new StdioClientTransport({command:process.execPath,args:["dist/index.js","--headless",...flags],stderr:"pipe"}));
  return client;
}

test("MCP Skills protocol remains available with or without --skills", {timeout:90000}, async()=>{
  for(const flags of [[],["--skills"],["--codemode"],["--codemode","--skills"]]) {
    const client=await connect(flags);
    try {
      const listed=await client.request({method:"skills/list"},z.any());
      assert.ok(listed.skills?.length);
      const names=(await client.listTools()).tools.map(x=>x.name);
      assert.equal(names.includes("searchSkills"),flags.includes("--skills")&&!flags.includes("--codemode"));
      assert.equal(names.includes("describeSkill"),flags.includes("--skills")&&!flags.includes("--codemode"));
      assert.equal(names.includes("codemode"),flags.includes("--codemode"));
    } finally {await client.close();}
  }
});

test("non-codemode Skill discovery uses full names and metadata only",{timeout:90000},async()=>{
  const client=await connect(["--skills"]);
  try {
    const result=await client.callTool({name:"searchSkills",arguments:{name:"builtin/*"}});
    const found=JSON.parse(result.content[0].text).skills;
    assert.ok(found.some(x=>x.name==="builtin/terminal-toolkit"));
    assert.deepEqual(Object.keys(found[0]).sort(),["description","name"]);
    assert.ok(found[0].description);
    const detail=await client.callTool({name:"describeSkill",arguments:{name:"builtin/terminal-toolkit"}});
    const metadata=JSON.parse(detail.content[0].text);
    assert.equal(metadata.path,"builtin://skills/terminal-toolkit/");
    assert.ok(metadata.size>0);
    assert.equal(metadata.content,undefined);
    const read=await client.callTool({name:"read",arguments:{path:metadata.path+"SKILL.md",limit:3}});
    assert.notEqual(read.isError,true);
    assert.ok(read.content[0].text.includes("---"));
  } finally {await client.close();}
});

test("codemode Skill discovery is gated by --skills",{timeout:90000},async()=>{
  for(const enabled of [false,true]) {
    const client=await connect(["--codemode",...(enabled?["--skills"]:[])]);
    try {
      const r=await client.callTool({name:"codemode",arguments:{code:'text((await search({namespace:"skills/*"})).length)'}});
      assert.equal(Number(r.content[0].text)>0,enabled);
    } finally {await client.close();}
  }
});
