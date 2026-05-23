# Test: collect_evidence on studious-memory

## Request — false claim about semantics
```json
{"claim": "The studious-memory MCP scope filtering uses OR semantics — a token only needs one of the required scopes to call a tool", "repo_root": "/home/kyubr/IdeaProjects/studious-memory"}
```

## Response — ⭐ Caught the wrong claim AND noticed AND/OR coexist in different layers
- **directAnswer**: "The claim is FALSE. Studious-memory MCP scope filtering uses AND semantics, not OR semantics. The require_mcp_scopes function in backend/app/mcp/authz.py (lines 59-67) checks if ANY required scope is missing and raises an error if so, meaning ALL scopes must be present. Tool discovery in backend/app/mcp/server.py (lines 95-104) also uses all() to verify all required scopes are granted. **The HTTP API (backend/app/api/scope_policy.py) uses OR semantics, but MCP uses AND.**"
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=3, fileCount=3
- **3 evidence items, all exact**:
  - E1: authz.py:59-67 — `missing = tuple(scope for scope in required if scope not in granted); if missing: raise McpScopeError(missing)` (AND)
  - E2: server.py:95-104 — `if all(scope in granted for scope in required):` (AND)
  - E3: scope_policy.py:55-64 — `if any(required_scope in scopes for required_scope in required_scopes): return` (OR for HTTP API)

## Notable
- ⭐ Caught the false claim
- ⭐ **Bonus insight**: distinguished MCP (AND) vs HTTP API (OR) — the user's premise was confused with the HTTP path. Evidence E3 explicitly cites the OR code in scope_policy.py to back the distinction.

## Cost: turns=16, toolCalls=19, elapsedMs=16260, totalTokens=279505
