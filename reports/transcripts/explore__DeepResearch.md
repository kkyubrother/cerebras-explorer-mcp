# Test: explore on DeepResearch

## Request
```json
{"prompt": "Give me an architecture overview of the research pipeline from task creation to final report, with inline file:line citations", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response — Markdown report
- **report** (~9KB Markdown): 7-section architecture covering Task Creation → Orchestrated Pipeline → 12 pipeline stages → Report Generation → Celery Workers → SSE progress → Data Flow Summary
- **structuredContent.citations[]**: 36 file_range citations
- **structuredContent.targets[]**: 36 read targets
- **filesRead**: 30 files
- **critic**: status="pass"
- **searchCoverage**: filesRead=30, grepCalls=3, scopeLimited=false
- **Cost**: turns=14, toolCalls=42, elapsedMs=13658, totalTokens=351080

## Notable
- ⭐ Identified that demo services (`build_demo_plan`, `build_demo_report`) are placeholders, not production
- ⭐ Flagged `_unconfigured_node` returning errors — real implementations depend on provider config
- Reproduces the full 12-node graph flow with conditional routing
- Korean status labels accurately mapped (대기 중, 계획 작성 중, etc.) with progress fractions

## Markdown excerpt
```markdown
The pipeline is defined as a **LangGraph state machine** (`app/orchestrator/graph.py:L39-L92`) with the following flow:

```
START → query_understanding → planner → plan_approval_gate → search 
→ budget_after_search → policy_guard → ...
```
```
