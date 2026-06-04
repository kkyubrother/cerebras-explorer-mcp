# Feature Spec: log and benchmark provenance for execution records

**Spec**: 022-response-provenance | **Date**: 2026-05-31 | **Status**: implemented 2026-06-05; closure verified (`npm test` 414/0)

## Summary

Record server-authored provenance in execution records, not in parent-agent tool
responses. The provenance object identifies the running executor: server/package
version, compact response schema version, git SHA when resolvable, stable public
tool-registry hash, exposed tool count, and ordered tool names.

The goal is that benchmark reports and opt-in transcript logs can later answer
"which exact build produced this verdict?" without forcing parent agents to spend
context on operational metadata that does not help answer the code question.

## Motivation

- The project purpose is context saving for parent coding agents: return compact,
  grounded code evidence so the parent does not repeat broad repository searches.
  Build identifiers do not improve that answer quality and should not be part of
  the normal `structuredContent` contract.
- Benchmarks are record-only and never a release gate ([[feedback-release-policy]]).
  For a record to be useful months later, it must be attributable to a precise
  executor build. Package version alone is insufficient for untagged working-tree
  runs or parallel agent sessions.
- `initialize` / `tools/list` can expose version and tool information, but a
  benchmark JSON file or transcript JSONL should remain self-describing even when
  those setup round-trips were not preserved alongside the result.
- This supersedes the earlier 022 draft that proposed adding `provenance` to every
  public MCP `structuredContent` response. That direction would make the compact
  parent-facing contract noisier without improving exploration quality.

## Functional Requirements

- **FR-001**: Public MCP tool `structuredContent` remains unchanged. The feature
  records provenance only in benchmark/log envelopes, not in parent-facing tool
  responses or child-model JSON.
- **FR-002**: The implementation MUST produce a server-authored provenance object
  for execution records with exactly these fields: `serverName`, `serverVersion`,
  `packageVersion`, `schemaVersion`, `gitSha`, `toolRegistryHash`,
  `exposedToolCount`, `toolNames`.
- **FR-003**: `schemaVersion` in the provenance object MUST be the current compact
  parent-facing response schema version, currently integer `2`.
- **FR-004**: `gitSha` MUST be the trimmed `CEREBRAS_EXPLORER_GIT_SHA` value when
  set; otherwise the result of `git rev-parse HEAD`; otherwise `null`. Git
  resolution MUST be memoized so a subprocess runs at most once per process,
  including the negative/null case.
- **FR-005**: `toolRegistryHash` MUST be a stable sha256 hex digest over the
  ordered public tool registry shape. The hash input MUST include each public
  tool's `name`, `inputSchema`, and `outputSchema` (`null` when absent);
  `toolNames` MUST mirror the ordered live registry and `exposedToolCount` MUST
  match its length (currently 8).
- **FR-006**: Benchmark JSON reports written by the `scripts/run-benchmark.mjs`
  `--output` path MUST include a top-level run-level `provenance` object. Individual
  case `result` payloads MUST remain the original parent-facing tool result.
- **FR-007**: When `CEREBRAS_EXPLORER_LOG_PATH` enables transcript JSONL logging,
  the transcript metadata MUST include the same provenance object at least once
  per exploration call, preferably in the initial `meta` record so failed or
  interrupted runs still have a build identifier.
- **FR-008**: Provenance records MUST pass through the existing report/transcript
  sanitization paths and MUST NOT require raw prompts, raw file content, secret
  values, or secret file paths.
- **FR-009**: The zero-dependency invariant holds. Implementation may use only
  Node built-ins such as `node:crypto`, `node:child_process`, and `node:fs`.
- **FR-010**: README/DESIGN updates MUST state that provenance is log/benchmark
  metadata only and that the compact MCP `structuredContent` contract remains
  focused on `directAnswer`, `status`, `targets`, `evidence`,
  `evidenceQuality`, `searchCoverage`, `critic`, and `failure`.

## Out of Scope

- Adding `provenance` to public MCP `structuredContent`.
- Changing any other compact-contract field or bumping the compact response
  `schemaVersion`.
- Allowing the child model to author, suggest, or override provenance.
- Cryptographic signing, attestation, or tamper-proof storage. This is build
  identity metadata, not a signature.
- Per-tool or per-call variation inside one process. The provenance describes the
  server build and public tool registry, which are stable for the process.
- Surfacing provenance inside the Markdown `explore` report text.

## Acceptance

- `npm test` 0 fail.
- A provenance unit/integration test asserts the object shape, `serverName ===
  'cerebras-explorer-mcp'`, `serverVersion`/`packageVersion` match the running
  package, `schemaVersion === 2`, `exposedToolCount === 8`, `toolNames` match the
  live public registry order, `toolRegistryHash` is 64 lowercase hex chars, and
  `gitSha` is `null` or a resolvable commit hash string.
- A benchmark report test asserts `scripts/run-benchmark.mjs --output` emits a
  top-level `provenance` object while leaving `cases[].result` as the existing
  parent-facing result payload.
- A transcript test asserts the initial or final `meta` JSONL record carries
  provenance when `CEREBRAS_EXPLORER_LOG_PATH` is enabled, and that transcript
  redaction behavior remains unchanged.
- Zero-dependency checks remain green.

## Closure Notes

- The previous response-provenance design was intentionally rejected: parent
  agents do not need git SHA or tool-registry hashes to make code decisions, and
  adding them to every response would work against the compact-contract goal.
- Provenance is still useful for benchmark reproducibility and operational
  debugging. The correct boundary is the log/report envelope, not the parent
  model's answer payload.
