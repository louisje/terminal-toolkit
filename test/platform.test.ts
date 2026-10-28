import test from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";
import { getDefaultShell, getDefaultSocketPath, resolveSocketPath } from "../src/utils/platform.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

test("getDefaultSocketPath uses TERMINAL_TOOLKIT_SOCKET when set", () => {
  const previous = process.env.TERMINAL_TOOLKIT_SOCKET;
  process.env.TERMINAL_TOOLKIT_SOCKET = "/tmp/custom-terminal-toolkit.sock";

  try {
    assert.equal(getDefaultSocketPath(), "/tmp/custom-terminal-toolkit.sock");
  } finally {
    restoreEnv("TERMINAL_TOOLKIT_SOCKET", previous);
  }
});

test("getDefaultSocketPath falls back to the platform default when env is unset", () => {
  const previous = process.env.TERMINAL_TOOLKIT_SOCKET;
  delete process.env.TERMINAL_TOOLKIT_SOCKET;

  try {
    const expected = process.platform === "win32"
      ? "\\\\.\\pipe\\terminal-toolkit"
      : path.join(os.tmpdir(), "terminal-toolkit.sock");

    assert.equal(getDefaultSocketPath(), expected);
  } finally {
    restoreEnv("TERMINAL_TOOLKIT_SOCKET", previous);
  }
});

test("resolveSocketPath gives CLI value precedence over TERMINAL_TOOLKIT_SOCKET", () => {
  const previous = process.env.TERMINAL_TOOLKIT_SOCKET;
  process.env.TERMINAL_TOOLKIT_SOCKET = "/tmp/from-env.sock";

  try {
    assert.equal(resolveSocketPath("/tmp/from-cli.sock"), "/tmp/from-cli.sock");
  } finally {
    restoreEnv("TERMINAL_TOOLKIT_SOCKET", previous);
  }
});

test("getDefaultShell uses TERMINAL_TOOLKIT_SHELL before native shell env", () => {
  const previousTerminalMcpShell = process.env.TERMINAL_TOOLKIT_SHELL;
  const previousShell = process.env.SHELL;
  const previousComspec = process.env.COMSPEC;
  process.env.TERMINAL_TOOLKIT_SHELL = "/tmp/terminal-toolkit-shell";
  process.env.SHELL = "/tmp/native-shell";
  process.env.COMSPEC = "C:\\native-shell.exe";

  try {
    assert.equal(getDefaultShell(), "/tmp/terminal-toolkit-shell");
  } finally {
    restoreEnv("TERMINAL_TOOLKIT_SHELL", previousTerminalMcpShell);
    restoreEnv("SHELL", previousShell);
    restoreEnv("COMSPEC", previousComspec);
  }
});
