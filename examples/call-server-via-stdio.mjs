import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function encodeMessage(payload) {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\nContent-Type: application/json\r\n\r\n${json}`;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn(process.execPath, ['src/index.mjs'], {
  cwd: repoRoot,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
});

child.stdin.write(
  encodeMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo', version: '0.0.1' } },
  }),
);

child.stdin.write(
  encodeMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'find_relevant_code',
      arguments: {
        query: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
        repo_root: './fixtures/demo-repo',
        scope: ['src/**', 'docs/**']
      }
    }
  }),
);
