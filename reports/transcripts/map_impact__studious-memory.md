# Test: map_impact on studious-memory (via direct invocation)

## Request
```json
{"anchor": "scoped_tool", "changeType": "refactor", "repo_root": "/home/kyubr/IdeaProjects/studious-memory"}
```

## Response
- **directAnswer**: "scoped_tool is a decorator in backend/app/mcp/server.py (lines 79-91) that wraps MCP tools with scope authorization. It has 54+ usages within the same file, depends on scope constants and require_mcp_scopes from backend/app/mcp/authz.py, is documented in docs/architecture/overview.md, and parsed by scripts/generate_contract_snapshot.py. No direct unit tests exist; coverage is indirect via smoke tests."
- **status**: confidence=high, verification=targeted_read_needed, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=5
- **8 evidence items, all exact** covering:
  - server.py:79-91 (definition)
  - server.py:123-830 (54+ usages — broad target range)
  - authz.py:5-13 (scope constants)
  - authz.py:59-67 (require_mcp_scopes)
  - docs/architecture/overview.md:87 (doc reference)
  - scripts/generate_contract_snapshot.py:166-167 (AST parser — may break on refactor)
  - tests/helpers/mcp_smoke.py (indirect tests)
  - server.py:123-135 (example process_input usage)
- **searchCoverage**: filesRead=6, grepCalls=5, symbolCalls=1
- **Cost**: turns=8, toolCalls=14, elapsedMs=10531, totalTokens=88063

## Notable
- ⭐ Identifies `scripts/generate_contract_snapshot.py` AST parser as **at risk** during refactor — strong dependency analysis
- "No direct unit tests exist; coverage is indirect via smoke tests" — actionable for review
- The broad `startLine: 123, endLine: 830` for "all usages" is honest about not enumerating each one — would be impractical for 54 sites
