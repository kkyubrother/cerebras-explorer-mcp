# Test: collect_evidence on DeepResearch

## Request — true claim
```json
{"claim": "DeepResearch enforces a per-task cost budget in USD that aborts the LangGraph run when exceeded", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response
- **directAnswer**: "Verified. DeepResearch enforces a per-task cost budget in USD that aborts the LangGraph run when exceeded. The ResearchTask model defines cost_budget_usd (default $2.00). BudgetGate checks accumulated cost_usd against this limit at multiple graph nodes. When exceeded, it returns BUDGET_EXCEEDED status, which routes to LangGraph's END terminal, aborting execution."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=5
- **8 evidence items, all exact**:
  - E1: models/research.py:50-54 — `cost_budget_usd: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("2.0"), nullable=False)`
  - E2: policy/budget.py:36-40 — `if usage.cost_usd > self.limits.cost_budget_usd: return BudgetDecision(False, ResearchStatus.BUDGET_EXCEEDED, ...)`
  - E3: graph.py:129-156 — budget_gate_node implementation
  - E4: graph.py:192-200 — `_route_budget_to_next_or_terminal` routing BUDGET_EXCEEDED to "terminal"
  - E5: cost_service.py:86-93 — cost aggregation
  - E6: enums.py:19 — `BUDGET_EXCEEDED = "budget_exceeded"`
  - E7: graph.py:57-63 — budget gate nodes added at multiple stages
  - E8: graph.py:178-183 — `_add_budget_edge` mapping "terminal" to END
- **searchCoverage**: filesRead=5, grepCalls=3
- Cost was efficient given the strong claim verification

## Cost: turns=5, toolCalls=9, elapsedMs=6915, totalTokens=67822
