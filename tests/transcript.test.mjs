import test from 'node:test';
import assert from 'node:assert/strict';

import { createCompactToolTrace } from '../src/explorer/transcript.mjs';

test('compact tool trace stores bounded tool summaries without raw content', () => {
  const trace = createCompactToolTrace({ maxEntries: 2 });

  trace.record({
    turn: 1,
    tool: 'repo_read_file',
    args: { path: 'src/auth.js', startLine: 1, endLine: 40 },
    result: {
      path: 'src/auth.js',
      startLine: 1,
      endLine: 40,
      totalLines: 100,
      truncated: false,
      content: 'secret raw file content must not be retained',
    },
  });
  trace.record({
    turn: 2,
    tool: 'repo_grep',
    args: { pattern: 'requireAuth', scope: ['src/**'], maxResults: 20 },
    result: {
      matches: [
        { path: 'src/auth.js', line: 1, text: 'export function requireAuth() {}' },
        { path: 'src/routes/user.js', line: 4, text: 'app.get("/me", requireAuth)' },
      ],
      truncated: false,
    },
  });
  trace.record({
    turn: 3,
    tool: 'repo_symbols',
    args: { path: 'src/auth.js', kind: 'all' },
    result: {
      path: 'src/auth.js',
      symbols: [{ name: 'requireAuth' }],
    },
  });

  const result = trace.toJSON();
  assert.equal(result.totalCalls, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries[0].args, { path: 'src/auth.js', startLine: 1, endLine: 40 });
  assert.deepEqual(result.entries[0].result, {
    path: 'src/auth.js',
    startLine: 1,
    endLine: 40,
    totalLines: 100,
    truncated: false,
  });
  assert.equal(result.entries[1].result.matches, 2);
  assert.deepEqual(result.entries[1].result.paths, ['src/auth.js', 'src/routes/user.js']);
  assert.equal(JSON.stringify(result).includes('secret raw file content'), false);
  assert.equal(JSON.stringify(result).includes('export function requireAuth'), false);
});

test('compact tool trace records short error summaries', () => {
  const trace = createCompactToolTrace();
  trace.record({
    turn: 1,
    tool: 'repo_read_file',
    args: { path: 'src/missing.js' },
    result: {
      error: true,
      type: 'tool_execution_error',
      stage: 'parse_or_exec',
      message: 'Unable to access path src/missing.js',
    },
  });

  const result = trace.toJSON();
  assert.equal(result.entries[0].result.error, true);
  assert.equal(result.entries[0].result.type, 'tool_execution_error');
  assert.match(result.entries[0].result.message, /missing/);
});

test('compact tool trace bounds nested argument depth', () => {
  const trace = createCompactToolTrace();
  let nested = 'leaf';
  for (let i = 0; i < 10000; i += 1) {
    nested = { child: nested };
  }

  assert.doesNotThrow(() => {
    trace.record({
      turn: 1,
      tool: 'repo_list_dir',
      args: { dirPath: '.', scope: nested },
      result: { entries: [] },
    });
  });

  const result = trace.toJSON();
  assert.equal(result.totalCalls, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(JSON.stringify(result.entries[0].args).includes('[MaxDepth]'), true);
});
