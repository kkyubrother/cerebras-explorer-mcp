#!/usr/bin/env node
import { startMcpServer } from './mcp/server.mjs';

function log(message) {
  process.stderr.write(`[cerebras-explorer-mcp] ${message}\n`);
}

function main() {
  startMcpServer({ logger: log });
  log('stdio MCP server started');
}

main();
