# Quickstart: Feature 028 Verification

This is the implementation verification order. Commands that reference new files become available as their implementation tasks land.

## 1. Confirm repository invariants

```powershell
node -e "const p=require('./package.json'); if ((p.dependencies && Object.keys(p.dependencies).length) || (p.devDependencies && Object.keys(p.devDependencies).length)) process.exit(1)"
npm test
```

Expected:

- No runtime or dev dependencies.
- Existing read-only, scope, git scope, redaction, cancellation, docs, and integration guards pass before feature changes.

## 2. Run pure trust-gate tests

```powershell
node --test tests/coverage.test.mjs
node --test tests/critic.test.mjs
node --test tests/schemas.test.mjs
```

Required cases:

1. A goal with no valid request/wrapper origin is rejected and cannot block completion.
2. A duplicate goal merges without losing origins/constraints; a too-broad goal is decomposed through one revision.
3. An omitted explicit request part is recovered through one revision; a second planning defect is materialized as a blocked required goal and prevents false completion.
4. Scope, read-only capability, unavailable live state, missing input, contradiction, and unverifiable proof conditions become non-repairable required gaps.
5. Difficulty alone does not classify a goal as infeasible; a checkable false premise with sufficient bounded evidence completes as a supported refutation, while insufficient absence/counterevidence remains `incomplete`.
6. Two unrelated exact evidence items do not complete a semantically unsupported claim.
7. Two of three valid required sub-goals supported returns `incomplete`.
8. A line number cannot be accepted as an item count without a deterministic count observation.
9. A missing middle handoff prevents flow completion.
10. Missing requested test/config impact categories prevent impact completion.
11. Contradictory route policies stay distinct.
12. A bounded absence certificate can complete a scope-qualified claim.
13. Truncation, incomplete enumeration, or a narrower boundary blocks an unqualified negative claim.
14. Valid partial tool/search truncation or context/turn limits affect only interrupted goals and never prove sufficiency; an output cap leaving required planner/auditor/verifier/final JSON invalid returns `failed`.
15. A verifier-invented uncovered part is audited before registration and cannot block completion when untraceable.
16. Repair counterevidence reopens every affected previously supported claim, and final verification cannot leave stale support.
17. Model confidence and evidence count do not affect final state.

## 3. Run runtime and MCP contract tests

```powershell
node --test --test-name-pattern='028|goal audit|feasibility|subgoal|semantic|repair|safety limit|absence|cancel' tests/runtime.mock.test.mjs
node --test --test-name-pattern='six-tool|schema v3|request id 0|minimal' tests/mcp-server.test.mjs
node --test tests/transcript.test.mjs
```

Expected:

- Initial planner → deterministic validation → isolated goal audit → at most one corrected plan/audit → exploration → isolated semantic verifier → at most one repair round → state reduction.
- Planner/auditor/verifier failures fail closed; valid infeasible goals return `incomplete`, not `failed`.
- Rejected planner goals remain in transcripts only and never appear in parent gaps or completion reduction.
- Verifier-proposed uncovered goals pass the same audit; remaining second-pass planning defects are required gaps, not diagnostics.
- Cancellation at every stage produces `state=failed`, `reason=aborted`, and no stale partial answer.
- JSON-RPC request id `0` can be cancelled.
- `tools/list` is exactly the six tools in [public-tool-surface.md](./contracts/public-tool-surface.md).
- Successful `structuredContent` contains no v2 confidence/coverage/critic/candidate/debug fields or empty collections.
- Text output mirrors only the direct answer plus action-relevant state/gap/failure.
- Detailed plan/search/verdict/usage records remain in the transcript, not the parent payload.

## 4. Verify removed surfaces, fixed limits, and documentation synchronization

```powershell
rg -n -e '\breview_change_context\b' -e '\bfreeExploreRepository\b' -e '\bfreeExplore\b' -e 'name:\s*.*\bexplore\b' src tests benchmarks integrations README.md DESIGN.md AGENTS.md TESTING.md examples
rg -n -e 'getBudgetConfig' -e '\bbudgetConfig\b' -e 'stoppedByBudget' -e 'budget_exhausted' -e 'TOOL_RESULT_CHAR_BUDGETS' -e 'budgetExhaustionRate' -e 'stats\.budget' -e 'CEREBRAS_EXPLORER_(TURN_MULTIPLIER|MAX_EXTRA_TURNS|MAX_COMPACTIONS)' src tests scripts benchmarks integrations README.md DESIGN.md TESTING.md package.json examples
rg -ni '\bbudget[A-Za-z0-9_]*\b' src scripts benchmarks package.json
rg -n -e 'hints\.strategy' -e 'CEREBRAS_EXPLORER_(TURN_MULTIPLIER|MAX_EXTRA_TURNS|MAX_COMPACTIONS)' integrations README.md DESIGN.md AGENTS.md TESTING.md examples
node --input-type=module -e "import { getRuntimeConfig } from './src/explorer/config.mjs'; const expected={maxTurns:30,maxSearchResults:80,maxReadLines:320,maxDirectoryEntries:300,maxWalkFiles:6000,maxCompletionTokens:16384,finalizeMaxCompletionTokens:3000,maxContextTokens:110000}; const actual=getRuntimeConfig(); for (const [key,value] of Object.entries(expected)) if (actual[key] !== value) throw new Error(key + ': expected ' + value + ', got ' + actual[key]); console.log('fixed runtime limits: ok')"
npm test
```

Expected after migration:

- Removed names appear only in explicit migration/history/negative-guard contexts.
- No alias or environment toggle re-enables either tool.
- Direct-runtime report aliases are absent; callers use `exploreRepository` or `ExplorerRuntime.explore`.
- Retry vocabulary and provenance list only the six current names.
- Public `explore_repo` input rejects `hints.strategy`; normal calls require no effort-policy choice.
- Active runtime/config/prompt/stats/benchmark/operator-config code has no budget label, object, completion/failure branch, effort envvar, or newly invented `budget*` identifier. The general scan returns no active matches; migration/history text and narrow negative assertions are explicitly allowlisted outside these active paths.
- `getRuntimeConfig()` reports exactly `maxTurns=30`, `maxSearchResults=80`, `maxReadLines=320`, `maxDirectoryEntries=300`, `maxWalkFiles=6000`, `maxCompletionTokens=16384`, `finalizeMaxCompletionTokens=3000`, and `maxContextTokens=110000`; callers/operators cannot select or multiply them.
- Internal limit observations use only `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, and `tool_result_limit`, and stay outside the normal v3 payload.
- README, DESIGN, AGENTS, integration allowlists, and examples agree with schema v3.

## 5. Run the offline known-answer suite

```powershell
node scripts/run-trust-suite.mjs --suite benchmarks/trust-known-answer.json --mode fixture --repeats 3 --verbose
```

Minimum manifest cases:

| Case | Required result |
|---|---|
| deny-list count/range confusion | Correct deterministic count or explicit gap; never line-number inference |
| large route/UI/API mismatch | Every requested layer supported or missing layer named as gap |
| route-specific admin divergence | Separate rules for each route; no repository-wide generalization |
| unsupported external-process inference | Inference absent or unresolved |
| repeated small repository | Test/env sub-goals and final state stable for all repeats |
| broad inventory classification | Every requested category supported or explicit gap |
| scoped negative | Exact scope qualification and certified absence |
| truncated all-usages claim | `incomplete` |
| cancellation/provider/verifier failure | `failed` |
| planner-invented goal | Rejected internally; never blocks or appears in parent payload |
| verifier-invented uncovered goal | Same goal audit; rejected if untraceable |
| omitted/decomposable goal | Corrected through at most one plan revision |
| second-pass planning defect | Materialized blocked required gap; never false-complete |
| scope/capability/live-state/missing-input/contradictory/unverifiable goal | `incomplete`; exact blocker; no evidence repair |
| every goal infeasible | `incomplete`; no invented `directAnswer`; at most one useful action |
| feasible but unsupported after repair | Supported partial facts plus gap; no second repair/re-plan |
| repair reveals counterevidence | Previously supported affected claims reopen and reverify |
| post-repair follow-up | Never repeats an equivalent attempted tool/action; omitted when no materially new action exists |
| supported false-premise refutation | `complete` when bounded proof is sufficient; otherwise `incomplete` |
| fixed safety limit | Only affected goals become `incomplete`; operator trace names the exact limit |
| invalid required control JSON after output cap | `failed` |

Expected aggregate:

- 0 unresolved required sub-goals with `complete`/`verify_targets`.
- 0 accepted claims with semantic evidence mismatch.
- 100% correctly bounded negative claims.
- 100% repeated final-state agreement.
- 100% expected goal-audit verdicts, zero rejected-goal leakage, zero repair attempts for known blockers, and no second plan revision.
- Every case records a fixture content hash or repository SHA plus dirty-tree content hash, and uses an oracle defined outside explorer/verifier output: expected sub-goals, allowed/forbidden claims, anchors, boundary, and state.

## 6. Measure parent payload reduction

```powershell
node scripts/run-benchmark.mjs --suite benchmarks/adoption.json --verbose
node scripts/run-trust-suite.mjs --suite benchmarks/trust-known-answer.json --mode fixture --measure-payload
```

Expected:

- Median schema v3 parent payload is at least 40% smaller than the recorded schema v2 baseline, measured as UTF-8 bytes of all parent-visible MCP `content` plus `structuredContent`.
- The five payload samples are rebuilt from the independent oracle's deterministic schema-v3 handoff with `buildOracleParentHandoff`, `buildParentPayload`, and `measureParentPayload`; failed or partial live Explorer output is not payload evidence.
- No successful payload includes empty arrays/objects, candidate inventories, search counters, critic details, confidence summaries, provider/model, token usage, or timing.
- Each retained wrapper passes its distinct proof-policy case.
- Removed review/report cases are replaced by general structured fallback cases rather than silently deleted from behavioral coverage.

## 7. Run the parent-observation harness

Create machine-specific repository mapping and output paths outside the checkout:

```powershell
$trustRoot = Join-Path $env:TEMP 'cerebras-explorer-trust'
New-Item -ItemType Directory -Force -Path $trustRoot | Out-Null
$pinnedRoot = Join-Path $trustRoot 'pinned-repositories'
New-Item -ItemType Directory -Force -Path $pinnedRoot | Out-Null

# Create dedicated clean detached worktrees at the five manifest-pinned commits.
git worktree add --detach (Join-Path $pinnedRoot 'cerebras-explorer-mcp') b3a7e75d39ff3f89d53de75bbcdf6e9f2bc4900e
git -C (Join-Path $env:USERPROFILE 'IdeaProjects\lawfirm') worktree add --detach (Join-Path $pinnedRoot 'lawfirm') fe7a5ca1cb7e279ae1eee5a931b60b69d93020b4
git -C (Join-Path $env:USERPROFILE 'IdeaProjects\AEGIS-AI-Agent') worktree add --detach (Join-Path $pinnedRoot 'AEGIS-AI-Agent') 492fa0a6c083c7d83302792b14b19da0b2953e67
git -C (Join-Path $env:USERPROFILE 'ClaudeProjects\translate') worktree add --detach (Join-Path $pinnedRoot 'translate') b9288a7b7532d9d90ea0f05228206b64cfe8e719
git -C (Join-Path $env:USERPROFILE 'PycharmProjects\Daeryun-AI-Backend') worktree add --detach (Join-Path $pinnedRoot 'Daeryun-AI-Backend') bbef2ff41b1b4ea93c97192edd355824ea4e5317

$repoMap = Join-Path $trustRoot 'repo-map.json'
@{
  'cerebras-explorer-mcp' = (Join-Path $pinnedRoot 'cerebras-explorer-mcp')
  lawfirm = (Join-Path $pinnedRoot 'lawfirm')
  'AEGIS-AI-Agent' = (Join-Path $pinnedRoot 'AEGIS-AI-Agent')
  translate = (Join-Path $pinnedRoot 'translate')
  'Daeryun-AI-Backend' = (Join-Path $pinnedRoot 'Daeryun-AI-Backend')
} | ConvertTo-Json | Set-Content -LiteralPath $repoMap

$traceDir = Join-Path $trustRoot 'parent-traces'
node scripts/run-parent-observation.mjs --suite benchmarks/trust-known-answer.json --repo-map $repoMap --output (Join-Path $trustRoot 'parent-observation.json') --trace-dir $traceDir
```

Every mapped repository must remain at the exact `gitSha` with the manifest's clean dirty-tree hash. Do not point the map at a development checkout with staged, unstaged, or untracked files. Fixture repositories are resolved and hash-checked from the suite automatically.

Metric definition:

- Denominator: non-fault known-answer cases whose oracle expects `complete` or `verify_targets`.
- Broad native re-search: unscoped/repository-wide grep, glob, walk, or uncited-path reads before using an allowed follow-up.
- Allowed verification: reads of returned targets and exact searches restricted to cited paths/ranges.
- Pass: at least 90% of eligible runs contain no broad native re-search.

This controlled replay measures how a real Codex parent consumes an independently constructed oracle schema-v3 handoff. It proves SC-008 parent behavior; it does not prove that the live Explorer can produce the same handoff. The portable manifest record retains only the policy profile, fixed denominator, source/prompt/handoff/report/trace hashes, observed/no-broad/broad metrics, allowances, and violation codes. The repo map, raw JSONL traces, commands, prose, usage, and absolute paths remain under `%TEMP%` and are never committed.

## 8. Run live Cerebras API verification

```powershell
$env:CEREBRAS_API_KEY = '<configured outside source control>'
$env:CEREBRAS_EXPLORER_LOG_PATH = Join-Path $trustRoot 'logs'
node scripts/integration-test.mjs
node scripts/run-trust-suite.mjs --suite benchmarks/trust-known-answer.json --mode live --repo-map $repoMap --output (Join-Path $trustRoot 'live-results.json') --repeats 3 --verbose
```

Use approved real repositories under locations such as:

- `C:\Users\daeryun\IdeaProjects`
- `C:\Users\daeryun\ClaudeProjects`

The live suite writes redacted transcripts and results under `$trustRoot`. It records tokens and latency but does not fail because they increased. The committed manifest stores logical repo ids only; the temp repo map resolves local absolute paths.

Unlike the controlled parent replay in section 7, this T069 run evaluates the actual Explorer output. A controlled oracle handoff or parent-observation pass cannot substitute for a useful live answer, precise real blocker, or the live trust oracle.

Required live gates:

- Every SC-001 through SC-016 criterion in [spec.md](./spec.md) passes.
- At least 90% of observed parent tasks finish without broad native re-search; critical checks are limited to cited targets.
- Repeated runs agree on required sub-goal completion even when optional citations differ.

## 9. Final release gate

```powershell
npm test
git diff --check
git status --short
```

Before commit/release also confirm:

- `package.json` version, top `CHANGELOG.md` heading, README install snippet, and every integration install ref match.
- `examples/expected-response.json` is a valid schema v3 example.
- Active source contains no internal budget abstraction or effort-tuning envvar; historical/migration and negative-test mentions are intentional.
- The completed implementation task plan is checked off and moved/deleted according to the repository plan-closure rule.
- No unrelated user changes were modified.
