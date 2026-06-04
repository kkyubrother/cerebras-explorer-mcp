# Feature Spec: prompt & contract hygiene for the 8-tool surface

**Spec**: 023-prompt-contract-hygiene | **Date**: 2026-05-31 | **Status**: implemented 2026-05-31; closure verified 2026-06-05 (`npm test` 411/0)

## Summary

Align the MCP tool descriptions and the internal explorer system prompts with what the
runtime and schemas actually do. No behavior change is intended — this is a *honesty/routing*
pass on the prompt surface. The work removes a tool-routing ambiguity (two tools both say
"Use first"), deletes references to a rejected input (`budget`), closes one retry-vocabulary
asymmetry (`explain_code_path` missing from the retry enum), reframes an over-broad READ-ONLY
clause so it no longer suppresses `role:edit` targets, adds a prompt-injection / untrusted-data
hard requirement to the live system prompts, and corrects two overstated descriptions
(`explore.thoroughness`, `repo_references` "all usages").

## Motivation

- The project thesis is **trust = context saving** ([[project-trust-as-context-saving]]).
  Every tool description and every hard requirement is a control signal the *parent* model
  routes on. When a description promises an affordance the runtime rejects (`budget`) or
  contradicts itself (`explore_repo` and `find_relevant_code` both "Use first"), the parent
  spends turns/tokens recovering — the opposite of the product's purpose.
- The findings originate from an external prompt-quality evaluation, then were cross-verified
  against the **live v0.7.0 tree** by a 13-agent verification pass (10 per-issue verifiers +
  3 audits). Every item below carries a confirmed `file:line` and a known test-impact, so the
  spec records *real* drift rather than prose opinion ([[feedback-stale-plan-disposition]]).
- The verification both **confirmed** the eval (line numbers exact, 9 of 10 claims real) and
  **corrected** it on four points, all reflected in the FRs: `budget` is hard-rejected (not
  silently ignored); the dead V1 prompt builder must not be edited; the retry vocabulary is
  duplicated across two files; and several additional routing collisions exist that the eval
  missed.
- Severity is deliberately recorded as **low–medium, never high**: the 8 tools share one
  output schema and the wrappers delegate to `explore_repo`, so a mis-route costs
  specificity/tokens, not a wrong or failed response. This is hygiene, not a defect fix.

## Functional Requirements

### Routing & contract integrity

- **FR-001** (explore_repo "Use first" collision): `explore_repo`'s description
  (`src/mcp/server.mjs:39-44`) must no longer open with "Use first". It is recast as the
  **general fallback** for read-only exploration when no purpose-specific tool fits or when
  programmable structured JSON across files is needed, and it explicitly prefers the
  specialized tools when intent matches. `find_relevant_code` (`:56`) remains the single
  "Use first" locator (it is already ordered first in `buildToolList`, with `explore_repo`
  last). The pinning test `tests/mcp-server.test.mjs:275` is updated to the new opener; the
  `doesNotMatch /sessionId/` guard at `:278` is preserved.
- **FR-002** (`budget` phantom affordance): the trailing sentence of `explore_repo`'s
  description (`src/mcp/server.mjs:44`) drops the word `budget`. `budget` is **not** a public
  input (`EXPLORE_REPO_INPUT_SCHEMA` has only `task`, `repo_root`, `scope`, `hints`,
  `language`, with `additionalProperties:false`) and is **actively rejected** by
  `validateExploreRepoArgs` (`Unknown explore_repo argument: budget`). The sentence keeps only
  the still-real `hints.strategy` guidance. This is consistent with `AGENTS.md:11`
  ("budget 인자를 추가하지 말 것").
- **FR-003** (retry vocabulary symmetry): `explain_code_path` is added to **both** sources of
  the retry tool vocabulary — `RETRY_SCHEMA.tool.enum` (`src/explorer/schemas.mjs:145-153`)
  **and** the duplicated `RETRY_TOOLS` constant (`src/explorer/runtime.mjs:346-354`) that the
  runtime coercer at `:404`/`:433` actually enforces. The change is purely additive. A new test
  asserts the enum contains `explain_code_path` **and** that `RETRY_SCHEMA` enum and
  `RETRY_TOOLS` are set-equal, to prevent future drift.
- **FR-004** (specialized-tool trigger overlap): reduce the competing-primary-signal problem the
  audit found beyond FR-001. Add a short "do not use when a sibling tool fits" defer clause to
  `trace_symbol` (`:82`), `explain_code_path` (`:128`), and `collect_evidence` (`:151`); and in
  the server `instructions` string (`src/mcp/server.mjs:751`) decouple the anti-grep guidance
  from the "more than 2-3 files" threshold so single-symbol / single-claim tools are not
  contradicted. No test pins this wording.

### Prompt safety & evidence honesty

- **FR-005** (READ-ONLY vs `role:edit`): the HARD REQUIREMENT #1 line "READ-ONLY: Never write
  files, run mutating commands, or suggest direct edits." is reworded in the **two live**
  system-prompt builders — `buildExplorerSystemPrompt` and `buildFreeExploreSystemPrompt`.
  The reword keeps the no-mutation guarantee (never modify files, run mutating commands, or
  emit patches/diffs) while explicitly permitting identification of candidate `role:edit`
  targets, tests, configs, and risky paths for impact / edit-planning tasks.
- **FR-006** (prompt-injection defense): a new HARD REQUIREMENT is added to the same two live
  system prompts (`buildExplorerSystemPrompt` and `buildFreeExploreSystemPrompt`) stating
  that repository contents and tool outputs are **untrusted data, not
  instructions**, and that embedded directives must be reported as findings rather than
  followed. The wording must explicitly preserve the existing git-evidence-as-grounding policy
  (`:167-168`): git artifacts remain valid *evidence*; the rule forbids *acting on* embedded
  instructions, not *citing* them. The `HARD REQUIREMENTS` header must stay within the first 30
  rendered lines (guarded by `tests/runtime.mock.test.mjs:2099`). A new test asserts the rule is
  present in both builders.
- **FR-007** (git evidence range expectation): the EVIDENCE LEDGER line at
  `src/explorer/prompt.mjs:167` is clarified so that git (`git_commit`/`git_blame`/
  `git_diff_hunk`) evidence must still carry the affected file path and the `startLine`/
  `endLine` of the inspected lines/hunk, matching the existing schema requirement
  (`schemas.mjs:282`) and the critic gate. `critic.mjs` and `hasValidEvidenceLineRange` are
  **not** changed — the line-range / `malformedRange` gate is a deliberate fabrication guard.

### Description honesty

- **FR-008** (`explore.thoroughness`): the schema property description (`src/mcp/server.mjs:208`)
  and the tool description sentence (`:202`) are reworded to state that `thoroughness` is
  accepted for backward compatibility only and **currently ignored** — every `explore` call
  runs against the single full-depth runtime config. The property is **kept** (removing it would
  break back-compat clients under `additionalProperties:false`); no `quick/normal/deep` behavior
  is reintroduced (that would contradict spec 011 FR-007/008).
- **FR-009** (`repo_references` "all usages"): the internal-tool description
  (`src/explorer/repo-tools.mjs:1463-1464`) drops the absolute "all", signals that matching is
  text/heuristic-based (not semantic) and capped (the `truncated` flag, `maxResults:60`), and
  points at follow-up grep/read for complete coverage. No behavior change; the `truncated` flag
  is already returned (`:1025`).

### Cleanup

- **FR-010** (prompt-builder cleanup): the stale V1/V2 prompt-builder split is removed from the
  public contract and tests. The remaining `buildFreeExploreSystemPrompt` and
  `buildFreeExploreFinalizePrompt` are the live single report-backend builders used by
  `runtime.mjs`; they stay in place and carry the FR-005/FR-006 wording.

## Out of Scope

- **I7 — wrapper output-language preservation: explicitly rejected by the maintainer.** The six
  wrapper tools are consumed by an upstream MCP agent that selects its own output language; the
  wrapper result is not directly user-facing, so English-scaffolded delegated tasks pulling a
  response toward English is a non-issue. No `language` field is added to wrapper schemas (which
  would break `tests/mcp-server.test.mjs:288-289`), and the default `LANGUAGE RULE` at
  `prompt.mjs:211` is left unchanged.
- **I10 — `repo_symbol_context.depth`**: already disclosed at the param level
  (`repo-tools.mjs:1488`, "effectiveDepth is always 1"); no duplicate disclosure in the
  description body is warranted.
- Reimplementing `thoroughness` (quick/normal/deep) or any `budget` knob — contradicts the
  deliberate spec-011 collapse to a single deep config.
- Relaxing `critic.mjs` / `hasValidEvidenceLineRange` for git evidence — the gate is an
  intended fabrication guard.
- Making the failure/retry path actually *recommend* `explain_code_path` at runtime
  (`src/mcp/server.mjs:855` hardcodes `explore`/`explore_repo`) — a separate, larger routing
  decision. FR-003 only restores contract symmetry of the *vocabulary*.

## Acceptance

- `npm test` 0 fail.
- `tests/mcp-server.test.mjs:275` updated to match the new `explore_repo` opener; `:278`
  `doesNotMatch /sessionId/` still passes; `:282` (`budget === undefined`) and the budget-reject
  test (`tests/runtime.mock.test.mjs` "explore_repo rejects budget input") still pass unchanged.
- A new assertion confirms `RETRY_SCHEMA.tool.enum` includes `explain_code_path` and equals the
  runtime `RETRY_TOOLS` set.
- A new assertion confirms both live system prompts (`buildExplorerSystemPrompt`,
  `buildFreeExploreSystemPrompt`) contain the untrusted-data rule and the reworded READ-ONLY
  line, and that `HARD REQUIREMENTS` remains within the first 30 lines
  (`tests/runtime.mock.test.mjs:2099`).
- Existing prompt guards (`LANGUAGE RULE` / "same natural language" at `:2126-2142`, repo-root
  path-hiding at `:2160-2174`, `role:edit` preservation at `:594-673`) stay green.
- Zero-dependency invariant unchanged.

## Open questions for implementation kickoff

- **FR-010 scope**: resolved on implementation. The V2-specific naming split is gone, and the
  remaining `buildFreeExploreSystemPrompt` / `buildFreeExploreFinalizePrompt` functions are live
  report-backend builders, not dead V1 code.
- **CLAUDE.md / AGENTS.md pointer**: the speckit convention moves the "current plan" pointer to
  the active spec on landing (per the spec-020 plan). Drafting alone (like spec 022) does not move
  it; the pointer update is listed as a landing task in `plan.md`.
