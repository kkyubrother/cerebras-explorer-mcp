# Test: explain_code_path on DeepResearch

## Request
```json
{"pathQuery": "A user POSTs a research task and the Celery worker drives it through the LangGraph orchestrator until completion", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response
- **directAnswer**: "Code path: POST /tasks → create_task() → InMemoryTaskStore.create() (status=WAITING_FOR_USER) → [INTENDED] Celery task run_research_task enqueued → run_research_task_async() → build_graph() → LangGraph.ainvoke() executes: START→query_understanding→planner→plan_approval_gate (HITL interrupt)→search→budget gates→policy_guard→fetcher→parser→evidence_extractor→synthesizer→citation_validator→finalize→END. POST /tasks/{id}/plan/approve resumes graph after interrupt. **Note**: Current InMemoryTaskStore does not trigger Celery; this is a demo implementation."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=5
- **8 evidence items**, all exact, covering API → service → store → worker → graph → HITL → resume endpoint
- **uncertainties**: ["Production database-backed store implementation not found - unclear if Celery enqueue exists in production code"]
- **searchCoverage**: filesRead=11, grepCalls=12, symbolCalls=4

## Notable
- ⭐ Explicitly flagged "[INTENDED] Celery task ... enqueued" because the code does NOT currently trigger Celery — `InMemoryTaskStore.create()` only creates the record
- toolTrace shows `repo_grep "delay\\(|apply_async"` returned 0 matches (verified gap)
- Honest about "demo implementation" status

## Cost: turns=16, toolCalls=30, elapsedMs=80902, totalTokens=324512
