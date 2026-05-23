# explain_code_path on DeepResearch

## Tool Description
Use for route, middleware, request, event, job, or CLI flow tracing across files. Returns the verified path through the code and the targets worth reading next.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "pathQuery": {
      "type": "string",
      "description": "The runtime path or flow to explain."
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
    "entryPoint": {
      "type": "string"
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
    "pathQuery"
  ]
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
  "pathQuery": "FastAPI app startup and API route registration through create_app",
  "entryPoint": "app/main.py",
  "knownFiles": [
    "app/main.py"
  ],
  "knownSymbols": [
    "create_app"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "FastAPI app startup begins with module-level execution: `app = create_app()` at line 27 in `app/main.py`. The `create_app()` factory (lines 12-24) orchestrates initialization by loading settings, configuring logging/telemetry, creating the FastAPI instance, registering error handlers, attaching four API routers via `include_router()`, and instrumenting the app. Each router imports a module-level `APIRouter` instance defined in `app/api/` modules with a URL prefix and tags, then registers endpoints using `@router.{method}()` decorators.",
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
    "summary": "Verified: 6 files read, 1 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
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
    "grepCalls": 1,
    "listDirCalls": 2,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 6 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_877a0b1d5cbd7723",
  "session": {
    "id": "sess_877a0b1d5cbd7723",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Entry point: module-level create_app() call",
      "evidenceRefs": [
        "app/main.py:12-24",
        "E1"
      ],
      "startLine": 27,
      "endLine": 27
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "create_app factory: app initialization and router registration",
      "evidenceRefs": [
        "app/main.py:27",
        "E2"
      ],
      "startLine": 12,
      "endLine": 24
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Handoff points: app.include_router() calls",
      "evidenceRefs": [
        "app/main.py:12-24",
        "E3"
      ],
      "startLine": 19,
      "endLine": 22
    },
    {
      "path": "app/api/tasks.py",
      "role": "read",
      "reason": "Router definition: APIRouter with prefix/tags",
      "evidenceRefs": [
        "app/main.py:19",
        "E4"
      ],
      "startLine": 26,
      "endLine": 26
    },
    {
      "path": "app/api/plans.py",
      "role": "read",
      "reason": "Router definition confirmation (plans)",
      "evidenceRefs": [
        "app/main.py:20",
        "E5"
      ],
      "startLine": 10,
      "endLine": 10
    },
    {
      "path": "app/api/claims.py",
      "role": "read",
      "reason": "Router definition confirmation (claims)",
      "evidenceRefs": [
        "app/main.py:21",
        "E6"
      ],
      "startLine": 10,
      "endLine": 10
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "Router definition confirmation (sources)",
      "evidenceRefs": [
        "app/main.py:22",
        "E7"
      ],
      "startLine": 17,
      "endLine": 17
    },
    {
      "path": "app/api/tasks.py",
      "role": "context",
      "reason": "Example endpoint using @router.post decorator",
      "evidenceRefs": [
        "app/api/tasks.py:26",
        "E8"
      ],
      "startLine": 39,
      "endLine": 50
    }
  ],
  "discoveredPathsCount": 29,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Entry point: module-level create_app() invocation when imported",
      "snippet": "27: app = create_app()"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "create_app factory: initialization sequence and router registration",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/main.py",
      "startLine": 19,
      "endLine": 22,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Handoff points: include_router() calls attaching each router",
      "snippet": "19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)"
    },
    {
      "id": "E4",
      "path": "app/api/tasks.py",
      "startLine": 26,
      "endLine": 26,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /tasks prefix and tags",
      "snippet": "26: router = APIRouter(prefix=\"/tasks\", tags=[\"tasks\"])"
    },
    {
      "id": "E5",
      "path": "app/api/plans.py",
      "startLine": 10,
      "endLine": 10,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /tasks prefix and tags",
      "snippet": "10: router = APIRouter(prefix=\"/tasks\", tags=[\"plans\"])"
    },
    {
      "id": "E6",
      "path": "app/api/claims.py",
      "startLine": 10,
      "endLine": 10,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /claims prefix and tags",
      "snippet": "10: router = APIRouter(prefix=\"/claims\", tags=[\"claims\"])"
    },
    {
      "id": "E7",
      "path": "app/api/sources.py",
      "startLine": 17,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Router instance: APIRouter with /sources prefix and tags",
      "snippet": "17: router = APIRouter(prefix=\"/sources\", tags=[\"sources\"])"
    },
    {
      "id": "E8",
      "path": "app/api/tasks.py",
      "startLine": 39,
      "endLine": 50,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Example endpoint: @router.post decorator pattern",
      "snippet": "39: @router.post(\"\", status_code=202)\n40: async def create_task_endpoint(request: CreateTaskRequest) -> dict:\n41:     record = create_task(\n42:         question=request.question,\n43:         language=request.language,\n44:         max_queries=request.max_queries,\n45:         max_sources=request.max_sources,\n46:         cost_budget_usd=request.cost_budget_usd,\n47:         timeout_seconds=request.timeout_seconds,\n48:         plan_wait_timeout_s=request.plan_wait_timeout_s,\n49:     )\n50:     return {\"task_id\": str(record.task_id), \"status\": \"queued\"}"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 14,
    "filesRead": 6,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 8870,
    "totalTokens": 74795
  }
}
```

ElapsedMs: 8881
McpIsError: false
