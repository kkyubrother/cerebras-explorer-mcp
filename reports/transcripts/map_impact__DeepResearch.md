# Test: map_impact on DeepResearch (via direct invocation)

## Request
```json
{"anchor": "BudgetGate", "changeType": "refactor", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response
- **directAnswer**: "BudgetGate is a policy class in app/policy/budget.py enforcing budget constraints. It's called by budget_gate_node in the orchestrator, tested in test_policy.py, and configured through API schema (tasks.py) and database model (research.py). Budget limits come from TaskRecord defaults and usage data from cost_service aggregation."
- **status**: confidence=high, verification=targeted_read_needed, complete=true
- **status.warnings**: ["2 evidence item(s) are grounded only by grep, blame, or nearby line observations."]
- **evidenceQuality**: level=high, exactCount=6, partialCount=2, fileCount=8
- **8 evidence items, 6 exact + 2 partial** covering:
  - policy/budget.py:32-54 (BudgetGate class)
  - graph.py:129-156 (budget_gate_node caller)
  - tests/test_policy.py:23-48 (unit tests)
  - api/tasks.py:32-47 (API schema defaults)
  - models/research.py:48-55 (DB columns)
  - services/task_service.py:72-75 (TaskRecord)
  - services/cost_service.py:86-93 (task_budget_usage)
  - domain/enums.py:20-21 (BUDGET_EXCEEDED, TIMEOUT)
- **searchCoverage**: filesRead=9, grepCalls=5, symbolCalls=1

## Notable
- Targets correctly labeled: edit (BudgetGate class), read (callers), test, config
- Recognizes that budget config flows from API → DB column defaults → TaskRecord → BudgetGate
- **Cost**: turns=11, toolCalls=19, elapsedMs=13009, totalTokens=115508
