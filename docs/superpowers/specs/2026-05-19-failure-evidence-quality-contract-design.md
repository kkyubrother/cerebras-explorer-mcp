# Failure And Evidence Quality Contract Design

## Goal

Expose the next action signals that an upper AI agent needs after `explore_repo` completes: a compact evidence quality summary for all results, and a structured failure object only when exploration execution did not complete normally.

This design is additive. It preserves the compact result contract introduced by `directAnswer`, `status`, `targets`, `evidence`, `uncertainties`, `nextAction`, `sessionId`, and `_debug`.

## Current Context

The internal model result contract is now compact-only. Legacy aliases such as `answer`, `summary`, top-level `confidence`, `candidatePaths`, and `followups` are no longer part of model output. Runtime confidence is reconciled through `status.confidence`, while detailed critic information currently remains split between `trustSummary`, `confidenceScore`, `confidenceFactors`, `status.warnings`, and `_debug`.

The current friction is not the answer shape itself. The friction is that an upper AI agent still has to infer whether to trust a partial result, retry with a narrower query, ask the user, or treat a run as an execution failure. Those signals are available internally, but they are not exposed as a stable top-level contract.

## Chosen Approach

Use an action contract, not a broad diagnostic dump.

Add three top-level fields:

```json
{
  "schemaVersion": 1,
  "evidenceQuality": {
    "level": "low",
    "exactCount": 0,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 0,
    "warnings": [],
    "summary": "Limited evidence found - consider follow-up exploration."
  },
  "failure": null
}
```

`schemaVersion` lets downstream agents and MCP clients branch safely as the agent-facing contract evolves.

`evidenceQuality` is always present. It summarizes whether the cited evidence is good enough to act on. It does not replace `status`; it makes the existing critic/trust signal easier for an upper AI to consume without parsing `_debug`.

`failure` is either `null` or a structured object. It is reserved for execution/input/provider/internal failure events, not for low-quality but normally completed answers.

## Evidence Quality Contract

`evidenceQuality` has this shape:

```json
{
  "level": "low|medium|high",
  "exactCount": 0,
  "partialCount": 0,
  "droppedCount": 0,
  "fileCount": 0,
  "warnings": ["string"],
  "summary": "string"
}
```

Field rules:

- `level` equals the final reconciled confidence level in `status.confidence`.
- `exactCount` counts retained evidence items with `groundingStatus: "exact"`.
- `partialCount` counts retained evidence items with `groundingStatus: "partial"`.
- `droppedCount` comes from critic grounding drops, including malformed and ungrounded evidence.
- `fileCount` counts distinct retained evidence paths.
- `warnings` is the compact warning list exposed to agents. It should be capped and should mirror the practical warnings in `status.warnings`.
- `summary` is the current human-readable `trustSummary` text.

Keep raw numeric `score` and unbounded `confidenceFactors` in `_debug`. They are useful for diagnostics and benchmarks, but they are too noisy for stable agent branching.

## Failure Contract

`failure` is `null` when the run completed normally, including cases where the evidence quality is low. Low confidence is a quality signal, not an execution failure.

When present, `failure` has this shape:

```json
{
  "category": "execution|input|provider|internal",
  "reason": "budget_exhausted",
  "message": "Exploration stopped at the turn budget before all follow-up checks were exhausted.",
  "retry": {
    "tool": "explore_repo",
    "hints": ["Narrow the scope to the files in targets before retrying."]
  }
}
```

Allowed reasons:

- `budget_exhausted`: runtime stopped because the configured turn budget was exhausted.
- `tool_errors`: runtime stopped after repeated tool errors.
- `aborted`: caller cancelled the exploration.
- `invalid_session`: requested session id was invalid.
- `repo_mismatch`: requested session belongs to another repo root.
- `provider_error`: provider call failed before a compact result could be produced.
- `access_denied`: the useful evidence was denied by path or secret policy.
- `invalid_final_response`: provider final output could not be repaired into a compact result.

Reason categories:

- `execution`: `budget_exhausted`, `tool_errors`, `aborted`
- `input`: `invalid_session`, `repo_mismatch`
- `provider`: `provider_error`
- `internal`: `access_denied`, `invalid_final_response`

`retry` is either `null` or an object:

```json
{
  "tool": "explore_repo|find_relevant_code|collect_evidence|trace_symbol|map_change_impact|review_change_context|explore",
  "hints": ["string"]
}
```

The contract intentionally does not expose a complete `retryInput` object. The upper AI should assemble the next tool call from its current task, session, repo root, scope, and user intent. This avoids stale session and stale scope bugs.

## Signal Precedence

Agents should use these rules:

1. If `failure` is not `null`, inspect `failure.retry` before `nextAction`.
2. If `failure` is `null`, use `nextAction` for normal follow-up behavior.
3. Use `evidenceQuality.level` to decide whether to re-open cited targets, run a follow-up, or trust the answer.
4. Treat `status` as the compatibility and summary state, not the only control signal.

This keeps `failure`, `nextAction`, and `evidenceQuality` from competing with each other.

## Runtime Behavior

The runtime will build `evidenceQuality` after deterministic critic grounding and after evidence snippets are attached. It can derive all required fields from the existing normalized result, critic pass, and stats.

The runtime will build `failure` from existing stats and validation outcomes:

- `stats.stoppedByBudget` maps to `budget_exhausted`.
- `stats.stoppedByErrors` maps to `tool_errors`.
- `stats.stoppedByAbort` maps to `aborted`.
- invalid session resolution maps to `invalid_session`.
- repo mismatch maps to `repo_mismatch`.
- final JSON repair fallback maps to `invalid_final_response`.

`access_denied` should only be used when the run retained no grounded evidence and the observable reason is denied path or secret policy. If the code cannot identify that condition confidently in the first implementation, it should not guess.

## MCP Error Boundary

For normal explore results, `structuredContent` must include `schemaVersion`, `evidenceQuality`, and `failure`.

For tool calls that return `isError: true`, the server should include `structuredContent.failure` when the error is handled in the MCP request handler and the client shape supports structured content. If a transport-level or protocol-level failure prevents structured content, documentation must say that `isError` responses can lack the compact result envelope.

The first implementation should cover the MCP handler catch paths already used for repo root errors, invalid arguments, and exposed tool execution failures. It should not redesign JSON-RPC transport behavior.

## Schema And Documentation

The public MCP output schema should require `schemaVersion` and `evidenceQuality`, and should allow `failure` as either `null` or the failure object.

The internal model result schema should not require the model to generate these fields. Runtime owns them because they are derived from verified local observations and execution state, not model claims.

README and DESIGN should show `evidenceQuality` and document the precedence rule. They should keep `_debug` as diagnostics only.

## Testing Strategy

Use TDD for implementation:

1. Schema tests fail until `schemaVersion`, `evidenceQuality`, and nullable `failure` are in the MCP output schema.
2. Runtime tests fail until normal successful results include `failure: null` and populated `evidenceQuality`.
3. Runtime tests fail until budget/error/final-response fallback results produce a structured `failure`.
4. MCP server tests fail until `structuredContent` includes the new fields and handled `isError` responses include structured failure content where supported.
5. README/DESIGN tests or targeted text checks fail until examples and contract prose match the new surface.

Full verification remains `npm test`.

## Out Of Scope

- A complete `session` object with `{ id, status, remainingCalls, reused, fallbackReason }`.
- A ready-to-submit `retryInput` object.
- Wrapper or router redesign for tool selection.
- Deep latency/cost telemetry.
- Changes to `explore` Markdown report routing beyond reflecting the new text summary if already available.

## Risks And Mitigations

The main risk is creating competing action signals. The precedence rules above mitigate this by making `failure.retry` authoritative only for failures and `nextAction` authoritative for normal results.

The second risk is overfitting enum values. The first implementation should map only states the runtime already knows. If a failure cannot be classified confidently, it should use `provider_error` or `internal` only at the boundary that actually observed the failure.

The third risk is leaking diagnostics into agent-facing output. Raw score and factors stay in `_debug`; the compact top-level surface stays small and branchable.
