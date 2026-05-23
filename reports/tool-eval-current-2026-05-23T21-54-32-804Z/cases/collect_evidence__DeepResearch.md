# collect_evidence on DeepResearch

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
  "repo_root": "/home/kyubr/IdeaProjects/DeepResearch",
  "scope": [
    "app/**",
    "main.py",
    "migrations/**"
  ],
  "claim": "create_app is the main FastAPI application factory and wires API routers or middleware",
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
  "directAnswer": "Claim VERIFIED: create_app in app/main.py is the FastAPI factory, includes 4 routers (tasks, plans, claims, sources), and wires middleware via instrument_fastapi_app.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 3,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 3,
    "warnings": [],
    "summary": "Verified: 4 files read, 1 grep searches, 1 symbol lookups, 3/3 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
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
    "filesRead": 4,
    "grepCalls": 1,
    "listDirCalls": 1,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 4 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_6d1fcef993fbc335",
  "session": {
    "id": "sess_6d1fcef993fbc335",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Full create_app factory showing FastAPI instantiation, router wiring, and middleware setup",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 12,
      "endLine": 24
    },
    {
      "path": "app/core/telemetry.py",
      "role": "read",
      "reason": "Shows instrument_fastpi_app adds OpenTelemetry instrumentation middleware",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 15,
      "endLine": 16
    },
    {
      "path": "app/api/errors.py",
      "role": "read",
      "reason": "Shows register_error_handlers adds exception handlers, not middleware",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 28,
      "endLine": 38
    }
  ],
  "discoveredPathsCount": 96,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Proves create_app creates FastAPI app, wires 4 routers via include_router, and calls instrumentation middleware",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/core/telemetry.py",
      "startLine": 15,
      "endLine": 16,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows instrument_fastapi_app uses FastAPIInstrumentor which adds ASGI middleware for tracing",
      "snippet": "15: def instrument_fastapi_app(app: object) -> None:\n16:     FastAPIInstrumentor.instrument_app(app)"
    },
    {
      "id": "E3",
      "path": "app/api/errors.py",
      "startLine": 28,
      "endLine": 38,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows register_error_handlers uses @app.exception_handler decorator, not middleware",
      "snippet": "28: def register_error_handlers(app: FastAPI) -> None:\n29:     @app.exception_handler(ApiError)\n30:     async def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:\n31:         return JSONResponse(\n32:             status_code=exc.status_code,\n33:             content=ErrorResponse(\n34:                 code=exc.code,\n35:                 message=exc.message,\n36:                 details=exc.details,\n37:             ).model_dump(),\n38:         )"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 7,
    "filesRead": 4,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 5886,
    "totalTokens": 36485
  }
}
```

ElapsedMs: 5896
McpIsError: false
