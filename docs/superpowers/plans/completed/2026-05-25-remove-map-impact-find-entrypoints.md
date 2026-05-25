# Remove map_impact and find_entrypoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore the public MCP surface to the 8-tool spec 011 contract by removing `map_impact` and `find_entrypoints` from code, tests, docs, integration examples, and current evaluation harnesses.

**Architecture:** Treat this as a breaking public-surface cleanup. Keep `src/mcp/server.mjs` as the single public tool registry, remove the two wrapper schemas and task builders entirely, and let the existing `exposedToolNames` guard reject direct calls as unknown tools. Keep historical specs and released changelog entries as history, but update active user-facing documentation and current harnesses to the 8-tool contract.

**Tech Stack:** Node.js ESM, `node:test`, MCP JSON-RPC handler, zero runtime dependencies.

---

## Context

Current repository state still exposes and documents the spec 013 10-tool surface, while `AGENTS.md` now defines the target invariant as the spec 011 8-tool surface:

- Keep: `explore_repo`, `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore`.
- Remove: `map_impact`, `find_entrypoints`.
- Do not add compatibility aliases or hidden envvar switches.
- Do not change `src/explorer/runtime.mjs` or `src/explorer/schemas.mjs`.
- Do not add `dependencies` or `devDependencies`.

Explorer handoff snapshot to preserve for downstream agents:

- `status.verification`: `targeted_read_needed`
- `status.complete`: `true`
- `evidenceQuality`: level `high`, exactCount `7`, partialCount `1`, droppedCount `0`, fileCount `4`, warning `1 evidence item(s) are grounded only by grep, blame, or nearby line observations.`
- `searchCoverage`: repo-wide, filesRead `13`, grepCalls `5`, symbolCalls `2`, stoppedByBudget `false`
- `failure`: `null`
- `session/sessionId`: `sess_ae17a8ea674e4142`
- `critic.warnings`: none present in the wrapper result; carry forward `status.warnings` if handing this off
- `_meta.progressToken`: not used for the discovery call

## Approaches Considered

Chosen approach: hard removal. Remove the tools from `buildToolList()`, dispatch, tests, allowlists, and active docs. This matches the new invariant and avoids carrying a deprecated public contract.

Rejected approach: client-side filtering only. Leaving the server at 10 tools and asking integrations to hide two names would keep README, tests, and actual MCP behavior out of sync with `AGENTS.md`.

Rejected approach: deprecated aliases. Keeping aliases that return guidance would still expose the names and violate the fixed 8-tool surface.

## File Structure

- Modify `src/mcp/server.mjs`: public MCP registry, tool schemas, wrapper task builders, initialize instructions, server version.
- Modify `tests/mcp-server.test.mjs`: tool-surface assertions, removed-tool rejection checks, wrapper validation matrix, server version expectation.
- Modify `tests/integrations.test.mjs`: integration allowlist and install-ref assertions.
- Modify `README.md`: quickstart refs, public tool count, wrapper list, decision rules, specialized tools table, agent-role snippet.
- Modify `DESIGN.md`: MCP server architecture text and future-extension list.
- Modify `CHANGELOG.md`: add `v0.5.0 - 2026-05-25` breaking-removal entry.
- Modify `package.json`: bump package version to `0.5.0`.
- Modify `integrations/**`: update install refs to `#v0.5.0` and remove removed tools from allowlists/prose.
- Modify `reports/run-current-tool-evaluation.mjs`: current evaluation harness should run the 8 public tools only.
- Do not edit historical `specs/013-*`, `specs/015-*`, or archived report markdown/JSON unless a test explicitly fails on active contract drift.

---

### Task 1: Pin The 8-Tool Server Contract In Tests

**Files:**
- Modify: `tests/mcp-server.test.mjs`

- [x] **Step 1: Replace the server import and add shared expected-name constants**

Change the import near the top of `tests/mcp-server.test.mjs` from:

```js
import { createMcpRequestHandler, buildEntryPointRegexBundle } from '../src/mcp/server.mjs';
```

to:

```js
import { createMcpRequestHandler } from '../src/mcp/server.mjs';
```

Add this immediately after the imports:

```js
const EXPECTED_PUBLIC_TOOL_NAMES = [
  'find_relevant_code',
  'trace_symbol',
  'map_change_impact',
  'explain_code_path',
  'collect_evidence',
  'review_change_context',
  'explore_repo',
  'explore',
];

const EXPECTED_WRAPPER_TOOL_NAMES = EXPECTED_PUBLIC_TOOL_NAMES.filter(
  name => name !== 'explore_repo' && name !== 'explore',
);

const REMOVED_SPEC_013_TOOL_NAMES = ['map_impact', 'find_entrypoints'];
```

- [x] **Step 2: Update the initialize/version and first tool-list assertions**

In the test named `MCP request handler exposes explore_repo and returns structuredContent`, change the version assertion to:

```js
assert.equal(initialized.serverInfo.version, '0.5.0');
```

After `const toolNames = listed.tools.map(t => t.name);`, add the full list assertion:

```js
assert.deepEqual(toolNames, EXPECTED_PUBLIC_TOOL_NAMES);
for (const removedToolName of REMOVED_SPEC_013_TOOL_NAMES) {
  assert.ok(!toolNames.includes(removedToolName), `${removedToolName} must not be exposed`);
}
```

Keep the existing `explore_repo` inclusion assertion.

- [x] **Step 3: Update wrapper language/context checks**

Replace the literal wrapper list in the same test with:

```js
for (const toolName of EXPECTED_WRAPPER_TOOL_NAMES) {
  const tool = listed.tools.find(t => t.name === toolName);
  assert.equal(tool.inputSchema.properties.language, undefined, `${toolName} must not expose language`);
  assert.equal(tool.inputSchema.properties.context, undefined, `${toolName} must not expose context`);
}
```

- [x] **Step 4: Update the read-only annotation test**

Rename the test from:

```js
test('MCP request handler declares read-only annotations for the fixed 10-tool surface', async () => {
```

to:

```js
test('MCP request handler declares read-only annotations for the fixed 8-tool surface', async () => {
```

Replace the local `expectedNames` array and old spec 013 comment with:

```js
// spec 011: tool surface is fixed at 8 regardless of legacy envvars.
const expectedNames = EXPECTED_PUBLIC_TOOL_NAMES;
```

Change the failure message from:

```js
`${scenario.name}: tool surface is fixed at 10 regardless of legacy envvars`,
```

to:

```js
`${scenario.name}: tool surface is fixed at 8 regardless of legacy envvars`,
```

- [x] **Step 5: Add a removed-tool rejection test**

Add this test near the existing `explore_v2` rejection test:

```js
test('MCP request handler rejects removed spec 013 wrappers as unknown tools', async () => {
  const repoRoot = await makeRepoFixture();
  const { handleRequest } = createMcpRequestHandler({
    runtimeOptions: { chatClient: new MockChatClient() },
  });

  const listed = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const toolNames = listed.tools.map(t => t.name);
  for (const removedToolName of REMOVED_SPEC_013_TOOL_NAMES) {
    assert.ok(!toolNames.includes(removedToolName), `${removedToolName} must not be listed`);
    await assert.rejects(
      handleRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: removedToolName, arguments: { repo_root: repoRoot } },
      }),
      new RegExp(`Unknown tool: ${removedToolName}`),
    );
  }
});
```

- [x] **Step 6: Remove tests that only validate the removed tools**

Delete the entire blocks with these names from `tests/mcp-server.test.mjs`:

```text
test name: map_impact rejects missing or empty anchor argument before runtime dispatch
test name: find_entrypoints rejects unknown entryKind via enum schema before runtime dispatch
test name: find_entrypoints dispatches with explore_repo-compatible hints
helper name: hasFragment
test name: Spec 015 - buildEntryPointRegexBundle("http") includes Ruby/PHP/Java/Rust patterns
test name: Spec 015 - buildEntryPointRegexBundle("cli") includes Ruby/PHP/Java/Rust patterns
test name: Spec 015 - buildEntryPointRegexBundle("cron") includes whenever/Laravel scheduler/Spring @Scheduled
test name: Spec 015 - buildEntryPointRegexBundle("all") is a superset including spec 013 and spec 015 patterns, and "cli" stays separate from http-only patterns
```

Also remove these two entries from the `WRAPPER_MATRIX`:

```js
{
  tool: 'map_impact',
  args: { anchor: 'src/auth.js' },
  unknownKey: 'reasonForChange',
},
{
  tool: 'find_entrypoints',
  args: {},
  unknownKey: 'targetLanguage',
},
```

- [x] **Step 7: Run the focused server test and confirm it fails before implementation**

Run:

```bash
node --test tests/mcp-server.test.mjs
```

Expected before Task 2: FAIL because `src/mcp/server.mjs` still exposes `map_impact`, `find_entrypoints`, and server version `0.4.1`.

- [x] **Step 8: Commit the test contract**

```bash
git add tests/mcp-server.test.mjs
git commit -m "test: pin 8-tool public mcp surface"
```

---

### Task 2: Remove The Two Wrapper Tools From The MCP Server

**Files:**
- Modify: `src/mcp/server.mjs`
- Test: `tests/mcp-server.test.mjs`

- [x] **Step 1: Bump server info**

Change:

```js
const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.4.1',
};
```

to:

```js
const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.5.0',
};
```

- [x] **Step 2: Delete removed tool schema constants**

Delete the complete `MAP_IMPACT_TOOL` and `FIND_ENTRYPOINTS_TOOL` constant blocks.

- [x] **Step 3: Restore the 8-tool registry**

Change `buildToolList()` to:

```js
function buildToolList() {
  return [
    FIND_RELEVANT_CODE_TOOL,
    TRACE_SYMBOL_TOOL,
    MAP_CHANGE_IMPACT_TOOL,
    EXPLAIN_CODE_PATH_TOOL,
    COLLECT_EVIDENCE_TOOL,
    REVIEW_CHANGE_CONTEXT_TOOL,
    EXPLORE_REPO_TOOL,
    EXPLORE_TOOL,
  ];
}
```

- [x] **Step 4: Delete removed wrapper builders**

Delete these declarations entirely:

```text
function name: looksLikeFilePath
function name: buildMapImpactArgs
constant name: ENTRY_POINT_REGEX_BY_KIND
exported function name: buildEntryPointRegexBundle
function name: buildFindEntrypointsArgs
```

- [x] **Step 5: Remove dispatch branches**

Delete these `tools/call` branches:

```js
if (name === 'map_impact') {
  validatePublicToolArgs(MAP_IMPACT_TOOL, args);
  return await callTool(buildMapImpactArgs(args), progressToken, requestId);
}
```

and:

```js
if (name === 'find_entrypoints') {
  validatePublicToolArgs(FIND_ENTRYPOINTS_TOOL, args);
  return await callTool(buildFindEntrypointsArgs(args), progressToken, requestId);
}
```

- [x] **Step 6: Update initialize instructions**

Change the `Purpose shortcuts:` sentence in the initialize response to:

```js
'Purpose shortcuts: find_relevant_code, trace_symbol, map_change_impact, explain_code_path, collect_evidence, review_change_context. ' +
```

The existing dynamic `${toolCount} tools` text will become `8 tools` after Step 3.

- [x] **Step 7: Run the server test**

Run:

```bash
node --test tests/mcp-server.test.mjs
```

Expected after this task: PASS.

- [x] **Step 8: Verify removed symbols are gone from server source**

Run:

```bash
rg -n "MAP_IMPACT_TOOL|FIND_ENTRYPOINTS_TOOL|buildMapImpactArgs|buildFindEntrypointsArgs|buildEntryPointRegexBundle|ENTRY_POINT_REGEX_BY_KIND|name: 'map_impact'|name: 'find_entrypoints'" src/mcp/server.mjs
```

Expected: no matches.

- [x] **Step 9: Commit server removal**

```bash
git add src/mcp/server.mjs tests/mcp-server.test.mjs
git commit -m "feat!: remove spec-013 wrapper tools from mcp server"
```

---

### Task 3: Update Integration Snapshot Tests

**Files:**
- Modify: `tests/integrations.test.mjs`

- [x] **Step 1: Update the Gemini example expected install ref and allowlist**

In the test named `Gemini example documents required env and recommended full wrapper allowlist`, change:

```js
assert.deepEqual(server.args, ['-y', 'github:kkyubrother/cerebras-explorer-mcp#v0.4.1']);
```

to:

```js
assert.deepEqual(server.args, ['-y', 'github:kkyubrother/cerebras-explorer-mcp#v0.5.0']);
```

Replace the `server.includeTools` expected list with:

```js
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
```

- [x] **Step 2: Update Codex install-ref assertion and add removed-name guards**

Change:

```js
assert.match(toml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.4\.1/);
```

to:

```js
assert.match(toml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.5\.0/);
```

After the existing `assert.match(toml, /"explore"/);`, add:

```js
assert.doesNotMatch(toml, /"map_impact"/);
assert.doesNotMatch(toml, /"find_entrypoints"/);
```

After `const agents = await read('integrations/codex/AGENTS.md.example');`, add:

```js
assert.doesNotMatch(agents, /`map_impact`/);
assert.doesNotMatch(agents, /`find_entrypoints`/);
```

- [x] **Step 3: Update Continue install-ref assertion**

Change:

```js
assert.match(yaml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.4\.1/);
```

to:

```js
assert.match(yaml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.5\.0/);
```

- [x] **Step 4: Run the integration snapshot test and confirm it fails before docs are updated**

Run:

```bash
node --test tests/integrations.test.mjs
```

Expected before Task 4: FAIL because active docs and examples still contain `#v0.4.1` and the removed tool names.

- [x] **Step 5: Commit integration test expectations**

```bash
git add tests/integrations.test.mjs
git commit -m "test: expect 8-tool integration allowlists"
```

---

### Task 4: Update Public Docs, Integration Examples, Version Metadata, And Current Harnesses

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `integrations/claude/.mcp.json.example`
- Modify: `integrations/claude-desktop/README.md`
- Modify: `integrations/claude-desktop/claude_desktop_config.json.example`
- Modify: `integrations/codex/AGENTS.md.example`
- Modify: `integrations/codex/config.toml.example`
- Modify: `integrations/continue/README.md`
- Modify: `integrations/continue/config.yaml.example`
- Modify: `integrations/cursor/README.md`
- Modify: `integrations/cursor/mcp.json.example`
- Modify: `integrations/gemini/README.md`
- Modify: `integrations/gemini/settings.json.example`
- Modify: `integrations/opencode/README.md`
- Modify: `integrations/opencode/opencode.json.example`
- Modify: `reports/run-current-tool-evaluation.mjs`
- Test: `tests/integrations.test.mjs`

- [x] **Step 1: Bump package version**

Change `package.json`:

```json
"version": "0.5.0",
```

- [x] **Step 2: Add the changelog release entry**

Insert this block directly under `# Changelog` in `CHANGELOG.md`:

```markdown
## v0.5.0 - 2026-05-25

### Public surface contraction to spec 011 8-tool contract (2026-05-25)

Breaking public MCP surface cleanup. The server again exposes exactly 8 tools:
`explore_repo`, six purpose wrappers (`find_relevant_code`, `trace_symbol`,
`map_change_impact`, `explain_code_path`, `collect_evidence`,
`review_change_context`), and `explore`.

- **Removed**: `map_impact` and `find_entrypoints` from the public MCP tool
  registry, tool schemas, dispatch path, integration allowlists, and current
  evaluation harnesses.
- **Changed**: README, DESIGN, and integrations now describe the fixed 8-tool
  surface. Calls to the removed names are rejected by the existing unknown-tool
  guard.
- **Migration**: Use `map_change_impact` when planning a change from a natural
  language description plus known file or symbol anchors. Use `find_relevant_code`
  or `explain_code_path` for route, CLI, job, MCP, or event entry-point discovery.
```

- [x] **Step 3: Update active install refs**

Replace active install refs from `#v0.4.1` to `#v0.5.0` in this exact file set:

```text
README.md
integrations/claude/.mcp.json.example
integrations/claude-desktop/README.md
integrations/claude-desktop/claude_desktop_config.json.example
integrations/codex/config.toml.example
integrations/continue/README.md
integrations/continue/config.yaml.example
integrations/cursor/README.md
integrations/cursor/mcp.json.example
integrations/gemini/README.md
integrations/gemini/settings.json.example
integrations/opencode/README.md
integrations/opencode/opencode.json.example
```

Do not rewrite historical refs inside `CHANGELOG.md`, `specs/**`, archived `reports/**`, or the untracked `docs/superpowers/plans/2026-05-25-contract-hygiene.md`.

- [x] **Step 4: Update README public surface sections**

In `README.md`, make these active contract changes:

```markdown
spec 011 이후 도구 surface는 환경변수와 무관하게 **항상 8개로 고정**입니다.

| 도구 | 역할 |
| --- | --- |
| `explore_repo` | 구조화 JSON handoff. 자동화/편집 계획/follow-up 검증의 기본 표면. |
| `find_relevant_code` / `trace_symbol` / `map_change_impact` / `explain_code_path` / `collect_evidence` / `review_change_context` | 목적형 wrapper 6개. 모두 내부적으로 `explore_repo`에 위임. |
| `explore` | 사람용 Markdown 보고 도구. 단일 V2 backend 구현(spec 011). |
```

Update the Codex quickstart allowlist to:

```toml
enabled_tools = [
  "explore_repo",
  "find_relevant_code",
  "trace_symbol",
  "map_change_impact",
  "explain_code_path",
  "collect_evidence",
  "review_change_context",
  "explore",
]
```

Replace the quickstart prose:

```markdown
The 8-tool allowlist is the recommended full wrapper setup. For a stricter
minimal trust boundary, expose only `explore_repo`, `find_relevant_code`,
`trace_symbol`, and `map_change_impact`; that subset intentionally drops the
purpose-built evidence, path, review, and Markdown-report entry points.
```

Update the public tool section to:

```markdown
도구 surface는 항상 정확히 **8개**(spec 011 이후 환경변수와 무관하게 고정).

- `explore_repo`: parent agent handoff의 정상 구조화 표면입니다. `directAnswer`, `status`, `targets`, `discoveredPaths`, `evidence`, `searchCoverage` 같은 JSON 필드를 후속 자동화와 편집 전 검증에 사용합니다.
- 목적형 wrapper 6개(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`): 모두 내부적으로 `explore_repo`에 위임하며, 특정 작업 의도를 더 좁은 입력 스키마로 표현하는 표면입니다.
- `explore`: 사람에게 바로 보여줄 Markdown 보고 도구. spec 011에서 V2 backend가 단일 구현으로 승격되어 모든 프롬프트에서 동일한 신뢰 가이드라인(structuredContent.citations[]/targets[], critic.warnings, searchCoverage.warnings, tool-result truncation 라벨)을 적용합니다.
```

Update the decision rules to remove the two deleted-tool bullets:

```markdown
- 자동화 / 편집 계획 / follow-up 검증 -> `explore_repo` (구조화 JSON)
- known symbol / 특정 경로 / 단일 변경 리뷰 -> 6 wrapper 중 의도에 맞는 것
- 사람에게 보여줄 narrative -> `explore` (Markdown)
```

Update the specialized tools table so it contains exactly these wrapper rows:

```markdown
| `find_relevant_code` | 기능/버그/설정/라우트와 관련된 파일과 line target을 찾음 | auto |
| `trace_symbol` | 심볼의 정의와 사용처를 추적하는 목적형 alias | symbol-first |
| `map_change_impact` | 변경 *설명*과 이미 알려진 file/symbol anchor로 likely edit/read target과 blast radius를 수집 | reference-chase |
| `explain_code_path` | route/middleware/request/event/CLI 흐름을 파일 간 추적 | reference-chase |
| `collect_evidence` | claim/review point에 대한 citation bundle 수집 | auto |
| `review_change_context` | PR/recent-change review context 수집 | git-guided |
```

Remove the `map_change_impact vs map_impact` paragraph and the `find_entrypoints` caveat paragraph.

In the Codex role snippet, remove the two deleted tools and keep the replacement guidance:

```markdown
- `map_change_impact` before edits when only a change description or known anchors are available
- `explain_code_path` for route, middleware, request, event, or CLI flows
```

- [x] **Step 5: Update DESIGN active contract text**

In `DESIGN.md`, replace the MCP server paragraph with:

```markdown
spec 011 이후 상위 모델에게 노출되는 도구는 환경변수와 무관하게 **항상 8개로 고정**된다: `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore_repo`, `explore`. `explore_v2` 도구 이름은 제거되었고, V2 구현은 단일 `explore` backend로 승격되었다. 이전 surface 토글 envvar(`CEREBRAS_EXPLORER_EXTRA_TOOLS`, `CEREBRAS_EXPLORER_ENABLE_EXPLORE`, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`)는 모두 인식되지 않는다.
```

In `## 17. 추후 확장`, remove these bullets:

```markdown
- `map_impact`
- `find_entrypoints`
```

- [x] **Step 6: Update integration allowlists and prose**

Use this 8-tool allowlist wherever an integration example has `enabled_tools`, `includeTools`, or equivalent allowlist:

```json
[
  "explore_repo",
  "find_relevant_code",
  "trace_symbol",
  "map_change_impact",
  "explain_code_path",
  "collect_evidence",
  "review_change_context",
  "explore"
]
```

In `integrations/codex/AGENTS.md.example`, replace the preferred-flow line with:

```markdown
1. Use the narrowest `cerebras-explorer` tool that fits the question: `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore_repo`, or `explore`.
```

Replace the recommended exposure paragraph with:

```markdown
Recommended full wrapper exposure is `explore_repo`, `find_relevant_code`,
`trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`,
`review_change_context`, and `explore`. Use the minimal 4-tool allowlist only
when the session needs a deliberately narrower trust boundary; it removes
purpose-built evidence, path, review, and Markdown-report entry points.
```

In `integrations/gemini/README.md`, replace the full-wrapper prose with:

```markdown
Recommended full wrapper exposure is the 8-tool list above. It keeps low-level
repo operations hidden while giving the agent separate entry points for locate,
symbol tracing, change-impact mapping, path explanation, evidence collection,
change review, structured JSON, and cited Markdown reports.
```

In `integrations/cursor/README.md` and `integrations/continue/README.md`, change the displayed default tool list to the same 8 names.

- [x] **Step 7: Update current evaluation harness**

In `reports/run-current-tool-evaluation.mjs`, change the first repo `reviewGoal` to:

```js
reviewGoal: 'Review the current public MCP surface for fixed 8-tool behavior and removed explore_v2/budget inputs.',
```

Remove all `entryKind` properties from the repo fixtures.

Change the `tools` array to:

```js
const tools = [
  'explore_repo',
  'find_relevant_code',
  'trace_symbol',
  'map_change_impact',
  'explain_code_path',
  'collect_evidence',
  'review_change_context',
  'explore',
];
```

Delete the `case 'map_impact':` branch from `argsFor()`, from that `case` line through the closing `};` immediately before `case 'explain_code_path':`.

Delete the `case 'find_entrypoints':` branch from `argsFor()`, from that `case` line through the closing `};` immediately before `case 'explore':`.

- [x] **Step 8: Run integration snapshot tests**

Run:

```bash
node --test tests/integrations.test.mjs
```

Expected after this task: PASS.

- [x] **Step 9: Run targeted active-contract search**

Run:

```bash
rg -n "map_impact|find_entrypoints|10-tool|10개|항상 10|fixed 10" src tests README.md DESIGN.md AGENTS.md integrations reports/run-current-tool-evaluation.mjs
```

Expected: no matches in these active contract files.

- [x] **Step 10: Commit docs, integrations, metadata, and harness changes**

```bash
git add package.json CHANGELOG.md README.md DESIGN.md integrations reports/run-current-tool-evaluation.mjs tests/integrations.test.mjs
git commit -m "docs!: restore 8-tool public surface contract"
```

---

### Task 5: Final Verification And Plan Closure

**Files:**
- Verify: full repository
- Modify: `docs/superpowers/plans/2026-05-25-remove-map-impact-find-entrypoints.md`

- [x] **Step 1: Run focused tests**

```bash
node --test tests/mcp-server.test.mjs
node --test tests/integrations.test.mjs
```

Expected: both commands PASS.

- [x] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: PASS. `node scripts/integration-test.mjs` is not required because this plan does not touch `src/explorer/runtime.mjs`.

- [x] **Step 3: Run repository hygiene checks**

```bash
git diff --check
rg -n "map_impact|find_entrypoints|10-tool|10개|항상 10|fixed 10" src tests README.md DESIGN.md AGENTS.md integrations reports/run-current-tool-evaluation.mjs
git status --short
```

Expected:

```text
git diff --check exits 0
rg exits 1 with no matches
git status --short shows only intended changes before the final closure commit
```

- [x] **Step 4: Close this active plan**

After all code/docs commits have landed, mark every checkbox in this plan as complete, then move it to completed plans:

```bash
git mv docs/superpowers/plans/2026-05-25-remove-map-impact-find-entrypoints.md docs/superpowers/plans/completed/2026-05-25-remove-map-impact-find-entrypoints.md
```

If this plan file was not committed before execution, move it with `mv` and add the completed path instead:

```bash
mkdir -p docs/superpowers/plans/completed
mv docs/superpowers/plans/2026-05-25-remove-map-impact-find-entrypoints.md docs/superpowers/plans/completed/2026-05-25-remove-map-impact-find-entrypoints.md
```

- [x] **Step 5: Commit plan closure**

```bash
git add docs/superpowers/plans/completed/2026-05-25-remove-map-impact-find-entrypoints.md
git commit -m "docs: complete removed wrapper plan"
```

If the implementation used task-level commits above, do not squash without also confirming `npm test` still passes afterward.
