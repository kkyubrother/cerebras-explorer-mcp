# Top-Level Session Contract Design

## Context

The remaining P0 gap in the compact `explore_repo` contract is session visibility.
The runtime already computes session state as `stats.sessionId`, `stats.sessionStatus`,
and `stats.remainingCalls`, but MCP `structuredContent` only exposes top-level
`sessionId`.

Upper AI agents should not need to inspect `_debug.stats` to decide whether a
follow-up call can safely reuse the current session. This matters most when an
expired or exhausted session silently falls back to a fresh session.

## Goal

Expose a small top-level `session` object in agent-facing `explore_repo` results
so an upper AI can see whether the session was created, reused, or replaced by
fallback, and how many calls remain.

## Non-Goals

- Do not remove top-level `sessionId` in this change. Keep it for compatibility.
- Do not add timestamps, repo roots, summaries, stored paths, or other session
  internals to the compact contract.
- Do not turn low confidence, missing evidence, narrow scope, or secret-denied
  results into `failure` reasons. Those remain `evidenceQuality`, `status`, and
  `nextAction` signals.
- Do not redesign `explore` or `explore_v2` output shapes in this P0 patch.

## Contract

Agent-facing `explore_repo` results include:

```json
{
  "sessionId": "sess_abc123",
  "session": {
    "id": "sess_abc123",
    "status": "created",
    "remainingCalls": 4
  }
}
```

`session.id` must equal `sessionId` when both are present.

`session.status` is one of:

- `created`: no reusable session was supplied, so the runtime created a new one.
- `reused`: the supplied session was valid and reused.
- `fallback`: the supplied session was expired or exhausted, so the runtime
  created a fresh replacement.

`session.remainingCalls` is the session store's remaining call count after the
current call has been recorded. It is an integer greater than or equal to zero.

When no session store exists, omit both `sessionId` and `session`.

## Runtime Boundary

The runtime may continue to keep `stats.sessionId`, `stats.sessionStatus`, and
`stats.remainingCalls` for diagnostics and existing internal consumers.

The MCP server should build the top-level `session` object from the runtime
result and stats. If later code wants the runtime raw result to expose `session`
directly, that can be additive, but the P0 contract is MCP `structuredContent`.

## Error Boundary

Handled input/provider/internal errors that occur before a session is created do
not need a `session` object.

Invalid or mismatched explicit sessions remain structured `failure` objects.
They should not also synthesize a `session` object, because no valid session was
used.

## Documentation

README and DESIGN should describe `session` as the preferred control-plane field
for follow-up calls. `sessionId` remains documented as a compatibility alias and
as the value to pass into the next call's `session` input.

The docs should also preserve the separation between:

- `failure`: execution/input/provider/internal failure events.
- `evidenceQuality`: trust and evidence strength.
- `nextAction`: normal follow-up guidance when `failure` is `null`.

## Test Strategy

- Schema test: `EXPLORE_REPO_OUTPUT_SCHEMA` includes `session` with `id`,
  `status`, and `remainingCalls`.
- MCP success test: normal `explore_repo` response includes `session`, and
  `session.id === sessionId`.
- MCP fallback test: exhausted or expired session produces a new `session.id`,
  `session.status === "fallback"`, and a valid `remainingCalls`.
- Regression check: legacy fields remain absent from `structuredContent`.
