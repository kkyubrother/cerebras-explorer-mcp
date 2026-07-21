import test from 'node:test';
import assert from 'node:assert/strict';

import { StdioJsonRpcServer } from '../src/mcp/jsonrpc-stdio.mjs';
import { createMcpRequestHandler } from '../src/mcp/server.mjs';

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

test('F5 — a malformed Content-Length frame does not wedge subsequent valid frames', async () => {
  const sent = [];
  const server = new StdioJsonRpcServer({
    handleRequest: async message => ({ echoedMethod: message.method }),
  });
  server.send = payload => { sent.push(payload); };

  const malformed = Buffer.from('Content-Length: notanumber\r\n\r\n', 'utf8');
  const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping', params: {} });
  const valid = makeRequest(body, '\r\n');

  server.buffer = Buffer.concat([malformed, valid]);
  server.processBuffer();
  await waitFor(() => sent.length >= 1);

  // The valid request after the bad frame must still be processed (buffer resynced).
  assert.ok(sent.some(p => p.id === 7 && p.result?.echoedMethod === 'ping'),
    'valid framed request after a malformed Content-Length must still be answered');
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

// T033 changes this to `test` after request-id-zero controller tracking lands.
const requestIdCancellationTest = test;

class AbortProbeChatClient {
  constructor() {
    this.model = 'mock';
    this.signal = null;
    this.abortCount = 0;
  }

  createChatCompletion({ signal }) {
    this.signal = signal;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const abort = () => {
        this.abortCount += 1;
        const error = new Error('cancelled by JSON-RPC notification');
        error.name = 'AbortError';
        finish(error);
      };
      const timer = setTimeout(() =>
        finish(new Error('cancellation notification was not delivered')), 2_000);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }
}

requestIdCancellationTest(
  'Spec 028 T027 — JSON-RPC id 0 is tracked, cancelled, and cleaned up like a nonzero id',
  async () => {
    const outcomes = [];

    for (const requestId of [7, 0]) {
      const sent = [];
      const logs = [];
      const client = new AbortProbeChatClient();
      const handler = createMcpRequestHandler({
        logger: line => logs.push(line),
        runtimeOptions: { chatClient: client },
      });
      const server = new StdioJsonRpcServer(handler);
      server.send = payload => { sent.push(payload); };

      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: 'explore_repo',
          arguments: {
            task: 'Wait at planning until this request is cancelled.',
            repo_root: process.cwd(),
            scope: ['src/mcp/server.mjs'],
          },
        },
      });
      server.buffer = makeRequest(request, '\r\n');
      server.processBuffer();
      await waitFor(() => client.signal !== null);

      const cancelled = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId },
      });
      server.buffer = makeRequest(cancelled, '\r\n');
      server.processBuffer();
      await waitFor(() => sent.some(item => item.id === requestId), 3_000);

      server.buffer = makeRequest(cancelled, '\r\n');
      server.processBuffer();
      await new Promise(resolve => setImmediate(resolve));

      const response = sent.find(item => item.id === requestId);
      const cancellationLogs = logs.filter(line =>
        line.includes('Cancelled exploration for request')).length;
      const outcome = {
        abortCount: client.abortCount,
        signalAborted: client.signal.aborted,
        cancellationLogs,
        failureReason: response.result?.structuredContent?.failure?.reason,
        responseKind: response.error ? 'error' : 'result',
      };
      outcomes.push(outcome);

      assert.equal(response.id, requestId);
      assert.equal(client.abortCount, 1);
      assert.equal(client.signal.aborted, true);
      assert.equal(cancellationLogs, 1,
        'a duplicate notification must not find a cleaned-up controller');
      assert.equal(outcome.failureReason, 'aborted');
      assert.equal(sent.length, 1, 'notifications must not receive JSON-RPC responses');
    }

    assert.deepEqual(outcomes[1], outcomes[0]);
  },
);
