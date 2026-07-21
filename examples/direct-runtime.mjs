import { exploreRepository } from '../src/explorer/runtime.mjs';

// Run with Node options before the script path:
// node --env-file=.env examples/direct-runtime.mjs
//
// This direct API returns the raw runtime result, not MCP structuredContent.
// `parentHandoff` is the minimal schema-v3 parent projection. `stats` and
// `parentPayloadMeasurement` are operational diagnostics that normal MCP
// clients do not receive.
const result = await exploreRepository({
  task: 'users/me 라우트에 인증 미들웨어가 어떻게 붙는지 추적해라.',
  repo_root: './fixtures/demo-repo',
  scope: ['src/**', 'docs/**'],
  hints: {
    symbols: ['requireAuth'],
  },
});

console.log(JSON.stringify({
  parentHandoff: result.parentHandoff,
  diagnostics: {
    stats: result.stats,
    parentPayloadMeasurement: result.parentPayloadMeasurement,
  },
}, null, 2));
