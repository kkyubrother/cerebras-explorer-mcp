# Implementation Plan: log and benchmark provenance (spec 022)

**Branch**: `022-response-provenance` (when picked up) | **Date**: 2026-05-31 | **Spec**: [`spec.md`](./spec.md)

> **Status: NOT STARTED.** This plan was rewritten on 2026-06-05 after the
> maintainer rejected parent-facing response provenance. The implementation must
> keep MCP `structuredContent` unchanged and record provenance only in benchmark
> reports and transcript/log metadata.

## Technical Context

Node.js 22+ ESM, zero-dep. Current source is v0.8.2 with compact
`schemaVersion: 2`. Public MCP tool surface remains fixed at 8 tools:
`explore_repo`, 6 specialized wrappers, and `explore`. The current compact
structured-content schema already excludes `provenance`; preserve that invariant.

Relevant current anchors:

- `src/mcp/server.mjs`: `SERVER_INFO`, public tool registry, tool-call envelope,
  `toAgentFacingResult()`.
- `src/explorer/schemas.mjs`: `EXPLORE_REPO_OUTPUT_SCHEMA` and
  `EXPLORE_RESULT_JSON_SCHEMA`.
- `src/explorer/transcript.mjs`: `createTranscriptRecorder()` writes initial and
  final `meta` JSONL records when `CEREBRAS_EXPLORER_LOG_PATH` is set.
- `scripts/run-benchmark.mjs`: writes sanitized JSON reports via `--output`.

## Code Changes

- `src/mcp/server.mjs`
  - Add an internal/exported helper such as `buildExecutionProvenance()`.
  - The helper reads `SERVER_INFO`, package version, compact schema version `2`,
    and the ordered live `buildToolList()` registry.
  - `gitSha`: trimmed `CEREBRAS_EXPLORER_GIT_SHA` -> `git rev-parse HEAD` ->
    `null`, memoized once per process.
  - `toolRegistryHash`: sha256 hex over
    `tools.map(({ name, inputSchema, outputSchema }) => ({ name, inputSchema,
    outputSchema: outputSchema ?? null }))`, memoized once per process unless
    the helper is given an explicit registry in tests.
  - Do not add the helper result to `toAgentFacingResult()` or
    `toAgentFacingFreeExploreResult()`.
  - For normal MCP calls, avoid resolving provenance unless transcript logging is
    enabled. Benchmark report generation resolves it once for the run.

- `src/explorer/transcript.mjs`
  - Extend `createTranscriptRecorder({ ... })` with an optional `provenance`
    parameter.
  - Include `provenance` in the initial `meta` record when supplied. Do not
    require transcript recording to resolve provenance when disabled.
  - Preserve existing redaction/raw-mode behavior by passing the metadata through
    the current `record()` path.

- `src/explorer/runtime.mjs`
  - Accept optional provenance through runtime options for
    `exploreRepository()` and `freeExploreRepository()`.
  - Pass that option into `createTranscriptRecorder()` for both compact and
    Markdown exploration paths.
  - Do not import `src/mcp/server.mjs` from runtime; keep dependency direction
    server -> runtime -> transcript.
  - Keep runtime behavior read-only and avoid exposing provenance in returned
    `structuredContent` or report text.

- `scripts/run-benchmark.mjs`
  - Capture one run-level provenance object after initializing the in-process MCP
    handler.
  - Include it as top-level `provenance` in the JSON object written by
    `--output`.
  - Leave `cases[].result` as the raw parent-facing `structuredContent`.

## Test Changes

- `tests/mcp-server.test.mjs`
  - If `buildExecutionProvenance()` is exported from `server.mjs`, assert its
    field shape and registry-derived values against the live 8-tool list.

- `tests/transcript.test.mjs`
  - Assert a transcript `meta` record carries provenance when supplied.
  - Re-run the redaction/raw-mode assertions to confirm provenance does not
    bypass existing transcript sanitization.

- `tests/benchmark-report.test.mjs` or a focused benchmark-runner test
  - Run the benchmark writer against a small mocked/fixture case if available,
    or call the report assembly helper if one is extracted.
  - Assert top-level `provenance` exists in the saved report and
    `cases[].result` remains the existing parent-facing result payload.

## Doc Changes

- `README.md`
  - Keep the compact-contract bullet free of provenance.
  - In the benchmark/transcript section, document that provenance is stored in
    benchmark JSON reports and transcript metadata, not parent-facing tool
    responses.

- `DESIGN.md`
  - Add one short note in the public-contract / observability discussion:
    provenance is operational/evaluation metadata and intentionally lives outside
    `structuredContent`.

- `examples/expected-response.json`
  - Do not add provenance. If touched, add/update a guard comment elsewhere
    instead of changing the canonical response body.

## Commit Units

- C1 `feat(spec-022): record execution provenance in logs`
  - provenance helper, transcript wiring, benchmark report output, tests.
- C2 `docs(spec-022): document log-only provenance`
  - README/DESIGN updates, no canonical response shape change.

## Verification

- `npm test` 0 fail.
- Zero-dependency invariant unchanged.
- Public tool count remains 8.
- No compact response schema or canonical response example update is required.
