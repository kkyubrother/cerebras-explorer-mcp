#!/usr/bin/env node
import { startMcpServer } from './mcp/server.mjs';
import { globalSessionStore } from './explorer/session.mjs';

function log(message) {
  process.stderr.write(`[cerebras-explorer-mcp] ${message}\n`);
}

function main() {
  const transport = startMcpServer({ logger: log });
  log('stdio MCP server started');

  // Graceful shutdown: clean up resources on termination signals
  let shuttingDown = false;

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down gracefully...`);

    // 1. Stop accepting new requests
    try { transport.stop?.(); } catch { /* ignore */ }

    // 2. Clean up sessions
    try { globalSessionStore.destroy(); } catch { /* ignore */ }

    // 3. Flush stderr and exit
    log('Shutdown complete.');

    // Failsafe: force exit after 5 seconds if cleanup hangs
    const failsafe = setTimeout(() => process.exit(1), 5000);
    if (failsafe.unref) failsafe.unref();

    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // SIGHUP not available on Windows, but safe to register
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => shutdown('SIGHUP'));
  }

  // Catch uncaught exceptions to prevent silent crashes
  process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    log(`Unhandled rejection: ${reason}`);
    // Don't shutdown — log and continue (some rejections are non-fatal)
  });
}

main();
