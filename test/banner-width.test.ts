import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { getBanner } from "../src/ui/index.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

for (const [columns, expected] of [[120, 79], [79, 79], [78, 69], [69, 69]] as const) {
  test(`banner fits ${columns}-column terminal with ${expected}-column frame`, () => {
    const lines = getBanner({
      socketPath: "/tmp/terminal-toolkit.sock",
      cols: columns,
      rows: 24,
      shell: "bash",
      sandboxEnabled: true,
    }).split("\n").map(stripAnsi);
    assert.ok(lines.some((line) => line.startsWith("╭") && stringWidth(line) === expected));
    for (const line of lines) {
      assert.ok(stringWidth(line) <= columns, `Line exceeds ${columns} columns: ${line}`);
    }
  });
}

test("banner remains unframed below 69 columns", () => {
  const banner = stripAnsi(getBanner({
    socketPath: "/tmp/terminal-toolkit.sock",
    cols: 60,
    rows: 24,
    shell: "bash",
  }));
  assert.match(banner, /Terminal Toolkit/);
  assert.doesNotMatch(banner, /╭/);
});
