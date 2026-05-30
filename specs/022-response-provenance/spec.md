# Feature Spec: response provenance for the 8-tool surface

**Spec**: 022-response-provenance | **Date**: 2026-05-31 | **Status**: drafted (implementation deferred)

## Summary

Attach a server-authored `provenance` object to every structured MCP tool response (`structuredContent`). It pins the running executor: server/package version, schema version, git SHA (when resolvable), a stable tool-registry hash, and the exposed tool count + ordered names. The goal is that an evaluation/benchmark transcript can fix *exactly which build* produced a verdict, without trusting the child model to self-report.

## Motivation

- Benchmarks are record-only and never a release gate ([[feedback-release-policy]]). For a record to be meaningful months later, it must be attributable to a precise executor build — version string alone is not enough across un-tagged working-tree runs.
- The project thesis is **trust = context saving** ([[project-trust-as-context-saving]]). Provenance is a trust signal that costs the consumer almost nothing to record and lets them detect surface drift (e.g. a tool added/removed, schema changed) by hash rather than by prose diffing.
- `initialize` / `tools/list` already expose `serverVersion`, but they are separate round-trips; a per-response field means every captured result is self-describing.
- This is the last open technical item of the 2026-05-25 contract-hygiene plan (Task 5); it was never built. It deserves its own spec rather than a checkbox because it changes the public output schema and the MCP boundary.

## Functional Requirements

- **FR-001**: Every structured tool response (`structuredContent`) for the public surface includes a `provenance` object with exactly: `serverName`, `serverVersion`, `packageVersion`, `schemaVersion`, `gitSha`, `toolRegistryHash`, `exposedToolCount`, `toolNames`.
- **FR-002**: `provenance` is **server-authored only**. It appears in `EXPLORE_REPO_OUTPUT_SCHEMA` (the agent-facing output schema) and is **absent** from the child-model `EXPLORE_RESULT_JSON_SCHEMA` — the model must never be able to author or forge it.
- **FR-003**: `gitSha` = trimmed `CEREBRAS_EXPLORER_GIT_SHA` if set; else the result of `git rev-parse HEAD`; else `null`. The git subprocess runs **at most once per process** (memoized) — never per response.
- **FR-004**: `toolRegistryHash` is a sha256 hex digest over the ordered registry's stable shape (`{name, inputSchema, outputSchema}` per tool). `toolNames` is the ordered live registry and `exposedToolCount` its length (currently 8). The hash is process-stable and may be memoized.
- **FR-005**: `packageVersion` is read from `package.json` (falling back to `SERVER_INFO.version` on read failure); `serverVersion` is `SERVER_INFO.version`; `schemaVersion` is the integer `1`.
- **FR-006**: The zero-dependency invariant holds — only `node:crypto`, `node:child_process`, `node:fs` (all built-in).
- **FR-007**: Docs and the canonical example are updated: `README.md` compact-contract bullet + sample response, `DESIGN.md` public-contract section, and `examples/expected-response.json` carry the 8-tool `provenance` shape. The benchmark runner records `provenance` alongside raw `initialize` / `tools/list` payloads.

## Out of Scope

- Cryptographic signing / attestation of responses — this is identity, not a signature.
- Per-tool or per-call provenance variation; the object describes the server build, identical across the 8 tools within one process.
- Changing any other compact-contract field, or the child-model schema beyond confirming `provenance` is excluded from it.
- Surfacing provenance in the Markdown `explore` report mode (structured `structuredContent` only).

## Acceptance

- `npm test` 0 fail.
- `tests/mcp-server.test.mjs` asserts `structuredContent.provenance` exists, `serverName === 'cerebras-explorer-mcp'`, `serverVersion`/`packageVersion` match, `schemaVersion === 1`, `exposedToolCount` and `toolNames` match the live 8-tool registry, `toolRegistryHash` is 64-hex, and `gitSha` is `null` or a `[0-9a-f]{7,40}` hash.
- `tests/schemas.test.mjs` asserts `EXPLORE_REPO_OUTPUT_SCHEMA.properties.provenance` exists with the 8 required fields, and that the child-model schema does not.
- Zero-dependency check still passes.

## Open question for implementation kickoff

- **schemaVersion bump policy**: does adding `provenance` itself warrant `schemaVersion` 1 → 2, or is `provenance` an additive field under the existing `1`? Default assumption here: additive, stays `1` (consumers tolerant of new top-level keys). Confirm with maintainer before implementing.
