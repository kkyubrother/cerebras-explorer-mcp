import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionStore } from '../src/explorer/session.mjs';

test('SessionStore.create returns a session ID string starting with "sess_"', () => {
  const store = new SessionStore();
  const id = store.create('/repo');
  assert.ok(typeof id === 'string');
  assert.ok(id.startsWith('sess_'));
});

test('SessionStore.get returns the session immediately after creation', () => {
  const store = new SessionStore();
  const id = store.create('/repo');
  const session = store.get(id);
  assert.ok(session !== null);
  assert.equal(session.id, id);
  assert.equal(session.calls, 0);
  assert.deepEqual(session.candidatePaths, []);
  assert.deepEqual(session.summaries, []);
});

test('SessionStore.get returns null for an unknown ID', () => {
  const store = new SessionStore();
  assert.equal(store.get('sess_nonexistent'), null);
  assert.equal(store.get(null), null);
  assert.equal(store.get(undefined), null);
});

test('SessionStore.get returns null for an expired session', () => {
  const store = new SessionStore({ ttlMs: 1 });  // 1ms TTL
  const id = store.create('/repo');
  // Wait a tick so Date.now() advances past the TTL
  return new Promise(resolve => setTimeout(() => {
    assert.equal(store.get(id), null);
    resolve();
  }, 5));
});

test('SessionStore.update increments call count', () => {
  const store = new SessionStore();
  const id = store.create('/repo');
  store.update(id, { candidatePaths: [], evidence: [], summary: 'first call', followups: [] });
  const session = store.get(id);
  assert.equal(session.calls, 1);
});

test('SessionStore.update accumulates candidatePaths without duplicates', () => {
  const store = new SessionStore();
  const id = store.create('/repo');
  store.update(id, { candidatePaths: ['src/a.js', 'src/b.js'], evidence: [], summary: '', followups: [] });
  store.update(id, { candidatePaths: ['src/b.js', 'src/c.js'], evidence: [], summary: '', followups: [] });
  const session = store.get(id);
  assert.deepEqual(session.candidatePaths, ['src/a.js', 'src/b.js', 'src/c.js']);
});

test('SessionStore.update accumulates evidencePaths from evidence array', () => {
  const store = new SessionStore();
  const id = store.create('/repo');
  store.update(id, {
    candidatePaths: [],
    evidence: [
      { path: 'src/auth.js', startLine: 1, endLine: 5, why: 'test' },
      { path: 'src/routes.js', startLine: 1, endLine: 3, why: 'test' },
    ],
    summary: 'found auth',
    followups: [],
  });
  const session = store.get(id);
  assert.ok(session.evidencePaths.includes('src/auth.js'));
  assert.ok(session.evidencePaths.includes('src/routes.js'));
});

test('SessionStore.update keeps only the last 3 summaries', () => {
  const store = new SessionStore();
  const id = store.create('/repo');
  for (let i = 1; i <= 5; i++) {
    store.update(id, { candidatePaths: [], evidence: [], summary: `summary ${i}`, followups: [] });
  }
  const session = store.get(id);
  assert.equal(session.summaries.length, 3);
  assert.equal(session.summaries[session.summaries.length - 1], 'summary 5');
});

test('SessionStore.isExhausted returns true when maxCalls is reached', () => {
  const store = new SessionStore({ maxCalls: 2 });
  const id = store.create('/repo');
  assert.equal(store.isExhausted(id), false);
  store.update(id, { candidatePaths: [], evidence: [], summary: '', followups: [] });
  assert.equal(store.isExhausted(id), false);
  store.update(id, { candidatePaths: [], evidence: [], summary: '', followups: [] });
  assert.equal(store.isExhausted(id), true);
});

test('SessionStore.isExhausted returns true for unknown ID', () => {
  const store = new SessionStore();
  assert.equal(store.isExhausted('sess_unknown'), true);
});

test('SessionStore.size counts only live sessions', () => {
  const store = new SessionStore({ ttlMs: 1 });
  store.create('/repo1');
  store.create('/repo2');
  return new Promise(resolve => setTimeout(() => {
    assert.equal(store.size, 0);
    resolve();
  }, 5));
});

test('SessionStore.prune removes expired sessions', () => {
  const store = new SessionStore({ ttlMs: 1 });
  store.create('/repo');
  return new Promise(resolve => setTimeout(() => {
    store.prune();
    assert.equal(store._sessions.size, 0);
    resolve();
  }, 5));
});
