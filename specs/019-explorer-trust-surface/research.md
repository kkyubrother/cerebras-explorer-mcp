# Research: Explorer Trust and Surface Hygiene

## Decisions

### Evidence exactness

**Decision**: Treat `grep` and `git_blame` observations as exact only for the exact observed line range. A one-line hit remains useful as an anchor but cannot exactly ground a larger evidence range.

**Rationale**: Current logic can mark evidence of up to three lines exact from a single grep/blame line. Claude feedback identified this as the highest-risk reliability issue because parent agents may skip follow-up reads.

**Alternatives considered**:

- Keep the existing <=3-line heuristic. Rejected because it overstates verification.
- Convert all grep/blame evidence to partial. Rejected because exact one-line findings are valid and useful.

### Malformed evidence ranges

**Decision**: Preserve invalid ranges long enough for deterministic criticism to drop them and count the drop; do not silently coerce missing/non-integer/inverted ranges to line 1.

**Rationale**: Coercion creates false exact evidence and hides model output quality problems from trust summaries.

**Alternatives considered**:

- Filter malformed evidence during schema normalization. Rejected because it loses drop accounting.
- Keep normalizing to line 1. Rejected because it is the bug being fixed.

### Control-plane warnings

**Decision**: Expose a slim `critic.warnings` object in the structured result while keeping existing `status.warnings` and `evidenceQuality.warnings` compatibility fields.

**Rationale**: `AGENTS.md` and server instructions already require `critic.warnings` preservation. Exposing the documented field is less surprising than rewriting all consumers to a new location.

**Alternatives considered**:

- Remove `critic.warnings` from documentation. Rejected because handoff instructions already name it as an invariant.
- Expose the full internal critic payload. Rejected because the parent-agent surface should stay compact.

### Discovered path bounding

**Decision**: Cap surfaced `discoveredPaths` at 50 entries and expose omitted counts via `searchCoverage.omittedDiscoveredPaths`.

**Rationale**: Candidate paths are useful hints but should not crowd out grounded targets/evidence. A count preserves awareness that candidates were truncated.

**Alternatives considered**:

- Keep the current 100-entry cap without a signal. Rejected because callers cannot tell whether candidates were omitted.
- Remove `discoveredPaths` entirely. Rejected because it is useful follow-up context for parent agents.

### MCP surface hygiene

**Decision**: Keep structured evidence snippets but reduce default display text duplication. For Markdown `explore`, emit answer-oriented structured content by default and separate operational diagnostics into `_meta.ops`.

**Rationale**: Codex-facing results should prioritize answer, citations, targets, evidence, and required control-plane fields. Diagnostics should remain available without becoming prompt payload.

**Alternatives considered**:

- Remove snippets from structured evidence. Rejected because agents may need them for grounded follow-up.
- Keep stats/transcript/toolTrace in default structured content. Rejected because it exposes local operational metadata as answer data.

### Transcript diagnostics

**Decision**: Add compact, redacted tool argument/result summaries to local transcript records by default; raw content remains unavailable unless explicitly enabled by existing raw diagnostics paths.

**Rationale**: Operators need enough context to debug answer quality without recording raw code or secrets.

**Alternatives considered**:

- Store raw args/results. Rejected for privacy and token-volume reasons.
- Keep only result character counts. Rejected because it is not enough to reconstruct poor tool choices.

### Failover attribution

**Decision**: Attach used provider/model metadata to successful failover completions and propagate that metadata into runtime stats/transcript diagnostics.

**Rationale**: Current attribution can report the first provider even when fallback succeeded, making diagnostics misleading.

**Alternatives considered**:

- Keep the current `model` getter behavior. Rejected because it is inaccurate under failover.
- Make provider identity public answer data. Rejected because provider override/failover remains internal implementation detail.

## Claude Feedback Incorporated

- Evidence grounding issue severity: medium-high; patch before surface polish.
- Malformed range coercion issue severity: medium; preserve/drop rather than normalize.
- `critic.warnings` mismatch: align runtime, schema, docs, examples.
- Duplicated snippets and broad discovered paths: reduce default surface and add truncation signal.
- Transcript path in stderr: keep log locatable but avoid full local path by default.
- `EXPLORER_PROVIDER` docs: keep as internal escape hatch, not a public first-class configuration path.
