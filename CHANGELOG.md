# Changelog

## v0.2.0 - 2026-05-19

### Surface Consolidation (2026-05-22)

010 follow-up cleanup bundle for `specs/011-consolidate-surface/`. Removes the
budget input knob and the `explore_v2` tool name, fixes the public tool
surface at 8, and drops ten low-use environment variables. Two intentional
breaking changes are bundled into this next minor.

- **Breaking — Removed**: `explore_repo` no longer accepts a `budget` key.
  Every call runs against the single deep runtime config (maxTurns 30,
  maxSearchResults 80, maxReadLines 320, temperature 1.0, top_p 0.95).
- **Breaking — Removed**: the `explore_v2` tool name is gone. Its V2
  backend implementation is now the only `explore` implementation, so
  every prompt receives the same truncation labels, structured citations,
  critic warnings, and tool-result truncation handling.
- **Removed**: environment variables `CEREBRAS_MODEL`,
  `CEREBRAS_EXPLORER_MODEL_QUICK|NORMAL|DEEP`,
  `CEREBRAS_EXPLORER_EXTRA_TOOLS`,
  `CEREBRAS_EXPLORER_ENABLE_EXPLORE`,
  `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`,
  `CEREBRAS_EXPLORER_AUTO_ROUTE`,
  `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`,
  `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`. None of them are
  honored anymore — the runtime ignores them entirely.
- **Removed**: the 010 opt-in branches behind those last two envvars.
  Auto repo-keyed session reuse is gone (`SessionStore.findReusableForRepo`
  was deleted; `_debug.stats.sessionSource='auto_repo'` no longer
  appears). The 010 migration window for legacy reference-target
  promotion is closed; discoveries surface only via top-level
  `discoveredPaths[]`.
- **Changed**: tool surface is now fixed at 8 regardless of any
  environment variable: `explore_repo`, the six wrappers, and `explore`.
- **Changed**: `CEREBRAS_EXPLORER_MODEL` is the single source of truth
  for model selection. Operators who previously used budget-specific
  model overrides should run a second server instance with a different
  `CEREBRAS_EXPLORER_MODEL` if they need that cost split.
- **Migration**:
  - Drop the `budget` key from every `explore_repo` / wrapper invocation.
  - Replace `explore_v2` tool-name calls with `explore`.
  - Stop relying on the removed env vars; the runtime ignores them.
  - Use explicit `session` arguments instead of
    `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`.
  - If you need a minimal tool surface, filter at the MCP gateway.

### Feedback Verification Fixes (2026-05-22)

Docs + runtime bundle for `specs/010-feedback-verification-fixes/`. Externally
verified feedback (16 claims) collapsed into 5 reliability fixes; every schema
change is additive and every behavior change is guarded by a default-off env
var so existing consumers can opt into the prior behavior for one release.

- **Changed**: `status.complete`/`verification`/`failure.reason`/`nextAction`
  now use evidence sufficiency as the primary signal instead of budget
  exhaustion alone. Budget-exhausted runs with enough grounded evidence stay
  `complete:true`, keep `searchCoverage.stoppedByBudget=true`, and surface
  "budget exhausted after sufficient evidence" in `status.warnings`.
- **Added**: Top-level `discoveredPaths[]` (`path`/`kind`/`sourceTool`/`reason`)
  separates discovery noise (list_dir, find_files, git diff/show) from the
  actionable `targets[]`. Report tools merge same-file citations at file level
  with min/max line ranges. Legacy promotion is available via
  `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS=1` for one release.
- **Changed**: Redaction preserves `process.env.X`/`import.meta.env.X`/
  `Deno.env.get("X")` identifiers as a public code interface; secret values and
  secret file paths still mask. Strict masking remains available via
  `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`.
- **Changed**: `repo_git_diff` (file + stat) and `repo_git_show` now enforce
  the base scope as a hard boundary like every other repo tool. Omitted file
  counts surface as additive optional `omittedOutOfScopeFiles` /
  `omittedSecretPaths` fields.
- **Added**: Opt-in `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` makes
  `resolveSessionForExplore` auto-reuse the most-recently-used reusable session
  for the same repoRoot when no explicit `session` argument is provided.
  `session.status` enum is unchanged; auto reuse is exposed via the
  `_debug.stats.sessionSource='auto_repo'` diagnostic.
- **Documentation**: README/DESIGN/AGENTS now describe the wrapper decision
  rule, `_meta.progressToken` recommendation for heavy calls, the
  control-plane fields agents must preserve when handing off a result, and the
  three new opt-in env vars.

### Tool Quality Follow-up (2026-05-21)

Docs-only bundle for `docs/superpowers/plans/2026-05-19-tool-quality-improvements.md`.

- **Changed**: Clarified V2 tool-result truncation wording so callers understand truncation happens before model synthesis and must be treated as an evidence-limit signal.
- **Changed**: Expanded the `explore` router heuristics for broad/deep report prompts while keeping `explore_v2` as an opt-in tool surface.
- **Added**: Exposed report-mode `citations[]` and citation-derived `targets[]` in `structuredContent` for `explore`/`explore_v2`.
- **Added**: Added the `benchmark:evidence` suite for citation/evidence preservation checks.
- **Added**: Added transcript-based adoption metrics for broad-search and repeated-plan signals, plus adoption-suite evidence snippet checks.

### Added

- Declared read-only MCP tool annotations for every exposed tool.
- Added a stdio guard and regression coverage for NDJSON and Content-Length framing.
- Added Gemini CLI integration examples and documented environment variable sanitization.
- Updated Codex CLI examples to use `npx` with `enabled_tools` and `disabled_tools`.

### Security

- Added a default secret path deny-list for `.env*`, SSH/GPG material, cloud credentials, package manager credentials, key/certificate files, and common `secrets/**` paths.
- Added response and provider-facing redaction for common API keys, PATs, JWTs, private key blocks, and optionally generic hex tokens.
- Preserved evidence grounding fields while adding redaction metadata as an additive contract.

### Documentation

- Reworked the README first screen around quickstart, supported clients, tool exposure, and security model.
- Removed stale `#main` GitHub refs from documented install snippets.
