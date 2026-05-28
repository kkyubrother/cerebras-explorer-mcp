# Implementation Plan: Explorer Trust and Surface Hygiene

**Branch**: `019-explorer-trust-surface` | **Date**: 2026-05-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-explorer-trust-surface/spec.md`

## Summary

Tighten the MCP explorer's trust accounting and agent-facing surface based on Claude-reviewed findings. The implementation will keep the eight public tools and zero-dependency constraint intact while improving evidence grounding, warning/search-coverage consistency, output size hygiene, transcript diagnostics, and failover provider attribution.

## Technical Context

**Language/Version**: Node.js ESM, Node >=22.0.0

**Primary Dependencies**: None; `package.json` must keep `dependencies` and `devDependencies` absent/empty

**Storage**: Local transcript files only when transcript logging is enabled; no persistent application database

**Testing**: Node built-in test runner via `npm test`; targeted `node --test tests/<file>.test.mjs` during TDD

**Target Platform**: MCP stdio server and local runtime library for coding agents

**Project Type**: Single-package Node.js library/CLI/MCP server

**Performance Goals**: Bound surfaced diagnostic lists and avoid unnecessary duplicate snippet text in MCP responses

**Constraints**: Read-only repository tooling, secret redaction always active, hard scope boundaries, fixed public tool surface, no `explore_repo` budget input, docs synchronized with public schema changes

**Scale/Scope**: Compact agent-facing response contract plus local diagnostics across existing runtime/server/provider modules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The Speckit constitution file is still a placeholder, so repository-specific gates come from `AGENTS.md`:

- PASS: Preserve zero runtime dependencies.
- PASS: Keep repository exploration read-only and do not add write/delete tool paths.
- PASS: Preserve secret deny-list and redaction behavior; diagnostic additions must be redacted by default.
- PASS: Keep the public MCP tool surface at eight tools and do not reintroduce `explore_v2`, budget input, or removed envvars.
- PASS: Treat scope as a hard boundary and do not weaken existing scope filtering.
- PASS: Preserve documented handoff control-plane fields or update docs/tests so the contract is unambiguous.
- PASS: Synchronize README, DESIGN, examples, and tests for public schema/output changes.

Post-design re-check: PASS with the same constraints. The selected design changes existing compact output fields and local diagnostics only; no dependency, tool-count, or write-path exceptions are required.

## Project Structure

### Documentation (this feature)

```text
specs/019-explorer-trust-surface/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── explore-repo-output.md
│   └── diagnostics.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── explorer/
│   ├── critic.mjs
│   ├── runtime.mjs
│   ├── schemas.mjs
│   ├── transcript.mjs
│   └── providers/failover.mjs
└── mcp/server.mjs

tests/
├── critic.test.mjs
├── runtime.mock.test.mjs
├── mcp-server.test.mjs
├── schemas.test.mjs
├── transcript.test.mjs
├── providers.test.mjs
└── integrations.test.mjs

docs/examples:
├── README.md
├── DESIGN.md
└── examples/expected-response.json
```

**Structure Decision**: Use the existing single-package structure. The feature changes existing runtime, schema, server, transcript, provider, documentation, and test files without adding packages or new runtime services.

## Complexity Tracking

No constitution violations or additional complexity exceptions are required.
