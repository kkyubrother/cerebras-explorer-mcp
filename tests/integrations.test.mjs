import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

test('JSON integration examples are parseable', async () => {
  const examples = [
    'integrations/claude/.mcp.json.example',
    'integrations/claude-desktop/claude_desktop_config.json.example',
    'integrations/cursor/mcp.json.example',
    'integrations/gemini/settings.json.example',
    'integrations/opencode/opencode.json.example',
  ];

  for (const relPath of examples) {
    const raw = await read(relPath);
    assert.doesNotThrow(() => JSON.parse(raw), `${relPath} must parse as JSON`);
  }
});

test('expected response example matches compact explore_repo contract', async () => {
  const raw = await read('examples/expected-response.json');
  const example = JSON.parse(raw);

  assert.equal(example.schemaVersion, 1);
  assert.equal(typeof example.directAnswer, 'string');
  assert.ok(example.status);
  assert.ok(Array.isArray(example.targets));
  assert.ok(Array.isArray(example.evidence));
  assert.ok(example.evidenceQuality);
  assert.equal(example.failure, null);
  assert.ok(example.sessionId);
  assert.deepEqual(example.session, {
    id: example.sessionId,
    status: 'created',
    remainingCalls: 4,
  });
  assert.ok(example.searchCoverage);
  assert.ok(example.nextAction?.type);
  assert.doesNotMatch(raw, /Discovered candidate path/);
});

test('stdio example documents NDJSON and Content-Length framing modes', async () => {
  const source = await read('examples/call-server-via-stdio.mjs');

  assert.match(source, /encodeNdjsonMessage/);
  assert.match(source, /encodeContentLengthMessage/);
  assert.match(source, /--framing=content-length/);
  assert.match(source, /framing = 'ndjson'/);
});

test('direct runtime example warns that output is raw runtime, not MCP structuredContent', async () => {
  const source = await read('examples/direct-runtime.mjs');

  assert.match(source, /raw runtime result/i);
  assert.match(source, /MCP structuredContent/i);
});

test('completed superpowers implementation plans are not left as unchecked active backlog', async () => {
  const completedPlanPaths = [
    'docs/superpowers/plans/2026-05-19-agent-facing-contract-improvements.md',
    'docs/superpowers/plans/2026-05-19-top-level-session-contract.md',
    'docs/superpowers/plans/2026-05-19-failure-evidence-quality-contract.md',
  ];

  for (const relPath of completedPlanPaths) {
    await assert.rejects(
      fs.access(path.join(ROOT, relPath)),
      { code: 'ENOENT' },
      `${relPath} should not remain as active unchecked backlog`,
    );
  }
});

test('regression tests do not reference removed feedback document', async () => {
  const source = await read('tests/regression.test.mjs');

  assert.doesNotMatch(source, /feedback_1\.md/);
  assert.match(source, /prior P0\/P1 fixes/);
});

test('docs and benchmark fixtures do not advertise recentActivity as an output contract', async () => {
  const docs = [
    'README.md',
    'benchmarks/adoption.json',
  ];

  for (const relPath of docs) {
    assert.doesNotMatch(await read(relPath), /recentActivity|hot_files|has_recent_activity/);
  }
});

test('Gemini example documents required env and recommended full wrapper allowlist', async () => {
  const settings = JSON.parse(await read('integrations/gemini/settings.json.example'));
  const server = settings.mcpServers?.['cerebras-explorer'];
  assert.ok(server, 'Gemini server alias should be cerebras-explorer');
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'github:kkyubrother/cerebras-explorer-mcp#v0.2.0']);
  assert.equal(server.env?.CEREBRAS_API_KEY, '$CEREBRAS_API_KEY');
  assert.deepEqual(server.includeTools, [
    'explore_repo',
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
    'explore',
  ]);

  const readme = await read('integrations/gemini/README.md');
  assert.match(readme, /recommended full wrapper/i);
  assert.match(readme, /minimal 4-tool/i);
  assert.match(readme, /\*KEY\*/);
  assert.match(readme, /CEREBRAS_API_KEY/);
  assert.match(readme, /excludeTools/);
  assert.match(readme, /cerebras-explorer/);
  assert.match(readme, /cerebras_explorer.*피하세요/);
  assert.doesNotMatch(JSON.stringify(settings), /cerebras_explorer/);
});

test('Codex example uses npx and tool allowlist controls', async () => {
  const toml = await read('integrations/codex/config.toml.example');
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.2\.0/);
  assert.match(toml, /startup_timeout_sec = 60/);
  assert.match(toml, /tool_timeout_sec = 60/);
  assert.match(toml, /enabled_tools = \[/);
  assert.match(toml, /"explain_code_path"/);
  assert.match(toml, /"collect_evidence"/);
  assert.match(toml, /"review_change_context"/);
  assert.match(toml, /"explore"/);
  assert.match(toml, /minimal 4-tool/i);
  assert.match(toml, /disabled_tools = \["explore_v2"\]/);
  assert.match(toml, /CEREBRAS_API_KEY = "\$\{CEREBRAS_API_KEY\}"/);
  assert.doesNotMatch(toml, /absolute\/path/);

  const agents = await read('integrations/codex/AGENTS.md.example');
  assert.match(agents, /enabled_tools/);
  assert.match(agents, /disabled_tools/);
  assert.match(agents, /recommended full wrapper/i);
  assert.match(agents, /minimal 4-tool/i);
});

test('documented active install refs track package version', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const expectedRef = `v${packageJson.version}`;
  const expectedSpec = `github:kkyubrother/cerebras-explorer-mcp#${expectedRef}`;
  const concreteSpecPattern = /github:kkyubrother\/cerebras-explorer-mcp#v\d+\.\d+\.\d+\b/g;
  const oldTagAssignmentPattern = /\bOLD_TAG\s*=\s*["']?v\d+\.\d+\.\d+["']?/;
  const docs = [
    'README.md',
    'integrations/claude/.mcp.json.example',
    'integrations/claude-desktop/README.md',
    'integrations/claude-desktop/claude_desktop_config.json.example',
    'integrations/codex/config.toml.example',
    'integrations/continue/README.md',
    'integrations/continue/config.yaml.example',
    'integrations/cursor/README.md',
    'integrations/cursor/mcp.json.example',
    'integrations/gemini/README.md',
    'integrations/gemini/settings.json.example',
    'integrations/opencode/README.md',
    'integrations/opencode/opencode.json.example',
  ];

  for (const relPath of docs) {
    const source = await read(relPath);
    assert.doesNotMatch(source, /github:kkyubrother\/cerebras-explorer-mcp#main\b/, relPath);
    assert.doesNotMatch(source, oldTagAssignmentPattern, relPath);
    for (const match of source.matchAll(concreteSpecPattern)) {
      assert.equal(match[0], expectedSpec, `${relPath} install ref should use ${expectedRef}`);
    }
  }
});

test('package manifest includes README-linked support files', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const files = new Set(packageJson.files);

  for (const relPath of [
    'benchmarks/',
    'examples/',
    'fixtures/',
    'integrations/',
    'scripts/',
    'tests/',
    'CHANGELOG.md',
    'DESIGN.md',
    'TESTING.md',
  ]) {
    assert.ok(files.has(relPath), `package files should include ${relPath}`);
  }
});

test('Continue YAML example keeps the expected MCP shape', async () => {
  const yaml = await read('integrations/continue/config.yaml.example');
  assert.match(yaml, /^mcpServers:/m);
  assert.match(yaml, /name: cerebras-explorer/);
  assert.match(yaml, /command: npx/);
  assert.match(yaml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.2\.0/);
  assert.match(yaml, /CEREBRAS_API_KEY/);
});
