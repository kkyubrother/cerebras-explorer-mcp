# Data Model: Trustworthy, Quiet Explorer

The model is split into an internal trust plane and a minimal parent handoff. Internal ids and diagnostics must not leak into the normal parent payload unless they are required to link surfaced evidence.

## 1. Task Contract

Represents the original delegated request after internal planning.

| Field | Type | Rule |
|---|---|---|
| `task` | string | Original task text, preserved verbatim internally. |
| `effectiveScope` | string[] | Normalized hard scope applied to every repository tool. Empty means the explorer-accessible repository boundary, not unrestricted filesystem access. |
| `constraints` | string[] | Explicit prohibitions, comparisons, completeness requests, output distinctions, and user qualifications. |
| `capabilities` | CapabilityManifest | Fixed read-only/static explorer capabilities and unavailable operations/state used by goal audit. Not model-authored. |
| `subgoals` | RequiredSubgoal[] | One audited required unit per explicit requested part or wrapper proof seed. No semantic cap; runtime may process batches of at most 12. |
| `plannerVersion` | string | Internal prompt/schema version for transcript reproducibility. |
| `goalAuditVersion` | string | Internal validator/auditor version for transcript reproducibility. |

Validation:

- Every explicit requested part must map to at least one accepted or blocked required sub-goal.
- Every constraint must be attached to one or more sub-goals or to the whole task.
- Required sub-goal ids are unique. Every accepted goal carries a runtime-owned audit binding over its immutable post-audit acceptance core; TaskContract creation and validation both fail closed on duplicate ids or a binding mismatch.
- A missing requested part, decomposable goal, or same-type goal whose auditor-confirmed origin signature strictly contains a sibling signature is corrected through at most one plan revision. A later uncovered or still-ambiguous part is inserted as a required goal/gap and blocks completion without recursive planning.
- Rejected planner-invented goals are retained only in the operational audit record and are not members of `subgoals`.
- The plan is internal; the parent does not receive it.

## 2. Required Sub-goal

One independently verifiable part of the request.

| Field | Type | Rule |
|---|---|---|
| `id` | string | Stable within one call, for example `S1`. |
| `question` | string | Concise statement of what must be established. |
| `originRefs` | string[] | Non-empty references to original request parts or a wrapper proof seed. Empty/untraceable goals cannot become required. |
| `claimType` | enum | `positive`, `absence`, `count`, `symbol_definition`, `symbol_usage`, `flow`, `impact`, `comparison`, `claim_verification`. Definition and usage are distinct so one cannot accidentally satisfy the other. |
| `proofPolicy` | enum | Runtime-derived from `claimType`; never independently authored by the planner. |
| `proofCondition` | string | Independently observable completion condition; cannot be circular or rely on model confidence. |
| `constraints` | string[] | Relevant user constraints and claim boundary. |
| `auditVerdict` | enum | `ready`, a valid blocker verdict, or runtime-derived `planning_incomplete` after the one revision. Rejected/merge candidates never enter the required ledger. |
| `auditBinding` | string | Runtime-owned checksum over `id`, `question`, confirmed `originRefs`, `claimType`, `proofPolicy`, `proofCondition`, `constraints`, and `auditVerdict`. Recomputed at transitions and TaskContract boundaries; never parent-facing. |
| `state` | enum | `audited`, `blocked`, `exploring`, `candidate`, `supported`, `gap`, `contradicted`. |
| `resolution` | enum? | `affirmed` or `refuted`, present only for `supported`. A proven false premise is a supported refutation, not a contradicted goal. |
| `claimRefs` | string[] | Atomic candidate claims intended to satisfy this sub-goal. |
| `blockerRef` | string? | Present when audit establishes a valid non-repairable blocker. |
| `gapRef` | string? | Present only for a terminal non-supported state. |

State transitions:

```text
draft -> audit -> rejected_untraceable|merged              (not required)
              -> needs_revision -> revised draft -> audit  (one revision only)
              -> blocked                                    (required terminal gap)
              -> audited -> exploring -> candidate -> supported
                                           |
                                           +-> gap
                                           +-> contradicted

repairable gap --one repair round--> exploring -> candidate -> supported|gap|contradicted
supported --repair adds relevant counterevidence--> candidate -> supported|gap|contradicted
```

No transition from a terminal non-supported state to `supported` is allowed without new recorded evidence and another semantic verification. `contradicted` means the available evidence leaves the required question unresolved or internally conflicting. When evidence conclusively refutes the caller's premise, an atomic refutation claim is accepted and the goal becomes `supported` with `resolution=refuted`.

## 3. Goal Audit

Runtime-owned validation of the planner output before repository exploration.

### Capability Manifest

| Field | Type | Rule |
|---|---|---|
| `repositoryRead` | const `true` | Scope-checked current source/config/docs/tests/fixtures may be inspected. |
| `gitRead` | const `true` | Scope-checked read-only history/diff/blame/show are available. |
| `repositoryWrite` | const `false` | Goals requiring edits or state mutation cannot be completed by the explorer. The explorer may still map change impact. |
| `liveRuntimeState` | const `false` | Running processes, deployed services, databases, browser state, and external systems cannot be established unless already supplied as evidence in the request. |
| `scopeWidening` | const `false` | The runtime cannot expand hard scope on its own. |
| `secretPathRead` | const `false` | Denied paths remain unavailable regardless of provider policy. |

### Audit record

| Field | Type | Rule |
|---|---|---|
| `proposedGoalId` | string | Id from the planner proposal. |
| `verdict` | enum | `ready`, `merge_duplicate`, `needs_decomposition`, `reject_untraceable`, `blocked_scope`, `blocked_capability`, `requires_external_state`, `missing_input`, `contradictory`, or `unverifiable`. |
| `originRefs` | string[] | Auditor-confirmed request/wrapper references. |
| `mergeInto` | string? | Required only for a duplicate. |
| `missingRequestParts` | string[] | Explicit request parts not covered by the proposed plan. |
| `reason` | string | Compact internal explanation; never copied verbatim to the parent. |

Rules:

- Deterministic schema, capability, scope, claim-type/proof-policy, and duplicate checks run before the isolated auditor.
- The isolated auditor sees the original request, wrapper seed, scope, capability manifest, and proposed goals only. It does not see repository content or exploratory prose.
- A goal with no confirmed origin reference is rejected even when it appears useful.
- A goal traceable to the user cannot be rejected merely because it is hard. A certain infeasibility becomes a blocker; uncertainty remains `ready` for evidence collection.
- `needs_decomposition`, uncovered request parts, or strict one-way containment between same-type auditor-confirmed origin signatures may trigger exactly one corrected planner output. Each refinement obligation maps to exactly one same-type descendant, one corrected goal cannot satisfy two refinement obligations, and equal/containing refined signatures fail closed. The corrected output is audited once; remaining defects become required gaps.
- After that revision, every still-uncovered or still-decomposable request part is materialized as a blocked required goal with its origin references, `auditVerdict=planning_incomplete`, and a `planning_incomplete` gap. It therefore participates in state reduction and cannot disappear as a free-floating diagnostic.
- Every accepted/blocked required goal is sealed only after audit. The checksum detects post-audit acceptance-core mutation; exploration state, resolution, and claim references remain outside the binding so legal state transitions can proceed.
- Rejected and merged proposal records stay in logs. Only accepted/blocked required goals enter the task contract.

## 4. Atomic Claim

A candidate answer sentence that can be accepted or dropped as a unit.

| Field | Type | Rule |
|---|---|---|
| `id` | string | Stable within a call, for example `C1`. |
| `subgoalId` | string | Exactly one required sub-goal. Cross-cutting conclusions must be split. |
| `text` | string | Concise claim without confidence language. |
| `evidenceRefs` | string[] | One or more observation/evidence ids. Empty references cannot be accepted. |
| `verdict` | enum | `pending`, `supported`, `insufficient`, `contradicted`. |

Rules:

- Claims must be atomic enough that one verdict applies to the whole text.
- Claim polarity/proof behavior is derived from the associated sub-goal's `claimType`; candidate claims do not carry an independently conflicting polarity.
- A claim cannot cite an evidence item from outside the associated sub-goal's proof boundary.
- The semantic verifier cannot create new claim text. It accepts or rejects the candidate and may explain the internal reason.
- Only `supported` claims contribute to `directAnswer`.

## 5. Evidence Observation

Runtime-owned fact derived from repository/git tools and reconstructed source.

### Source Observation

| Field | Type | Rule |
|---|---|---|
| `id` | string | Stable evidence id. |
| `kind` | const | `source`. |
| `path` | string | Repository-relative, scope-checked path. |
| `startLine`, `endLine` | integer | Valid observed range. |
| `snippet` | string | Rebuilt by runtime, redacted, exact useful lines only. |
| `rangeGrounding` | enum | `exact` or `partial`; describes observation coverage only. |
| `sourceRole` | enum | Runtime-classified `implementation`, `test`, `config`, `documentation`, `fixture`, `generated`, or `unknown`. |
| `temporalRole` | enum | Runtime-derived `current` or `historical`. File reads are current; git observations state their historical/current relationship explicitly. |
| `redacted` | boolean | Whether source/path content was redacted. |

### Git Observation

| Field | Type | Rule |
|---|---|---|
| `id` | string | Stable evidence id. |
| `kind` | enum | `git_commit`, `git_blame`, `git_diff_hunk`. |
| `sha` | string | Observed commit when applicable. |
| `path` | string? | Scope-filtered repository-relative path. |
| `startLine`, `endLine` | integer? | Observed range when applicable. |
| `content` | string | Compact redacted observed content used by verifier. |
| `temporalRole` | enum | Normally `historical`; a diff may compare historical/current sides but cannot silently prove current behavior. |

### Search Observation

Internal coverage fact. It becomes a public absence evidence item only after certification.

| Field | Type | Rule |
|---|---|---|
| `id` | string | Stable search id. |
| `kind` | const | `search`. |
| `tool` | string | Repository tool used. |
| `normalizedArgs` | object | Redacted normalized pattern/symbol/path inputs. |
| `boundary` | string[] | Effective claim/search boundary. |
| `matchCount` | integer | Runtime-computed result count. |
| `toolTruncated` | boolean | Tool indicated bounded/truncated output. |
| `contextTruncated` | boolean | Runtime truncated result before synthesis. |
| `omittedOutOfScopeFiles` | integer | Files intentionally omitted by hard scope. |
| `deniedPaths` | integer | Relevant denied/secret-path omissions, without exposing names. |
| `errors` | integer | Search/tool failures. |
| `enumerationComplete` | boolean | Runtime can establish that the intended accessible boundary was inspected for this search method. |

`rangeGrounding=exact` must never be interpreted as semantic claim support. Semantic support exists only after a claim verdict.

Source-role rules:

- Claims about current behavior require current implementation/config evidence appropriate to the claim.
- Tests, documentation, fixtures, and historical git may corroborate current behavior but cannot prove it alone.
- Claims specifically about a test, document, fixture, or change history use that matching source role as primary evidence.
- When current code and docs/tests/history disagree, preserve the distinction and create a contradiction/gap as required.

`enumerationComplete` is computed by runtime, never by a model:

- `repo_grep`/file discovery: effective boundary equals the claim boundary; filesystem walk and result output are not truncated; traversal/tool errors are zero; relevant denied/out-of-scope omissions are zero.
- `repo_references`: useful for a cross-check, but never sufficient by itself to certify semantic exhaustiveness because dynamic/aliased references may exist.
- git log/diff/show/blame: certifies only the explicitly inspected history/ref/path range, never all repository history or current behavior.
- Macro/symbol tools inherit the completeness of their underlying searches and caps; an opaque capped result cannot certify absence/all/count claims.

## 6. Absence Certificate

Runtime-owned proof that a bounded negative/count/unique claim is safe to surface.

| Field | Type | Rule |
|---|---|---|
| `id` | string | Public evidence id if surfaced. |
| `subgoalId` | string | Associated absence/count sub-goal. |
| `claimBoundary` | string[] | Boundary stated by the accepted claim. |
| `searchRefs` | string[] | Search observations that collectively cover the proof policy. |
| `searchSummary` | string[] | Small normalized list of search concepts, not raw transcript. |
| `complete` | boolean | True only when every negative gate passes. |
| `qualification` | string? | Required static/dynamic/access limitation included in the claim. |

Certificate rules:

- `claimBoundary` must be no broader than every effective search boundary.
- `toolTruncated`, `contextTruncated`, relevant `omittedOutOfScopeFiles`, relevant denied paths, errors, or incomplete enumeration make `complete=false` for repository-wide claims.
- Zero-match literal grep alone certifies only that literal's bounded textual absence.
- A zero-match filename glob certifies only bounded filename absence. It cannot by itself refute behavior, registration, function existence, or another mechanism premise.
- For `support_or_refute`, a complete certificate is necessary but not sufficient when no direct source/git counterexample exists. An independent focused verifier must agree on `supported/refuted` and every `searchRef` of one complete certificate. Runtime retains that agreement as an ephemeral proof artifact and does not expose it to the parent.
- Counts are calculated by runtime from complete normalized results, never copied from model prose.

## 7. Semantic Verdict

Output of the isolated verifier, retained internally.

| Field | Type | Rule |
|---|---|---|
| `claimId` | string | Existing candidate claim only. |
| `result` | enum | `supported`, `insufficient`, `contradicted`. |
| `resolution` | enum? | Required only for `supported`: `affirmed` or `refuted`. It classifies the supported claim against the required question; runtime never infers this from claim prose. |
| `supportingEvidenceRefs` | string[] | Subset of the claim's existing references. |
| `reasonCode` | enum | `entailed`, `semantic_mismatch`, `overgeneralized`, `missing_transition`, `missing_category`, `boundary_mismatch`, `contradiction`, `uncovered_request`. |
| `note` | string | Compact internal diagnostic, recorded in transcript. |

Every supported verdict must carry exactly one resolution. Non-supported verdicts must not carry one. If supported claims for the same required goal disagree on resolution, the goal remains contradicted and incomplete rather than selecting a result by model or array order.

Certificate-only refutations are accepted only when the primary and focused verdicts agree on `supported/refuted` and one complete certificate's full search-ref set. Direct source/git counterexamples do not need the focused pass. The agreement marker is runtime-only and is not part of `SemanticVerdict` or schema-v3 parent output.

The verifier may also return `uncoveredRequestParts[]`. Each proposed part contains a question, exact original-request/wrapper origin references, claim type, proof condition, and constraints. It is not registered directly. Runtime sends the batch through the same deterministic traceability/scope/capability checks and isolated goal-audit rules without another planner revision:

- `reject_untraceable` suggestions are logged and discarded;
- audited `ready` goals become required and may enter the remaining repair round;
- blocker or `planning_incomplete` outcomes become blocked required goals and never enter repair;
- suggestions first discovered after repair still undergo audit, become terminal gaps when valid, and cannot start another repair or plan revision.

## 8. Coverage Gap

Minimal unresolved requirement.

| Field | Type | Rule |
|---|---|---|
| `id` | string | Internal stable id. |
| `subgoalId` | string? | Missing-plan gaps may not have an original id. |
| `question` | string | Internal unresolved-goal wording for logs and reconciliation. Parent display is reconstructed from confirmed original-request slices instead of copying this model-authored text. |
| `reason` | enum | `missing_evidence`, `semantic_mismatch`, `contradicted`, `planning_incomplete`, `scope_blocked`, `capability_blocked`, `external_state_required`, `missing_input`, `contradictory_request`, `unverifiable`, `truncated`, `enumeration_incomplete`, `safety_limit_reached`, `denied_evidence`, or `uncovered_request`. |
| `repairable` | boolean | True only when one narrow internal evidence action can plausibly close it. Known scope/capability/input/contradiction/external-state blockers are false. |
| `followUp` | object? | Narrow task, scope, and existing anchors. No budget/strategy/depth. |
| `priority` | integer | Runtime-owned ordering derived from original request order and proof-policy criticality; the model cannot set it. |
| `attemptedActionFingerprints` | string[] | Internal normalized tool/action fingerprints already tried for this gap, including the repair round. Never parent-facing. |

Every unresolved required part is represented by a concise parent gap whose question is rebuilt from its confirmed `request:<start>-<end>` slices; wrapper-only or plan-level gaps fall back to the original task. Gaps with the same request-derived question and reason may be grouped only when no requested distinction is lost. Exactly one top-level follow-up may be exposed, selected from the highest-priority unresolved gap. Planner-rejected goals, audit prose, and `auditBinding` never create or enter parent gaps. Fatal execution observations are failures, not coverage gaps.

## 9. Parent Handoff v3

Defined fully in [contracts/parent-handoff-v3.md](./contracts/parent-handoff-v3.md).

| Field | Presence |
|---|---|
| `schemaVersion` | Always, const `3`. |
| `directAnswer` | Required for `complete`, `verify_targets`, and `failed`; for `incomplete`, only when supported partial claims exist. |
| `state` | Always; one of four values. |
| `targets` | Only when the parent needs specific source locations for the next action. |
| `evidence` | Only the minimal evidence set covering surfaced claims; normally present for supported answers. |
| `gaps` | Only for `incomplete`. |
| `followUp` | Only for `incomplete` when one useful tool, caller question, or external-verification action exists. |
| `failure` | Only for `failed`. |

State reduction:

```text
invalid invocation/cancel/provider/tool/verifier/internal fatal fault -> failed
any valid required sub-goal blocked or not supported                  -> incomplete
all supported + explicit edit requires target read -> verify_targets
all supported + no remaining parent action -> complete
```

There is no public confidence, complete boolean, critic, coverage summary, candidate inventory, or successful next-action object.

## 10. Safety Limits

Fixed runtime-owned ceilings that protect process health and provider constraints. They are not a task-effort profile and are never parent inputs.

| Field | Type | Rule |
|---|---|---|
| `name` | enum | Specific ceiling such as `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, or `tool_result_limit`. No generic budget label. |
| `stage` | enum | `planner`, `goal_audit`, `plan_revision`, `exploration`, `synthesis`, `verification`, or `repair`. |
| `affectedSubgoalIds` | string[] | Required goals whose proof was prevented or invalidated. Empty only for an operator warning with no state effect. |
| `truncated` | boolean | Whether evidence/model context was truncated. |

A limit observation cannot establish completion. Valid partial tool/search/result truncation or a context/turn ceiling that prevents further evidence makes only affected goals `safety_limit_reached`/`incomplete`. A provider output cap that leaves a required planner, goal-auditor, verifier, or final structured response invalid is a fatal execution fault and returns `failed`; it is not converted into a coverage gap. If a limit affects no required goal, it remains operational only. Fixed values live in one unlabeled runtime configuration; there is no budget selector, turn multiplier, or adaptive effort tier.

## 11. Operational Trace

Optional redacted JSONL/direct-runtime diagnostic data.

| Record type | Contents |
|---|---|
| `plan_proposed` | Planner proposal, origin references, and proof conditions. |
| `goal_audit` | Deterministic/auditor verdicts, capability manifest, rejected/merged goals, and revision count. |
| `plan` | Final task contract and planner/auditor versions. |
| `subgoal_state` | State transition and reason. |
| `tool` | Existing compact arguments/result plus boundary/truncation/omission facts. |
| `claim` | Candidate claim and evidence references. |
| `verdict` | Semantic verdict and uncovered request parts. |
| `repair` | Selected gap, narrow follow-up, and outcome. |
| `safety_limit` | Exact limit, stage, truncation fact, and affected goals. |
| `final` | State reduction inputs and public payload hash/size. |
| `usage` | Provider/model, calls, tokens, timing; internal provider routing remains non-public. |

Operational trace records follow current redaction policy. They are not copied into the normal MCP response.

Implementation staging: T034 records the `final` state-reduction inputs first. The public payload hash/size lands atomically with the schema-v3 parent projection in T043 so no legacy schema-v2 payload becomes a second trust baseline.

## 12. Public Tool Intent

| Tool | Internal baseline sub-goals/proof policy |
|---|---|
| `find_relevant_code` | Relevant location plus why it is relevant; minimal target set. |
| `trace_symbol` | Definition/meaning plus usage cross-check inside boundary. |
| `map_change_impact` | Edit/read targets, dependent paths, requested tests/config/docs categories, risk boundaries. |
| `explain_code_path` | Entry point, ordered handoffs, terminal effect; every transition supported. |
| `collect_evidence` | Claim is supported, contradicted, or unresolved; semantic entailment required. |
| `explore_repo` | Planner-derived required sub-goals for all other repository investigations. |
