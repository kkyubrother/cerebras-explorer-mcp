# Test: find_entrypoints on DeepResearch (via direct invocation; strategy bug worked around)

## Request
```json
{"entryKind": "http", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response
- **directAnswer**: Enumerates 13 HTTP routes — 2 app-level (main.py), 9 task router, 2 sources router, 1 claims router, 1 plans router
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=5
- **13 targets, 8 evidence items**
- **searchCoverage**: filesRead=6, grepCalls=17
- **Cost**: turns=7, toolCalls=24, elapsedMs=9419, totalTokens=68018

## Notable
- Distinguishes app-level (`@app.get`) vs router-level (`@router.get/post/put/delete/patch`) routes
- All 13 routes have file:line citations
- Each target labeled with its purpose (e.g., "Task router with 9 endpoints")
- Caveat about regex-based detection is reproduced in the answer
