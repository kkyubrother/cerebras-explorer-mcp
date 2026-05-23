# Test: find_entrypoints on studious-memory (via direct invocation; strategy bug worked around)

## Request
```json
{"entryKind": "all", "repo_root": "/home/kyubr/IdeaProjects/studious-memory"}
```

## Response
- **directAnswer** (~600 chars): groups 5 entry kinds:
  - **HTTP**: 150+ FastAPI routes in main.py + backend/app/api/v1/*.py
  - **CLI**: 13+ argparse scripts in scripts/ and admin/
  - **Cron**: 12 supervisor.spawn() background tasks (main.py:462-533) + 4 frontend setInterval
  - **MCP**: 45 tools + 7 resources in server.py:79-947 + stdio entry at mcp_server.py:26-30
  - **Event**: 14+ addEventListener calls in frontend TS/JS
- **status**: confidence=high, verification=verified, complete=true
- **status.warnings**: ["2 evidence item(s) are grounded only by grep, blame, or nearby line observations."]
- **evidenceQuality**: level=high, exactCount=6, partialCount=2, fileCount=7
- **9 targets, 8 evidence items**
- **searchCoverage**: filesRead=12, grepCalls=15, symbolCalls=1
- **Cost**: turns=11, toolCalls=29, elapsedMs=25073, totalTokens=472245

## Notable
- ⚠️ Identifies "12 supervisor.spawn() background tasks" — this is NOT in the cron regex bundle (which is `cron.schedule`, `node-cron`, `setInterval`, `@scheduled`, etc.). The LLM extended classification beyond the regex bundle to include FastAPI supervisor patterns — useful but be cautious about completeness
- Each kind has at least 1 grounded evidence point
- Properly counted MCP tools using symbol_context (45 tools + 7 resources)
- The directAnswer leads with "⚠️ REGEX-BASED DETECTION: Verify all cited lines before acting." prominently — strong caveat
