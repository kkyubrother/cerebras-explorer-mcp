# Implementation Plan: Trustworthy, Quiet Explorer

**Branch**: `028-trustworthy-explorer` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/028-trustworthy-explorer/spec.md`

## Summary

Replace evidence-count-based completion with an audited required-sub-goal ledger and a fail-closed claim-verification pipeline. The explorer will plan independently verifiable parts of the request, validate their request traceability and feasibility before exploration, revise the plan at most once, collect evidence against a fixed proof policy, validate source grounding deterministically, validate semantic claim support in an isolated model pass, and return a complete result only when every valid required sub-goal passes. Planner-invented goals are discarded internally; user-required but impossible or still-unachieved goals become precise `incomplete` gaps. One later repair round may close a narrow batch of feasible evidence gaps.

Remove the internal budget abstraction, not only its already-removed public input. The `deep` label, budget config names, budget-derived completion/failure branches, budget telemetry, and report effort envvars disappear. Fixed provider/context/process ceilings remain as explicit non-configurable safety limits; they never prove completion and affect only goals whose evidence collection they interrupted. The parent never selects a budget, strategy, turn count, or depth.

The normal MCP handoff becomes schema v3: `schemaVersion`, `directAnswer`, one four-value `state`, and only the targets/evidence needed for the parent's next action. Gaps, follow-up, and failure appear only when applicable. Search counters, critic details, candidate paths, sub-goal history, usage, timing, and successful checks move to the transcript/direct-runtime evaluation channel. The public surface shrinks from eight tools to six by removing `review_change_context` and the Markdown `explore` report tool; no aliases or replacement tools are added.

## Technical Context

**Language/Version**: Node.js 22+ ESM (`.mjs`), JavaScript

**Primary Dependencies**: None. `package.json` must continue to have no `dependencies` or `devDependencies`.

**Storage**: No application database. Optional redacted JSONL transcript files remain the operational record.

**Testing**: Node built-in test runner through `npm test`; deterministic mock-provider tests; real Cerebras API known-answer and repeatability suite when `CEREBRAS_API_KEY` is available

**Target Platform**: Cross-platform stdio MCP server and direct Node runtime library, developed on Windows and exercised in CI on supported Node platforms

**Project Type**: Single-package MCP server/library/CLI

**Performance Goals**: Zero false-complete known-answer cases; zero semantically unsupported cited claims; 100% correct wrong/infeasible-goal classification fixtures; median normal parent payload at least 40% smaller than schema v2. Token use and latency are recorded but are not acceptance gates. Planning is bounded to one revision and evidence repair to one round so defects cannot create an unbounded loop.

**Constraints**: Read-only repository access; hard scope boundary; deny-list and redaction always active; no public or internal budget abstraction/effort controls; fixed safety/context limits only; no new public tools; at most six public tools; honest cancellation/provider/truncation/infeasibility handling; detailed diagnostics excluded from normal parent-facing output

**Scale/Scope**: Existing structured exploration path across JavaScript/TypeScript, Python, Go, and mixed large repositories; five manifest-pinned real repositories plus independently hash-pinned fixtures in the trust suite; production changes concentrated in runtime, prompt, critic/coverage, schemas, MCP server, transcript, benchmark, tests, docs, and integration manifests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template, so the repository rules in `AGENTS.md` are the effective gates.

| Gate | Before Phase 0 | After Phase 1 design |
|---|---|---|
| Zero runtime/dev dependencies | PASS — the design uses current provider calls and Node standard-library modules only | PASS — one small pure `coverage.mjs` module is sufficient; no package is added |
| Read-only repository access | PASS — only planning, verification, response shaping, and public removal are involved | PASS — no write/delete repo tool is introduced |
| Secret deny-list and redaction always active | PASS — user-approved ZDR changes prioritization, not the invariant | PASS — source, transcript, and error paths remain redacted by the current policy |
| Scope is a hard boundary for every repo/git tool | PASS | PASS — scope and omission observations become stronger completion gates |
| No public budget or internal-strategy decision | PASS | PASS — the old internal budget abstraction is removed; one goal revision, fixed proof policies, fixed safety limits, and one repair round are runtime-owned |
| Public surface fixed at eight tools | INTENTIONAL MIGRATION — explicit user direction requires removal of low-value tools | PASS after synchronously changing `AGENTS.md`, server registry, retry vocabulary, docs, integrations, examples, and tests to the six-tool contract |
| Preserve all current control-plane fields in handoff | INTENTIONAL MIGRATION — the current overlap is the cognitive-load problem being fixed | PASS after schema v3 replaces overlapping fields with one `state`, while detailed facts remain in logs/direct-runtime evaluation |
| Scope/cancel/security regressions forbidden | PASS | PASS — dedicated fault-precedence and request-id-zero cancellation tests are included |
| Docs/code synchronization and `npm test` before commit | PASS | PASS — release/docs/integration snapshots are an explicit final phase |

The two intentional migrations are authorized by the feature request and are breaking pre-1.0 contract changes, not silent exceptions. Implementation must not merge a half-migrated state.

## Project Structure

### Documentation (this feature)

```text
specs/028-trustworthy-explorer/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── internal-subgoal-ledger.md
│   ├── goal-audit.md
│   ├── parent-handoff-v3.md
│   ├── public-tool-surface.md
│   └── trust-gates.md
├── checklists/
│   └── requirements.md
└── tasks.md                  # generated later by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── explorer/
│   ├── coverage.mjs          # new: pure sub-goal/claim/gap state and deterministic completion gates
│   ├── config.mjs            # unlabeled runtime configuration and fixed safety limits; no budget/effort tier
│   ├── prompt.mjs            # planner, structured exploration, isolated verifier, and repair prompts
│   ├── runtime.mjs           # orchestration, observation ledger, bounded repair, fault precedence
│   ├── repo-tools.mjs        # search boundary/truncation/omission metadata for coverage gates
│   ├── critic.mjs            # retained deterministic range/source-integrity checks
│   ├── schemas.mjs           # internal plan/claim/verdict schemas and public schema v3
│   └── transcript.mjs        # sub-goal/claim/verdict/usage diagnostics outside parent payload
├── mcp/
│   └── server.mjs            # six-tool registry, minimal text/structured handoff, no report handler
└── benchmark/
    ├── evaluator.mjs         # sub-goal, semantic support, negative-boundary, state checks
    └── effect-metrics.mjs    # payload-size and independent citation/source verification

benchmarks/
├── adoption.json             # retained-tool adoption cases; removed-tool cases migrated/deleted
└── trust-known-answer.json   # cross-repository, negative, repeatability, scope, cancel cases

scripts/
├── integration-test.mjs      # schema v3 and six-tool live smoke checks
├── run-trust-suite.mjs       # real-repository known-answer/repeat driver
└── run-parent-observation.mjs # parent native-research behavior harness

tests/
├── coverage.test.mjs         # new pure sub-goal and trust-gate tests
├── runtime.mock.test.mjs
├── schemas.test.mjs
├── mcp-server.test.mjs
├── critic.test.mjs
├── benchmark-evaluator.test.mjs
├── benchmark-effect-metrics.test.mjs
├── integrations.test.mjs
├── transcript.test.mjs
├── repo-tools.test.mjs
└── security/redact.test.mjs

README.md
DESIGN.md
TESTING.md
CHANGELOG.md
AGENTS.md
examples/expected-response.json
integrations/**
```

**Structure Decision**: Keep the existing single package. Add one pure module, `src/explorer/coverage.mjs`, so sub-goal state and completion rules can be tested independently without further growing the 2,500-line runtime. Provider orchestration stays in `runtime.mjs`; public schemas stay in `schemas.mjs`; prompt construction stays in `prompt.mjs`. Do not create a separate service, database, worker, or public tool.

## Implementation Phases

### Phase 0 — Freeze the evidence-backed baseline

1. Encode the observed failures as known-answer cases before changing runtime logic: deny-list count/range confusion, large-repository route/UI/API mismatch, route-specific admin divergence, unsupported external-process inference, missing tests/environment details on repeat, and incomplete AWS-style inventory classification. Each oracle lives outside explorer output and includes expected sub-goals, allowed/forbidden claims, evidence anchors, boundary, and state.
2. Pin every case to a fixture content hash or repository git SHA plus dirty-tree content hash so repository drift cannot masquerade as an explorer regression.
3. Capture schema v2 parent payload sizes, tool choices, completion states, citations, total tokens, and latency. Payload size is UTF-8 bytes of all parent-visible MCP `content` plus `structuredContent`; cost and latency are record-only.
4. Add deterministic fixtures for semantic mismatch, incomplete multi-part requests, contradictory policies, scope-limited absence, truncated enumeration, cancellation, provider failure, and MCP request id `0` cancellation tracking.
5. Add goal-audit fixtures for untraceable invention, duplicate, over-broad decomposition, omitted request part, immutable-scope block, read-only capability block, unavailable live state, missing input, contradictory requirements, no observable proof condition, and a feasible goal that remains unsupported.
6. Inventory every active internal budget surface before renaming/removal: config/export/local names, prompts, limit helpers, stats, stderr/transcripts, critic warnings, failure/coverage schema, benchmarks, tests, docs, and `CEREBRAS_EXPLORER_TURN_MULTIPLIER|MAX_EXTRA_TURNS|MAX_COMPACTIONS`.
7. Preserve the raw evaluation artifacts outside the normal response so later implementation can be compared without trusting model self-reports.

**Exit gate**: every previously observed false-complete mode has a failing regression or a documented independently checked live case.

### Phase 1 — Introduce the audited task contract, coverage ledger, and safety limits

1. Add strict internal schemas for a planner proposal, audited task plan, capability manifest, goal-audit verdict, required sub-goal, claim candidate, evidence reference, semantic verdict, absence certificate, safety-limit observation, and coverage gap.
2. Add one initial planner call that creates a proposed sub-goal for every explicit requested part while preserving comparisons, boundaries, constraints, and distinctions. Each proposal includes validated request/wrapper origin references and an independently observable proof condition. The ledger has no semantic cap; execution may process large ledgers in internal batches of at most 12.
3. Run deterministic goal checks followed by an isolated goal auditor that sees the original request, hard scope, wrapper seed, fixed read-only capability manifest, and proposed goals only. It classifies ready, duplicate, decomposable, untraceable, scope/capability/external-state/input/contradiction/unverifiable outcomes without confidence scores.
4. Permit one corrected planner pass only for missing request parts, goals requiring decomposition, or same-type goals whose auditor-confirmed origin signature strictly contains a sibling signature. Origin refinement produces exactly one uniquely reconciled same-type descendant per affected obligation; it does not add another planning round. Re-audit once. Reject/log planner inventions without blocking; retain user-required blockers as terminal required gaps. Materialize every remaining uncovered, undecomposable, or still-ambiguous requested part as a blocked `planning_incomplete` required goal so it participates in state reduction rather than remaining a free-floating diagnostic.
5. Have the planner assign each ready sub-goal a language-independent claim type; runtime derives the fixed proof policy for positive fact, bounded absence, deterministic count, ordered flow, symbol definition, bounded symbol-usage cross-check, change impact, comparison/policy divergence, or claim verification. Definition and usage are separate types so one cannot accidentally close the other. Do not depend on English negative-keyword regexes or accept model-authored policy overrides.
6. Replace the structured runtime's `DEEP_RUNTIME_CONFIG`/`getBudgetConfig`/`budgetConfig` and generic budget stop state with one unlabeled runtime configuration plus exact safety-limit observations. Rename result-character “budgets” to limits and remove the `deep` prompt label. A valid partial limit hit cannot prove sufficiency or become failure by itself; an unrecovered invalid required control response remains a distinct execution fault.
7. Track tool observations, truncation, denied/out-of-scope omissions, relevant enumeration boundaries, safety limits, and evidence relationships by sub-goal. Fix the structured path so truncation and omitted-out-of-scope facts affect completion, not only report-mode diagnostics.
8. Keep proposed/rejected/audited goals and ledger transitions in redacted transcripts/direct-runtime results only.

**Exit gate**: pure tests prove that evidence count alone can never complete a task, every explicit request part reaches an audited required goal or blocker, rejected planner goals cannot block completion, and the structured runtime has no budget-derived completion branch.

### Phase 2 — Add semantic verification and fail-closed completion

1. Change structured synthesis to emit atomic claims linked to sub-goal ids and evidence ids rather than treating `directAnswer` plus line coverage as the trust source.
2. Retain the deterministic critic for path/range/source-integrity checks and rebuild snippets from the repository as today.
3. Run an isolated semantic verifier with only the original request, sub-goal plan, candidate claims, exact rebuilt snippets/git observations, and bounded search certificates. It does not see the exploratory prose or self-confidence. Planner, goal-auditor, and verifier prompts treat all repository text, docs, tests, fixtures, comments, paths, and git messages as untrusted data that cannot alter system instructions.
4. Accept only claims whose cited contents entail the claim and whose proof policy passes. Unsupported, contradictory, or over-generalized claims are dropped; the corresponding sub-goal becomes a gap rather than being rewritten into a new unverified claim.
5. Treat verifier-discovered `uncoveredRequestParts` as untrusted goal proposals. Require original-request/wrapper origin references and pass them through the same deterministic and isolated goal audit before registration. Only audited `ready` goals may enter the remaining repair round; blockers become required gaps and inventions are discarded/logged.
6. Permit one internal repair round for all feasible evidence gaps that share one narrow query or fit a small parallel targeted batch. Scope/capability/live-state/input/contradiction/unverifiable/planning blockers never enter repair. After repair, reopen and re-run grounding/semantic verification for every surfaced claim and required goal so new counterevidence cannot leave stale supported claims. Do not re-plan or expose/configure this round publicly.
7. Distinguish candidate contradiction from goal resolution: a sufficiently evidenced atomic refutation sets the goal `supported/resolution=refuted`; an unsupported or merely contradicted positive candidate remains a gap.
8. Apply deterministic precedence: invalid invocation/cancel/provider/tool/verifier/internal fatal fault; then any valid blocked or unsupported required sub-goal; then parent target verification; then complete. Rejected planner goals are outside reduction. A verifier failure or a provider output cap leaving required control JSON invalid fails closed.
9. Preserve supported claims when valid partial search/tool truncation or a fixed context/turn limit affects only another goal; mark the affected goal `incomplete` with the exact limit reason. If every requested goal is blocked, return `incomplete` without an invented answer or pointless repair.

**Exit gate**: known-answer fixtures have zero unsupported claims and zero unresolved-sub-goal `complete` results.

### Phase 3 — Replace the parent handoff with schema v3

1. Replace `status.confidence`, `status.verification`, `status.complete`, `status.warnings`, `nextAction`, `evidenceQuality`, `searchCoverage`, `critic`, `discoveredPaths`, and always-present empty arrays with one `state` and conditionally present action data. Remove `budget_exhausted` and `stoppedByBudget` from the public contract; an affected fixed ceiling becomes an `incomplete` `safety_limit_reached` gap, never a parent choice.
2. Use exactly four parent states: `complete`, `verify_targets`, `incomplete`, and `failed`. The mapping is defined in [parent-handoff-v3.md](./contracts/parent-handoff-v3.md).
3. Surface `directAnswer` only for supported claims (or one failed-state message); omit it for an all-blocked `incomplete` result. Surface targets only when the parent must read/edit/verify them. Surface the smallest evidence set that covers accepted claims; deduplicate paths/reasons and bound snippets to the exact useful lines.
4. For certified negative claims, return a compact absence evidence item naming the inspected boundary and searches. Uncertified absence becomes a gap.
5. Move detailed operational data out of MCP `structuredContent` and formatted text. Direct runtime and JSONL transcripts retain stats, full ledger, critic/verifier detail, candidates, and usage for tests/operators. Avoid returning `_meta.ops` diagnostics to the parent by default.
6. Make `content[0].text` a concise rendering of the same v3 facts, not a second confidence/coverage report.
7. Define one discriminated incomplete `followUp`: a schema-valid public tool action, one focused `ask_user` question, or one minimal `external_verification` requirement. Never issue a tool retry for a goal already known to be infeasible, and after repair never repeat the same normalized tool/action for the same gap unless materially new input/authority/evidence is required.

**Exit gate**: schema contract tests pass; successful payloads contain no irrelevant/empty fields; median payload is at least 40% smaller without losing the parent's required next action.

### Phase 4 — Reduce the public surface from eight to six

1. Retain `explore_repo`, `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, and `collect_evidence`, each with the distinct proof policy in [public-tool-surface.md](./contracts/public-tool-surface.md).
2. Remove `review_change_context`. Git/change-history questions continue through `explore_repo`, which already supports git tools and automatic task strategy. Delete the wrapper's orphaned internal `change_review` taskMode while retaining automatic git-intent classification; do not retain an alias.
3. Remove the public Markdown `explore` tool. Parent agents can present the concise structured answer themselves. After removing server call sites, delete report-only runtime/prompt/critic/schema/test code that has no remaining structured-path consumer; retain shared compaction or result-limit helpers only when still referenced.
4. Remove the public `hints.strategy` choice from `explore_repo`; automatic strategy detection and wrapper-owned internal modes remain implementation details. Preserve `scope` and known anchors because they are task facts, not effort controls.
5. Audit and migrate every report-only surface: `package.json` `benchmark:evidence`; `benchmarks/evidence-preservation.json`; `scripts/integration-test.mjs`; `tests/free-explore.test.mjs`; report blocks in audit-remediation, integration-script, benchmark-evaluator, regression, security/redact, critic, runtime, and MCP-server tests; `TESTING.md`; and report wording in transcript/config modules. Retarget the adoption `buildReportCritic` trace case to a structured-path symbol that remains after deletion.
6. Preserve valuable guarantees by migration rather than deletion: intermediate-draft rejection becomes structured cancellation/stale-answer coverage; untrusted-content prompt checks move to planner/verifier prompts; report redaction becomes schema-v3 text/structured parity redaction; evidence-preservation cases become structured semantic/source-integrity cases.
7. Remove both tool names from active retry enums, server instructions, provenance, allowlists, integration configs, examples, and normal docs. Retain/add their names only in CHANGELOG migration history and negative regression guards.
8. Document that removing public `explore` also removes the direct-runtime `freeExploreRepository` and `ExplorerRuntime.freeExplore` APIs; direct callers migrate to `exploreRepository`/`ExplorerRuntime.explore`.
9. Remove report effort controls `CEREBRAS_EXPLORER_TURN_MULTIPLIER`, `CEREBRAS_EXPLORER_MAX_EXTRA_TURNS`, and `CEREBRAS_EXPLORER_MAX_COMPACTIONS`; do not replace them. Remove/rename remaining active `budget` config, prompt, stats, critic, benchmark, stderr/transcript, comments, and test terminology to exact safety/result/context-limit terms.
10. Add both known-name and case-insensitive general-identifier guards that prevent removed tool names, public strategy controls, any active `budget*` identifier/label/object, budget effort envvars, and budget-derived completion/failure branches from reappearing. Allow `budget` text only in explicit migration/history documents and the narrow negative assertions that enforce this rule.

**Exit gate**: `tools/list` is exactly the six-tool contract under every legacy environment-variable scenario, and each retained tool passes its distinct acceptance case.

### Phase 5 — Trust evaluation, release synchronization, and rollout

1. Extend the evaluator with independently checked goal-audit/claim/sub-goal/state/absence-boundary checks; do not score completion from keyword coverage, planner/auditor self-report, or model `groundingStatus` alone.
2. Run the cross-repository trust suite at least three times per repeatability case. Completion state must agree even if optional evidence differs. Commit only portable fixture/expectation manifests; keep machine-specific repository path mapping in an ignored local file or command arguments.
3. Add a runnable parent-observation harness. Eligible denominator: non-fault known-answer cases expected to end `complete` or `verify_targets`. Broad native re-search means an unscoped/repository-wide grep/glob/walk or reading uncited paths before using an allowed follow-up; cited-target reads and exact checks inside cited paths are allowed.
4. Run scope, tool-result truncation, out-of-scope omission, request-id-zero cancellation, provider failure, redaction, deny-list, and zero-dependency regressions.
5. Synchronize schema/docs/examples/integrations, bump the pre-1.0 minor version, and document the v2→v3 migration and two removed tools in `CHANGELOG.md`.
6. Run `npm test`, live `node scripts/integration-test.mjs`, the adoption suite, and the new trust suite. Record token and latency deltas without failing the release on cost.

**Exit gate**: all SC-001 through SC-016 criteria pass and no plan task is left open when the implementation plan is closed/moved according to repository policy.

## Test Strategy

- **Pure state tests**: every goal-audit verdict/sub-goal/proof-policy/safety-limit/fault combination has deterministic state output; precedence cannot be changed accidentally by evidence count.
- **Mock provider tests**: invented/duplicate/decomposable/missing/blocked goals, late verifier-invented goals, one revision and remaining planning defect, supported refutation vs insufficient refutation, invalid audit, semantic mismatch, repair counterevidence reopening prior claims, no equivalent post-repair follow-up, current-vs-historical/source-role confusion, prompt injection in repository content, contradiction, verifier failure, cancellation, valid partial limit, and invalid output-cap failure.
- **Repository-tool tests**: scope, git scope filtering, truncation metadata, enumeration completeness, denied-path behavior, and request-id-zero cancellation.
- **Contract tests**: exact six-tool registry, schema v3 required/optional fields, omitted empty fields, retry vocabulary, concise text parity, and absence evidence shape.
- **Independent evidence tests**: snippets/ranges are reread from the pinned working tree; expected sub-goals, allowed/forbidden claims, anchors, boundaries, and state are maintained separately from explorer/verifier output.
- **Live API tests**: multiple repositories/languages, at least three repeats for variance-sensitive cases, with full transcripts and operator metrics retained.
- **Release guards**: README/DESIGN/examples/integration manifests/AGENTS/CHANGELOG synchronized; `npm test` zero failures; `package.json` dependency sections remain absent/empty.

## Rollout and Compatibility

- Treat schema v3 and the six-tool registry as one pre-1.0 breaking release. Do not ship a hybrid v2/v3 response or compatibility aliases.
- Provide a short migration table: old overlapping fields → `state`/conditional `gaps`/`followUp`/`failure`; old budget stop/config terminology → fixed safety-limit diagnostics; `review_change_context` → `explore_repo`; Markdown `explore` → `explore_repo` plus parent presentation; public `hints.strategy` → automatic internal selection.
- Keep no environment toggle for the old surface. A toggle would preserve cognitive load and double the test matrix.
- If live known-answer evaluation does not meet the trust gates, keep the feature unreleased; do not weaken completion rules to preserve old pass rates.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| The planner misses an explicit request part | The isolated verifier compares the original request with the plan; uncovered parts become gaps and block completion. Known-answer multi-part fixtures guard common misses. |
| The planner invents a plausible but unrequested goal | Exact origin references plus an isolated goal audit reject it; rejected proposals stay in logs and cannot participate in completion. |
| A broad same-type goal can be reassigned to a narrower sibling | Seal each audited acceptance core, revise one-way strict origin containment once, require one unique corrected goal per refinement obligation, and fail closed if ambiguity remains. |
| The goal auditor wrongly calls a hard goal impossible | Blocker verdicts require a concrete scope/capability/input/observability conflict; uncertainty stays ready. Independent categorical fixtures cover every blocker. |
| An impossible goal causes repeated work | Goal-audit blockers skip exploration/repair; planning revises once and evidence repair runs once. |
| The semantic verifier is another model and can be wrong | It sees only bounded claims and reconstructed evidence, uses deterministic settings, cannot promote unreferenced evidence, and is backed by known-answer evaluation. Failure is non-complete. |
| Negative claims become too difficult to complete | Permit precisely bounded statements with a compact absence certificate; only unqualified repository-wide absence requires complete relevant coverage. |
| Extra model passes increase latency | Cost/latency are observable, not acceptance gates; allow one initial plan/audit, at most one corrected plan/audit, one batched semantic verification plus at most one focused corroboration per supported comparison spanning two or more current source paths, and at most one repair/reverification cycle. Each verifier pass may submit at most one bounded late-goal audit batch, never a new planner or repair loop. |
| Removing budgets accidentally removes necessary protection | Keep fixed, specifically named context/output/walk/result/turn safety limits and test that each produces an honest affected-goal gap rather than runaway execution. |
| Removing report mode deletes shared safeguards | Audit references before deletion and retain any compaction/truncation utility still used by structured exploration. Tests run before and after removal. |
| Six tools can still feel overlapping | Retained tools have distinct proof policies and task examples; `explore_repo` is the explicit fallback. No new aliases are added. |
| Existing consumers depend on v2 fields/tools | Ship as an explicit pre-1.0 minor breaking release with synchronized integration configs and no ambiguous compatibility period. |

## Complexity Tracking

| Current invariant intentionally superseded | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Fixed eight-tool public surface | User explicitly prioritizes low selection burden; `review_change_context` and Markdown `explore` lack enough distinct parent-agent value | Keeping inert aliases leaves the same cognitive load and maintenance surface |
| Preserve six overlapping v2 control-plane structures | They duplicate trust/action information and have already produced misleading `complete` results | Merely changing wording leaves parents to reconcile contradictory fields and does not reduce payload |
