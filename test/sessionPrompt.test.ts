import test from "node:test";
import assert from "node:assert/strict";
import { TerminalSession } from "../src/terminal/session.ts";

test("TerminalSession configures cmd.exe prompt with spacing and ANSI highlight", () => {
  const session = Object.create(TerminalSession.prototype) as TerminalSession & {
    setupShellPrompt: (
      shellName: string,
      extraEnv?: Record<string, string>,
      startupBanner?: string,
      login?: boolean,
    ) => { args: string[]; env: Record<string, string> };
  };

  const { args, env } = session.setupShellPrompt("cmd.exe");

  assert.deepEqual(args, []);
  assert.equal(env.TERMINAL_TOOLKIT, "1");
  assert.equal(env.PROMPT, "$E[30;43m ⚡ mcp $E[0m $P$G ");
});


test("TerminalSession exports the Bash rcfile path for reload", () => {
  const session = Object.create(TerminalSession.prototype) as TerminalSession & {
    setupShellPrompt: (shellName: string) => { args: string[]; env: Record<string, string> };
  };

  const { args, env } = session.setupShellPrompt("bash");
  assert.equal(env.TERMINAL_TOOLKIT, "1");
  assert.equal(env.TERMINAL_TOOLKIT_RCFILE, args[1]);
  assert.equal(args[0], "--rcfile");
});
