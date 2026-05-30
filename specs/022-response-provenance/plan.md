# Implementation Plan: response provenance (spec 022)

**Branch**: `022-response-provenance` (when picked up) | **Date**: 2026-05-31 | **Spec**: [`spec.md`](./spec.md)

> **Status: NOT STARTED.** This plan is drafted ahead of implementation per the maintainer's "spec only" decision (2026-05-31). Resolve the schemaVersion open question in `spec.md` before writing code.

## Technical Context

Node.js 22+ ESM, zero-dep. The change is server-boundary only: the child model schema is untouched, so `research.md`/`data-model.md`/`contracts/` are not generated (spec 014–021 pattern). All identifiers below are verified against the current source (v0.7.0): `EXPLORE_REPO_OUTPUT_SCHEMA` (`schemas.mjs:285`), `EXPLORE_RESULT_JSON_SCHEMA` (`schemas.mjs:318`), `SERVER_INFO` (`server.mjs:14`), `buildToolList()` (`server.mjs:221`), `toAgentFacingResult()` (`server.mjs:614`).

## Code changes

- `src/explorer/schemas.mjs`
  - Add `PROVENANCE_SCHEMA` (`type: object`, `additionalProperties: false`, the 8 required fields from FR-001).
  - Add `provenance: PROVENANCE_SCHEMA` to `EXPLORE_REPO_OUTPUT_SCHEMA.properties`.
  - Do **not** touch `EXPLORE_RESULT_JSON_SCHEMA` — FR-002 keeps it server-authored.
- `src/mcp/server.mjs`
  - Imports: `execFileSync` (`node:child_process`), `createHash` (`node:crypto`), `fs` (`node:fs`).
  - `readPackageVersion()`: read `../../package.json`, fall back to `SERVER_INFO.version`.
  - `resolveGitSha()`: `CEREBRAS_EXPLORER_GIT_SHA` trimmed → else `git rev-parse HEAD` → else `null`. **Memoize in a module-level variable** so the subprocess runs at most once per process (FR-003). Use a sentinel (e.g. `undefined` = not yet resolved, `null` = resolved-absent) to cache the negative case too.
  - `buildToolRegistryHash(tools)`: sha256 hex over `tools.map({name, inputSchema, outputSchema})`. **Memoize** — `buildToolList()` is stable per process (FR-004).
  - `buildResponseProvenance()`: assemble the object from the above + `SERVER_INFO` + `schemaVersion: 1`.
  - In `toAgentFacingResult()`, add `provenance: result.provenance ?? buildResponseProvenance()`.

## Test changes

- `tests/mcp-server.test.mjs`: in the structuredContent test, assert provenance presence + shape (serverName, serverVersion === initialized version, packageVersion === package.json, schemaVersion === 1, exposedToolCount === live registry length, toolNames deepEqual live registry, toolRegistryHash matches `/^[0-9a-f]{64}$/`, gitSha null-or-`/^[0-9a-f]{7,40}$/`).
- `tests/schemas.test.mjs`: assert `EXPLORE_REPO_OUTPUT_SCHEMA.properties.provenance` exists with the 8 `required` fields; assert `EXPLORE_RESULT_JSON_SCHEMA` does **not** carry `provenance` (FR-002 guard).

## Doc changes

- `README.md`: extend the compact-contract bullet to list `provenance`; add the 8-tool `provenance` object to the sample compact response.
- `DESIGN.md`: one paragraph in the public-contract section describing provenance and the "record it with raw initialize/tools/list before product verdicts" expectation.
- `examples/expected-response.json`: add the top-level `provenance` object after `schemaVersion`.
- Benchmark runner (`scripts/run-benchmark.mjs`): record `provenance` + raw `initialize`/`tools/list` in the transcript (FR-007). Confirm exact insertion point during implementation.

## Commit units

- C1 `feat(spec-022): add server-authored response provenance` (schema + server + tests)
- C2 `docs(spec-022): document response provenance` (README/DESIGN/example/benchmark runner)

## Verification

`npm test` 0 fail (385 → 385 + new provenance assertions). Zero-dep check passes. 8-tool surface guard (`tests/mcp-server.test.mjs`) still green. Whether this ships in a patch or minor depends on the schemaVersion decision — record-only, no release gate.
