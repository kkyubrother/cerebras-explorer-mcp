import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getRuntimeConfig } from '../src/explorer/config.mjs';
import { validateParentHandoffV3 } from '../src/explorer/schemas.mjs';

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

test('project keeps zero runtime and development dependencies', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.deepEqual(packageJson.dependencies, {});
  assert.deepEqual(packageJson.devDependencies, {});
});

test('collect_evidence keeps one quiet wrapper task in MCP and trust execution', async () => {
  const server = await read('src/mcp/server.mjs');
  const trustRunner = await read('scripts/run-trust-suite.mjs');
  const expectedServer = /Verify this claim with repository evidence: \$\{claim\.trim\(\)\}/u;
  const expectedRunner = /Verify this claim with repository evidence: \$\{claim\}/u;
  const staleNoise = /compact evidence bundle|with snippets|Mark uncertainties/u;

  assert.match(server, expectedServer);
  assert.match(trustRunner, expectedRunner);
  assert.doesNotMatch(server, staleNoise);
  assert.doesNotMatch(trustRunner, staleNoise);
});

test('map_change_impact task stays aligned with its four fixed goal seeds', async () => {
  const server = await read('src/mcp/server.mjs');
  const trustRunner = await read('scripts/run-trust-suite.mjs');
  const expected = /Identify actionable targets, dependent callers\/consumers, affected verification or public-contract surfaces, and the remaining risk boundary/u;
  const staleMandatoryCategories = /affected tests\/configuration\/documentation/u;
  const staleSixPartTask = /Identify likely edit targets, read targets, callers, tests, configuration, and risky dependent paths/u;

  assert.match(server, expected);
  assert.match(trustRunner, expected);
  assert.doesNotMatch(server, staleMandatoryCategories);
  assert.doesNotMatch(trustRunner, staleMandatoryCategories);
  assert.doesNotMatch(server, staleSixPartTask);
  assert.doesNotMatch(trustRunner, staleSixPartTask);
});

test('find_relevant_code asks for a bounded useful set without claiming global minimality', async () => {
  const server = await read('src/mcp/server.mjs');
  const trustRunner = await read('scripts/run-trust-suite.mjs');
  const runtime = await read('src/explorer/runtime.mjs');
  const prompt = await read('src/explorer/prompt.mjs');
  const schemas = await read('src/explorer/schemas.mjs');
  const coverage = await read('src/explorer/coverage.mjs');
  const metrics = await read('src/benchmark/effect-metrics.mjs');
  const dataModel = await read('specs/028-trustworthy-explorer/data-model.md');
  const expected = /return bounded useful targets/u;
  const staleGlobalMinimum = /return the smallest useful read\/edit targets/u;

  assert.match(server, expected);
  assert.match(trustRunner, expected);
  assert.match(runtime, expected);
  assert.doesNotMatch(server, staleGlobalMinimum);
  assert.doesNotMatch(trustRunner, staleGlobalMinimum);
  assert.doesNotMatch(runtime, staleGlobalMinimum);
  for (const activeSource of [prompt, schemas, coverage]) {
    assert.doesNotMatch(activeSource, /smallest_set/u);
  }
  assert.doesNotMatch(metrics, /smallest_relevant_location_set/u);
  assert.doesNotMatch(dataModel, /minimal target set/iu);
});

test('explain_code_path keeps runtime-owned output obligations out of the caller task', async () => {
  const server = await read('src/mcp/server.mjs');
  const trustRunner = await read('scripts/run-trust-suite.mjs');
  const staleGeneratedSuffix =
    /Include the entry point, handoff points, and next read targets/u;

  assert.match(
    server,
    /const task = `Explain this code path across files with grounded citations: \$\{pathQuery\.trim\(\)\}`;/u,
  );
  assert.match(
    trustRunner,
    /task: `Explain this code path across files with grounded citations: \$\{query\}`/u,
  );
  assert.doesNotMatch(server, staleGeneratedSuffix);
  assert.doesNotMatch(trustRunner, staleGeneratedSuffix);
});

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

test('expected response example matches the minimal v3 complete contract', async () => {
  const raw = await read('examples/expected-response.json');
  const example = JSON.parse(raw);

  assert.doesNotThrow(() => validateParentHandoffV3(example));
  assert.equal(example.schemaVersion, 3);
  assert.equal(typeof example.directAnswer, 'string');
  assert.equal(example.state, 'complete');
  assert.ok(Array.isArray(example.evidence) && example.evidence.length > 0);
  assert.deepEqual(Object.keys(example).sort(), [
    'directAnswer',
    'evidence',
    'schemaVersion',
    'state',
  ]);
  for (const diagnostic of [
    'status',
    'evidenceQuality',
    'searchCoverage',
    'critic',
    'stats',
    'nextAction',
    'failure',
  ]) {
    assert.equal(Object.hasOwn(example, diagnostic), false, diagnostic);
  }
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
  assert.match(source, /parentHandoff/);
  assert.match(source, /parentPayloadMeasurement/);
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

// T047_ACTIVE_SURFACE_GUARD_FIXTURE_START
// Test-first activation points. T054 removes executable effort/budget state;
// T056 removes the remaining user-facing migration surface. This block is the
// guard's own narrowly scoped negative-test allowlist and is stripped before
// the repository scan, so its banned fixtures cannot satisfy themselves.
const T054_ACTIVE_EFFORT_STATE_REMOVED = true;
const T056_USER_SURFACE_MIGRATED = true;

const ACTIVE_CODE_ROOTS = Object.freeze(['src', 'scripts', 'benchmarks', 'tests']);
const ACTIVE_USER_ROOTS = Object.freeze(['integrations', 'examples']);
const ACTIVE_USER_FILES = Object.freeze([
  'package.json',
  'README.md',
  'DESIGN.md',
  'TESTING.md',
  'AGENTS.md',
]);
const GENERAL_IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const GENERAL_BUDGET_IDENTIFIER = /^budget[A-Za-z0-9_$]*$/i;
const KNOWN_EFFORT_IDENTIFIERS = new Set([
  'getBudgetConfig',
  'budgetConfig',
  'stoppedByBudget',
  'budget_exhausted',
  'TOOL_RESULT_CHAR_BUDGETS',
  'applyToolResultCharBudget',
  'budgetExhaustionRate',
  'deepBudgetAvgTotalTokens',
  'chooseAutoBudget',
  'getModelForBudget',
  'getReasoningEffortForBudget',
  'BUDGETS',
  'CEREBRAS_EXPLORER_TURN_MULTIPLIER',
  'CEREBRAS_EXPLORER_MAX_EXTRA_TURNS',
  'CEREBRAS_EXPLORER_MAX_COMPACTIONS',
  'getExploreTurnMultiplier',
  'getExploreMaxExtraTurns',
  'getExploreMaxCompactions',
  'DEEP_RUNTIME_CONFIG',
].map(value => value.toLowerCase()));
const T047_BLOCK_START = '// T047_ACTIVE_SURFACE_GUARD_FIXTURE_START';
const T047_BLOCK_END = '// T047_ACTIVE_SURFACE_GUARD_FIXTURE_END';

async function listActiveFiles(relDir) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs.readdir(path.join(ROOT, current), { withFileTypes: true })) {
      const relPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(relPath);
      else if (/\.(?:cjs|js|json|md|mjs|toml|txt|yaml|yml|example)$/.test(entry.name)) {
        files.push(relPath.replaceAll('\\', '/'));
      }
    }
  }
  await walk(relDir);
  return files;
}

function stripT047NegativeFixture(relPath, source) {
  if (relPath !== 'tests/integrations.test.mjs' &&
      relPath !== 'tests/project-config.test.mjs') return source;
  const lines = source.split(/\r?\n/);
  const output = [];
  let insideFixture = false;
  for (const line of lines) {
    if (line.trim() === T047_BLOCK_START) {
      insideFixture = true;
      continue;
    }
    if (line.trim() === T047_BLOCK_END) {
      insideFixture = false;
      continue;
    }
    if (!insideFixture) output.push(line);
  }
  assert.equal(insideFixture, false, `${relPath} has an unterminated T047 fixture block`);
  return output.join('\n');
}

function effortSurfaceViolations(relPath, source) {
  const violations = [];
  for (const [index, line] of stripT047NegativeFixture(relPath, source).split(/\r?\n/).entries()) {
    const tokens = line.match(GENERAL_IDENTIFIER) ?? [];
    for (const token of tokens) {
      if (GENERAL_BUDGET_IDENTIFIER.test(token) ||
          KNOWN_EFFORT_IDENTIFIERS.has(token.toLowerCase())) {
        violations.push(`${relPath}:${index + 1}:${token}`);
      }
    }
    if (/Runtime profile:\s*deep/i.test(line)) {
      violations.push(`${relPath}:${index + 1}:Runtime profile: deep`);
    }
  }
  return violations;
}

async function scanEffortSurface(relPaths) {
  const violations = [];
  for (const relPath of [...new Set(relPaths)].sort()) {
    violations.push(...effortSurfaceViolations(relPath, await read(relPath)));
  }
  return violations;
}

test('Spec 028 T047 — executable active surface has no selectable effort abstraction', async t => {
  if (!T054_ACTIVE_EFFORT_STATE_REMOVED) {
    t.todo('T054 activates the executable active-surface guard');
    return;
  }
  const files = (await Promise.all(ACTIVE_CODE_ROOTS.map(listActiveFiles))).flat();
  assert.deepEqual(await scanEffortSurface(files), []);
});

test('Spec 028 T047 — public docs and examples have no selectable effort surface', async t => {
  if (!T056_USER_SURFACE_MIGRATED) {
    t.todo('T056 activates the public active-surface guard');
    return;
  }
  const files = [
    ...(await Promise.all(ACTIVE_USER_ROOTS.map(listActiveFiles))).flat(),
    ...ACTIVE_USER_FILES,
  ];
  assert.deepEqual(await scanEffortSurface(files), []);
});
// T047_ACTIVE_SURFACE_GUARD_FIXTURE_END

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

test('Gemini example documents required env and the full six-tool allowlist', async () => {
  const settings = JSON.parse(await read('integrations/gemini/settings.json.example'));
  const server = settings.mcpServers?.['cerebras-explorer'];
  assert.ok(server, 'Gemini server alias should be cerebras-explorer');
  assert.equal(server.command, 'npx');
  assert.equal(server.env?.CEREBRAS_API_KEY, '$CEREBRAS_API_KEY');
  assert.deepEqual(server.includeTools, [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'explore_repo',
  ]);
  assert.deepEqual(server.args, ['-y', 'github:kkyubrother/cerebras-explorer-mcp#v0.9.0']);

  const readme = await read('integrations/gemini/README.md');
  assert.match(readme, /full six-tool/i);
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
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'explore_repo',
  ]);
  assert.match(toml, /github:kkyubrother\/cerebras-explorer-mcp#v0.9.0/);
  assert.match(toml, /full six-tool/i);
  assert.doesNotMatch(toml, /minimal 4-tool/i);
  // spec 011: explore_v2 tool name is gone; the disabled_tools example just
  // demonstrates the syntax with any retained tool name.
  assert.match(toml, /disabled_tools = \["/);
  assert.match(toml, /CEREBRAS_API_KEY = "\$\{CEREBRAS_API_KEY\}"/);
  assert.doesNotMatch(toml, /absolute\/path/);

  const agents = await read('integrations/codex/AGENTS.md.example');
  assert.match(agents, /enabled_tools/);
  assert.match(agents, /disabled_tools/);
  assert.match(agents, /full six-tool/i);
  assert.doesNotMatch(agents, /minimal 4-tool/i);
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

test('CHANGELOG records the package version with a valid release status', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const changelog = await read('CHANGELOG.md');
  const escapedVersion = packageJson.version.replace(/\./g, '\\.');

  const versionHeading = new RegExp(
    `^##\\s+v${escapedVersion}\\s*-\\s*(?:Unreleased|\\d{4}-\\d{2}-\\d{2})\\s*$`,
    'mi',
  );
  assert.match(
    changelog,
    versionHeading,
    `CHANGELOG.md should contain an Unreleased or dated heading for v${packageJson.version}`,
  );
});

test('Continue YAML example keeps the expected MCP shape', async () => {
  const yaml = await read('integrations/continue/config.yaml.example');
  assert.match(yaml, /^mcpServers:/m);
  assert.match(yaml, /name: cerebras-explorer/);
  assert.match(yaml, /command: npx/);
  assert.match(yaml, /github:kkyubrother\/cerebras-explorer-mcp#v0.9.0/);
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
  `\\b(${[
    ['map', 'impact'].join('_'),
    ['find', 'entrypoints'].join('_'),
    ['review', 'change', 'context'].join('_'),
  ].join('|')})\\b|(?:\`explore\`|"explore"|'explore')`,
);

test('Gemini client timeout matches Codex tool_timeout_sec limit', async () => {
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

test('LLM prose files mention the current schema-v3 state contract', async () => {
  for (const relPath of LLM_PROSE_FILES) {
    const text = await read(relPath);
    assert.match(
      text,
      /schema[- ]?v3|schemaVersion[^\r\n]*3/i,
      `${relPath} should identify the schema-v3 handoff`,
    );
    assert.match(text, /\bstate\b/, `${relPath} should explain the state field`);
  }
});

test('Codex agent role TOML lists every public tool', async () => {
  const toml = await read('integrations/codex/.codex/agents/cerebras_explorer.toml');
  const expected = [
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
    'explain_code_path',
    'collect_evidence',
    'explore_repo',
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
  // `session` (spec 017) and `explore.thoroughness` (spec 023) are rejected
  // inputs. Prose may mention them only as removed, never as something an
  // agent could set, choose, or tune.
  const settableRemovedInput =
    /\b(?:set|sets|setting|choose|chooses|choosing|pass|passes|passing|specify|specifies|specifying|tune|tunes|tuning)\s+[`"']?(?:thoroughness|session)\b/i;
  for (const relPath of LLM_PROSE_FILES) {
    assert.doesNotMatch(
      await read(relPath),
      settableRemovedInput,
      `${relPath} must describe thoroughness/session as removed inputs, not settable ones`,
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

test('Spec 028 T056 — quickstart uses executable Node option order and PowerShell-native search', async () => {
  const quickstart = await read('specs/028-trustworthy-explorer/quickstart.md');
  assert.doesNotMatch(
    quickstart,
    /node\s+--test\s+tests\/[^\r\n]+\s+--test-name-pattern/,
    'Node test-runner options must precede positional test files',
  );
  assert.match(quickstart, /node\s+--test\s+--test-name-pattern(?:=|\s+)[^\r\n]+\s+tests\//);
  assert.match(quickstart, /```powershell[\s\S]*?\brg\s+-n/);
  assert.doesNotMatch(quickstart, /\bfind\s+\.\s+-name\b|\bxargs\b|\bgrep\s+-R\b/);
});

test('Spec 028 T071 — active fixed-limit documents track the final projection ceiling', async () => {
  const finalProjectionLimit = getRuntimeConfig().finalizeMaxCompletionTokens;
  assert.equal(finalProjectionLimit, 16_384);
  const sources = await Promise.all([
    read('README.md'),
    read('DESIGN.md'),
    read('TESTING.md'),
    read('specs/028-trustworthy-explorer/quickstart.md'),
    read('specs/028-trustworthy-explorer/contracts/public-tool-surface.md'),
  ]);
  const combined = sources.join('\n');

  assert.doesNotMatch(
    combined,
    /finalizeMaxCompletionTokens[^\r\n]{0,80}\b3000\b|final projection tokens[^\r\n]{0,40}\b3000\b/u,
  );
  assert.match(sources[0], new RegExp(`final projection tokens\\s*\\|\\s*${finalProjectionLimit}`));
  for (const source of sources.slice(1)) {
    assert.match(
      source,
      new RegExp(`finalizeMaxCompletionTokens[^\\r\\n]{0,80}\\b${finalProjectionLimit}\\b`),
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
