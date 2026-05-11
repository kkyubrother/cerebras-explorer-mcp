import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'index.mjs',
);

const HANDSHAKE_MESSAGES = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-purity-test', version: '0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
];

function encodeNdjson(message) {
  return `${JSON.stringify(message)}\n`;
}

function encodeContentLength(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function parseNdjson(stdoutBuffer) {
  const stdout = stdoutBuffer.toString('utf8');
  const lines = stdout.split('\n').filter(line => line.trim());
  return lines.map(line => {
    const parsed = JSON.parse(line);
    assert.equal(parsed.jsonrpc, '2.0', `stdout line is not a JSON-RPC frame: ${line}`);
    return parsed;
  });
}

function parseContentLength(stdoutBuffer) {
  const messages = [];
  let offset = 0;
  const separator = Buffer.from('\r\n\r\n');
  while (offset < stdoutBuffer.length) {
    const headerEnd = stdoutBuffer.indexOf(separator, offset);
    assert.notEqual(
      headerEnd,
      -1,
      `stdout contains a non-frame prefix: ${stdoutBuffer.subarray(offset).toString('utf8')}`,
    );
    const headerText = stdoutBuffer.subarray(offset, headerEnd).toString('utf8');
    const lengthMatch = headerText.match(/^Content-Length:\s*(\d+)(?:\r\n|$)/im);
    assert.ok(lengthMatch, `stdout frame is missing Content-Length: ${headerText}`);
    const contentLength = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    assert.ok(stdoutBuffer.length >= bodyEnd, 'stdout ended inside a Content-Length body');
    const body = stdoutBuffer.subarray(bodyStart, bodyEnd).toString('utf8');
    const parsed = JSON.parse(body);
    assert.equal(parsed.jsonrpc, '2.0', `stdout body is not a JSON-RPC frame: ${body}`);
    messages.push(parsed);
    offset = bodyEnd;
  }
  return messages;
}

async function waitForResponses(chunks, parse, expectedIds) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const stdout = Buffer.concat(chunks);
    try {
      const messages = parse(stdout);
      const ids = new Set(messages.map(message => message.id).filter(id => id !== undefined));
      if (expectedIds.every(id => ids.has(id))) {
        return messages;
      }
    } catch {
      // Keep waiting while a Content-Length frame may still be incomplete.
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for JSON-RPC responses. stdout=${Buffer.concat(chunks).toString('utf8')}`);
}

async function terminateProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => proc.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 1000)),
  ]);
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL');
    await new Promise(resolve => proc.once('exit', resolve));
  }
}

async function runHandshake({ framing }) {
  const proc = spawn(process.execPath, [ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CEREBRAS_API_KEY: 'test-key-not-used',
    },
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  proc.stdout.on('data', chunk => stdoutChunks.push(chunk));
  proc.stderr.on('data', chunk => stderrChunks.push(chunk));

  try {
    const encode = framing === 'content-length' ? encodeContentLength : encodeNdjson;
    const parse = framing === 'content-length' ? parseContentLength : parseNdjson;
    for (const message of HANDSHAKE_MESSAGES) {
      proc.stdin.write(encode(message));
    }

    const messages = await waitForResponses(stdoutChunks, parse, [1, 2]);
    const stdout = Buffer.concat(stdoutChunks);
    assert.deepEqual(parse(stdout).map(message => message.id).filter(id => id !== undefined), [1, 2]);
    assert.ok(
      Buffer.concat(stderrChunks).toString('utf8').includes('stdio MCP server started'),
      'server lifecycle logs must go to stderr',
    );
    return messages;
  } finally {
    await terminateProcess(proc);
  }
}

test('stdio purity: NDJSON handshake writes only JSON-RPC frames to stdout', async () => {
  const messages = await runHandshake({ framing: 'ndjson' });
  assert.equal(messages[0].id, 1);
  assert.equal(messages[1].id, 2);
});

test('stdio purity: Content-Length handshake writes only JSON-RPC frames to stdout', async () => {
  const messages = await runHandshake({ framing: 'content-length' });
  assert.equal(messages[0].id, 1);
  assert.equal(messages[1].id, 2);
});
