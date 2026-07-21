# Contract: Parent Handoff v3

## Purpose

Give a parent agent exactly one routing signal and the minimum proof/action data needed to continue. Internal planning, trust diagnostics, search counters, and successful checks are not part of this contract.

## JSON shape

```json
{
  "schemaVersion": 3,
  "directAnswer": "Only claims accepted by the semantic and deterministic gates.",
  "state": "complete",
  "evidence": [
    {
      "kind": "source",
      "path": "src/example.mjs",
      "startLine": 10,
      "endLine": 18,
      "supports": "The handler calls validateRequest before dispatch.",
      "snippet": "10: ..."
    }
  ]
}
```

Top-level schema:

| Field | Type | Required | Rule |
|---|---|---:|---|
| `schemaVersion` | integer | yes | Const `3`. |
| `directAnswer` | string | conditional | Required and non-empty for `complete`, `verify_targets`, and `failed`. Present for `incomplete` only when supported partial claims exist. It never repeats unresolved gaps. |
| `state` | enum | yes | `complete`, `verify_targets`, `incomplete`, or `failed`. |
| `targets` | Target[] | no | Present only when the parent must inspect or act on locations. |
| `evidence` | Evidence[] | conditional | Non-empty for `complete`/`verify_targets`, and whenever `incomplete.directAnswer` contains supported partial claims. |
| `gaps` | Gap[] | no | Present only for `incomplete`; every unresolved requested part remains identifiable. |
| `followUp` | FollowUp | no | Present only for `incomplete`; at most one discriminated action. |
| `failure` | Failure | no | Present only for `failed`. |

`additionalProperties` is false at every public object level.

## State contract

| State | Meaning | Parent action | Allowed conditional fields |
|---|---|---|---|
| `complete` | Every required explorer sub-goal is supported and no source read is required before using the answer. | Use the answer. | Non-empty `evidence` required; `targets` only if useful navigation is explicitly requested. |
| `verify_targets` | Every explorer sub-goal is supported, and the original request has explicit edit/implementation intent requiring the parent to read named source ranges before modifying them. | Read only `targets`, then continue. | Non-empty `targets` and `evidence` required. |
| `incomplete` | At least one valid required sub-goal is blocked or remains unresolved after the optional internal repair. | Use supported partial facts only; run the one `followUp` if useful. | `gaps` required; `followUp` optional; `directAnswer`/`evidence` only when supported partial facts exist; `targets` optional. |
| `failed` | No trustworthy normal completion is available because of input, cancellation, provider, tool, or verifier failure. | Retry only when `failure.retry` exists; otherwise stop. | `failure` required. No stale partial answer or success evidence. |

There is no separate `complete` boolean. `complete` and `verify_targets` mean internal required-sub-goal coverage is closed; the state itself tells the parent whether further reading is required.

## Target

```json
{
  "path": "src/example.mjs",
  "startLine": 10,
  "endLine": 18,
  "role": "read",
  "reason": "Verify this range before editing the handler.",
  "evidenceRefs": ["E1"]
}
```

- `path`, `role`, and `reason` are required.
- `role` is one of `read`, `edit`, `test`, or `config`.
- Line bounds and `evidenceRefs` are optional.
- Do not return targets that merely appeared in directory/find/git output.
- Deduplicate the same path/range/action.
- A `complete` answer should normally omit targets unless the user explicitly requested locations.
- An `incomplete` edit-planning result may retain exact targets derived from supported partial claims. Claims affected by a goal-local safety limit contribute no answer, evidence, or target.
- A model target role is retained only for an exact verified source range. Path-only fallback from a mismatched range is downgraded to `read`.

## Evidence

Evidence is a discriminated union.

`id` is optional and is emitted only when a surfaced target's `evidenceRefs` (or another public cross-reference) uses it. Internal observation ids otherwise remain internal.

### Source evidence

```json
{
  "id": "E1",
  "kind": "source",
  "path": "src/example.mjs",
  "startLine": 10,
  "endLine": 18,
  "supports": "The handler calls validateRequest before dispatch.",
  "snippet": "10: ..."
}
```

- Range and snippet are rebuilt from the repository, not copied from model output.
- `supports` names the accepted claim this range entails.
- `snippet` is optional and included only when it prevents a parent read or resolves ambiguity. It is limited to the exact useful lines and current redaction rules.

### Git evidence

```json
{
  "id": "E2",
  "kind": "git",
  "sha": "abc1234",
  "path": "src/example.mjs",
  "supports": "This commit introduced the validation call."
}
```

- `sha` and `supports` are required.
- Scope-filtered `path` and line bounds are optional.
- Only actually observed commit/blame/diff data may be surfaced.

### Absence evidence

```json
{
  "id": "E3",
  "kind": "absence",
  "boundary": ["src/auth/**"],
  "searches": ["symbol references: legacyAuthorize", "text: legacyAuthorize"],
  "supports": "No static reference to legacyAuthorize was found in src/auth/**."
}
```

- `boundary`, `searches`, and `supports` are required.
- It is emitted only from a complete internal absence certificate.
- The accepted claim must use the same boundary/qualification.
- Raw counters, candidate files, ignored secret paths, and tool traces stay internal.

The evidence list is claim-cover-minimized: retain one direct item per claim where possible, but retain one verifier-approved item for every distinct source path explicitly named by an accepted claim. Comparisons, ordered transitions, and independent cross-checks retain their required proof parts. Every `complete` or `verify_targets` result contains at least one evidence item; an `incomplete` result contains evidence whenever it surfaces supported partial claims.

For `map_change_impact`, the runtime replaces free-form risk-boundary prose with one parent-visible sentence that lists the verifier-approved observed source paths and marks additional in-scope impact as unverified. Every named path retains direct evidence; evidence-local `supports` text does not repeat the aggregate caveat.

## Gap and follow-up

```json
{
  "gaps": [
    {
      "question": "Whether an alternate bootstrap still registers the legacy route",
      "reason": "The first bootstrap search was truncated before every candidate was inspected."
    }
  ],
  "followUp": {
    "type": "tool",
    "tool": "explore_repo",
    "arguments": {
      "task": "Check application bootstrap files for legacy route registration.",
      "scope": ["src/app/**", "src/server/**"],
      "hints": {
        "files": ["src/app/index.mjs"]
      }
    }
  }
}
```

- `gaps` contains every unresolved requested part, but no successful sub-goal or diagnostic history. Each `question` is rebuilt from the required goal's confirmed original `request:<start>-<end>` slices; wrapper-only or plan-level gaps fall back to the original task. Gaps sharing one request-derived question and cause may be grouped only when no requested distinction is lost.
- Do not expose model-authored goal/audit wording, `auditBinding`, sub-goal ids, state history, goal-audit verdicts, rejected planner goals, verifier reason codes, or successful sub-goals.
- `followUp` is one narrow action for the runtime-selected highest-priority remaining gap; priority derives from original request order and proof policy, not model preference.
- It is exactly one of:

```json
[
  { "type": "tool", "tool": "explore_repo", "arguments": { "task": "..." } },
  { "type": "ask_user", "question": "Which deployment or environment should be checked?" },
  { "type": "external_verification", "requirement": "Inspect the deployed route table and report the active registration." }
]
```

- A `tool` action uses only public six-tool vocabulary and its `arguments` must validate against that tool's public input schema.
- `ask_user` is allowed only when one missing input, contradiction, or scope decision can materially unblock the task.
- `external_verification` is allowed only when the requested fact depends on live or external state the repository explorer cannot observe. It describes the minimum fact to obtain, not a procedure dump.
- It never widens the original hard scope and never contains budget, strategy, depth, turn count, or reasoning controls. A scope-blocked gap has no executable tool follow-up unless the proposed arguments remain inside the original boundary.
- Known-infeasible goals never receive a pointless tool retry. Omit `followUp` when no action would materially change the result.
- After the single repair round, normalize and fingerprint every attempted tool/action. Do not return the same tool with equivalent arguments for the same gap. A follow-up must introduce materially new caller input, an authorized scope decision, or external-state evidence; otherwise omit it.

## Failure

```json
{
  "schemaVersion": 3,
  "directAnswer": "Explorer was cancelled before a trustworthy answer was produced.",
  "state": "failed",
  "failure": {
    "reason": "aborted"
  }
}
```

- Public reasons are exactly `invalid_arguments`, `repo_mismatch`, `aborted`, `provider_error`, `tool_failure`, `verifier_error`, `access_denied`, and `internal_error`.
- `budget_exhausted` is not a public reason. Reaching a fixed safety/context ceiling produces `state=incomplete` and a concise gap only for affected goals; `safety_limit_reached` remains an internal gap classification rather than a new public field. A narrow continuation is present only when it can materially help. Exact usage/limit facts remain operational logs.
- If a provider output cap leaves the required planner, goal-auditor, verifier, or final structured response invalid after bounded recovery, use the applicable provider/verifier/internal failure reason and `state=failed`; invalid control JSON is not a partial coverage gap.
- Cancellation never reuses intermediate assistant content as `directAnswer`.
- `directAnswer` is the only human failure message; `failure` does not repeat it.
- `retry` is omitted when retry is not appropriate.
- When present, `retry` is a tool action with exact `{ type: "tool", tool, arguments }` shape; its arguments must validate against one of the six public tool schemas. Failure retries never use `ask_user` or `external_verification`.

## Omission rules

The following are absent from normal v3 output:

- `status`, `confidence`, `verification`, `complete`, and `warnings`
- `nextAction`
- `evidenceQuality`
- `searchCoverage`
- `critic`
- `discoveredPaths`
- `uncertainties`
- `trustSummary`
- sub-goal plan/ledger and claim/verifier diagnostics
- stats, provider/model, token usage, timing, transcript path, and tool trace
- any optional array/object that would be empty

## Text response parity

Some MCP clients display only `content[0].text`. The text rendering therefore mirrors, but does not expand, the structured result:

```text
<directAnswer, only when present>

State: incomplete
Gap: <primary gap>
Follow-up: <one narrow action>
```

- For `complete`, return only `directAnswer` unless locations/evidence are explicitly needed in text.
- For an `incomplete` result with no supported partial fact, begin with `State: incomplete`; do not manufacture or repeat an answer sentence.
- Do not add confidence, trust summaries, search summaries, JSON dumps, or repeated evidence counts.
- For `failed`, include the failure reason and retry only when present.

## Examples

### Complete

```json
{
  "schemaVersion": 3,
  "directAnswer": "`normalizeExploreResult` is defined in `src/explorer/schemas.mjs` and normalizes the model result before runtime enrichment.",
  "state": "complete",
  "evidence": [
    {
      "kind": "source",
      "path": "src/explorer/schemas.mjs",
      "startLine": 363,
      "endLine": 390,
      "supports": "Defines and exports normalizeExploreResult."
    }
  ]
}
```

### Verify targets before editing

```json
{
  "schemaVersion": 3,
  "directAnswer": "The output contract is declared in schemas.mjs and projected by server.mjs; both must change together.",
  "state": "verify_targets",
  "targets": [
    {
      "path": "src/explorer/schemas.mjs",
      "role": "edit",
      "reason": "Change the public output schema here.",
      "evidenceRefs": ["E1"]
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "edit",
      "reason": "Change the agent-facing projection here.",
      "evidenceRefs": ["E2"]
    }
  ],
  "evidence": [
    {
      "id": "E1",
      "kind": "source",
      "path": "src/explorer/schemas.mjs",
      "startLine": 294,
      "endLine": 324,
      "supports": "Declares the public structured output schema."
    },
    {
      "id": "E2",
      "kind": "source",
      "path": "src/mcp/server.mjs",
      "startLine": 699,
      "endLine": 718,
      "supports": "Projects the runtime result into structuredContent."
    }
  ]
}
```

### Incomplete

```json
{
  "schemaVersion": 3,
  "directAnswer": "The API route exists and is called by the settings page.",
  "state": "incomplete",
  "evidence": [
    {
      "kind": "source",
      "path": "src/settings/routes.mjs",
      "startLine": 20,
      "endLine": 34,
      "supports": "The settings page calls the API route."
    }
  ],
  "gaps": [
    {
      "question": "Whether an alternate bootstrap registers the route",
      "reason": "The bootstrap search was truncated before every candidate was inspected."
    }
  ],
  "followUp": {
    "type": "tool",
    "tool": "explore_repo",
    "arguments": {
      "task": "Check bootstrap files for registration of this route.",
      "scope": ["src/app/**", "src/server/**"]
    }
  }
}
```

### Incomplete because repository evidence cannot prove live state

```json
{
  "schemaVersion": 3,
  "state": "incomplete",
  "gaps": [
    {
      "question": "Whether the deployed service currently uses the repository configuration",
      "reason": "This depends on live deployment state that a read-only repository explorer cannot observe."
    }
  ],
  "followUp": {
    "type": "external_verification",
    "requirement": "Inspect the target deployment and report the active configuration revision."
  }
}
```

An all-blocked response has no `directAnswer` or `evidence`, because it contains no supported requested fact. This is `incomplete`, not `failed`.
