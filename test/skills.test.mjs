import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createServer } from "../src/server.ts";

async function withClient(callback) {
  const {server} = createServer({codemode: true});
  const client = new Client({name:"skills-test",version:"1.0.0"},{capabilities:{}});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const call = (client, method, params = {}) => client.request({method,params},z.any());

test("Skills extension advertises capabilities and preserves tools", async () => {
  await withClient(async (client) => {
    const caps = client.getServerCapabilities();
    assert.deepEqual(caps.extensions["io.modelcontextprotocol/skills"], {});
    assert.ok(caps.resources);
    assert.ok(caps.tools);
    assert.ok(caps.prompts);
    const list = await call(client,"skills/list");
    assert.equal(list.resultType,"complete");
    assert.equal(list.cacheScope,"public");
    assert.equal(list.skills.length,1);
    assert.equal(list.skills[0].uri,"skill://terminal-toolkit/SKILL.md");
    const entry = list.skills[0];
    assert.equal(entry.frontmatter.name,"terminal-toolkit");
    assert.equal(typeof entry.frontmatter.description,"string");
    assert.ok(entry.resources.length >= 1);
    const get = await call(client,"skills/get",{uri:entry.uri});
    assert.deepEqual(get.skill,entry);
    const resource = await call(client,"resources/read",{uri:entry.uri});
    const actual = await readFile("skills/terminal-toolkit/SKILL.md");
    assert.equal(resource.contents[0].text,actual.toString());
    assert.equal(entry.resources[0].size,actual.length);
    assert.equal(entry.resources[0].digest,"sha256:"+createHash("sha256").update(actual).digest("hex"));
    const tools = await call(client,"tools/list");
    assert.ok(tools.tools.some(t => t.name === "codemode"));
  });
});



test("stdio headless and codemode both advertise and serve skills", async () => {
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  for (const codemode of [false, true]) {
    const client = new Client({ name: "stdio-skills-test", version: "1.0.0" }, { capabilities: {} });
    const env = { ...process.env };
    delete env.TERMINAL_TOOLKIT; // Avoid the intentional nested-terminal guard.
    delete env.TERMINAL_TOOLKIT_SOCKET;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js", "--headless", ...(codemode ? ["--codemode"] : [])],
      env,
      cwd: process.cwd(),
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      assert.ok(client.getServerCapabilities().extensions["io.modelcontextprotocol/skills"]);
      assert.equal((await call(client,"skills/list")).skills[0].frontmatter.name,"terminal-toolkit");
      const tools = await call(client,"tools/list");
      assert.equal(tools.tools.some((t)=>t.name==="codemode"),codemode);
    } finally {
      await client.close();
    }
  }
});



test("socket/client MCP mode exposes the Skills extension independently of socket tools", async () => {
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const net = await import("node:net");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tmcp-skills-socket-"));
  const socketPath = path.join(dir, "server.sock");
  const socketServer = net.createServer((conn) => {
    let buffer = "";
    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0,end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        conn.write(JSON.stringify({id:request.id,result:{}}) + "\n");
      }
    });
  });
  await new Promise((resolve,reject) => socketServer.once("error",reject).listen(socketPath,resolve));
  const client = new Client({name:"socket-skills-test",version:"1.0.0"},{capabilities:{}});
  const env = {...process.env};
  delete env.TERMINAL_TOOLKIT;
  const transport = new StdioClientTransport({
    command:process.execPath,
    args:["dist/index.js","--socket",socketPath,"--codemode"],
    cwd:process.cwd(),
    env,
    stderr:"pipe",
  });
  try {
    await client.connect(transport);
    assert.ok(client.getServerCapabilities().extensions["io.modelcontextprotocol/skills"]);
    assert.equal((await call(client,"skills/list")).skills[0].uri,"skill://terminal-toolkit/SKILL.md");
    assert.equal((await call(client,"tools/list")).tools[0].name,"codemode");
  } finally {
    await client.close();
    await new Promise((resolve) => socketServer.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test("Skills extension rejects nonexistent and traversal URIs", async () => {
  await withClient(async (client) => {
    for (const uri of [
      "skill://missing/SKILL.md",
      "skill://terminal-toolkit/../../package.json",
      "skill://terminal-toolkit/%2e%2e/package.json",
      "skill://terminal-toolkit/%2fetc/passwd",
      "file:///etc/passwd",
      "skill://terminal-toolkit/SKILL.md?x=1",
    ]) {
      await assert.rejects(call(client,"resources/read",{uri}), /-32602/);
    }
    await assert.rejects(call(client,"skills/get",{uri:"skill://terminal-toolkit/../SKILL.md"}), /-32602/);
  });
});
