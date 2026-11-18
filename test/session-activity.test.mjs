import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { TerminalManager } from '../src/terminal/index.ts';

const waitFor = async (predicate, timeout = 3000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for PTY activity');
};

const assertTimestamp = value => {
  assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
};

test('PTY activity timestamps distinguish input and output for primary and additional sessions', { timeout: 15000 }, async () => {
  const manager = new TerminalManager({ sessionIdleTimeout: 600 });
  try {
    const initial = manager.listSessions().sessions[0];
    assert.equal(initial.mode, 'uninitialized');
    assert.equal(initial.lastInputAt, null);
    assert.equal(initial.lastOutputAt, null);
    assert.equal('lastActivityAt' in initial, false);

    await manager.getSessionAsync();
    const primaryId = manager.listSessions().sessions.find(s => s.isDefault).sessionId;
    const primaryBefore = manager.listSessions().sessions.find(s => s.sessionId === primaryId);
    assert.equal(primaryBefore.lastInputAt, null);
    manager.write('echo primary-activity-check\n');
    await waitFor(() => manager.listSessions().sessions.find(s => s.sessionId === primaryId)?.lastOutputAt);
    const primary = manager.listSessions().sessions.find(s => s.sessionId === primaryId);
    assertTimestamp(primary.lastOutputAt);
    assertTimestamp(primary.lastInputAt);

    const extra = await manager.createSession();
    const before = manager.listSessions().sessions.find(s => s.sessionId === extra.sessionId);
    assert.equal(before.lastInputAt, null);
    assert.equal('lastActivityAt' in before, false);

    manager.write('echo session-activity-check\n', extra.sessionId);
    await waitFor(() => manager.listSessions().sessions.find(s => s.sessionId === extra.sessionId)?.lastInputAt);
    await waitFor(() => manager.listSessions().sessions.find(s => s.sessionId === extra.sessionId)?.lastOutputAt);
    const after = manager.listSessions().sessions.find(s => s.sessionId === extra.sessionId);
    assertTimestamp(after.lastInputAt);
    assertTimestamp(after.lastOutputAt);
    assert.equal(manager.listSessions().sessions.find(s => s.sessionId === primaryId).lastInputAt, primary.lastInputAt);

    manager.getContent(extra.sessionId);
    assert.equal(manager.listSessions().sessions.find(s => s.sessionId === extra.sessionId).lastInputAt, after.lastInputAt);
  } finally {
    manager.dispose();
  }
});
