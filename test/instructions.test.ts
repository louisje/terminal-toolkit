import test from 'node:test';
import assert from 'node:assert/strict';
import { codemodeDefinition } from '../src/tools/codemode.ts';
import { namespaceRegistryGuidance } from '../src/tools/namespaceGuidance.ts';
import { getCodemodeToolDefinitions, getMcpToolDefinitions } from '../src/tools/definitions.ts';

test('namespace instructions are independent of MCP initialize', () => {
  assert.match(namespaceRegistryGuidance['tools/pty'].instruction, /Primary Session/);
  assert.match(namespaceRegistryGuidance['tools/core'].instruction, /non-interactive/);
  assert.match(codemodeDefinition.description, /searchTools/);
});

test('standard MCP tools include namespace guidance; codemode discovery keeps summaries', () => {
  const standard = getMcpToolDefinitions();
  const codemode = getCodemodeToolDefinitions();
  assert.match(standard.find(t => t.name === 'getContent')!.description, /Primary Session/);
  assert.match(standard.find(t => t.name === 'shell')!.description, /non-interactive/);
  assert.doesNotMatch(codemode.find(t => t.name === 'getContent')!.description, /Primary Session/);
  assert.ok(codemode.find(t => t.name === 'getContent')!.instruction);
});

test('standard descriptions avoid redundant namespace text and respect extra operator flags', () => {
  const tools = getMcpToolDefinitions(true, false);
  assert.equal(tools.some(t => t.name === 'shell'), true);
  assert.equal(tools.some(t => t.name === 'grep'), false);
  const normal = getMcpToolDefinitions(true, true);
  const shell = normal.find(t => t.name === 'shell')!.description;
  assert.equal(shell.split("Prefer read/write/edit").length - 1, 0);
  assert.doesNotMatch(normal.find(t => t.name === 'notify')!.description, /Primary Session/);
  assert.doesNotMatch(normal.find(t => t.name === 'destroySession')!.description, /Before using the Primary Session/);
  assert.match(normal.find(t => t.name === 'createSession')!.description, /headless/);
});

test('flat MCP descriptions independently guide tool selection and PTY safety', () => {
  const definitions = getMcpToolDefinitions(true, false);
  const description = (name: string) => definitions.find(t => t.name === name)!.description;
  assert.match(description('shell'), /non-interactive/);
  assert.match(description('shell'), /PTY for long-running/);
  assert.match(description('type'), /persistent interactive PTY/);
  assert.match(description('type'), /autoSubmit=true/);
  assert.match(description('sendKey'), /type\(autoSubmit=true\)/);
  assert.match(description('getContent'), /visibleOnly=false/);
  assert.match(description('createSession'), /headless/);
  assert.match(description('destroySession'), /cannot be destroyed/);
  for (const name of ['type', 'sendKey', 'getContent', 'createSession'])
    assert.match(description(name), /Primary Session/);
});

test('codemode entry guides discovery and preserves standalone tool instructions', () => {
  assert.match(codemodeDefinition.description, /Before using an unfamiliar tool/);
  assert.match(codemodeDefinition.description, /describeTool\(name\)/);
  assert.match(codemodeDefinition.description, /describeNamespace\("tools\/pty"\)/);
  const tools = getCodemodeToolDefinitions();
  const type = tools.find(t => t.name === 'type')!;
  assert.match(type.description, /interactive terminal session/);
  assert.match(type.instruction!, /persistent interactive PTY/);
  assert.match(type.instruction!, /autoSubmit=true/);
  assert.match(type.inputSchema.properties.sessionId.description, /Primary Session/);
});
