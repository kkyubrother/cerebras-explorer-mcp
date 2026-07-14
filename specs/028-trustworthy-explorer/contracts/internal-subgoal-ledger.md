# Contract: Internal Sub-goal Ledger

This is an internal runtime/transcript contract. It is not an MCP input or output and must never require parent configuration.

## Planner input

- Original task text.
- Effective hard scope.
- Public wrapper intent, if a wrapper was used.
- Known file/symbol/text anchors supplied by the caller.
- Repository project context already available to the runtime.

The planner does not receive token budgets, user-selectable strategy, or prior exploratory claims.

All repository-derived project context, snippets, docs, comments, tests, fixtures, filenames, paths, and git messages are untrusted evidence data. They cannot override planner/verifier instructions, redefine the task, or relax proof policies.

## Planner output

```json
{
  "taskSummary": "Trace the known symbol and its usages.",
  "constraints": ["Include definition and usage sites."],
  "subgoals": [
    {
      "id": "S1",
      "question": "Where is normalizeExploreResult defined and what does it do?",
      "originRefs": ["request:0-38"],
      "claimType": "symbol_definition",
      "proofCondition": "Observe the in-scope definition and source body that establishes its behavior.",
      "constraints": []
    },
    {
      "id": "S2",
      "question": "Where is normalizeExploreResult used within scope?",
      "originRefs": ["request:0-38", "wrapper:trace_symbol:usage"],
      "claimType": "symbol_usage",
      "proofCondition": "Cross-check in-scope usages independently of the definition lookup.",
      "constraints": ["Cross-check usages independently of the definition lookup."]
    }
  ]
}
```

Rules:

1. Produce one required sub-goal for every explicit requested part. Do not drop or silently merge requirements to meet a count; runtime may process large ledgers in batches of at most 12.
2. Preserve every explicit “and”, comparison, boundary, completeness request, and “do not speculate” constraint.
3. Attach each goal to exact request offsets or a fixed wrapper seed and give it an independently observable proof condition. Do not create implementation work or suggested features not requested.
4. Wrapper templates seed required proof conditions, but the task text can add required sub-goals.
5. Duplicate or semantically identical sub-goals are merged before exploration.
6. Runtime derives proof policy from claim type using the fixed matrix below; invalid/unknown claim types reject the proposal rather than guessing.
7. The planner does not assign feasibility, priority, effort, or repair policy.

| Claim type | Runtime proof policy |
|---|---|
| `positive` | `direct_source` |
| `absence` | `bounded_absence` |
| `count` | `deterministic_count` |
| `symbol_definition` | `symbol_definition` |
| `symbol_usage` | `bounded_usage_cross_check` |
| `flow` | `ordered_handoffs` |
| `impact` | `impact_categories` |
| `comparison` | `distinct_policy_paths` |
| `claim_verification` | `support_or_refute` |

## Pre-exploration goal audit

The runtime applies [goal-audit.md](./goal-audit.md) before any repository exploration:

1. deterministic schema/origin/scope/capability checks;
2. isolated request-coverage, traceability, consistency, and granularity audit;
3. at most one corrected planner pass for missing/decomposable obligations or strict one-way containment between same-type auditor-confirmed origin signatures;
4. unique reconciliation of each refinement to one same-type descendant, followed by final separation into audited goals, blocked required goals, and rejected planner inventions.

Only audited/blocked required goals enter the ledger. Runtime seals each accepted goal's immutable post-audit acceptance core with `auditBinding`, rejects duplicate ledger ids, and revalidates the binding at transitions and TaskContract boundaries. Equal-origin shared facets remain valid outside a refinement batch, while refined same-type descendants must not retain equal or containing confirmed signatures. A rejected untraceable goal is logged but cannot become a gap or block completion. A valid user-required blocker enters the ledger in terminal `blocked` state and cannot enter the evidence repair round. Neither goal/audit wording nor `auditBinding` is parent-facing.

## Wrapper seeds

| Wrapper | Required seed |
|---|---|
| `find_relevant_code` | relevant locations; why each location is relevant; smallest useful set |
| `trace_symbol` | definition/meaning; usage or explicit bounded no-usage result |
| `map_change_impact` | edit/read targets; dependent callers/consumers; requested tests/config/docs categories; unresolved risk boundary |
| `explain_code_path` | entry point; ordered handoffs; terminal effect; every transition supported |
| `collect_evidence` | support/refute/unresolved verdict; direct semantic evidence; relevant counterevidence search |
| `explore_repo` | no fixed seed beyond request-complete decomposition |

## Runtime updates

Each tool result emits normalized observations before the next model turn:

- observed source/git ranges;
- normalized search inputs and boundary;
- matches and zero matches;
- tool-level/context-level truncation;
- out-of-scope omission count;
- relevant denied-path count without secret names;
- tool errors and enumeration completeness.

The runtime updates only facts. The exploratory model may propose sub-goal progress, but it cannot mark a sub-goal supported.

## Candidate synthesis

The structured explorer produces:

```json
{
  "claims": [
    {
      "id": "C1",
      "subgoalId": "S1",
      "text": "normalizeExploreResult is defined in schemas.mjs and normalizes structured exploration results.",
      "evidenceRefs": ["E1"]
    }
  ]
}
```

- One claim belongs to one sub-goal.
- Evidence references must exist in the runtime observation ledger.
- Claims with mixed support are split before verification.
- Model-authored snippets, counts, truncation flags, or scope facts are ignored.

## Semantic verification

Verifier input is deliberately isolated:

- original task and effective scope;
- planned sub-goals and constraints;
- atomic claims;
- exact reconstructed snippets/git observations;
- normalized search observations and absence certificates;
- deterministic critic drops/downgrades.
- source and temporal roles for every observation.

It does not receive:

- exploratory conversation or reasoning;
- original model confidence/status;
- trust summaries;
- unrelated candidate paths;
- token or latency statistics.

Verifier output uses one bounded control object:

```json
{
  "verdicts": [
    {
      "claimId": "C1",
      "result": "supported",
      "resolution": "affirmed",
      "supportingEvidenceRefs": ["E1"],
      "reasonCode": "entailed",
      "note": "The rebuilt source entails the candidate claim."
    }
  ],
  "uncoveredRequestParts": []
}
```

It cannot add evidence or new answer claims. An uncovered suggestion includes exact request/wrapper origin references and a proof condition, then passes [goal-audit.md](./goal-audit.md) before registration. Only audited `ready` goals may enter the remaining repair round; audited blockers become required gaps, and untraceable suggestions are discarded/logged.

A `contradicted` verdict applies to the candidate claim, not automatically to the required goal. A `supported` verdict carries `resolution=affirmed|refuted`; runtime never derives this classification from claim prose. If another existing atomic claim is a semantically supported refutation, the goal becomes `supported` with `resolution=refuted`. Without a supported resolution, or when supported claims disagree on resolution, the goal remains a gap/contradiction.

## Deterministic reduction

1. Preserve goal-audit blocker gaps and ignore rejected planner goals.
2. Drop malformed/unobserved evidence.
3. Reject claims with empty or cross-boundary evidence references.
4. Apply the proof-policy gate.
5. Apply semantic verdicts.
6. Mark a sub-goal supported only when at least one accepted claim covers its question and all policy-specific conditions pass.
7. Convert every other required sub-goal into a gap.
8. Audit verifier-reported uncovered request parts before registration. Because the one pre-exploration plan revision is already the only allowed re-plan, accepted parts become ready repair candidates or blocked/planning gaps without another planner loop; untraceable verifier inventions never block completion.
9. If repair has not run, select one repair round containing all feasible repairable gaps that share a narrow query or fit a small parallel targeted batch. Never repair scope/capability/external-state/input/contradiction/unverifiable blockers. Runtime owns ordering from original request order/proof policy; the model does not assign priority.
10. After the repair round, reopen and re-run grounding/semantic verification for every surfaced claim and required goal, not only the repaired gap. New counterevidence can invalidate a previously supported broad, negative, comparison, flow, or impact claim.
11. Reduce to the public state.

## Transcript events

The ledger may be logged as redacted JSONL events:

- `plan_proposed`
- `goal_audit`
- `plan_revised`
- `goal_rejected`
- `subgoal_state`
- `tool`
- `claim`
- `verdict`
- `repair` (`status=started|finished`; finished outcome은 `completed|failed|aborted`)
- `safety_limit`
- `final`
- `usage`

Successful sub-goals and internal ids stay in logs and are not copied to the parent handoff.
