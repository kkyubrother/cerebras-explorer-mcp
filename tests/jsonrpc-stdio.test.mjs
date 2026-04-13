import test from 'node:test';
import assert from 'node:assert/strict';

import { StdioJsonRpcServer } from '../src/mcp/jsonrpc-stdio.mjs';

function makeRequest(body, separator) {
  return Buffer.from(
    `Content-Length: ${Buffer.byteLength(body, 'utf8')}${separator}Content-Type: application/json${separator}${separator}${body}`,
    'utf8',
  );
}

/**
 * Poll condition() until it returns true or timeoutMs elapses.
 * Needed because processBuffer() is now fire-and-forget: it returns before
 * dispatches complete, so tests must wait for the side-effects asynchronously.
 */
async function waitFor(condition, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('stdio parser accepts LF-only header separators', async () => {
  const sent = [];
  const server = new StdioJsonRpcServer({
    handleRequest: async message => ({ echoedMethod: message.method }),
  });

  server.send = payload => {
    sent.push(payload);
  };

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });

  server.buffer = makeRequest(body, '\n');
  // processBuffer() now returns before dispatches complete — wait for the response.
  server.processBuffer();
  await waitFor(() => sent.length >= 1);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 1);
  assert.deepEqual(sent[0].result, { echoedMethod: 'initialize' });
});

test('stdio parser still accepts CRLF header separators', async () => {
  const sent = [];
  const server = new StdioJsonRpcServer({
    handleRequest: async message => ({ echoedMethod: message.method }),
  });

  server.send = payload => {
    sent.push(payload);
  };

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping',
    params: {},
  });

  server.buffer = makeRequest(body, '\r\n');
  // processBuffer() now returns before dispatches complete — wait for the response.
  server.processBuffer();
  await waitFor(() => sent.length >= 1);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 2);
  assert.deepEqual(sent[0].result, { echoedMethod: 'ping' });
});

test('concurrent requests are processed in parallel — slow request does not block fast one', async () => {
  const sent = [];
  const startTimes = {};

  const server = new StdioJsonRpcServer({
    handleRequest: async message => {
      startTimes[message.id] = Date.now();
      if (message.id === 1) {
        // Simulate a slow tool call (e.g. a real exploration)
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      return { id: message.id };
    },
  });

  server.send = payload => {
    sent.push(payload);
  };

  const slow = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slow', params: {} });
  const fast = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'fast', params: {} });

  // Put both messages in the buffer before calling processBuffer so they are
  // parsed and dispatched in the same synchronous sweep.
  server.buffer = Buffer.concat([makeRequest(slow, '\r\n'), makeRequest(fast, '\r\n')]);

  const t0 = Date.now();
  server.processBuffer();

  // The fast response (id=2) should arrive well before the slow one finishes.
  await waitFor(() => sent.some(s => s.id === 2), 500);
  const fastElapsed = Date.now() - t0;

  // Fast request should complete long before the 80 ms slow delay.
  assert.ok(fastElapsed < 70, `Fast request took ${fastElapsed}ms — expected < 70ms`);

  // Wait for the slow response too.
  await waitFor(() => sent.length >= 2, 500);
  assert.equal(sent.length, 2);
  assert.ok(sent.some(s => s.id === 1));
  assert.ok(sent.some(s => s.id === 2));
});
