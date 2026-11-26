import test from "node:test";
import assert from "node:assert/strict";
import { handleExtraOperatorTool } from "../src/tools/extra-operators.ts";
import { storeResult } from "../src/tools/resultStore.ts";
import { limitResponseForTool, limitCodemodeText } from "../src/tools/outputLimit.ts";

test("search timeout validation and pre-aborted signal", async () => {
  for (const name of ["list", "grep", "find"]) {
    for (const timeout of [-1, 91]) await assert.rejects(handleExtraOperatorTool(name, {pattern:"x", timeout}));
    await assert.rejects(handleExtraOperatorTool(name, {pattern:"x"}, AbortSignal.abort()), /aborted/);
  }
});

test("virtual grep timeout preserves matches and identifies empty partial results", async () => {
  const path = storeResult("needle\n" + "other\n".repeat(500000))!;
  const result = await handleExtraOperatorTool("grep", {path, pattern:"needle", timeout:0.02});
  assert.match(result.content[0].text, /needle/);
  assert.match(result.content[0].text, /timedOut=true incomplete=true/);
  const empty = await handleExtraOperatorTool("grep", {path, pattern:"absent", timeout:0.001});
  assert.match(empty.content[0].text, /No results collected before timeout/);
  assert.match(empty.content[0].text, /timedOut=true incomplete=true/);
});

test("virtual grep upstream abort is not a successful timeout", async () => {
  const path = storeResult("other\n".repeat(500000))!;
  const controller = new AbortController();
  const pending = handleExtraOperatorTool("grep", {path, pattern:"absent", timeout:0}, controller.signal);
  setTimeout(() => controller.abort(), 1);
  await assert.rejects(pending, /aborted/);
});

test("timeout marker survives result store and Codemode suppression", () => {
  const text = "x".repeat(20000) + "\n[search-status timedOut=true incomplete=true; search stopped before completion]";
  const result = limitResponseForTool("grep", {content:[{type:"text",text}]});
  assert.match(result.content[0].text, /result:\/\//);
  assert.match(result.content[0].text, /timedOut=true incomplete=true/);
  assert.match(limitCodemodeText(text), /timedOut=true incomplete=true/);
});
test("physical grep and find stop subprocesses on timeout and upstream abort", {skip:process.platform === "win32"}, async () => {
  const {mkdtemp, writeFile, chmod, rm, readFile} = await import("node:fs/promises");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(),"search-child-"));
  const oldPath = process.env.PATH;
  try {
    for (const binary of ["rg","fd"]) {
      const line = binary === "rg" ? JSON.stringify({type:"match",data:{path:{text:join(dir,"sample")},line_number:1,lines:{text:"needle\n"}}}) : join(dir,"sample");
      const script = join(dir,binary);
      await writeFile(script, "#!"+process.execPath+"\nrequire('node:fs').writeFileSync("+JSON.stringify(join(dir,"pid"))+",String(process.pid)); console.log("+JSON.stringify(line)+"); setInterval(()=>{},1000);\n");
      await chmod(script,0o755);
    }
    process.env.PATH = dir + ":" + oldPath;
    for (const name of ["grep","find"]) {
      const params = {path:dir,pattern:"needle",timeout:1};
      const result = await handleExtraOperatorTool(name,params);
      assert.match(result.content[0].text,/sample/);
      assert.match(result.content[0].text,/timedOut=true incomplete=true/);
      const pid = Number(await readFile(join(dir,"pid"),"utf8"));
      assert.throws(()=>process.kill(pid,0), /ESRCH/);
      const controller = new AbortController();
      const pending = handleExtraOperatorTool(name,{...params,timeout:0},controller.signal);
      const rejected = assert.rejects(pending,/aborted/);
      // Wait for the new child to publish its PID, not a fixed startup delay.
      try {
        const deadline = Date.now() + 10000;
        while (Number(await readFile(join(dir,"pid"),"utf8")) === pid) {
          assert.ok(Date.now() < deadline, "search child did not become ready");
          await new Promise(r=>setTimeout(r,20));
        }
      } finally { controller.abort(); }
      await rejected;
      const abortedPid = Number(await readFile(join(dir,"pid"),"utf8"));
      assert.notEqual(abortedPid,pid);
      assert.throws(()=>process.kill(abortedPid,0), /ESRCH/);
    }
  } finally {process.env.PATH=oldPath; await rm(dir,{recursive:true,force:true});}
});
test("physical list observes timeout and cancellation", async () => {
  const {mkdtemp, writeFile, rm} = await import("node:fs/promises");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(),"search-list-"));
  try {
    for(let i=0;i<20;i++) await Promise.all(Array.from({length:100},(_,j)=>writeFile(join(dir,String(i*100+j)),"")));
    const result = await handleExtraOperatorTool("list",{path:dir,timeout:0.001});
    assert.match(result.content[0].text,/timedOut=true incomplete=true/);
    const controller = new AbortController();
    const pending = handleExtraOperatorTool("list",{path:dir,timeout:0},controller.signal);
    setTimeout(()=>controller.abort(),1);
    await assert.rejects(pending,/aborted/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("watchdog aborts search rather than returning a partial success", async () => {
  const {withToolWatchdog} = await import("../src/tools/watchdog.ts");
  const path = storeResult("other\n".repeat(500000))!;
  await assert.rejects(withToolWatchdog("grep",signal=>handleExtraOperatorTool("grep",{path,pattern:"absent",timeout:0},signal),undefined,5),/safety deadline/);
});
