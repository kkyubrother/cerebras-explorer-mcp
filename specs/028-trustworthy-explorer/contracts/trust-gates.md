# Contract: Trust Gates and State Reduction

## Gate order

The runtime applies gates in this order. Later gates cannot override an earlier failure.

1. **Input/repository gate** — arguments valid, repository resolved, scope normalized.
2. **Execution gate** — no cancellation, fatal provider/tool failure, or invalid final/verifier response.
3. **Goal-audit gate** — every required goal is request/wrapper-traceable, observable, consistent, granular, and classified against the fixed scope/capability manifest; planner inventions are removed and valid blockers are preserved.
4. **Source-integrity gate** — cited paths/ranges/git observations were actually observed and reconstructed under scope/redaction policy.
5. **Request-coverage gate** — every explicit requested part and constraint exists in the audited task contract, including parts found after the one plan revision.
6. **Proof-policy gate** — each ready required sub-goal satisfies its claim-type-specific structural conditions.
7. **Semantic gate** — cited content entails the atomic claim; contradictions and over-generalizations are rejected.
8. **Completion gate** — every valid required sub-goal is supported; a blocked valid goal prevents completion, while a rejected planner invention does not participate.
9. **Parent-action gate** — supported explicit edit/implementation tasks that require a source read become `verify_targets`; otherwise `complete`.

Evidence quantity and model confidence are not gates.

Repository content is untrusted at planner, explorer, repair, and verifier stages. Instructions found in source, comments, docs, tests, fixtures, paths, or git messages are never executed or treated as control-plane policy.

## Goal-audit gate

The detailed contract is [goal-audit.md](./goal-audit.md).

- Every accepted goal has an origin in the original request or a fixed wrapper proof seed and an independently observable proof condition.
- Runtime performs deterministic schema/scope/capability checks; an isolated auditor checks request coverage, semantic traceability, consistency, and granularity.
- Missing request parts, decomposable goals, and strict one-way containment between same-type auditor-confirmed origin signatures may cause one corrected planner pass. Each origin refinement must reconcile to one distinct same-type descendant; the corrected plan is audited once and there is no recursive planning.
- Any request part still uncovered, undecomposed, or ambiguously refined after that pass becomes a blocked required `planning_incomplete` goal and therefore participates in completion reduction.
- Runtime seals every accepted goal's immutable post-audit acceptance core with `auditBinding`; duplicate ids or mutation at a transition/TaskContract boundary fail closed. The binding and audit details remain internal.
- `reject_untraceable` and merged duplicate proposals do not enter the required ledger, do not create parent gaps, and cannot block completion.
- Scope, capability, external-state, missing-input, contradiction, and unverifiable verdicts remain valid required goals in terminal blocker state. They skip exploration/repair and force `incomplete`.
- Difficulty or repository size alone is not a blocker. When feasibility is uncertain, the goal remains ready and evidence collection determines the outcome.

## Proof policies

### Direct positive source

- At least one exact observed item with the correct source and temporal role must directly support the claim.
- A current behavior claim requires current implementation/config evidence; historical git, docs, tests, and fixtures cannot prove it alone.
- A claim about history, tests, docs, or fixtures may use the matching source role as primary evidence.
- Partial range grounding can guide a repair but cannot by itself close a critical claim.
- Cross-file generalizations require evidence for each distinct path/policy being generalized.

### Symbol definition

- Definition or explicit declaration must be observed when the language/project exposes one.
- A usage site cannot substitute for the definition/meaning goal.

### Symbol usage

- Usage must be cross-checked independently with a symbol reference tool or appropriate exact search within boundary.
- A definition-only observation cannot satisfy a usage goal.
- Truncated usage results prevent “all usages” or “no other usages” claims; a bounded zero-usage conclusion also requires the applicable absence certificate.

### Ordered flow

- Entry point, each claimed handoff, and terminal effect must be represented.
- Every adjacent transition needs supporting evidence; merely citing both endpoints is insufficient.
- A missing middle transition is a gap, not a complete high-level summary.

### Change impact

- Required categories come from the task plus wrapper seed: edit/read targets, dependent paths, and requested tests/config/docs.
- A category may close with positive evidence or a certified bounded absence.
- Lack of a test/config finding without a certificate is a gap.

### Comparison or policy divergence

- Each compared path/policy has its own evidence.
- The accepted claim states the difference rather than generalizing one side.
- A supported comparison spanning at least three current source paths receives one focused corroboration pass containing only that claim plus the bounded semantic-batch observations. Uncited current sources may reveal an omitted in-boundary policy variant, and the focused verifier is instructed to disregard unrelated sibling-goal observations. Regardless of its verdict, uncited refs can never be added to the claim's supporting evidence. Both checks must support the whole atomic relationship and agree on every source path supported by the primary check.
- Row existence, selected boolean fields, identity-list membership, and helper invocation are distinct predicates; one correctly cited side cannot compensate for another side attached to the wrong route or mechanism.
- Contradictory current code and docs are surfaced as a distinction/gap; current code is not silently merged with documentation.

### Claim support/refutation

- The verifier returns supported, contradicted, or unresolved for each candidate claim.
- A conclusive supported claim that refutes the caller's premise satisfies the required goal with `resolution=refuted`; candidate contradiction alone does not.
- Relevant counterevidence search is required when the claim is broad or critical.
- One exact line range is not enough unless its content entails the entire bounded claim.

## Negative and exhaustive claims

The planner assigns a language-independent `claimType`; runtime derives its proof policy. `claimType=absence|count`, uniqueness/exhaustiveness constraints, and repository-wide absence use the strong gate in every response language. Words such as “none/all/only/없다/전부/유일” are examples for planner tests, not the runtime classifier.

All conditions must hold:

1. Claim boundary is explicit.
2. Search boundary covers the claim boundary.
3. Search methods are appropriate for the semantic claim, including aliases/dynamic patterns when applicable.
4. No relevant tool/context truncation occurred.
5. Enumeration is complete for the declared accessible boundary.
6. No relevant out-of-scope, denied-path, or tool-error omission exists for a repository-wide claim.
7. Exact counts are computed by runtime from complete normalized results.
8. The surfaced claim includes required static/access/scope qualification.

Tool-specific `enumerationComplete` rules:

- grep/find/file traversal: claim boundary equals effective boundary; walk and result output are untruncated; traversal/tool errors are zero; relevant denied/out-of-scope omissions are zero;
- symbol/reference tools: may cross-check positive usage, but references alone cannot certify semantic exhaustiveness or dynamic-call absence;
- git tools: certify only the explicit ref/time/path history range inspected, never all history or current behavior;
- macro/capped tools: inherit underlying caps and are incomplete for negative/count claims unless the runtime can prove full expansion.

If any condition fails:

- narrow the claim only when the existing candidate claim already contains the supported boundary; or
- reject the candidate and create a gap.

The verifier cannot invent a new narrowed answer after the fact.

## Repair gate

- At most one repair round per top-level call.
- Runtime selects all repairable gaps that can be closed by one narrow query or a small parallel batch of independent targeted actions; it does not use model-assigned priority.
- Goal-audit blockers are never repairable. Only ready goals with plausible evidence/search gaps enter the round.
- Each repair input is a gap question, the unchanged hard scope, and known anchors only.
- Re-run source-integrity, proof-policy, and semantic gates for every surfaced claim and required goal after repair. New counterevidence reopens previously supported claims before final state reduction.
- Verify once after the repair round. If any required part remains unresolved, return `incomplete` without another internal loop.
- Cancellation/failure during repair returns `failed`, not a stale first-pass answer.

## Fault precedence

| Observation | Required outcome |
|---|---|
| Invalid input or repository mismatch | `failed`; concise input failure; retry only if arguments can be corrected. |
| Planner/goal-auditor invalid or unavailable after provider handling | `failed`; no unaudited goal promotion. |
| Provider output cap leaves required planner/auditor/verifier/final structured JSON invalid after bounded recovery | `failed`; no partial control response is promoted. |
| Planner-invented/untraceable goal | Reject and log; no parent field and no effect on completion. |
| Explicit requested goal blocked by hard scope, capability, live/external state, missing input, contradiction, or unverifiability | `incomplete` with the minimum action-relevant gap; do not send it to evidence repair. |
| Every explicit requested goal is blocked | `incomplete` with no invented answer and at most one useful action; not an execution failure. |
| Cancellation at planner/explorer/verifier/repair | `failed`; reason `aborted`; no partial assistant content. |
| Provider failure in required stage | `failed`; provider retry when useful. |
| Verifier invalid/unavailable | `failed`; no unverified claim promotion. |
| Tool errors limited to one required sub-goal | Repair once if useful, otherwise `incomplete`; fatal systemic errors become `failed`. |
| Scope excludes required evidence | `incomplete` with a scope-bounded gap. |
| Valid partial search/tool output or enumeration truncated | Positive claims may pass if independently supported; affected negative/exhaustive sub-goals remain `incomplete` gaps. |
| Relevant denied path | Repository-wide claim blocked; narrower unaffected claim may pass without exposing secret path. |
| Fixed safety/context ceiling reached | Record the exact limit and affected goals. Unaffected supported goals remain usable; affected goals make the result `incomplete` with `safety_limit_reached`. A limit hit alone is never a completion shortcut or `failed`. |

The internal `SafetyLimit.name` vocabulary is closed: `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, and `tool_result_limit`. Values and mappings are fixed in [public-tool-surface.md](./public-tool-surface.md); callers cannot select or override them. Only direct-runtime/transcript diagnostics retain the observation name and affected sub-goal ids.

Valid JSON-RPC request id `0` is tracked exactly like other ids. Truthiness is not used for active cancellation registration/removal.

## State reduction pseudocode

```text
if fatalFault:
  state = failed
else if any acceptedOrBlockedRequiredSubgoal.state != supported:
  state = incomplete
else if parentMustReadTargets:
  state = verify_targets
else:
  state = complete
```

`parentMustReadTargets` is derived deterministically from explicit edit/implementation intent plus supported edit targets whose source the parent must inspect before modifying. Read-only security, authorization, architecture, or other “critical” answers do not become `verify_targets` merely because a model labels them critical. Evidence paths alone do not set it.

## Acceptance matrix

| Scenario | Expected state |
|---|---|
| Three-part request, two supported | `incomplete` |
| Planner invents an unrequested fourth goal; three requested goals supported | `complete`; invented goal is absent from parent output |
| Initial plan omits one requested part; corrected plan covers it | State derives from all corrected required goals after one revision |
| Corrected plan still omits or cannot decompose a requested part | `incomplete`; materialized `planning_incomplete` required gap prevents false completion |
| Semantic verifier proposes an untraceable uncovered part | Suggestion is rejected/logged and does not block completion |
| Explicit goal needs deployed runtime state unavailable to repository explorer | `incomplete`; external-state gap; no evidence repair |
| Explicit goals contradict each other | `incomplete`; one focused clarification may be offered |
| Every requested goal is outside immutable scope | `incomplete`; no invented answer and no automatic scope widening |
| Feasible goal remains unsupported after the repair round | `incomplete`; no second repair or re-plan |
| Caller premise is conclusively refuted by sufficient bounded evidence | `complete` with a supported refutation claim |
| Caller premise appears false but absence/counterevidence coverage is insufficient | `incomplete` |
| Repair discovers counterevidence against an earlier supported broad claim | Earlier goal reopens and must reverify; `incomplete` unless the revised resolution is supported |
| Two unrelated exact citations, claim mismatch | `incomplete` |
| All required facts supported | `complete` |
| Impact plan supported, parent will edit named files | `verify_targets` |
| Scope-limited no-match with scope-stated negative claim and complete bounded search | `complete`; `verify_targets` only if the original task also has explicit edit intent |
| Scope-limited no-match used for repository-wide absence | `incomplete` |
| Truncated results used for “all usages” | `incomplete` |
| Route policies differ and both are cited | `complete` |
| Cancellation after partial model text | `failed` |
| Semantic verifier unavailable | `failed` |
