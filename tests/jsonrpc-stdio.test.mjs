import test from 'node:test';
import assert from 'node:assert/strict';

import { StdioJsonRpcServer } from '../src/mcp/jsonrpc-stdio.mjs';

function makeRequest(body, separator) {
  return Buffer.from(
    `Content-Length: ${Buffer.byteLength(body, 'utf8')}${separator}Content-Type: application/json${separator}${separator}${body}`,
    'utf8',
  );
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
  await server.processBuffer();

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
  await server.processBuffer();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 2);
  assert.deepEqual(sent[0].result, { echoedMethod: 'ping' });
});
