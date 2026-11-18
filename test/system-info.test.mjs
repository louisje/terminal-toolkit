import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { TerminalManager } from '../src/terminal/index.ts';
import { getSystemInfo, handleSystemInfo } from '../src/tools/systemInfo.ts';
import { getToolNamespace, getCodemodeToolDefinitions, getMcpToolDefinitions } from '../src/tools/definitions.ts';

test('systemInfo is a read-only misc tool available in both discovery modes', () => {
  assert.equal(getToolNamespace('systemInfo'), 'tools/misc');
  for (const definitions of [getCodemodeToolDefinitions(), getMcpToolDefinitions()]) {
    const tool = definitions.find(tool => tool.name === 'systemInfo');
    assert.ok(tool);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.deepEqual(tool.inputSchema.properties, {});
  }
});

test('systemInfo reports host and uninitialized Primary Session without spawning PTY', () => {
  const manager = new TerminalManager();
  try {
    const result = getSystemInfo(manager);
    assert.equal(result.system.platform, process.platform);
    assert.equal(result.runtime.node, process.version);
    assert.equal(result.primarySession.mode, 'uninitialized');
    assert.equal(result.primarySession.connected, false);
    assert.equal(result.primarySession.lastInputAt, null);
    assert.equal(result.primarySession.lastOutputAt, null);
    assert.equal(manager.hasActiveSession(), false);
    assert.deepEqual(JSON.parse(handleSystemInfo(manager, {}).content[0].text), result);
  } finally { manager.dispose(); }
});
