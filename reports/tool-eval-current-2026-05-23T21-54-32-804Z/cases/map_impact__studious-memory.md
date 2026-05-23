# map_impact on studious-memory

## Tool Description
Use when the parent already knows the specific anchor (a file path or symbol name) that is about to change and wants a deeper dependency chain plus test/config blast radius. Differs from map_change_impact: this tool puts the anchor in front and runs a deeper reference chase; map_change_impact takes a natural-language change description.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "anchor": {
      "type": "string",
      "description": "A file path (e.g. \"src/auth.js\") or a symbol name (e.g. \"requireAuth\") that will change."
    },
    "changeType": {
      "type": "string",
      "enum": [
        "rename",
        "refactor",
        "remove",
        "add"
      ],
      "description": "Optional. The intended kind of change so the task statement reflects it (e.g. callers matter more for \"remove\")."
    },
    "repo_root": {
      "type": "string"
    },
    "scope": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "knownFiles": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "knownSymbols": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "session": {
      "type": "string"
    }
  },
  "required": [
    "anchor"
  ]
}
```

## Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/studious-memory",
  "scope": [
    "backend/**",
    "frontend/src/**",
    "extensions/firefox-inbox/src/**",
    "scripts/**",
    "android/**"
  ],
  "anchor": "backend/mcp_server.py",
  "changeType": "refactor",
  "knownSymbols": [
    "scoped_tool"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Traced dependency chain for backend/mcp_server.py. Anchor resolves to two files: entry point (backend/mcp_server.py, 41 lines) and implementation (backend/app/mcp/server.py, 947 lines). Found 4 direct importers, 14 test files, configuration with 25+ MCP settings, and 2 script dependencies.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 7,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 10 files read, 6 grep searches, 3 symbol lookups, 7/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read backend/mcp_server.py:1-41 before final verification.",
    "target": {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "Stdio transport entry point that imports and runs mcp with stdio transport",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 41
    }
  },
  "searchCoverage": {
    "scope": [
      "backend/**",
      "frontend/src/**",
      "extensions/firefox-inbox/src/**",
      "scripts/**",
      "android/**"
    ],
    "scopeLimited": true,
    "filesRead": 10,
    "grepCalls": 6,
    "listDirCalls": 0,
    "symbolCalls": 3,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 10 file read(s), 6 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_cbf020d1de6951a7",
  "session": {
    "id": "sess_cbf020d1de6951a7",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/mcp_server.py",
      "role": "read",
      "reason": "Stdio transport entry point that imports and runs mcp with stdio transport",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 41
    },
    {
      "path": "backend/main.py",
      "role": "read",
      "reason": "FastAPI main app imports mcp from app.mcp.server",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 42,
      "endLine": 42
    },
    {
      "path": "backend/tests/auth/test_mcp_scope_enforcement.py",
      "role": "test",
      "reason": "Primary test file imports server and tests orchestrate_input, tool functions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 213
    },
    {
      "path": "backend/tests/mcp/test_mcp_stdio_smoke.py",
      "role": "test",
      "reason": "Stdio lifecycle test runs mcp_server.py as subprocess",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 88
    },
    {
      "path": "backend/app/config.py",
      "role": "config",
      "reason": "Defines 25+ MCP_* settings for auth modes, OAuth, and connection limits",
      "evidenceRefs": [],
      "startLine": 231,
      "endLine": 434
    },
    {
      "path": "scripts/generate_contract_snapshot.py",
      "role": "read",
      "reason": "Script references scoped_tool decorator for AST analysis",
      "evidenceRefs": [],
      "startLine": 160,
      "endLine": 175
    },
    {
      "path": "scripts/idea_run_mcp.sh",
      "role": "read",
      "reason": "Shell script executes mcp_server.py entry point",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 18,
      "endLine": 18
    },
    {
      "path": "backend/mcp_server.py",
      "startLine": 32,
      "endLine": 40,
      "role": "read",
      "reason": "Entry point imports mcp from app.mcp.server and runs with stdio transport",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 35,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/mcp_server.py",
      "startLine": 32,
      "endLine": 40,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Entry point imports mcp from app.mcp.server and runs with stdio transport",
      "snippet": "32:     from app.mcp.server import mcp\n33: \n34:     set_mcp_owner_id(settings.DEFAULT_OWNER_ID)\n35:     set_mcp_auth_context(\n36:         auth_type=\"stdio\",\n37:         scopes=list(SUPPORTED_MCP_OAUTH_SCOPES),\n38:         subject=\"local-stdio\",\n39:     )\n40:     mcp.run(transport=\"stdio\")"
    },
    {
      "id": "E2",
      "path": "backend/main.py",
      "startLine": 42,
      "endLine": 42,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastAPI main app imports mcp from app.mcp.server",
      "snippet": "42: from app.mcp.server import mcp"
    },
    {
      "id": "E3",
      "path": "backend/tests/auth/test_mcp_scope_enforcement.py",
      "startLine": 8,
      "endLine": 8,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test file imports server as mcp_server",
      "snippet": "8: from app.mcp import server as mcp_server"
    },
    {
      "id": "E4",
      "path": "backend/tests/auth/test_mcp_scope_enforcement.py",
      "startLine": 84,
      "endLine": 84,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test calls mcp_server.orchestrate_input()",
      "snippet": "84:         asyncio.run(mcp_server.orchestrate_input(text=\"내일 오전 9시에 약 복용 알려줘\", execute=True))"
    },
    {
      "id": "E5",
      "path": "backend/tests/mcp/test_mcp_stdio_smoke.py",
      "startLine": 32,
      "endLine": 32,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test runs mcp_server.py as subprocess",
      "snippet": "32:         args=[\"mcp_server.py\"],"
    },
    {
      "id": "E6",
      "path": "backend/app/config.py",
      "startLine": 231,
      "endLine": 293,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Config defines MCP_ALLOW_QUERY_KEY, MCP_PUBLIC_AUTH_MODE, MCP_OAUTH_*, MCP_MAX_*",
      "snippet": "231:     MCP_ALLOW_QUERY_KEY: bool = False  # allow ?studious-api-key= on MCP paths (dev only)\n232:     MCP_ALLOW_QUERY_KEY_UNSAFE_OVERRIDE: bool = False\n233:     MCP_PUBLIC_AUTH_MODE: str = \"api_key\"  # api_key, oauth, or dual\n234:     MCP_ALLOW_API_KEY_AUTH: bool = True\n235:     MCP_OAUTH_RESOURCE: str = \"\"\n236:     MCP_OAUTH_AUTHORIZATION_SERVERS: str = \"\"\n237:     MCP_OAUTH_ISSUER: str = \"\"\n238:     MCP_OAUTH_AUDIENCE: str = \"\"\n239:     MCP_OAUTH_JWKS_URL: str = \"\"\n240:     MCP_OAUTH_ALLOWED_SUBJECTS: str = \"\"\n241:     MCP_OAUTH_OWNER_ID: str = \"\"\n242:     MCP_OAUTH_ACCESS_PROFILE: str = \"\"\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "scripts/generate_contract_snapshot.py",
      "startLine": 166,
      "endLine": 166,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Script references scoped_tool decorator for AST analysis",
      "snippet": "166:             if isinstance(func, ast.Name) and func.id == \"scoped_tool\":"
    },
    {
      "id": "E8",
      "path": "scripts/idea_run_mcp.sh",
      "startLine": 18,
      "endLine": 18,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shell script executes mcp_server.py entry point",
      "snippet": "18: exec uv run --frozen python mcp_server.py"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 21,
    "filesRead": 10,
    "grepCalls": 6,
    "symbolCalls": 3,
    "stoppedByBudget": false,
    "elapsedMs": 10791,
    "totalTokens": 108617
  }
}
```

ElapsedMs: 10802
McpIsError: false
