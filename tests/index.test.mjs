import test from 'node:test';
import assert from 'node:assert/strict';

import { createShutdownHandler } from '../src/index.mjs';

test('createShutdownHandler marks uncaught exceptions as non-zero and leaves failsafe reachable', () => {
  const logs = [];
  let stopCalls = 0;
  let destroyCalls = 0;
  let paused = 0;
  let forcedExitCode = null;
  let scheduled = null;

  const processRef = {
    exitCode: undefined,
    stdin: {
      pause() {
        paused += 1;
      },
    },
    exit(code) {
      forcedExitCode = code;
    },
  };

  const scheduleTimeout = (fn, ms) => {
    scheduled = { fn, ms, unrefCalled: false };
    return {
      unref() {
        scheduled.unrefCalled = true;
      },
    };
  };

  const shutdown = createShutdownHandler({
    transport: {
      stop() {
        stopCalls += 1;
      },
    },
    sessionStore: {
      destroy() {
        destroyCalls += 1;
      },
    },
    logger: (message) => logs.push(message),
    processRef,
    scheduleTimeout,
  });

  shutdown('uncaughtException', { exitCode: 1 });

  assert.equal(processRef.exitCode, 1, 'fatal shutdown must mark the process as failed');
  assert.equal(forcedExitCode, null, 'fatal shutdown should not force immediate exit');
  assert.equal(stopCalls, 1, 'transport.stop() should be called once');
  assert.equal(destroyCalls, 1, 'sessionStore.destroy() should be called once');
  assert.equal(paused, 1, 'stdin should be paused so the process can exit naturally');
  assert.equal(scheduled.ms, 5000, 'failsafe timer should still be armed');
  assert.equal(scheduled.unrefCalled, true, 'failsafe timer should be unrefed');
  assert.ok(logs.some(message => /uncaughtException/.test(message)), 'shutdown cause should be logged');

  scheduled.fn();
  assert.equal(forcedExitCode, 1, 'failsafe should eventually force a non-zero exit');
});
