# Tasks: Trustworthy, Quiet Explorer

**Input**: Design documents from `/specs/028-trustworthy-explorer/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required. Phase 1 uses green characterization tests whose independent oracle detects the pinned current failures. In each implementation phase, write the new behavior assertions first, confirm they fail for the intended reason, then implement the phase. Run `npm test` before every commit.

**Organization**: Tasks are grouped by user story. The two P1 stories are ordered by dependency: US3 establishes valid goals before US1 can make trustworthy completion decisions.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel after the phase prerequisites are complete because it owns different files or an isolated test surface.
- **[Story]**: Maps the task to the user story in `spec.md`.
- Every task names its exact file or directory scope.

---

## Phase 1: Setup — Freeze the Evidence-Backed Baseline

**Purpose**: Preserve known failures and an independent oracle before changing runtime behavior.

- [x] T001 Create `benchmarks/trust-known-answer.json` with pinned fixture/repository hashes, requested sub-goals, allowed and forbidden claims, evidence anchors, boundaries, expected states, repeat counts, and schema-v2 parent-payload baselines for every Phase 0 case in `specs/028-trustworthy-explorer/plan.md`
- [x] T002 Create deterministic minimal repositories and provider-response fixtures for semantic mismatch, multi-part omission, route-policy divergence, scoped/truncated search, cancellation, provider failure, goal invention, infeasible goals, and repair counterevidence under `fixtures/trust-known-answer/`
- [x] T003 Add manifest/fixture integrity tests that reject missing hashes, self-authored explorer oracles, invalid boundaries, missing expected goals, and unparseable cases in `tests/benchmark-evaluator.test.mjs`
- [x] T004 Pin the observed false-complete outputs and request-id-zero cancellation defect as immutable expected-failure records under `fixtures/trust-known-answer/baseline-results/`, and add green assertions that the independent oracle detects each trust failure in `tests/benchmark-evaluator.test.mjs`

**Checkpoint**: Every known trust failure is reproducible from a pinned fixture or independently checked case before production logic changes.

---

## Phase 2: Foundational — Internal Trust Types, Observations, and Safety Limits

**Purpose**: Build the shared deterministic primitives required by every user story.

**⚠️ CRITICAL**: No user-story implementation starts until this phase passes its pure and mock tests.

- [x] T005 [P] Add failing pure tests for TaskContract, RequiredSubgoal, AtomicClaim, CoverageGap, SafetyLimit, legal state transitions, runtime-owned priority, and fatal-fault precedence in `tests/coverage.test.mjs`
- [x] T006 [P] Add failing strict-schema tests for internal plan, audit, claim, verdict, absence-certificate, and safety-limit objects with `additionalProperties:false` in `tests/schemas.test.mjs`
- [x] T007 [P] Add failing repository observation tests for boundary, tool/context truncation, denied paths, out-of-scope omissions, errors, and runtime-computed enumeration completeness in `tests/repo-tools.test.mjs`
- [x] T008 [P] Add failing tests that distinguish fixed safety/context limits from effort policy and migrate structured-path config/metrics away from budget-derived completion in `tests/project-config.test.mjs`, `tests/runtime.mock.test.mjs`, and `tests/benchmark-transcript-metrics.test.mjs`
- [x] T009 Implement the pure trust-plane entities, legal transitions, deterministic priority, action fingerprinting, and state-reduction skeleton in `src/explorer/coverage.mjs`
- [x] T010 Implement reusable strict internal schema definitions and validators for the trust-plane entities in `src/explorer/schemas.mjs`
- [x] T011 [P] Normalize source/git/search observations and preserve scope, omission, denial, truncation, error, and enumeration facts in `src/explorer/repo-tools.mjs`
- [x] T012 After T011, replace the structured path's labeled deep/budget configuration with one unlabeled fixed runtime configuration and exact limit names in `src/explorer/config.mjs`, `src/explorer/prompt.mjs`, and `src/explorer/repo-tools.mjs`
- [x] T013 Integrate safety-limit observations and valid-partial-limit versus invalid-control-output fault precedence in `src/explorer/runtime.mjs`, `src/explorer/critic.mjs`, and `src/explorer/coverage.mjs`
- [x] T014 Migrate structured-path operational events and record-only metrics to exact safety-limit terminology in `src/explorer/transcript.mjs`, `src/benchmark/transcript-metrics.mjs`, and `scripts/run-benchmark.mjs`, then pass the Phase 2 tests and `npm test`

**Checkpoint**: Shared trust types are deterministic, observations retain all boundary facts, and no structured completion decision depends on a budget label or evidence count.

---

## Phase 3: User Story 3 — Valid Goals and Honest Blockers (Priority: P1) 🎯 MVP Foundation

**Goal**: Pursue only request-traceable, independently observable goals; discard invented goals and preserve valid blockers without futile work.

**Independent Test**: With a mock provider and fixture repository, verify all audit verdicts, at most one plan revision, materialized second-pass planning defects, blocked-goal repair exclusion, supported false-premise feasibility, and zero rejected-goal leakage into the required ledger or parent-facing projection.

### Tests for User Story 3

- [x] T015 [P] [US3] Add the full deterministic goal-audit matrix for valid offsets, wrapper seeds, duplicates, circular proof conditions, decomposition, missing request parts, every blocker category, difficulty-not-infeasibility, and `planning_incomplete` materialization in `tests/coverage.test.mjs`
- [x] T016 [P] [US3] Add strict planner/auditor schema tests for origin references, claim-type/proof-policy combinations, categorical verdicts, and runtime-owned revision decisions in `tests/schemas.test.mjs`
- [x] T017 [P] [US3] Add mock-provider tests for initial plan/audit, one corrected plan/audit, malformed audit failure, all-blocked early completion, cancellation at each new stage, and audited late-goal batching in `tests/runtime.mock.test.mjs`
- [x] T018 [P] [US3] Add prompt-boundary regressions proving repository comments, docs, tests, fixtures, paths, and git messages cannot alter planner/auditor instructions or proof policy in `tests/regression.test.mjs`

### Implementation for User Story 3

- [x] T019 [US3] Implement isolated planner, corrected-planner, and goal-auditor prompt builders with fixed capability/wrapper inputs and untrusted-content boundaries in `src/explorer/prompt.mjs`
- [x] T020 [US3] Implement planner proposal, goal-auditor response, and late-uncovered proposal schemas plus request-origin validation in `src/explorer/schemas.mjs`
- [x] T021 [US3] Implement deterministic preflight, duplicate merge, traceability checks, blocker reduction, repair eligibility, and `planning_incomplete` materialization in `src/explorer/coverage.mjs`
- [x] T022 [US3] Orchestrate initial planning, isolated audit, one bounded revision, all-blocked short-circuit, and audited late-goal helper calls in `src/explorer/runtime.mjs`
- [x] T023 [US3] Record redacted `plan_proposed`, `goal_audit`, `plan_revised`, `goal_rejected`, and blocker transitions in `src/explorer/transcript.mjs`, then run the US3 independent test set and `npm test`

**Checkpoint**: US3 works through the direct runtime without exposing internal goal state; no untraceable model-proposed goal can block completion.

---

## Phase 4: User Story 1 — Complete or Honest Answers (Priority: P1) 🎯 MVP

**Goal**: Accept only semantically supported atomic claims and return complete only when every valid required goal has a supported resolution.

**Independent Test**: Run the multi-part, semantic-mismatch, route-divergence, refutation, repair, cancellation, and failure fixtures; zero unresolved goal may produce complete and zero accepted claim may contradict its rebuilt evidence.

### Tests for User Story 1

- [x] T024 [P] [US1] Add failing atomic-claim, supported/refuted resolution, evidence-link, cross-boundary rejection, request-coverage, and deterministic state-reduction tests in `tests/coverage.test.mjs`
- [x] T025 [P] [US1] Add failing source-integrity, source-role, temporal-role, semantic-mismatch, and cross-file generalization tests in `tests/critic.test.mjs`
- [x] T026 [P] [US1] Add mock-provider tests for isolated semantic verification, verifier-invented goals, one repair round, post-repair reopening of prior claims, traceable and untraceable post-repair uncovered goals with audit/leakage/terminal-state/no-second-repair assertions, no equivalent repeated follow-up, valid partial limits, invalid control JSON, and provider/verifier faults in `tests/runtime.mock.test.mjs`
- [x] T027 [P] [US1] Add cancellation regressions for planner, auditor, explorer, verifier, and repair stages plus JSON-RPC request id `0` in `tests/mcp-server.test.mjs` and `tests/jsonrpc-stdio.test.mjs`

### Implementation for User Story 1

- [x] T028 [US1] Implement atomic-claim synthesis and isolated semantic-verifier schemas/prompts without prose rewriting or model-authored evidence facts in `src/explorer/schemas.mjs` and `src/explorer/prompt.mjs`
- [x] T029 [US1] Build the runtime observation ledger, rebuilt source/git evidence, and current/historical source-role classification in `src/explorer/runtime.mjs`, `src/explorer/critic.mjs`, and `src/explorer/repo-tools.mjs`
- [x] T030 [US1] Implement isolated semantic-verifier execution, claim entailment filtering, supported refutation, and claim-to-goal resolution in `src/explorer/runtime.mjs` and `src/explorer/coverage.mjs`
- [x] T031 [US1] Pass every verifier `uncoveredRequestParts` proposal, including post-repair proposals, through the same deterministic and isolated goal audit before registration, with no rejected-goal leakage or additional planner revision, in `src/explorer/runtime.mjs` and `src/explorer/coverage.mjs`
- [x] T032 [US1] Implement one feasible-gap repair round, normalized attempted-action fingerprints, full post-repair claim reopening/reverification, terminal gaps for newly valid post-repair goals, and no second repair or repeated parent action in `src/explorer/runtime.mjs` and `src/explorer/coverage.mjs`
- [x] T033 [US1] Implement fatal-fault precedence, invalid-control-output handling, stale-answer suppression, and request-id-zero cancellation tracking in `src/explorer/runtime.mjs`, `src/mcp/server.mjs`, and `src/mcp/jsonrpc-stdio.mjs`
- [x] T034 [US1] Record redacted claim, verdict, repair, safety-limit, final-reduction, and usage events without copying unverified prose in `src/explorer/transcript.mjs`
- [x] T035 [US1] Add the US1 known-answer cases and expected state/claim oracles to `benchmarks/trust-known-answer.json`, run the independent US1 fixture subset three times, and pass `npm test`

**Checkpoint**: Foundational + US3 + US1 is the development MVP. It is testable through the direct runtime but is not releasable until the public v3 migration is complete.

---

## Phase 5: User Story 2 — Quiet Parent Handoff (Priority: P2)

**Goal**: Give the parent one state and only the answer, proof, gap, or recovery data that changes its next action.

**Independent Test**: Validate complete, verify-targets, partial-incomplete, all-blocked-incomplete, and failed payloads against schema v3; no forbidden diagnostic or empty optional field may appear in text, `structuredContent`, or default `_meta`.

### Tests for User Story 2

- [x] T036 [P] [US2] Add exhaustive schema-v3 state/conditional-field/additional-properties tests and v2-field rejection tests in `tests/schemas.test.mjs`
- [x] T037 [P] [US2] Add MCP tests for concise text parity, minimal structured output, deterministic `verify_targets`, exact `{type, tool, arguments}` follow-up/retry unions, rejection of flattened action keys, `explore_repo` anchors under `arguments.hints.files`, all-blocked omission, and default `_meta` quietness in `tests/mcp-server.test.mjs`
- [x] T038 [P] [US2] Add redaction parity tests for v3 source/git/absence evidence, gaps, failures, text, structured output, and operational logs in `tests/security/redact.test.mjs`
- [x] T039 [P] [US2] Add parent-visible `content + structuredContent` UTF-8 payload-size and claim-cover-minimization tests in `tests/effect-metrics.test.mjs`

### Implementation for User Story 2

- [x] T040 [US2] Replace the public output schema with the exact v3 discriminated state, target, evidence, gap, failure, and `{type, tool, arguments}` follow-up/retry contracts whose arguments validate against the selected public tool schema in `src/explorer/schemas.mjs`
- [x] T041 [US2] Implement minimal claim-cover evidence selection, deterministic parent action, optional-field omission, and v3 handoff assembly in `src/explorer/coverage.mjs` and `src/explorer/runtime.mjs`
- [x] T042 [US2] Project only v3 facts into MCP text and `structuredContent`, validate tool/retry arguments, and remove default detailed `_meta.ops` from `src/mcp/server.mjs`
- [x] T043 [US2] Preserve full redacted direct-runtime/transcript diagnostics and update parent-payload measurement in `src/explorer/transcript.mjs` and `src/benchmark/effect-metrics.mjs`
- [x] T044 [US2] Replace the canonical response and live smoke assertions with v3 complete/incomplete/failed examples in `examples/expected-response.json`, `examples/direct-runtime.mjs`, and `scripts/integration-test.mjs`, then run the US2 contract tests and `npm test`

**Checkpoint**: The parent receives one unambiguous state and no internal planning, confidence, search, critic, usage, or empty-field noise.

---

## Phase 6: User Story 4 — Small, Distinct Tool Surface (Priority: P3)

**Goal**: Expose exactly six distinct intents, remove presentation/review overlap, remove strategy and budget effort choices, and preserve only shared safeguards.

**Independent Test**: Under normal and every legacy environment-variable combination, `tools/list` is exactly the six-tool registry, removed APIs are unavailable, retained wrappers pass their distinct intent tests, and no active `budget*` identifier or effort control remains outside explicit migration/negative-guard allowlists.

### Tests for User Story 4

- [x] T045 [P] [US4] Add six-tool registry, stable-order, provenance, concise dispatch-description, removed-name, `hints.strategy` rejection, and legacy-env invariance tests in `tests/mcp-server.test.mjs` and `tests/schemas.test.mjs`
- [x] T046 [P] [US4] Add direct-runtime export/removal and migrated cancellation, intermediate-draft, report-redaction, and untrusted-content safeguard tests in `tests/free-explore.test.mjs`, `tests/regression.test.mjs`, and `tests/security/redact.test.mjs`
- [x] T047 [P] [US4] Add known-name and case-insensitive general `budget*` active-surface guards with narrow migration/history/negative-test allowlists in `tests/integrations.test.mjs` and `tests/project-config.test.mjs`

### Implementation for User Story 4

- [x] T048 [US4] Remove `review_change_context`, its retry/provenance/schema surfaces, and the orphaned `change_review` task mode while retaining automatic git-intent classification in `src/mcp/server.mjs`, `src/explorer/runtime.mjs`, and `src/explorer/schemas.mjs`
- [x] T049 [US4] Remove the public Markdown `explore` handler plus `freeExploreRepository` and `ExplorerRuntime.freeExplore` exports without compatibility aliases in `src/mcp/server.mjs` and `src/explorer/runtime.mjs`
- [x] T050 [US4] Delete report-only loop, prompt, citation extraction, critic, schema, recovery code, transcript example, and config wording after reference analysis while preserving structured-path compaction/truncation safeguards in `src/explorer/runtime.mjs`, `src/explorer/prompt.mjs`, `src/explorer/critic.mjs`, `src/explorer/schemas.mjs`, `src/explorer/transcript.mjs`, and `src/explorer/config.mjs`
- [x] T051 [US4] Migrate valuable report tests to structured planner/verifier, cancellation, redaction, and source-integrity coverage and remove orphaned report assertions in `tests/free-explore.test.mjs`, `tests/audit-remediation.test.mjs`, `tests/integration-script.test.mjs`, `tests/benchmark-evaluator.test.mjs`, `tests/regression.test.mjs`, `tests/critic.test.mjs`, and `tests/runtime.mock.test.mjs`
- [x] T052 [US4] Remove `benchmark:evidence` and `benchmarks/evidence-preservation.json`, migrate its trust cases and the `buildReportCritic` adoption case to structured equivalents in `package.json`, `benchmarks/adoption.json`, `benchmarks/trust-known-answer.json`, and `tests/benchmark-evaluator.test.mjs`
- [x] T053 [US4] Remove public `hints.strategy` while preserving scope and known file/symbol/text anchors in `src/explorer/schemas.mjs`, `src/mcp/server.mjs`, and `src/explorer/prompt.mjs`
- [x] T054 [US4] Remove report effort envvars and every remaining active budget label/object/branch/metric/comment, replacing only physically necessary caps with exact safety/result/context-limit names in `src/explorer/config.mjs`, `src/explorer/runtime.mjs`, `src/explorer/repo-tools.mjs`, `src/explorer/critic.mjs`, `src/explorer/transcript.mjs`, `src/benchmark/transcript-metrics.mjs`, and `scripts/run-benchmark.mjs`
- [x] T055 [US4] Rewrite MCP initialization instructions and each retained tool description to one positive trigger plus one boundary, and keep provenance/retry vocabularies set-equal to the six tools in `src/mcp/server.mjs` and `src/explorer/schemas.mjs`
- [ ] T056 [US4] Synchronize the six-tool/v3/no-effort contract and removed direct-runtime API migration across `README.md`, `DESIGN.md`, `TESTING.md`, `AGENTS.md`, `examples/`, `integrations/`, `specs/028-trustworthy-explorer/contracts/`, and `specs/028-trustworthy-explorer/quickstart.md`, including executable Node option order and PowerShell search commands, then run the US4 tests and `npm test`

**Checkpoint**: The public surface is exactly six tools with no aliases, report backend, public strategy selector, or active internal budget abstraction.

---

## Phase 7: User Story 5 — Trustworthy Negative and Critical Claims (Priority: P4)

**Goal**: Surface negative, exhaustive, count, authorization, and impact conclusions only within a runtime-certified boundary and appropriate source/temporal role.

**Independent Test**: A complete bounded search may support a qualified absence/refutation; truncation, omitted/denied paths, tool errors, incomplete enumeration, dynamic ambiguity, or wrong source role must keep the affected claim bounded or incomplete.

### Tests for User Story 5

- [ ] T057 [P] [US5] Add absence-certificate, deterministic count, uniqueness/exhaustiveness, source-role, temporal-role, and supported-refutation proof-policy tests in `tests/coverage.test.mjs` and `tests/critic.test.mjs`
- [ ] T058 [P] [US5] Add tool-specific enumeration-completeness tests for grep/find/walk, symbol/reference, macro, and scoped git operations with truncation, errors, denial, and out-of-scope omissions in `tests/repo-tools.test.mjs`
- [ ] T059 [P] [US5] Add runtime tests for scoped absence, repository-wide overclaim rejection, all-usages truncation, route-policy divergence, current-versus-history evidence, and impact-category gaps in `tests/runtime.mock.test.mjs`

### Implementation for User Story 5

- [ ] T060 [US5] Compute tool-specific enumeration completeness and normalized search boundaries from actual traversal/result metadata in `src/explorer/repo-tools.mjs`
- [ ] T061 [US5] Implement absence certificates, deterministic counts, strong negative/exhaustive gates, symbol definition/usage separation, flow transitions, impact categories, and comparison policy in `src/explorer/coverage.mjs` and `src/explorer/critic.mjs`
- [ ] T062 [US5] Integrate certified bounded negative/refutation claims and compact public absence evidence while turning uncertified claims into gaps in `src/explorer/runtime.mjs` and `src/explorer/schemas.mjs`
- [ ] T063 [US5] Add scoped-negative, truncated-all-usages, route-divergence, count/range, and historical-source cases—including exact path/range-free `git_commit` projection without fabricated locations—to `benchmarks/trust-known-answer.json`, run the US5 independent fixture subset, and pass `npm test`

**Checkpoint**: No negative or critical conclusion is stronger than its inspected boundary, source role, temporal role, and enumeration facts.

---

## Phase 8: Polish, Independent Evaluation, and Release

**Purpose**: Prove the feature independently, synchronize the breaking release, and close the plan without weakening gates.

- [ ] T064 Extend independent oracle evaluation for goal audit, required coverage, semantic support, state, absence boundary, source/temporal role, rejected-goal leakage, and repeatability in `src/benchmark/evaluator.mjs` and `tests/benchmark-evaluator.test.mjs`
- [ ] T065 [P] Implement the pinned fixture/live repeat driver with logical repo ids, SHA/dirty hashes, redacted result paths, and record-only usage/latency in `scripts/run-trust-suite.mjs`
- [ ] T066 [P] Implement the parent-observation harness and fixed broad-native-research denominator/allowance metrics in `scripts/run-parent-observation.mjs`
- [ ] T067 Update payload, citation, target-read, wrapper-distinctness, safety-limit incidence, and parent-effect metrics without self-reported trust scoring in `src/benchmark/effect-metrics.mjs`, `src/benchmark/transcript-metrics.mjs`, `scripts/run-benchmark.mjs`, and `tests/effect-metrics.test.mjs`
- [ ] T068 Run the offline trust suite three times per repeatability case and the parent-observation harness, require every SC-001 through SC-016 offline gate plus one distinct proof-policy acceptance scenario for each retained wrapper, and record only portable results in `benchmarks/trust-known-answer.json`
- [ ] T069 Run live `scripts/integration-test.mjs` and `scripts/run-trust-suite.mjs` with `CEREBRAS_API_KEY`, `CEREBRAS_EXPLORER_LOG_PATH`, and an external logical repo map as specified in `specs/028-trustworthy-explorer/quickstart.md`; do not commit local absolute paths or transcripts
- [ ] T070 Bump the pre-1.0 minor version and synchronize the top release heading, v2-to-v3 migration, removed tools/APIs/envvars, install snippet, and all integration install refs in `package.json`, `CHANGELOG.md`, `README.md`, and `integrations/`
- [ ] T071 Run the full `specs/028-trustworthy-explorer/quickstart.md`, `npm test`, dependency/secret/scope/redaction/cancellation/stale-name guards, `git diff --check`, and schema/example validation; then mark every completed item in `specs/028-trustworthy-explorer/tasks.md` and close/move any implementation plan required by `AGENTS.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: No dependencies.
- **Phase 2 — Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 — US3 (P1)**: Depends on Phase 2; goal validity must exist before completion can be trustworthy.
- **Phase 4 — US1 (P1)**: Depends on US3 and the foundational trust plane.
- **Phase 5 — US2 (P2)**: Depends on US1 because v3 may expose only verified claim/gap state.
- **Phase 6 — US4 (P3)**: Depends on US2 so tool/API removal lands against the final v3 contract.
- **Phase 7 — US5 (P4)**: Depends on US1 and US2. It may be developed alongside US4 only with isolated ownership because both touch runtime/schema/test surfaces; sequential execution is safer.
- **Phase 8 — Polish/Release**: Depends on all selected user stories. The breaking release requires US1-US5 together; do not ship an intermediate hybrid.

### User Story Dependency Graph

```text
Setup -> Foundational -> US3 (valid goals) -> US1 (verified completion) -> US2 (quiet v3)
                                                                  |             |
                                                                  +--> US5 -----+
                                                                                |
                                                                  US2 -> US4 ---+
                                                                                v
                                                                       Evaluation/Release
```

### Within Each User Story

1. Add the story's tests and confirm they fail for the intended missing behavior.
2. Implement pure schemas/state/proof rules before orchestration.
3. Integrate runtime/provider stages before MCP projection.
4. Preserve transcript diagnostics while keeping parent output minimal.
5. Run the independent story test and `npm test` before proceeding.

### Parallel Opportunities

- T005-T008 can be authored in parallel after baseline fixtures exist.
- T011 can proceed alongside T009-T010 after the foundational contracts are fixed; T012 follows T011 because both modify `src/explorer/repo-tools.mjs`.
- T015-T018, T024-T027, T036-T039, T045-T047, and T057-T059 are independent test-file batches within their phases.
- T065 and T066 can run in parallel after the trust manifest/evaluator contract is stable.
- US4 and US5 are logically separable after US2, but both modify `runtime.mjs`/`schemas.mjs`; use separate worktrees and an explicit merge order or execute them sequentially.

---

## Parallel Examples

### User Story 3

```text
Task T015: Goal-audit state matrix in tests/coverage.test.mjs
Task T016: Planner/auditor schemas in tests/schemas.test.mjs
Task T017: Plan/audit orchestration in tests/runtime.mock.test.mjs
Task T018: Prompt-boundary regressions in tests/regression.test.mjs
```

### User Story 1

```text
Task T024: Claim/reduction tests in tests/coverage.test.mjs
Task T025: Source/temporal role tests in tests/critic.test.mjs
Task T026: Verifier/repair tests in tests/runtime.mock.test.mjs
Task T027: Cancellation tests in tests/mcp-server.test.mjs and tests/jsonrpc-stdio.test.mjs
```

### User Story 2

```text
Task T036: Public schema tests in tests/schemas.test.mjs
Task T037: MCP projection tests in tests/mcp-server.test.mjs
Task T038: Redaction parity tests in tests/security/redact.test.mjs
Task T039: Parent payload tests in tests/effect-metrics.test.mjs
```

### User Story 4

```text
Task T045: Six-tool registry tests in tests/mcp-server.test.mjs and tests/schemas.test.mjs
Task T046: Removed report/API safeguard tests in tests/index.test.mjs and report-related test files
Task T047: Active budget-surface guards in tests/integrations.test.mjs and tests/project-config.test.mjs
```

### User Story 5

```text
Task T057: Negative proof-policy tests in tests/coverage.test.mjs and tests/critic.test.mjs
Task T058: Enumeration tests in tests/repo-tools.test.mjs
Task T059: Negative/critical runtime tests in tests/runtime.mock.test.mjs
```

---

## Implementation Strategy

### Development MVP

1. Complete Phase 1 and Phase 2.
2. Complete US3 so only valid goals enter the ledger.
3. Complete US1 so every accepted claim and completion state is verified.
4. Stop and run the pinned direct-runtime known-answer subset three times.
5. Treat this as a development checkpoint only; do not release until v3 and the six-tool migration land.

### Incremental Delivery

1. Baseline + foundational trust plane.
2. US3 valid goals and blockers.
3. US1 semantic verification and bounded repair.
4. US2 quiet schema-v3 parent handoff.
5. US4 six-tool/no-budget surface and US5 negative proof gates.
6. Independent evaluation, live API verification, synchronized breaking release.

### Commit and Scope Discipline

- Keep each commit to one task or tightly coupled task group and run `npm test` before committing.
- Do not add runtime or dev dependencies.
- Do not add write/delete repository tools or weaken scope, deny-list, redaction, or cancellation.
- Do not ship compatibility aliases, feature flags, or a hybrid v2/v3 response.
- Preserve only migration/history and narrow negative-guard mentions of removed names or budget terminology.
- Do not edit unrelated pre-existing changes in the working tree.

---

## Notes

- `[P]` tasks are safe only after their phase prerequisites are complete.
- Tests precede implementation in every story phase.
- Cost/token/latency remain operational metrics, not release gates.
- Machine-specific repo maps, API transcripts, and absolute paths stay outside the checkout.
- The release requires every SC-001 through SC-016 gate; partial completion remains unreleased rather than weakening trust rules.
