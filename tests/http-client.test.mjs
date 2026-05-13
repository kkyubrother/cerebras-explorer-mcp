import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchWithTimeoutAndRetry,
  extractMessageText,
  DEFAULT_RETRYABLE_STATUSES,
  RETRYABLE_NETWORK_ERRORS,
  DEFAULT_HTTP_TIMEOUT_MS,
} from '../src/explorer/utils/http-client.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeOkFetch(body = {}) {
  return async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });
}

function makeErrorFetch(status, message = 'error') {
  return async () => ({
    ok: false,
    status,
    statusText: String(status),
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { message } }),
  });
}

// ── DEFAULT_RETRYABLE_STATUSES ────────────────────────────────────────────────

test('DEFAULT_RETRYABLE_STATUSES includes 408, 429, 500, 502, 503, 504', () => {
  for (const code of [408, 429, 500, 502, 503, 504]) {
    assert.ok(DEFAULT_RETRYABLE_STATUSES.has(code), `expected ${code} to be retryable`);
  }
});

test('DEFAULT_RETRYABLE_STATUSES does not include 400, 401, 403, 404', () => {
  for (const code of [400, 401, 403, 404]) {
    assert.ok(!DEFAULT_RETRYABLE_STATUSES.has(code), `expected ${code} NOT to be retryable`);
  }
});

// ── fetchWithTimeoutAndRetry — success ────────────────────────────────────────

test('fetchWithTimeoutAndRetry: returns parsed JSON on success', async () => {
  const result = await fetchWithTimeoutAndRetry(makeOkFetch({ hello: 'world' }), 'http://x', {});
  assert.deepEqual(result, { hello: 'world' });
});

test('fetchWithTimeoutAndRetry: returns {} when response body is empty', async () => {
  const emptyFetch = async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => null },
    text: async () => '',
  });
  const result = await fetchWithTimeoutAndRetry(emptyFetch, 'http://x', {});
  assert.deepEqual(result, {});
});

// ── non-retryable errors ──────────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: throws immediately on 400', async () => {
  let callCount = 0;
  const fetch400 = async () => {
    callCount += 1;
    return { ok: false, status: 400, statusText: 'Bad Request', headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'bad input' } }) };
  };
  await assert.rejects(() => fetchWithTimeoutAndRetry(fetch400, 'http://x', {}, { errorPrefix: 'Test' }), /bad input/);
  assert.equal(callCount, 1, '400 must not be retried');
});

test('fetchWithTimeoutAndRetry: throws immediately on 401', async () => {
  let callCount = 0;
  const fetch401 = async () => {
    callCount += 1;
    return { ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => null }, text: async () => '{}' };
  };
  await assert.rejects(() => fetchWithTimeoutAndRetry(fetch401, 'http://x', {}));
  assert.equal(callCount, 1, '401 must not be retried');
});

// ── retryable HTTP status codes ───────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: retries on 429 and succeeds on second attempt', async () => {
  let callCount = 0;
  const retryFetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'rate limited' } }) };
    }
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }) };
  };
  const result = await fetchWithTimeoutAndRetry(retryFetch, 'http://x', {}, { maxRetries: 2 });
  assert.deepEqual(result, { ok: true });
  assert.equal(callCount, 2);
});

test('fetchWithTimeoutAndRetry: retries on 500 up to maxRetries then throws', async () => {
  let callCount = 0;
  const alwaysFail = async () => {
    callCount += 1;
    return { ok: false, status: 500, statusText: 'Internal Server Error', headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'server error' } }) };
  };
  await assert.rejects(() => fetchWithTimeoutAndRetry(alwaysFail, 'http://x', {}, { maxRetries: 2 }), /server error/);
  assert.equal(callCount, 3, 'should have tried 1 + 2 retries = 3 total');
});

// ── custom retryableStatuses ──────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: custom retryableStatuses excludes 408', async () => {
  let callCount = 0;
  const fetch408 = async () => {
    callCount += 1;
    return { ok: false, status: 408, statusText: 'Request Timeout', headers: { get: () => null }, text: async () => '{}' };
  };
  const customStatuses = new Set([429, 500, 502, 503, 504]); // 408 excluded
  await assert.rejects(() => fetchWithTimeoutAndRetry(fetch408, 'http://x', {}, { retryableStatuses: customStatuses, maxRetries: 2 }));
  assert.equal(callCount, 1, '408 should not be retried with custom statuses');
});

// ── Retry-After header ────────────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: succeeds after retry regardless of delay strategy', async () => {
  // We can't easily verify the exact delay without mocking setTimeout,
  // but we can verify that Retry-After doesn't prevent eventual success.
  let callCount = 0;
  const retryAfterFetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false, status: 429, statusText: 'Too Many Requests',
        headers: { get: (h) => h === 'retry-after' ? '0' : null },
        text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
      };
    }
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => '{}' };
  };
  const result = await fetchWithTimeoutAndRetry(retryAfterFetch, 'http://x', {}, { maxRetries: 2 });
  assert.deepEqual(result, {});
  assert.equal(callCount, 2);
});

// ── timeout ───────────────────────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: throws timed out error on hanging fetch', async () => {
  const prev = process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS;
  process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS = '50';

  const hangingFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

  try {
    await assert.rejects(
      () => fetchWithTimeoutAndRetry(hangingFetch, 'http://x', {}, { maxRetries: 0, errorPrefix: 'Test' }),
      /timed out/,
    );
  } finally {
    if (prev === undefined) delete process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS;
    else process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS = prev;
  }
});

test('fetchWithTimeoutAndRetry: timed out error includes attempt count', async () => {
  const prev = process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS;
  process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS = '50';

  const hangingFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

  try {
    await assert.rejects(
      () => fetchWithTimeoutAndRetry(hangingFetch, 'http://x', {}, { maxRetries: 0 }),
      /1 attempt/,
    );
  } finally {
    if (prev === undefined) delete process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS;
    else process.env.CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS = prev;
  }
});

test('fetchWithTimeoutAndRetry: hard timeout covers stalled response body', async () => {
  const stalledBodyFetch = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => {
      signal.addEventListener('abort', () => {}, { once: true });
      return new Promise(() => {});
    },
  });

  await assert.rejects(
    () => fetchWithTimeoutAndRetry(stalledBodyFetch, 'http://x', {}, { maxRetries: 0, timeoutMs: 20, errorPrefix: 'Test' }),
    /Test timed out after 20ms/,
  );
});

// ── externalSignal ────────────────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: throws AbortError immediately if signal already aborted', async () => {
  const controller = new AbortController();
  controller.abort();

  let callCount = 0;
  const neverCalledFetch = async () => { callCount += 1; return makeOkFetch()(); };

  await assert.rejects(
    () => fetchWithTimeoutAndRetry(neverCalledFetch, 'http://x', {}, { externalSignal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(callCount, 0, 'fetch should not be called when signal is already aborted');
});

test('fetchWithTimeoutAndRetry: propagates external abort as AbortError', async () => {
  const controller = new AbortController();

  const hangingFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    // abort the external controller after a short delay
    setTimeout(() => controller.abort(), 10);
  });

  await assert.rejects(
    () => fetchWithTimeoutAndRetry(hangingFetch, 'http://x', {}, { externalSignal: controller.signal, maxRetries: 0 }),
    { name: 'AbortError' },
  );
});

// ── retryNetworkErrors ────────────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: retries ECONNRESET network error by default', async () => {
  let callCount = 0;
  const econnreset = async () => {
    callCount += 1;
    if (callCount === 1) {
      const err = new Error('socket hang up');
      err.code = 'ECONNRESET';
      throw err;
    }
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => '{}' };
  };
  const result = await fetchWithTimeoutAndRetry(econnreset, 'http://x', {}, { maxRetries: 2 });
  assert.deepEqual(result, {});
  assert.equal(callCount, 2);
});

test('fetchWithTimeoutAndRetry: does not retry network errors when retryNetworkErrors=false', async () => {
  let callCount = 0;
  const econnreset = async () => {
    callCount += 1;
    const err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    throw err;
  };
  await assert.rejects(
    () => fetchWithTimeoutAndRetry(econnreset, 'http://x', {}, { maxRetries: 2, retryNetworkErrors: false }),
    /socket hang up/,
  );
  assert.equal(callCount, 1, 'should not retry with retryNetworkErrors=false');
});

// ── JSON parse failure ────────────────────────────────────────────────────────

test('fetchWithTimeoutAndRetry: throws on invalid JSON response body', async () => {
  const badJsonFetch = async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => null },
    text: async () => 'not-json{{{',
  });
  await assert.rejects(
    () => fetchWithTimeoutAndRetry(badJsonFetch, 'http://x', {}, { errorPrefix: 'Test' }),
    /Failed to parse Test response/,
  );
});

// ── DEFAULT_HTTP_TIMEOUT_MS ───────────────────────────────────────────────────

test('DEFAULT_HTTP_TIMEOUT_MS is 60000', () => {
  assert.equal(DEFAULT_HTTP_TIMEOUT_MS, 60000);
});

// ── extractMessageText ────────────────────────────────────────────────────────

test('extractMessageText: returns string content as-is', () => {
  assert.equal(extractMessageText('hello world'), 'hello world');
});

test('extractMessageText: returns empty string for null/undefined', () => {
  assert.equal(extractMessageText(null), '');
  assert.equal(extractMessageText(undefined), '');
});

test('extractMessageText: returns empty string for non-string/non-array input', () => {
  assert.equal(extractMessageText(42), '');
  assert.equal(extractMessageText({ type: 'text', text: 'hi' }), '');
});

test('extractMessageText: joins text parts from ContentPart array', () => {
  const parts = [
    { type: 'text', text: 'hello ' },
    { type: 'text', text: 'world' },
  ];
  assert.equal(extractMessageText(parts), 'hello world');
});

test('extractMessageText: ignores non-text ContentPart types', () => {
  const parts = [
    { type: 'text', text: 'answer: ' },
    { type: 'image_url', url: 'http://example.com/img.png' },
    { type: 'text', text: '42' },
  ];
  assert.equal(extractMessageText(parts), 'answer: 42');
});

test('extractMessageText: ignores null/non-object items in array', () => {
  const parts = [null, undefined, 'bare-string', { type: 'text', text: 'ok' }];
  assert.equal(extractMessageText(parts), 'ok');
});

test('extractMessageText: returns empty string for empty array', () => {
  assert.equal(extractMessageText([]), '');
});

// ── RETRYABLE_NETWORK_ERRORS ──────────────────────────────────────────────────

test('RETRYABLE_NETWORK_ERRORS includes common transient error codes', () => {
  for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']) {
    assert.ok(RETRYABLE_NETWORK_ERRORS.has(code), `expected ${code} to be in RETRYABLE_NETWORK_ERRORS`);
  }
});
