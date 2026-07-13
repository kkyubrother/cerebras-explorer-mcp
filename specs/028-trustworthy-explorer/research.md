# Research: Trustworthy, Quiet Explorer

## Empirical baseline

The planning baseline combines the current source with live exploration across seven real repositories and nine primary calls. Successful calls consumed roughly 2.43 million API tokens in aggregate, which is acceptable under the user's Cerebras Code Plan. Cost exposed useful diagnostics but did not predict trustworthiness.

The most important observed failures were:

- A line range ending at line 117 was summarized as “117 patterns”; the cited range existed, but the semantic claim was false.
- A large application exploration missed an orphaned UI/API prefix and a Prisma model while returning high confidence and complete.
- Route-specific administrator policies were generalized into one repository-wide rule.
- A Python flow inferred an external process despite an explicit instruction not to speculate.
- Repeated runs on a small repository omitted tests or environment details but still returned verified/complete.
- A broad AWS-style inventory misclassified a Bedrock invocation path and omitted requested claims.
- Scope boundaries and live cancellation behaved correctly, showing that the existing read-only/scope/cancel foundations are worth preserving.
- Purpose wrappers used about 24% fewer tokens and were about 13% faster than the general fallback in the small A/B sample. This is not a cost gate, but it supports retaining wrappers that impose a genuinely distinct task contract.

## Source findings

| Finding | Current source | Consequence |
|---|---|---|
| General completion is `exactCount >= 2 || fileCount >= 2` | `src/explorer/runtime.mjs:933-981` | Two unrelated citations can mark a multi-part request complete. |
| `targeted_read_needed` is also `complete: true` | `src/explorer/runtime.mjs:984-1019` | The parent must reconcile “complete” with “read before verification.” |
| Exact grounding means observed range coverage, not semantic entailment | `src/explorer/critic.mjs` grounding pass | A wrong `why` or over-broad claim can be attached to a real line range. |
| Structured exploration does not preserve all tool-level truncation/omission facts for completion | primary loop in `src/explorer/runtime.mjs`; repo tool metadata | Negative and exhaustive claims can be stronger than the search boundary. |
| Server returns several overlapping trust/action summaries | `src/mcp/server.mjs:486-539`, `:699-718`; `src/explorer/schemas.mjs:294-324` | Parent context and decision burden increase without improving proof. |
| Change-review wrapper has no distinct sufficiency branch | `src/mcp/server.mjs:437-458`, `src/explorer/runtime.mjs:946-981` | It is primarily a prompt/strategy convenience wrapper. |
| Markdown report is a second output contract and backend | `src/mcp/server.mjs:200-220`, report path in `src/explorer/runtime.mjs` | Parents must choose format and interpret a weaker parallel critic surface. |
| JSON-RPC request id `0` is treated as false in active-cancel tracking | `src/mcp/server.mjs` `if (requestId)` checks | A valid request id can escape cancellation tracking. |
| Cancelled synthesis may reuse partial assistant content | cancellation/final-object path in `src/explorer/runtime.mjs` | Intermediate reasoning can look like a final answer. |

## Decisions

### R1. Completion is required-sub-goal coverage, not evidence quantity

**Decision**: Create an internal task contract before exploration. It contains every independently verifiable requirement, comparison, boundary, prohibition, and requested distinction. Every required sub-goal has a proof policy and must reach `supported`; otherwise the result cannot be complete.

**Rationale**: Evidence count is unrelated to whether all parts of a request were answered. A sub-goal ledger directly represents the condition the parent cares about.

**Alternatives considered**:

- Raise the exact-evidence threshold. Rejected because any fixed count still ignores request coverage.
- Add more regex-based broad-task exceptions. Rejected because the failure is semantic and combinatorial, not a missing keyword list.
- Expose sub-goals to the parent for it to judge. Rejected because that transfers internal work and cognitive load to the caller.

### R2. Use bounded planning/audit and one isolated semantic verifier

**Decision**: Use a strict planner to propose one sub-goal for every explicit requested part, then deterministically validate and independently audit the plan before tool exploration. Permit at most one corrected planner/auditor pass for missing or decomposable goals. The accepted ledger is not semantically capped; large ledgers may be processed in batches of at most 12. After deterministic range/source grounding, run an isolated semantic verifier that sees only the original task contract, atomic claims, reconstructed snippets/git observations, and search-boundary facts. It returns claim/sub-goal verdicts, not prose or confidence.

**Rationale**: The current critic proves observation, not meaning. A fresh bounded context reduces self-confirmation and makes claim-to-evidence entailment an explicit acceptance step. Comparing the original request with the plan also catches planner omissions.

**Alternatives considered**:

- Extend the deterministic critic to understand arbitrary source semantics. Rejected because reliable semantic entailment is not feasible with regex/range logic.
- Give the verifier the full transcript. Rejected because exploratory assertions can anchor the verifier and inflate context.
- Run multiple voting verifiers by default. Rejected as unnecessary complexity before one isolated verifier is measured; cost is available, but complexity and latency still matter.
- Trust the model's confidence. Rejected because confidence did not correlate with complete answers in observed failures.

### R3. Accepted atomic claims are the answer source

**Decision**: Structured synthesis produces atomic claims linked to one sub-goal and explicit evidence ids. The semantic verifier may accept, reject, or contradict them. It does not silently rewrite an over-broad claim into new prose. `directAnswer` is composed only from accepted claim text; unresolved parts are represented separately as minimal gaps.

**Rationale**: A free-form final rewrite can reintroduce unsupported facts after verification. Dropping a weak claim and returning a gap is safer than creating an unverified paraphrase.

**Alternatives considered**:

- Let the verifier return a polished corrected answer. Rejected because the correction itself would need another verification pass.
- Preserve the original prose and attach warnings. Rejected because parents tend to consume the answer even when warnings disagree.

### R4. Negative, exhaustive, unique, and count claims need an absence/coverage certificate

**Decision**: A negative or exhaustive claim passes only when its claim boundary matches a fully inspected relevant boundary, tool/context output is not truncated, no required path was omitted/denied, and the search policy is appropriate to the semantic claim. Exact counts are computed deterministically from complete tool output rather than by the model. Otherwise the claim is bounded (“within X scope and accessible static references”) or becomes a gap.

**Rationale**: Zero-match grep proves only bounded textual absence for that search. It does not prove semantic absence, dynamic-call absence, or repository-wide absence.

**Alternatives considered**:

- Ban all negative claims. Rejected because bounded absence is useful and can be supported honestly.
- Return raw search counters to the parent. Rejected because the parent needs the conclusion's boundary, not internal tool telemetry.
- Treat scope-limited zero matches as repository-wide. Rejected as the exact trust failure this feature prevents.

### R5. Permit one bounded internal repair round

**Decision**: After first verification, the runtime may run one repair round containing all gaps that share one narrow query or fit a small parallel batch of independent targeted actions, then re-run grounding/semantic verification once. Verifier-discovered uncovered request parts become required sub-goals before selection. No second round and no public configuration are allowed.

**Rationale**: Many failures are one missed route, test, or callsite. Repairing it internally keeps the parent handoff quiet without creating an unbounded agent loop.

**Alternatives considered**:

- Return every first-pass gap immediately. Rejected because it needlessly transfers a narrow recoverable task to the parent.
- Continue until all gaps close. Rejected because a blocked or impossible proof could loop and become operationally noisy.
- Expose a repair count/budget. Rejected because it recreates the parent configuration burden removed with public budget.

### R6. Schema v3 has one action-oriented state

**Decision**: Replace overlapping status/confidence/quality/coverage/critic/next-action structures with one `state` enum: `complete`, `verify_targets`, `incomplete`, or `failed`. Optional fields are omitted unless they change the next action.

**Rationale**: Current `targeted_read_needed + complete:true`, confidence, quality, critic, warnings, and next action can disagree or repeat the same idea. Four mutually exclusive states are enough for parent routing.

**Alternatives considered**:

- Keep `status.complete` and only remove confidence. Rejected because verification and nextAction still overlap.
- Add another “coverage” field. Rejected because it would increase rather than remove cognitive load.
- Return only prose. Rejected because parent automation still needs a stable machine state and target/evidence objects.

### R7. Operational detail stays off the normal MCP answer

**Decision**: Normal text and `structuredContent` contain only schema v3. Full sub-goal transitions, search observations, candidate paths, critic/verifier verdicts, provider/usage/timing, and repair history stay in the optional JSONL transcript and direct-runtime evaluation result. Default MCP `_meta` must not carry the full stats object; if a correlation handle is retained, it is opaque and present only when logging is enabled.

**Rationale**: `_meta` is not guaranteed to be invisible to every parent/client, and operators can diagnose through the existing log channel. Benchmark code can call the runtime directly.

**Alternatives considered**:

- Keep full `_meta.ops.stats` because it is nominally out-of-band. Rejected because the user asked not to return unnecessary values and client behavior varies.
- Remove diagnostics entirely. Rejected because trust work needs reproducible traces.

### R8. Retain exactly six public tools

**Decision**: Keep `explore_repo`, `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, and `collect_evidence`. Remove `review_change_context` and Markdown `explore`. Add no replacement or compatibility alias.

**Rationale**:

- The five retained wrappers can impose distinct proof policies: locate relevance, symbol definition+usage, impact category coverage, ordered path transitions, and claim support/refutation.
- `review_change_context` currently forces git-guided prompting but has no distinct completion policy. General `explore_repo` already has git tools and automatic git intent classification.
- Markdown `explore` differs primarily in presentation. Parent agents can turn structured evidence into user-facing prose, while a second backend/schema/critic increases selection and interpretation burden.

**Alternatives considered**:

- Collapse to only `explore_repo`. Rejected because measured wrappers reduced exploratory overhead and several can enforce useful intent-specific proof policies.
- Keep all eight because they already work. Rejected because working is not evidence that the parent benefits from selecting them.
- Keep removed names as aliases. Rejected because aliases preserve cognitive load, docs surface, tests, and drift risk.
- Add a public `verify_answer` or `plan_subgoals` tool. Rejected because verification/planning are internal responsibilities.

### R9. Tool descriptions become one positive trigger plus one boundary

**Decision**: Each public description states its primary trigger and one non-overlap boundary. A short dispatch list is sufficient: location, known symbol, intended change, runtime flow, claim verification, otherwise fallback.

**Rationale**: Current descriptions repeatedly compare several sibling tools. Reducing tool count without shortening those comparisons would leave much of the selection burden intact.

### R10. Remove report mode cleanly, preserving only shared safeguards

**Decision**: Once the public report handler is removed, delete report-only runtime methods, prompts, citation extraction/critic code, tests, and benchmark cases that have no structured-path consumer. Retain compaction, output recovery, or tool-result limiting only when reference analysis shows the structured explorer still uses them.

**Rationale**: Hiding a tool while retaining an unused backend creates dead code and a likely future re-exposure path. Surgical reference-based deletion avoids removing shared safeguards.

### R11. Fault and boundary facts have deterministic precedence

**Decision**: Cancellation, provider failure, verifier failure, tool errors, truncation, and out-of-scope/denied omissions are runtime observations, not model judgments. They gate applicable sub-goals before final state reduction. JSON-RPC id `0` must be tracked, and cancellation must never promote partial assistant content to `directAnswer`.

**Rationale**: A model cannot reliably infer runtime facts that were not preserved. Fault precedence must be independent of how plausible the partial prose sounds.

### R12. Cost is observable, not a release gate

**Decision**: Continue recording calls, tokens, and latency in direct-runtime results/transcripts. Do not reject an otherwise trustworthy design for using the planner, verifier, or one repair round. Still bound the workflow to prevent accidental infinite or redundant work.

**Rationale**: Cerebras Code Plan makes inference cost secondary, but operational regressions remain worth observing.

### R13. ZDR does not remove repository security invariants

**Decision**: Do not spend this feature on expanding secret access. Preserve deny-list/redaction exactly as repository policy requires. Treat the user's ZDR assurance as permission to use the API for evaluation, not as authorization to weaken project security contracts.

**Rationale**: The requested improvement is parent trust and quietness. Changing secret behavior adds risk and unrelated migration work.

### R14. Remove public strategy selection; retain only task facts

**Decision**: Remove `hints.strategy` from the public `explore_repo` input. Scope and known file/symbol/text anchors remain because they express a hard boundary or already-known facts, not an effort level. Wrapper modes and search strategy stay internal.

**Rationale**: An “advanced, usually omit” field still asks the parent to understand internal exploration policy. The same reasoning that removed budget applies to strategy.

**Alternatives considered**:

- Keep the field but shorten its documentation. Rejected because it remains a public choice and permanent test/migration surface.
- Remove all scope/anchor inputs. Rejected because scope is a security/correctness boundary and anchors can materially improve a delegated task without choosing effort.

### R15. Proof depends on source role and temporal role

**Decision**: Classify observations as implementation, test, config, documentation, fixture, generated, or unknown, and as current or historical. A current implementation claim cannot be supported solely by historical git content, docs, tests, or fixtures; those sources corroborate or prove claims specifically about themselves.

**Rationale**: A valid citation can still be the wrong kind of source. Historical commits describe prior state, while tests/docs often describe intent rather than the active implementation.

### R16. Repository content remains untrusted in every new model stage

**Decision**: Planner and isolated verifier prompts preserve the existing untrusted-content rule. Source snippets, comments, docs, tests, fixtures, filenames, and git messages are evidence data only and cannot modify instructions or proof policy.

**Rationale**: Adding planner/verifier model calls creates new prompt-injection surfaces unless the existing boundary is carried forward and regression-tested.

### R17. Delete the internal budget abstraction; retain only named safety limits

**Decision**: Remove active budget terminology and policy machinery from source, prompts, schemas, metrics, tests, and operator configuration. The single `deep` label, `getBudgetConfig`, `budgetConfig`, `stats.budget`, `stoppedByBudget`, `budget_exhausted`, report turn-multiplier controls, and budget-based completion branches are migrated away rather than renamed cosmetically as another effort tier. Fixed ceilings that protect provider/context/process correctness remain, but are represented as non-parent-configurable runtime or safety limits and never as a quality/completion policy.

The implementation inventory is:

| Current surface | Decision |
|---|---|
| `DEEP_RUNTIME_CONFIG`, `getBudgetConfig`, `budgetConfig`, prompt `Runtime profile: deep` | Remove the label; use one unlabeled explorer runtime configuration and explicit safety-limit names. |
| `maxTurns`, model context/output limits, file-walk/result/read caps | Retain fixed values where physically necessary; classify and log the exact limit reached. They never prove sufficiency. |
| `TOOL_RESULT_CHAR_BUDGETS` / `applyToolResultCharBudget` | Rename to result/context limits and preserve truncation facts in the observation ledger. |
| `stoppedByBudget`, `budget_exhausted`, budget caveats/retries | Replace with a specific safety-limit observation and an affected required-goal gap. A limit hit alone is not `failed`. |
| `CEREBRAS_EXPLORER_TURN_MULTIPLIER`, `MAX_EXTRA_TURNS`, `MAX_COMPACTIONS` | Remove with report mode; do not replace them with new effort controls. |
| budget-exhaustion benchmark rate and stderr field | Replace with a safety-limit incidence metric/field for operators. It is record-only. |
| warning “budget” terminology and comments | Rename to limit/cap terminology so active code has one meaning for budget: none. |

**Rationale**: Although the public budget input was removed, the internal name still shapes prompts, stats, retry behavior, and completion decisions. It also suggests that maintainers should tune effort tiers that no longer exist. Physical limits are unavoidable, but conflating them with an effort budget makes a safety stop look like a quality judgment.

**Alternatives considered**:

- Keep `budgetConfig` as a harmless internal name. Rejected because it already leaks into prompts, diagnostics, tests, and completion logic and perpetuates the wrong mental model.
- Remove all limits. Rejected because provider context/output windows, filesystem traversal, and runaway execution remain physically bounded even when inference cost is irrelevant.
- Make limits dynamically task-selected. Rejected for this feature because it recreates an implicit budget policy and adds another trust surface. The runtime may choose searches based on goal state, but fixed ceilings stay constant.

### R18. Audit goals before repository exploration and permit one plan revision

**Decision**: Insert a goal-audit stage between planning and exploration:

1. The planner emits request references and an independently observable proof condition for every proposed goal.
2. Deterministic validation rejects malformed ids, unknown claim types, impossible proof-policy combinations, duplicate/circular structure, scope widening, and capabilities outside the fixed read-only explorer manifest.
3. An isolated goal auditor sees only the original request, effective scope, wrapper seed, capability manifest, and proposed plan. It checks request coverage, traceability, consistency, and granularity; it does not see repository prose or exploratory claims.
4. Runtime accepts/merges valid goals, removes untraceable planner inventions, records valid blockers, and requests one corrected plan only when decomposition or missing coverage can be repaired.
5. The corrected plan is validated once. Every remaining planning defect is materialized as a blocked required goal/gap; no recursive re-plan is allowed.

The auditor uses categorical verdicts, not confidence scores: `ready`, `merge_duplicate`, `needs_decomposition`, `reject_untraceable`, `blocked_scope`, `blocked_capability`, `requires_external_state`, `missing_input`, `contradictory`, or `unverifiable`. It cannot remove a goal traceable to an explicit user requirement merely because the goal is hard or blocked.

**Rationale**: The semantic verifier can reject an unsupported answer, but it is too late to prevent wasted exploration or to distinguish a planner-invented obligation from a real user requirement. A separate audit prevents the planner from silently grading its own decomposition and gives blocked goals deterministic terminal semantics.

**Alternatives considered**:

- Let the original planner self-correct in one prompt. Rejected because self-review shares the same omission and invention failure mode.
- Defer all plan defects to the final semantic verifier. Rejected because impossible goals would consume exploration/repair work and spurious goals could incorrectly block completion.
- Re-plan until the auditor approves. Rejected because an adversarial or ambiguous request could create an unbounded loop; one revision is enough to correct ordinary decomposition defects.

### R19. Wrong goals, infeasible goals, unachieved goals, and execution faults are distinct

**Decision**: Reduce outcomes according to goal origin and feasibility:

| Situation | Runtime treatment | Parent state |
|---|---|---|
| Planner-invented/untraceable goal | Reject and log; it is not required and is never surfaced. | Does not affect state. |
| Duplicate goal | Merge while preserving every request reference/constraint. | Does not affect state. |
| Valid but too-broad goal | Decompose during the single plan revision. | Depends on resulting goals. |
| Explicit user goal blocked by scope/capability/live state/missing input/contradiction/unverifiability | Keep required, record exact blocker, skip futile exploration/repair. | `incomplete`. |
| Caller premise is false but a supported refutation/absence certificate establishes the answer | Mark the required goal supported with a refuted resolution. | `complete` when all other goals are supported. |
| Feasible goal lacks evidence after exploration | Make it repairable only when one narrow round can help. | `incomplete` if still unresolved. |
| Fixed safety limit interrupts an affected goal | Preserve supported claims; mark only affected goals with a limit gap. | `incomplete`. |
| Provider output cap leaves required planner/auditor/verifier/final control JSON invalid | Do not treat invalid control output as partial evidence. | `failed`. |
| Invalid invocation, cancellation, provider/tool/verifier/internal fault | Do not promote stale or unverified content. | `failed`. |

Verifier-discovered uncovered parts undergo the same goal audit before registration; a verifier invention cannot become a completion blocker. If every requested goal is blocked, the answer is still `incomplete`, not an execution failure. The handoff contains no invented answer and at most one action that can materially change the result: a valid explorer tool continuation, one focused question to the caller, or an explicit external verification requirement. No action is emitted when none would help, and a completed repair action is never returned again with equivalent arguments.

**Rationale**: “Could not prove the requested fact with this tool” is a normal, trustworthy result. Treating it as system failure encourages blind retry; silently deleting it encourages false completion. Conversely, letting a model-invented goal block completion punishes the parent for a planner error.

## Evaluation decision

The release gate is a known-answer suite, not the current keyword-weighted adoption score alone. Each case is pinned to a fixture content hash or repository git SHA plus dirty-tree content hash. Its oracle is authored outside explorer/verifier output and defines required sub-goals, allowed/forbidden claims, evidence anchors, expected boundary, and expected state. The suite then checks:

- every required sub-goal is supported or explicitly unresolved;
- accepted claim text is entailed by its cited source/search certificate;
- negative claims are bounded correctly;
- final state is stable across repeated runs;
- cancellation/provider/scope/truncation facts win over model assertions;
- the parent can finish without broad native re-search;
- schema v3 payload is smaller and contains no irrelevant fields.

Payload size is the UTF-8 serialized size of all parent-visible MCP `content` plus `structuredContent`, not structured content alone. The existing adoption suite remains useful for target discovery and payload/effect trends, but keyword matches, the verifier itself, and self-reported `groundingStatus` cannot serve as the known-answer oracle.
