# collect_evidence on studious-memory

## Tool Description
Use when you already have a claim, hypothesis, or review point and need a compact bundle of grounded file:line evidence with snippets. Best for verifying facts before replying or reviewing a change.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "claim": {
      "type": "string",
      "description": "The claim or hypothesis to verify."
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
    "knownText": {
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
    "claim"
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
  "claim": "MCP tools are registered through scoped_tool or equivalent wrappers in backend/mcp_server.py",
  "knownFiles": [
    "backend/mcp_server.py"
  ],
  "knownSymbols": [
    "scoped_tool"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "The claim is PARTIALLY CORRECT but contains a critical file path error. MCP tools ARE registered through the `scoped_tool` wrapper, but the correct file is `backend/app/mcp/server.py`, NOT `backend/mcp_server.py`. The file `backend/mcp_server.py` is only a 41-line stdio transport entry point that imports and runs the MCP server - it contains no tool registration code.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 6,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 2,
    "warnings": [],
    "summary": "Verified: 5 files read, 3 grep searches, 2 symbol lookups, 6/6 evidence items grounded, cross-verified across 2 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
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
    "filesRead": 5,
    "grepCalls": 3,
    "listDirCalls": 0,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 5 file read(s), 3 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_e5bf7a10b2679dfa",
  "session": {
    "id": "sess_e5bf7a10b2679dfa",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/mcp_server.py",
      "role": "context",
      "reason": "Full file showing it's only an entry point with no tool registration",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 41
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "scoped_tool wrapper definition that wraps @mcp.tool() decorator",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 79,
      "endLine": 91
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "scoped_resource wrapper (equivalent wrapper for resources)",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 110,
      "endLine": 120
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Example of tool registration using @scoped_tool decorator",
      "evidenceRefs": [],
      "startLine": 123,
      "endLine": 143
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "read",
      "reason": "Another example of tool registration using @scoped_tool",
      "evidenceRefs": [],
      "startLine": 146,
      "endLine": 174
    },
    {
      "path": "backend/app/mcp/server.py",
      "startLine": 81,
      "endLine": 81,
      "role": "read",
      "reason": "Shows scoped_tool calls @mcp.tool() for actual registration",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 123,
      "role": "read",
      "reason": "Example: process_input tool uses @scoped_tool wrapper",
      "evidenceRefs": [
        "E5"
      ]
    },
    {
      "path": "backend/app/mcp/server.py",
      "startLine": 146,
      "endLine": 146,
      "role": "read",
      "reason": "Example: orchestrate_input tool uses @scoped_tool wrapper",
      "evidenceRefs": [
        "E6"
      ]
    }
  ],
  "discoveredPathsCount": 26,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/mcp_server.py",
      "startLine": 1,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows this file is only an entry point with no tool registration",
      "snippet": "1: \"\"\"Stdio transport entry point for MCP clients that don't support HTTP.\"\"\"\n2: \n3: import os\n4: import subprocess\n5: import sys\n6: \n7: \n8: def _run_migrations() -> None:\n9:     \"\"\"Run Alembic migrations before starting the stdio server.\"\"\"\n10:     from app.config import ensure_runtime_directories\n11: \n12:     ensure_runtime_directories()\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 91,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines scoped_tool wrapper using @mcp.tool() internally",
      "snippet": "79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n83:         async def _wrapped(*args: Any, **kwargs: Any):\n84:             require_mcp_scopes(*required_scopes)\n85:             return await func(*args, **kwargs)\n86: \n87:         return _wrapped\n88: \n89:     return _decorator\n90: \n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/app/mcp/server.py",
      "startLine": 81,
      "endLine": 81,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows scoped_tool calls @mcp.tool() for actual registration",
      "snippet": "81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})"
    },
    {
      "id": "E4",
      "path": "backend/app/mcp/server.py",
      "startLine": 110,
      "endLine": 120,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines scoped_resource wrapper - equivalent for resources",
      "snippet": "110: def scoped_resource(uri: str, *required_scopes: str):\n111:     def _decorator(func: Callable[..., Any]):\n112:         @mcp.resource(uri)\n113:         @wraps(func)\n114:         async def _wrapped(*args: Any, **kwargs: Any):\n115:             require_mcp_scopes(*required_scopes)\n116:             return await func(*args, **kwargs)\n117: \n118:         return _wrapped\n119: \n120:     return _decorator"
    },
    {
      "id": "E5",
      "path": "backend/app/mcp/server.py",
      "startLine": 123,
      "endLine": 123,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Example: process_input tool uses @scoped_tool wrapper",
      "snippet": "123: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)"
    },
    {
      "id": "E6",
      "path": "backend/app/mcp/server.py",
      "startLine": 146,
      "endLine": 146,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Example: orchestrate_input tool uses @scoped_tool wrapper",
      "snippet": "146: @scoped_tool(MCP_SCOPE_MEMORY_WRITE)"
    }
  ],
  "uncertainties": [
    "The claim mentions 'equivalent wrappers' - I confirmed scoped_resource for resources, but other wrappers may exist in files outside backend/mcp_server.py scope"
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 10,
    "filesRead": 5,
    "grepCalls": 3,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 67008,
    "totalTokens": 92446
  }
}
```

ElapsedMs: 67018
McpIsError: false
