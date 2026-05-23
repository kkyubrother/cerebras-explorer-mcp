# find_entrypoints on DeepResearch

## Tool Description
Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entryKind": {
      "type": "string",
      "enum": [
        "http",
        "cli",
        "cron",
        "mcp",
        "event",
        "all"
      ],
      "description": "Optional. Restrict detection to one entry kind. Defaults to \"all\"."
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
    "session": {
      "type": "string"
    }
  }
}
```

## Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/DeepResearch",
  "scope": [
    "app/**",
    "main.py",
    "migrations/**"
  ],
  "entryKind": "http"
}
```

## Response Summary
```json
{
  "directAnswer": "Found 13 HTTP routes in this FastAPI application using decorator patterns (@app.get|post, @router.get|post). **CAVEAT**: Entry-point detection is regex-based — verify each cited line is an actual route before acting.\n\n**By Entry Kind:**\n\n1. Root Application Routes (main.py): GET / (line 6), GET /hello/{name} (line 11)\n\n2. API Router Routes (app/api/):\n   - Claims (prefix=/claims): GET /claims/{claim_id}/evidence (line 13)\n   - Plans (prefix=/tasks): POST /tasks/{task_id}/plan/approve (line 13)\n   - Sources (prefix=/sources): GET /sources (line 20), GET /sources/{source_id} (line 41)\n   - Tasks (prefix=/tasks): POST /tasks (line 39), GET /tasks/{task_id} (line 53), GET /tasks/{task_id}/events (line 61), POST /tasks/{task_id}/pause (line 77), POST /tasks/{task_id}/retry (line 89), POST /tasks/{task_id}/cancel (line 101), GET /tasks/{task_id}/report (line 113), GET /tasks/{task_id}/cost (line 125)",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 8,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 5,
    "warnings": [],
    "summary": "Verified: 6 files read, 7 grep searches, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 6,
    "grepCalls": 7,
    "listDirCalls": 2,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 6 file read(s), 7 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4794439a0572191f",
  "session": {
    "id": "sess_4794439a0572191f",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "main.py",
      "role": "read",
      "reason": "Root application GET routes",
      "evidenceRefs": [],
      "startLine": 6,
      "endLine": 13
    },
    {
      "path": "app/api/claims.py",
      "role": "read",
      "reason": "Claims router with GET route",
      "evidenceRefs": [],
      "startLine": 10,
      "endLine": 18
    },
    {
      "path": "app/api/plans.py",
      "role": "read",
      "reason": "Plans router with POST route",
      "evidenceRefs": [],
      "startLine": 10,
      "endLine": 18
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "Sources router with 2 GET routes",
      "evidenceRefs": [],
      "startLine": 17,
      "endLine": 46
    },
    {
      "path": "app/api/tasks.py",
      "role": "read",
      "reason": "Tasks router with 7 routes",
      "evidenceRefs": [],
      "startLine": 26,
      "endLine": 135
    },
    {
      "path": "main.py",
      "startLine": 6,
      "endLine": 6,
      "role": "read",
      "reason": "Root GET / route decorator",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "main.py",
      "startLine": 11,
      "endLine": 11,
      "role": "read",
      "reason": "GET /hello/{name} route decorator",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "app/api/claims.py",
      "startLine": 10,
      "endLine": 13,
      "role": "read",
      "reason": "Claims router prefix and GET route",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 29,
  "evidence": [
    {
      "id": "E1",
      "path": "main.py",
      "startLine": 6,
      "endLine": 6,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Root GET / route decorator",
      "snippet": "6: @app.get(\"/\")"
    },
    {
      "id": "E2",
      "path": "main.py",
      "startLine": 11,
      "endLine": 11,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /hello/{name} route decorator",
      "snippet": "11: @app.get(\"/hello/{name}\")"
    },
    {
      "id": "E3",
      "path": "app/api/claims.py",
      "startLine": 10,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Claims router prefix and GET route",
      "snippet": "10: router = APIRouter(prefix=\"/claims\", tags=[\"claims\"])\n11: \n12: \n13: @router.get(\"/{claim_id}/evidence\")"
    },
    {
      "id": "E4",
      "path": "app/api/plans.py",
      "startLine": 10,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Plans router prefix and POST route",
      "snippet": "10: router = APIRouter(prefix=\"/tasks\", tags=[\"plans\"])\n11: \n12: \n13: @router.post(\"/{task_id}/plan/approve\")"
    },
    {
      "id": "E5",
      "path": "app/api/sources.py",
      "startLine": 17,
      "endLine": 20,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Sources router prefix and GET list route",
      "snippet": "17: router = APIRouter(prefix=\"/sources\", tags=[\"sources\"])\n18: \n19: \n20: @router.get(\"\")"
    },
    {
      "id": "E6",
      "path": "app/api/sources.py",
      "startLine": 41,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Sources GET detail route decorator",
      "snippet": "41: @router.get(\"/{source_id}\")"
    },
    {
      "id": "E7",
      "path": "app/api/tasks.py",
      "startLine": 26,
      "endLine": 39,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tasks router prefix and POST route",
      "snippet": "26: router = APIRouter(prefix=\"/tasks\", tags=[\"tasks\"])\n27: \n28: \n29: class CreateTaskRequest(BaseModel):\n30:     question: str = Field(min_length=5, max_length=2000)\n31:     language: str = Field(min_length=2, max_length=5)\n32:     max_queries: int = Field(default=8, ge=1, le=30)\n33:     max_sources: int = Field(default=10, ge=1, le=30)\n34:     cost_budget_usd: float = Field(default=2.0, ge=0.1, le=20.0)\n35:     timeout_seconds: int = Field(default=1500, ge=60, le=3600)\n36:     plan_wait_timeout_s: int = Field(default=1800, ge=60, le=3600)\n37: \n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "app/api/tasks.py",
      "startLine": 53,
      "endLine": 61,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tasks GET routes for task and events",
      "snippet": "53: @router.get(\"/{task_id}\")\n54: async def get_task_endpoint(task_id: UUID) -> dict:\n55:     record = get_task(task_id)\n56:     if record is None:\n57:         raise ApiError(\"not_found\", \"Task not found\", status_code=404)\n58:     return serialize_task(record)\n59: \n60: \n61: @router.get(\"/{task_id}/events\")"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 16,
    "filesRead": 6,
    "grepCalls": 7,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 7560,
    "totalTokens": 56698
  }
}
```

ElapsedMs: 7571
McpIsError: false
