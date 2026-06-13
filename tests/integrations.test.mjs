import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

async function listTextFiles(relDir) {
  const output = [];
  async function walk(currentRelDir) {
    const entries = await fs.readdir(path.join(ROOT, currentRelDir), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.join(currentRelDir, entry.name);
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (/\.(md|json|toml|yaml|yml|example)$/.test(entry.name)) {
        output.push(relPath);
      }
    }
  }
  await walk(relDir);
  return output;
}

function extractFirstTomlStringArray(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)^\\s*\\]`, 'm'));
  assert.ok(match, `${key} array should exist`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]);
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

  assert.equal(example.schemaVersion, 2);
  assert.equal(typeof example.directAnswer, 'string');
  assert.ok(example.status);
  assert.ok(Array.isArray(example.targets));
  assert.ok(Array.isArray(example.evidence));
  assert.ok(example.evidenceQuality);
  assert.equal(example.failure, null);
  assert.ok(example.critic);
  assert.ok(Array.isArray(example.critic.warnings));
  // spec 017: sessionId/session/_debug are no longer part of the contract.
  assert.equal(example.sessionId, undefined);
  assert.equal(example.session, undefined);
  assert.equal(example._debug, undefined);
  assert.ok(example.searchCoverage);
  assert.equal(typeof example.searchCoverage.omittedDiscoveredPaths, 'number');
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

test('user-facing docs advertise LOG_PATH instead of legacy transcript envvars', async () => {
  const docs = [
    'README.md',
    'DESIGN.md',
    ...(await listTextFiles('integrations')),
  ];

  for (const relPath of docs) {
    assert.doesNotMatch(
      await read(relPath),
      /CEREBRAS_EXPLORER_TRANSCRIPT/,
      `${relPath} should not advertise legacy transcript envvars`,
    );
  }

  const changelogLines = (await read('CHANGELOG.md'))
    .split(/\r?\n/)
    .filter(line => /CEREBRAS_EXPLORER_TRANSCRIPT/.test(line));
  assert.equal(changelogLines.length, 3, 'CHANGELOG should mention the legacy transcript envvars only in the v0.6.1 deprecation notice and the v0.7.0 removal record');
});

test('CI workflows do not receive provider API keys', async () => {
  const workflows = await listTextFiles('.github/workflows');

  for (const relPath of workflows) {
    assert.doesNotMatch(
      await read(relPath),
      /CEREBRAS_API_KEY/,
      `${relPath} must not expose provider API keys to GitHub Actions jobs`,
    );
  }
});

test('Gemini example documents required env and recommended full wrapper allowlist', async () => {
  const settings = JSON.parse(await read('integrations/gemini/settings.json.example'));
  const server = settings.mcpServers?.['cerebras-explorer'];
  assert.ok(server, 'Gemini server alias should be cerebras-explorer');
  assert.equal(server.command, 'npx');
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
  assert.deepEqual(server.args, ['-y', 'github:kkyubrother/cerebras-explorer-mcp#v0.8.7']);

  const readme = await read('integrations/gemini/README.md');
  assert.match(readme, /recommended full wrapper/i);
  assert.match(readme, /\*KEY\*/);
  assert.match(readme, /CEREBRAS_API_KEY/);
  assert.match(readme, /excludeTools/);
  assert.match(readme, /cerebras-explorer/);
  assert.match(readme, /cerebras_explorer.*피하세요/);
  assert.doesNotMatch(JSON.stringify(settings), /cerebras_explorer/);
});

test('Codex example uses npx, trusted auto-approval, and tool allowlist controls', async () => {
  const toml = await read('integrations/codex/config.toml.example');
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /startup_timeout_sec = 60/);
  assert.match(toml, /tool_timeout_sec = 180/);
  assert.match(toml, /default_tools_approval_mode = "approve"/);
  assert.doesNotMatch(toml, /^required\s*=/m);
  assert.match(toml, /trusted local coding sessions/);
  assert.match(toml, /external model provider/);
  assert.deepEqual(extractFirstTomlStringArray(toml, 'enabled_tools'), [
    'explore_repo',
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
    'explore',
  ]);
  assert.match(toml, /github:kkyubrother\/cerebras-explorer-mcp#v0.8.7/);
  assert.match(toml, /minimal 4-tool/i);
  // spec 011: explore_v2 tool name is gone; the disabled_tools example just
  // demonstrates the syntax with any retained tool name.
  assert.match(toml, /disabled_tools = \["/);
  assert.match(toml, /CEREBRAS_API_KEY = "\$\{CEREBRAS_API_KEY\}"/);
  assert.doesNotMatch(toml, /absolute\/path/);

  const agents = await read('integrations/codex/AGENTS.md.example');
  assert.match(agents, /enabled_tools/);
  assert.match(agents, /disabled_tools/);
  assert.match(agents, /recommended full wrapper/i);
  assert.match(agents, /minimal 4-tool/i);
  assert.match(agents, /trusted\s+local coding sessions/);

  const readme = await read('README.md');
  assert.match(readme, /default_tools_approval_mode = "approve"/);
  assert.match(readme, /trusted local coding sessions/);
  assert.match(readme, /external model provider/);
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

test('CHANGELOG records the version declared in package.json', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const changelog = await read('CHANGELOG.md');
  const escapedVersion = packageJson.version.replace(/\./g, '\\.');

  const versionHeading = new RegExp(`^##\\s+v${escapedVersion}\\b`, 'm');
  assert.match(
    changelog,
    versionHeading,
    `CHANGELOG.md should contain a heading for v${packageJson.version}`,
  );

  const unreleasedForCurrent = new RegExp(
    `^##\\s+v${escapedVersion}\\s*-\\s*Unreleased\\b`,
    'mi',
  );
  assert.doesNotMatch(
    changelog,
    unreleasedForCurrent,
    `CHANGELOG.md heading for v${packageJson.version} should not say "Unreleased" once that version is declared in package.json`,
  );
});

test('Continue YAML example keeps the expected MCP shape', async () => {
  const yaml = await read('integrations/continue/config.yaml.example');
  assert.match(yaml, /^mcpServers:/m);
  assert.match(yaml, /name: cerebras-explorer/);
  assert.match(yaml, /command: npx/);
  assert.match(yaml, /github:kkyubrother\/cerebras-explorer-mcp#v0.8.7/);
  assert.match(yaml, /CEREBRAS_API_KEY/);
});

const LLM_PROSE_FILES = [
  'integrations/claude/.claude/agents/cerebras-explorer.md',
  'integrations/claude/.claude/skills/cerebras-explore/SKILL.md',
  'integrations/codex/.agents/skills/cerebras-explore/SKILL.md',
  'integrations/codex/.codex/agents/cerebras_explorer.toml',
  'integrations/codex/AGENTS.md.example',
];

const REMOVED_PUBLIC_TOOL_NAME_PATTERN = new RegExp(
  `\\b(${['map', 'impact'].join('_')}|${['find', 'entrypoints'].join('_')})\\b`,
);

test('Gemini client timeout matches Codex tool_timeout_sec budget', async () => {
  const gemini = JSON.parse(await read('integrations/gemini/settings.json.example'));
  const codex = await read('integrations/codex/config.toml.example');
  const codexMatch = codex.match(/tool_timeout_sec\s*=\s*(\d+)/);
  assert.ok(codexMatch, 'Codex tool_timeout_sec must be set');
  const codexSeconds = Number(codexMatch[1]);
  const geminiMs = gemini.mcpServers['cerebras-explorer'].timeout;
  assert.equal(
    geminiMs,
    codexSeconds * 1000,
    `Gemini timeout(${geminiMs}ms) should match Codex tool_timeout_sec(${codexSeconds}s)`,
  );
});

test('LLM prose files mention current compact contract fields', async () => {
  for (const relPath of LLM_PROSE_FILES) {
    const text = await read(relPath);
    assert.match(
      text,
      /failure|evidenceQuality|searchCoverage|critic\.warnings/,
      `${relPath} should mention at least one of failure/evidenceQuality/searchCoverage/critic.warnings`,
    );
  }
});

test('Codex agent role TOML lists every public wrapper tool', async () => {
  const toml = await read('integrations/codex/.codex/agents/cerebras_explorer.toml');
  const expected = [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'review_change_context',
    'explore_repo',
    'explore',
  ];
  for (const name of expected) {
    assert.match(toml, new RegExp(`\\b${name}\\b`), `${name} should appear in Codex agent role TOML`);
  }
  assert.doesNotMatch(
    toml,
    REMOVED_PUBLIC_TOOL_NAME_PATTERN,
    'Codex agent role TOML should not mention removed public tool names',
  );
});

test('LLM prose files do not advertise removed public tool names', async () => {
  for (const relPath of LLM_PROSE_FILES) {
    assert.doesNotMatch(await read(relPath), REMOVED_PUBLIC_TOOL_NAME_PATTERN, relPath);
  }
});

test('LLM prose files do not use stale "Discovered candidate path" phrasing', async () => {
  for (const relPath of LLM_PROSE_FILES) {
    assert.doesNotMatch(await read(relPath), /Discovered candidate path/, relPath);
  }
});

test('LLM prose files do not advertise removed top-level fields', async () => {
  const banned = /\b(candidatePaths|recentActivity|hot_files|has_recent_activity|confidenceLevel)\b/;
  for (const relPath of LLM_PROSE_FILES) {
    assert.doesNotMatch(await read(relPath), banned, relPath);
  }
});

test('LLM prose files do not present removed inputs as settable parameters', async () => {
  // `budget` (spec 011), `session` (spec 017), and `explore.thoroughness`
  // (spec 023) are rejected inputs. Prose may mention them only as removed
  // (e.g. "`budget` was removed in spec 011"), never as something an agent
  // could set, choose, or tune — "Do not set `budget` ... unless an advanced
  // workflow requires it" phrasing led agents into invalid_arguments failures.
  const settableRemovedInput =
    /\b(?:set|sets|setting|choose|chooses|choosing|pass|passes|passing|specify|specifies|specifying|tune|tunes|tuning)\s+[`"']?(?:budget|thoroughness|session)\b/i;
  for (const relPath of LLM_PROSE_FILES) {
    assert.doesNotMatch(
      await read(relPath),
      settableRemovedInput,
      `${relPath} must describe budget/thoroughness/session as removed inputs, not settable ones`,
    );
  }
});

test('Codex AGENTS.md.example and agent TOML introduce find_relevant_code before explore_repo', async () => {
  const sources = [
    await read('integrations/codex/AGENTS.md.example'),
    await read('integrations/codex/.codex/agents/cerebras_explorer.toml'),
  ];
  for (const text of sources) {
    const idxFind = text.indexOf('find_relevant_code');
    const idxRepo = text.indexOf('explore_repo');
    assert.ok(idxFind > 0 && idxRepo > 0, 'both tools should appear');
    assert.ok(
      idxFind < idxRepo,
      'find_relevant_code should appear before explore_repo in user-facing tool guidance',
    );
  }
});

test('DESIGN evidence reliability does not describe explore_v2 as active report mode', async () => {
  const design = await read('DESIGN.md');
  const staleActiveReportMode = /explore_v2 opt-in|`explore`와 `explore_v2`|explore_v2.*Report-mode|Report-mode.*explore_v2/;

  assert.doesNotMatch(design, staleActiveReportMode);
});

test('TESTING.md does not pin absolute test totals or fixed tool counts', async () => {
  const testingMd = await read('TESTING.md');

  assert.doesNotMatch(
    testingMd,
    /\b\d+\s+tests\b/,
    'TESTING.md must not pin absolute unit test count (\\d+ tests)',
  );
  assert.doesNotMatch(
    testingMd,
    /\b\d+\s+pass\b/,
    'TESTING.md must not pin absolute unit pass count (\\d+ pass)',
  );
  assert.doesNotMatch(
    testingMd,
    /\b\d+\s+skipped\b/,
    'TESTING.md must not pin absolute unit skip count (\\d+ skipped)',
  );
  assert.doesNotMatch(
    testingMd,
    /\b\d+\s*\/\s*\d+\s*통과(?=\s|[.)\]}]|$)/u,
    'TESTING.md must not pin fixed integration pass fractions (\\d+/\\d+ 통과)',
  );
  assert.doesNotMatch(
    testingMd,
    /(?:\b\d+\s*개\s*(?:공개\s*)?도구|도구\s*\d+\s*개)(?=\s|[.)\]}]|$)/u,
    'TESTING.md must not pin fixed public tool counts (\\d+개 도구 or 도구 \\d+개)',
  );
  assert.match(
    testingMd,
    /\bnpm test\b/,
    'TESTING.md must keep npm test as the unit-test acceptance command',
  );
  assert.match(
    testingMd,
    /\b0\s+(fail|failures)\b/,
    'TESTING.md must keep 0 fail/0 failures as the acceptance signal',
  );
});
