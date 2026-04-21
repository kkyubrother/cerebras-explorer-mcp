#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startMcpServer } from './mcp/server.mjs';
import { globalSessionStore } from './explorer/session.mjs';

function log(message) {
  process.stderr.write(`[cerebras-explorer-mcp] ${message}\n`);
}

export function createShutdownHandler({
  transport,
  sessionStore = globalSessionStore,
  logger = log,
  processRef = process,
  scheduleTimeout = setTimeout,
} = {}) {
  let shuttingDown = false;

  return function shutdown(signal, { exitCode = 0 } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger(`Received ${signal}, shutting down gracefully...`);

    // 1. Stop accepting new requests
    try { transport?.stop?.(); } catch { /* ignore */ }

    // 2. Clean up sessions
    try { sessionStore?.destroy?.(); } catch { /* ignore */ }

    // 3. Allow the process to exit naturally; keep a failsafe for stuck handles
    logger('Shutdown complete.');
    processRef.exitCode = exitCode;

    const failsafe = scheduleTimeout(() => processRef.exit(exitCode || 1), 5000);
    if (failsafe?.unref) failsafe.unref();

    try { processRef.stdin?.pause?.(); } catch { /* ignore */ }
  };
}

export function main({
  startServer = startMcpServer,
  sessionStore = globalSessionStore,
  logger = log,
  processRef = process,
} = {}) {
  const transport = startServer({ logger });
  logger('stdio MCP server started');

  const shutdown = createShutdownHandler({
    transport,
    sessionStore,
    logger,
    processRef,
  });

  processRef.on('SIGINT', () => shutdown('SIGINT'));
  processRef.on('SIGTERM', () => shutdown('SIGTERM'));
  // SIGHUP not available on Windows, but safe to register
  if (processRef.platform !== 'win32') {
    processRef.on('SIGHUP', () => shutdown('SIGHUP'));
  }

  // Catch uncaught exceptions to prevent silent crashes
  processRef.on('uncaughtException', (error) => {
    logger(`Uncaught exception: ${error.message}`);
    shutdown('uncaughtException', { exitCode: 1 });
  });

  processRef.on('unhandledRejection', (reason) => {
    logger(`Unhandled rejection: ${reason}`);
    // Don't shutdown — log and continue (some rejections are non-fatal)
  });

  return { transport, shutdown };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main();
}
