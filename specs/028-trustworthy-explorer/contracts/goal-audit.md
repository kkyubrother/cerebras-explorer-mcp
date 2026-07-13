# Contract: Goal Audit and Feasibility

This contract runs after the initial planner and before repository exploration. It prevents a planner-created obligation from becoming a completion requirement unless it is traceable to the delegated request or a retained wrapper's fixed proof seed.

## Inputs

- original task text, unchanged;
- normalized hard scope;
- retained wrapper intent and its fixed proof seed, if any;
- fixed explorer capability manifest;
- proposed constraints and goals;
- revision count, `0` or `1`.

The audit receives no repository content, exploratory messages, candidate claims, confidence, token statistics, or effort settings.

## Planner proposal

Every proposed goal has:

```json
{
  "id": "S1",
  "question": "Determine whether the legacy route is absent from every in-scope bootstrap.",
  "originRefs": ["request:18-62"],
  "claimType": "absence",
  "proofCondition": "Every in-scope bootstrap is enumerated and a bounded absence certificate covers the legacy route registration patterns.",
  "constraints": ["Do not infer deployed runtime state."]
}
```

- A `request:<start>-<end>` reference must point to a valid non-empty range in the original task. Exact range validity is checked by runtime.
- A `wrapper:<tool>:<seed>` reference must name a fixed seed from the public-tool contract.
- A valid offset is necessary but not sufficient: the isolated auditor still checks that the goal is semantically entailed by the referenced request text or wrapper seed.
- `proofCondition` describes an observable repository/search condition. “The model is confident” and restatements of the answer are circular and invalid.
- The planner does not author `proofPolicy`, feasibility, priority, or repair count.

## Deterministic preflight

Before the model audit, runtime rejects or normalizes:

1. malformed/duplicate ids and invalid request offsets;
2. unknown claim types or claim type/proof-policy combinations;
3. exact duplicate goals, while unioning origin references and constraints;
4. proof conditions that are empty or explicitly depend on confidence/status;
5. proposed scope wider than the normalized hard scope;
6. explicit write, secret-path read, scope-widening, live-system, or external-network actions outside the capability manifest.

Mechanical duplicates are merged. Other defects are sent to the isolated auditor as diagnostics; runtime never guesses a replacement goal.

## Isolated auditor output

```json
{
  "goals": [
    {
      "id": "S1",
      "verdict": "ready",
      "confirmedOriginRefs": ["request:18-62"],
      "reason": "The goal is requested, bounded, and has an observable repository proof condition."
    }
  ],
  "uncoveredRequestParts": []
}
```

Allowed verdicts:

| Verdict | Meaning | Required-ledger effect |
|---|---|---|
| `ready` | Traceable, internally consistent, granular enough, and not certainly blocked. | Add as audited required goal. |
| `merge_duplicate` | Same obligation as another goal. | Merge origins/constraints into the named goal; no new obligation. |
| `needs_decomposition` | Traceable but one verdict/proof condition cannot cover the whole goal. | Request revision when count is `0`; otherwise create a planning gap. |
| `reject_untraceable` | Not entailed by the request or wrapper seed, or is circular planner invention. | Log and discard; never blocks or appears to parent. |
| `blocked_scope` | Explicit requirement needs evidence outside the immutable scope. | Add required blocked goal; no internal repair. |
| `blocked_capability` | Explicit requirement needs a prohibited operation such as a write/secret read. | Add required blocked goal; no internal repair. |
| `requires_external_state` | Repository evidence cannot establish the requested mutable/live fact. | Add required blocked goal; no internal repair. |
| `missing_input` | A caller-supplied identifier, boundary, artifact, or choice is necessary before proof is possible. | Add required blocked goal; optionally ask one focused question. |
| `contradictory` | Two explicit requirements cannot simultaneously be satisfied as written. | Preserve both origins in one required blocker; optionally ask one focused question. |
| `unverifiable` | The requested conclusion has no observable acceptance condition within the supplied task and capability manifest. | Add required blocked goal; no speculative answer. |

Auditor rules:

- Difficulty, likely token use, repository size, or lack of an obvious search path is not infeasibility.
- A false premise or negative outcome is not infeasibility when repository evidence or a bounded absence certificate can support/refute it. Such a goal remains `ready`.
- `contradictory` applies to mutually incompatible caller requirements, not merely to conflicting repository sources; source disagreement is an evidence result the explorer should preserve.
- A blocker verdict requires a concrete conflict with scope, capability, supplied input, or observability. Otherwise use `ready`.
- A traceable user requirement cannot receive `reject_untraceable`.
- The auditor cannot add new task requirements, modify hard scope, relax a proof policy, or suggest implementation work.
- Runtime derives whether revision is required from uncovered request parts and `needs_decomposition` verdicts. The auditor cannot request extra passes or set the revision count.

## One revision

When runtime derives `revisionRequired=true` and `revisionCount=0`, the planner receives only:

- the original request/scope/wrapper seed;
- accepted and blocked goals that must be preserved;
- uncovered request parts;
- goals requiring decomposition;
- deterministic/auditor defect reasons.

The corrected plan is audited once with `revisionCount=1`. No further planner call is allowed. For every remaining uncovered or still-decomposable request part, runtime creates a blocked required goal carrying the original request references, `auditVerdict=planning_incomplete`, and a `planning_incomplete` gap. These synthetic required goals participate in completion reduction; silently keeping a free-floating diagnostic would permit false completion.

## Late uncovered suggestions

`uncoveredRequestParts` from the semantic verifier are untrusted goal proposals, not automatically required goals. Each suggestion must include original-request/wrapper origin references and an observable proof condition, then pass this same deterministic and isolated audit contract:

- untraceable suggestions are rejected/logged and cannot block completion;
- `ready` suggestions become required and may enter the repair round only if it has not run;
- scope/capability/external-state/input/contradiction/unverifiable outcomes become blocked required gaps;
- still-decomposable suggestions become `planning_incomplete` blocked required goals because no plan revision remains;
- suggestions found during post-repair verification may become required gaps after audit but cannot start another plan or repair loop.

## Reduction and repair eligibility

1. Discard `reject_untraceable` goals and store them only in the redacted operational trace.
2. Merge duplicates without losing request references or constraints.
3. Put `ready` goals into exploration.
4. Put blocker verdicts directly into terminal required gaps.
5. Never send blocker gaps to the evidence repair round.
6. A `ready` goal that later lacks evidence may enter the single repair round if one narrow action can plausibly help.
7. If every required goal is blocked, return `incomplete` immediately after producing the minimal gap/action handoff; this is not `failed`.

## Parent boundary

The parent never receives goal ids, audit verdict names, rejected goals, capability manifests, revision history, or audit explanations. It receives only:

- supported requested facts, if any;
- one concise gap per unresolved requested part (grouped only when no distinction is lost);
- at most one action that could materially change the result;
- `state=incomplete` for valid blockers, or `state=failed` only for an execution fault.
