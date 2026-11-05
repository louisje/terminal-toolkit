import test from 'node:test';
import assert from 'node:assert/strict';
import { getServerInstructions } from '../src/server.ts';

test('codemode outer guidance and shared terminal instructions are separately exposed', () => {
  const value = getServerInstructions({ codemode: true, piOperators: true });
  assert.match(value, /describeNamespace\("tools\/pty"\)/);
  assert.match(value, /searchTools\(\)/);
  assert.doesNotMatch(value, /ALL_TOOLS/);
  assert.match(value, /Promise\.allSettled/);
  assert.doesNotMatch(value, /Pi operators are enabled/);
  assert.match(getServerInstructions({piOperators:true}), /stateless/);
  assert.doesNotMatch(getServerInstructions(), /QuickJS/);
  assert.doesNotMatch(getServerInstructions({ codemode: true }), /Pi operators are enabled/);
});
