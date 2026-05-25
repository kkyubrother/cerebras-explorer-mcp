# Contract Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining contract hygiene fixes after `map_impact` and `find_entrypoints` were removed from the public MCP surface.

**Architecture:** Treat the public MCP surface as the current spec 011 8-tool contract. Do not re-add spec 013 wrappers. Strengthen the agent-facing response boundary by enforcing evidence reference integrity, deterministic `nextAction`, consistent repo ignore policy, and response provenance.

**Tech Stack:** Node.js ESM, `node:test`, zero npm dependencies, existing MCP request handler and ExplorerRuntime.

---

## Current Baseline

Current source and docs now agree on the 8-tool surface:

```text
find_relevant_code
trace_symbol
map_change_impact
explain_code_path
collect_evidence
review_change_context
explore_repo
explore
```

The removed spec 013 wrappers are intentionally absent:

```text
map_impact
find_entrypoints
```

Therefore this plan explicitly removes the old 10-tool remediation work:

- Do not add `impact_analysis` or `entry_point_discovery` to `TASK_MODES`.
- Do not update docs to say 10 tools.
- Do not expose `map_impact` or `find_entrypoints` in examples, provenance, or allowlists.
- Keep existing tests that reject removed spec 013 wrappers as unknown tools.

## Scope

In scope:

- Add an active-doc parity guard for the current 8-tool surface.
- Enforce `targets[].evidenceRefs ⊆ evidence[].id`.
- Normalize `nextAction` so cited targets are followed before `ask_user`.
- Apply `extraIgnorePatterns` consistently across traversal, grep, direct reads, symbols, and cache keys.
- Add response provenance that reports the running 8-tool registry.
- Run `npm test` before every commit, per `AGENTS.md`.

Out of scope:

- Reintroducing `map_impact` or `find_entrypoints`.
- Deciding cut-to-5 or wrapper deprecation.
- Telemetry or benchmark redesign.
- Typed redaction policy for safe `.env`/`.npmrc` prose. That needs a separate security/UX design.

## File Map

- `tests/integrations.test.mjs`: add active-doc surface parity guard for 8 tools.
- `src/explorer/runtime.mjs`: enforce evidence refs after final target merge and normalize next action.
- `tests/runtime.mock.test.mjs`: add regressions for invalid evidence refs and target-first follow-up.
- `src/explorer/repo-tools.mjs`: apply `extraIgnorePatterns` in direct path tools, ripgrep post-filtering, and scoped cache keys.
- `tests/repo-tools.test.mjs`: add ignore policy tests for grep/read/cache consistency.
- `src/explorer/schemas.mjs`: add the public `provenance` output schema.
- `src/mcp/server.mjs`: compute and attach provenance to structured tool responses.
- `tests/mcp-server.test.mjs`: assert provenance appears in `structuredContent` and reports 8 tools.
- `tests/schemas.test.mjs`: assert the output schema includes `provenance`.
- `README.md`: document the compact response `provenance` field and current ignore policy.
- `DESIGN.md`: document provenance and final contract enforcement.
- `examples/expected-response.json`: add a current 8-tool `provenance` example.

---

### Task 1: Active 8-Tool Surface Guard

**Files:**
- Modify: `tests/integrations.test.mjs`

- [ ] **Step 1: Add active-doc parity test**

Add this constant near the other integration-test constants in `tests/integrations.test.mjs`:

```js
const ACTIVE_PUBLIC_TOOL_NAMES = [
  'find_relevant_code',
  'trace_symbol',
  'map_change_impact',
  'explain_code_path',
  'collect_evidence',
  'review_change_context',
  'explore_repo',
  'explore',
];

const REMOVED_SPEC_013_TOOL_NAMES = [
  'map_impact',
  'find_entrypoints',
];
```

Add this test after the existing LLM prose drift tests:

```js
test('active docs track the current 8-tool surface and removed spec 013 wrappers', async () => {
  const activeDocs = {
    'AGENTS.md': await read('AGENTS.md'),
    'README.md': await read('README.md'),
    'DESIGN.md': await read('DESIGN.md'),
    'integrations/claude/.claude/agents/cerebras-explorer.md':
      await read('integrations/claude/.claude/agents/cerebras-explorer.md'),
  };

  assert.match(activeDocs['AGENTS.md'], /공개 도구 표면은 8개로 고정/);
  assert.match(activeDocs['README.md'], /항상 정확히 \*\*8개\*\*/);
  assert.match(activeDocs['DESIGN.md'], /항상 8개로 고정/);

  for (const [relPath, source] of Object.entries(activeDocs)) {
    for (const toolName of ACTIVE_PUBLIC_TOOL_NAMES) {
      assert.match(source, new RegExp(`\\b${toolName}\\b`), `${relPath} should mention ${toolName}`);
    }
    for (const removedToolName of REMOVED_SPEC_013_TOOL_NAMES) {
      assert.doesNotMatch(source, new RegExp(`\\b${removedToolName}\\b`), `${relPath} must not advertise ${removedToolName}`);
    }
  }
});
```

- [ ] **Step 2: Run the targeted test**

Run:

```bash
node --test tests/integrations.test.mjs
```

Expected: PASS on the current 8-tool source. If it fails, update only the active docs named by the assertion; do not edit `CHANGELOG.md` historical entries.

- [ ] **Step 3: Run full test suite before commit**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/integrations.test.mjs
git commit -m "test: guard active 8-tool surface docs"
```

---

### Task 2: Evidence Reference Integrity

**Files:**
- Modify: `src/explorer/runtime.mjs`
- Modify: `tests/runtime.mock.test.mjs`

- [ ] **Step 1: Add failing invalid-reference test**

Add this test after the existing task-mode tests in `tests/runtime.mock.test.mjs`:

```js
test('ExplorerRuntime drops target evidenceRefs that do not reference retained evidence ids', async () => {
  class InvalidRefsClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }

    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: 'requireAuth는 인증되지 않은 요청을 거부합니다.',
            statusConfidence: 'high',
            evidence: [
              { id: 'E1', path: 'src/auth.js', startLine: 1, endLine: 4, why: 'requireAuth 구현 위치입니다.' },
            ],
            targets: [
              {
                path: 'src/auth.js',
                startLine: 1,
                endLine: 4,
                role: 'read',
                reason: '근거가 있는 target입니다.',
                evidenceRefs: ['file_range', 'E1', 'missing-id'],
              },
            ],
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new InvalidRefsClient() });
  const result = await runtime.explore({
    task: 'requireAuth를 설명해라.',
    repo_root: root,
    scope: ['src/**'],
  });

  const validEvidenceIds = new Set(result.evidence.map(item => item.id));
  for (const target of result.targets) {
    for (const ref of target.evidenceRefs) {
      assert.equal(validEvidenceIds.has(ref), true, `${ref} must point at retained evidence`);
    }
  }
  assert.ok(!JSON.stringify(result.targets).includes('file_range'));
  assert.ok(!JSON.stringify(result.targets).includes('missing-id'));
});
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
node --test tests/runtime.mock.test.mjs
```

Expected: FAIL if invalid refs currently survive target merging.

- [ ] **Step 3: Add final evidence-ref enforcement**

Add this helper near `mergeTargets()` in `src/explorer/runtime.mjs`:

```js
function enforceTargetEvidenceRefs(targets = [], evidence = []) {
  const validIds = new Set(
    evidence
      .map(item => (typeof item?.id === 'string' && item.id ? item.id : null))
      .filter(Boolean),
  );

  return targets.map(target => ({
    ...target,
    evidenceRefs: Array.isArray(target.evidenceRefs)
      ? target.evidenceRefs.filter(ref => validIds.has(ref))
      : [],
  }));
}
```

After the existing `mergeTargets(...)` assignment in `ExplorerRuntime.explore()`, add:

```js
normalized.targets = enforceTargetEvidenceRefs(normalized.targets, normalized.evidence);
```

The final block should be:

```js
normalized.targets = mergeTargets(
  groundedModelTargets,
  buildTargets({ evidence: normalized.evidence }),
);
normalized.targets = enforceTargetEvidenceRefs(normalized.targets, normalized.evidence);
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test tests/runtime.mock.test.mjs tests/schemas.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run full test suite before commit**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/explorer/runtime.mjs tests/runtime.mock.test.mjs
git commit -m "fix: enforce evidence reference integrity"
```

---

### Task 3: Deterministic Next Action Normalization

**Files:**
- Modify: `src/explorer/runtime.mjs`
- Modify: `tests/runtime.mock.test.mjs`

- [ ] **Step 1: Add failing nextAction test**

Add this test after the evidence-ref test:

```js
test('ExplorerRuntime prefers cited target follow-up over model ask_user when evidence targets exist', async () => {
  class AskUserClient {
    constructor() { this.model = 'zai-glm-4.7'; this.calls = 0; }

    async createChatCompletion() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          message: {
            content: '',
            toolCalls: [{
              id: 'read-auth',
              function: {
                name: 'repo_read_file',
                arguments: JSON.stringify({ path: 'src/auth.js', startLine: 1, endLine: 4 }),
              },
            }],
          },
        };
      }

      return {
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        message: {
          content: JSON.stringify(compactResult({
            directAnswer: '부분 근거는 있습니다.',
            statusConfidence: 'low',
            evidence: [
              { path: 'src/auth.js', startLine: 1, endLine: 4, why: '읽은 근거입니다.' },
            ],
            nextAction: { type: 'ask_user', reason: '사용자에게 더 물어보세요.' },
          })),
          toolCalls: [],
        },
      };
    }
  }

  const root = await makeRepoFixture();
  const runtime = new ExplorerRuntime({ chatClient: new AskUserClient() });
  const result = await runtime.explore({
    task: 'requireAuth 설명을 보강해라.',
    repo_root: root,
    scope: ['src/**'],
  });

  assert.equal(result.status.verification, 'follow_up_needed');
  assert.equal(result.nextAction.type, 'explore_followup');
  assert.match(result.nextAction.query, /src\/auth\.js:1-4/);
});
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
node --test tests/runtime.mock.test.mjs
```

Expected: FAIL if `buildNextAction()` still preserves `ask_user` before checking cited targets.

- [ ] **Step 3: Normalize target-first follow-up**

Replace the `follow_up_needed` / `broad_search_needed` branch in `buildNextAction()` with:

```js
if (verification === 'follow_up_needed' || verification === 'broad_search_needed') {
  const firstTarget = (result.targets ?? []).find(item => item.role === 'read' || item.role === 'reference') ??
    (result.targets ?? []).find(item => item.path);
  if (firstTarget) {
    const range = firstTarget.startLine
      ? `${firstTarget.path}:${firstTarget.startLine}-${firstTarget.endLine ?? firstTarget.startLine}`
      : firstTarget.path;
    return {
      type: 'explore_followup',
      reason: 'Run a narrower follow-up around the cited target before asking the user.',
      query: range,
    };
  }

  if (result.nextAction?.type === 'explore_followup') {
    return {
      type: 'explore_followup',
      reason: result.nextAction.reason || 'The retained evidence is not sufficient for a complete answer.',
      ...(result.nextAction.query ? { query: result.nextAction.query } : {}),
    };
  }

  return {
    type: 'ask_user',
    reason: sufficiency?.reason ?? 'The task needs clarification or a narrower scope.',
  };
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test tests/runtime.mock.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run full test suite before commit**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/explorer/runtime.mjs tests/runtime.mock.test.mjs
git commit -m "fix: prefer grounded follow-up actions"
```

---

### Task 4: extraIgnorePatterns Consistency

**Files:**
- Modify: `src/explorer/repo-tools.mjs`
- Modify: `tests/repo-tools.test.mjs`
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Add failing ignore consistency tests**

Add these tests after the existing spec 014 tests in `tests/repo-tools.test.mjs`:

```js
test('Spec 014 — readFile rejects paths matched by extraIgnorePatterns', async () => {
  const repoRoot = await makeNestedIgnoreFixture();
  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
    extraIgnorePatterns: ['**/*.snapshot.json'],
  });
  await toolkit.initialize();

  await assert.rejects(
    toolkit.readFile({ path: 'fixture.snapshot.json', startLine: 1, endLine: 1 }),
    /Path is ignored by extraIgnorePatterns: fixture\.snapshot\.json/,
  );
});

test('Spec 014 — ripgrep fast path filters extraIgnorePatterns', { skip: !hasRipgrep() }, async () => {
  const repoRoot = await makeNestedIgnoreFixture();
  await fs.writeFile(path.join(repoRoot, 'fixture.snapshot.json'), '{"marker":"AUTH_MARKER"}');
  await fs.writeFile(path.join(repoRoot, 'normal.js'), 'const AUTH_MARKER = true;\n');

  const toolkit = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
    extraIgnorePatterns: ['**/*.snapshot.json'],
  });
  await toolkit.initialize([]);

  assert.equal(toolkit._hasRipgrep, true, 'ripgrep is available');
  const result = await toolkit.grep({ pattern: 'AUTH_MARKER' });
  assert.ok(result.matches.some(match => match.path === 'normal.js'));
  assert.ok(!result.matches.some(match => match.path === 'fixture.snapshot.json'));
});

test('Spec 014 — cache keys include extraIgnorePatterns policy', async () => {
  globalRepoCache.clear();
  const repoRoot = await makeNestedIgnoreFixture();

  const baseline = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
    cache: globalRepoCache,
  });
  await baseline.initialize();
  const baselineRead = await baseline.callTool('repo_read_file', {
    path: 'fixture.snapshot.json',
    startLine: 1,
    endLine: 1,
  });
  assert.match(baselineRead.content, /snap/);

  const ignored = new RepoToolkit({
    repoRoot,
    budgetConfig: getBudgetConfig('normal'),
    cache: globalRepoCache,
    extraIgnorePatterns: ['**/*.snapshot.json'],
  });
  await ignored.initialize();

  await assert.rejects(
    ignored.callTool('repo_read_file', { path: 'fixture.snapshot.json', startLine: 1, endLine: 1 }),
    /Path is ignored by extraIgnorePatterns: fixture\.snapshot\.json/,
  );
});
```

- [ ] **Step 2: Run the targeted failing tests**

Run:

```bash
node --test tests/repo-tools.test.mjs
```

Expected: FAIL if direct reads and ripgrep/cache paths do not fully enforce `extraIgnorePatterns`.

- [ ] **Step 3: Implement path-policy helpers**

In `RepoToolkit` constructor, preserve the patterns:

```js
this.extraIgnorePatterns = extraIgnorePatterns.filter(item => typeof item === 'string');
this.extraPatternMatcher = this.extraIgnorePatterns.length > 0
  ? buildGitignoreMatcher(this.extraIgnorePatterns)
  : null;
```

Add these methods near `_ignoreDirsFingerprint()`:

```js
_extraIgnorePatternsFingerprint() {
  return this.extraIgnorePatterns.length > 0 ? [...this.extraIgnorePatterns].sort().join(',') : '';
}

_matchesExtraIgnore(relPath) {
  return Boolean(this.extraPatternMatcher && this.extraPatternMatcher(relPath));
}

_enforceExtraIgnorePolicy(relPath) {
  if (this._matchesExtraIgnore(relPath)) {
    throw new Error(`Path is ignored by extraIgnorePatterns: ${relPath}`);
  }
}
```

Update `_scopedCacheKey()` to include:

```js
x: this._extraIgnorePatternsFingerprint(),
```

- [ ] **Step 4: Enforce policy in direct path tools**

In `readFile()` and `symbols()`, after the secret deny-list check and before `resolveSafePath()`, add:

```js
this._enforceExtraIgnorePolicy(relativePath);
```

- [ ] **Step 5: Enforce policy in ripgrep**

In `_grepWithRipgrep()`, add glob exclusions after the default secret-deny globs:

```js
for (const ignorePattern of this.extraIgnorePatterns) {
  rgArgs.push('--glob', `!${ignorePattern}`);
}
```

Also add a post-filter after the existing secret-path check:

```js
if (this._matchesExtraIgnore(relPath)) continue;
```

- [ ] **Step 6: Clarify docs**

In `README.md`, replace the current `.gitignore` / `extraIgnorePatterns` limitation bullet with:

```markdown
- `.gitignore`는 루트 파일과 traversal 도중 발견되는 nested `.gitignore`(서브디렉토리별)를 함께 반영합니다 (spec 014). nested 매처는 자기 디렉토리 prefix 안의 path에만 적용됩니다. `.gitignore`의 부정 규칙(`!keep`)은 지원하지 않으며 silently dropped됩니다. `.cerebras-explorer.json`의 `extraIgnorePatterns`(저장소 루트 기준 path glob)는 traversal, grep, direct read, symbols, cache key에 일관 적용됩니다. secret deny-list와 scope 경계는 이 ignore 정책 위에서 항상 우선합니다.
```

In `DESIGN.md`, update the ignore policy section to make the same ordering explicit:

```markdown
Effective path policy order: scope boundary and secret deny-list remain hard security boundaries; repo-specific ignore rules (`extraIgnoreDirs`, root/nested `.gitignore`, `extraIgnorePatterns`) are then applied consistently to traversal, grep, read, symbols, and cache keys.
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
node --test tests/repo-tools.test.mjs tests/integrations.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Run full test suite before commit**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/explorer/repo-tools.mjs tests/repo-tools.test.mjs README.md DESIGN.md
git commit -m "fix: apply extra ignore patterns consistently"
```

---

### Task 5: Tool Response Provenance for 8-Tool Surface

**Files:**
- Modify: `src/explorer/schemas.mjs`
- Modify: `src/mcp/server.mjs`
- Modify: `tests/mcp-server.test.mjs`
- Modify: `tests/schemas.test.mjs`
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `examples/expected-response.json`

- [ ] **Step 1: Add failing provenance tests**

In `tests/mcp-server.test.mjs`, inside `MCP request handler exposes explore_repo and returns structuredContent`, after the existing `structuredContent` assertions, add:

```js
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.ok(called.structuredContent.provenance, 'structuredContent must include provenance');
assert.equal(called.structuredContent.provenance.serverName, 'cerebras-explorer-mcp');
assert.equal(called.structuredContent.provenance.serverVersion, initialized.serverInfo.version);
assert.equal(called.structuredContent.provenance.packageVersion, packageJson.version);
assert.equal(called.structuredContent.provenance.schemaVersion, 1);
assert.equal(called.structuredContent.provenance.exposedToolCount, EXPECTED_PUBLIC_TOOL_NAMES.length);
assert.deepEqual(called.structuredContent.provenance.toolNames, EXPECTED_PUBLIC_TOOL_NAMES);
assert.match(called.structuredContent.provenance.toolRegistryHash, /^[0-9a-f]{64}$/);
assert.ok(
  called.structuredContent.provenance.gitSha === null ||
    /^[0-9a-f]{7,40}$/.test(called.structuredContent.provenance.gitSha),
  'gitSha must be null or a git commit hash',
);
```

In `tests/schemas.test.mjs`, extend `agent-facing output schema is compact...` with:

```js
assert.ok(EXPLORE_REPO_OUTPUT_SCHEMA.properties.provenance);
assert.deepEqual(EXPLORE_REPO_OUTPUT_SCHEMA.properties.provenance.required, [
  'serverName',
  'serverVersion',
  'packageVersion',
  'schemaVersion',
  'gitSha',
  'toolRegistryHash',
  'exposedToolCount',
  'toolNames',
]);
```

- [ ] **Step 2: Run the targeted failing tests**

Run:

```bash
node --test tests/mcp-server.test.mjs tests/schemas.test.mjs
```

Expected: FAIL because `provenance` is not yet in the output schema or structured response.

- [ ] **Step 3: Add output schema**

In `src/explorer/schemas.mjs`, add:

```js
const PROVENANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serverName: { type: 'string' },
    serverVersion: { type: 'string' },
    packageVersion: { type: 'string' },
    schemaVersion: { type: 'integer' },
    gitSha: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    toolRegistryHash: { type: 'string' },
    exposedToolCount: { type: 'integer', minimum: 0 },
    toolNames: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'serverName',
    'serverVersion',
    'packageVersion',
    'schemaVersion',
    'gitSha',
    'toolRegistryHash',
    'exposedToolCount',
    'toolNames',
  ],
};
```

Add this property to `EXPLORE_REPO_OUTPUT_SCHEMA.properties`:

```js
provenance: PROVENANCE_SCHEMA,
```

Do not add `provenance` to `EXPLORE_RESULT_JSON_SCHEMA`; the child model must not author this field.

- [ ] **Step 4: Compute provenance in the MCP boundary**

In `src/mcp/server.mjs`, add imports:

```js
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
```

Add helpers near `SERVER_INFO`:

```js
function readPackageVersion() {
  try {
    const raw = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw).version || SERVER_INFO.version;
  } catch {
    return SERVER_INFO.version;
  }
}

function readGitSha() {
  const envSha = process.env.CEREBRAS_EXPLORER_GIT_SHA?.trim();
  if (envSha) return envSha;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function buildToolRegistryHash(tools) {
  const stable = tools.map(tool => ({
    name: tool.name,
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null,
  }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function buildResponseProvenance() {
  const tools = buildToolList();
  const toolNames = tools.map(tool => tool.name);
  return {
    serverName: SERVER_INFO.name,
    serverVersion: SERVER_INFO.version,
    packageVersion: readPackageVersion(),
    schemaVersion: 1,
    gitSha: readGitSha(),
    toolRegistryHash: buildToolRegistryHash(tools),
    exposedToolCount: toolNames.length,
    toolNames,
  };
}
```

In `toAgentFacingResult()`, add:

```js
provenance: result.provenance ?? buildResponseProvenance(),
```

- [ ] **Step 5: Update docs and example**

In `examples/expected-response.json`, add a top-level `provenance` object immediately after `"schemaVersion": 1`:

```json
"provenance": {
  "serverName": "cerebras-explorer-mcp",
  "serverVersion": "0.5.0",
  "packageVersion": "0.5.0",
  "schemaVersion": 1,
  "gitSha": null,
  "toolRegistryHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "exposedToolCount": 8,
  "toolNames": [
    "find_relevant_code",
    "trace_symbol",
    "map_change_impact",
    "explain_code_path",
    "collect_evidence",
    "review_change_context",
    "explore_repo",
    "explore"
  ]
}
```

In `README.md`, replace the compact contract bullet near the top with:

```markdown
- **Compact 반환 계약**: MCP `structuredContent`는 `schemaVersion`, `directAnswer`, `status`, `targets`, snippet 포함 `evidence`, `uncertainties`, `nextAction`, `evidenceQuality`, nullable `failure`, `session`, `sessionId`, `provenance` 중심의 compact 계약을 사용합니다. 운영 디버그 정보는 `_debug.stats`, `_debug.toolTrace`에만 남깁니다. 평가 transcript에는 `provenance`와 raw `initialize`/`tools/list` payload를 함께 보존해 실행체 version/provenance를 고정합니다.
```

In the sample compact response JSON in `README.md`, insert the same 8-tool `provenance` object used in `examples/expected-response.json`.

In `DESIGN.md`, add one paragraph to the public contract section:

```markdown
Each structured tool response includes `provenance`, which identifies the running MCP server version, package version, git SHA when available, schema version, exposed tool count, ordered tool names, and a stable registry hash. Evaluations must record this field together with raw `initialize` and `tools/list` payloads before making product-level verdicts.
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
node --test tests/mcp-server.test.mjs tests/schemas.test.mjs tests/integrations.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run full test suite before commit**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/explorer/schemas.mjs src/mcp/server.mjs tests/mcp-server.test.mjs tests/schemas.test.mjs README.md DESIGN.md examples/expected-response.json
git commit -m "feat: expose tool response provenance"
```

---

### Task 6: Final Verification and Plan Closure

**Files:**
- Modify: `docs/superpowers/plans/2026-05-25-contract-hygiene.md`
- Move: `docs/superpowers/plans/2026-05-25-contract-hygiene.md` to `docs/superpowers/plans/completed/2026-05-25-contract-hygiene.md`

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 2: Verify zero dependency invariant**

Run:

```bash
node -e "const p=require('./package.json'); if ((p.dependencies&&Object.keys(p.dependencies).length)||(p.devDependencies&&Object.keys(p.devDependencies).length)) process.exit(1)"
```

Expected: exit code 0.

- [ ] **Step 3: Verify 8-tool surface**

Run:

```bash
node --test tests/mcp-server.test.mjs tests/integrations.test.mjs
```

Expected: PASS and the MCP tests assert the 8-tool public surface.

- [ ] **Step 4: Close the plan**

After every task above has landed in commits, change each unchecked box in this file to checked, then move the file:

```bash
git mv docs/superpowers/plans/2026-05-25-contract-hygiene.md docs/superpowers/plans/completed/2026-05-25-contract-hygiene.md
```

- [ ] **Step 5: Run full tests before final commit**

Run:

```bash
npm test
```

Expected: PASS with `0 fail`.

- [ ] **Step 6: Commit plan closure**

Run:

```bash
git add docs/superpowers/plans/completed/2026-05-25-contract-hygiene.md
git commit -m "chore: close contract hygiene plan"
```

---

## Self-Review

- Spec coverage: The plan now matches the current 8-tool contract and excludes the removed spec 013 wrappers. It still covers the remaining high-priority findings: provenance, evidence ref integrity, `nextAction`, and `extraIgnorePatterns`.
- Placeholder scan: No task relies on unspecified files or generic “add tests” wording. Each code-changing task includes concrete test code, implementation code, commands, and expected results.
- Type consistency: `provenance` is server-authored only, appears in `EXPLORE_REPO_OUTPUT_SCHEMA`, and is intentionally absent from the child model schema.
- Repo invariants: No dependencies are added. Public tool surface remains 8 tools. MCP repository access remains read-only.
