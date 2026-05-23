# trace_symbol on DeepResearch

## Tool Description
Use when a known function, class, variable, or type needs definition plus usage/callsite context. Returns grounded targets and evidence without requiring a manual grep-then-read loop.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {
      "type": "string",
      "description": "The symbol name to explain (function, class, variable, type, etc.)."
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
      "type": "string",
      "description": "Optional session ID for continuity."
    }
  },
  "required": [
    "symbol"
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
  "symbol": "create_app"
}
```

## Response Summary
```json
{
  "directAnswer": "create_app is a factory function defined in app/main.py (line 12) that creates and configures a FastAPI application. It takes no parameters and returns a FastAPI instance. The function initializes the app by loading settings, configuring logging and telemetry, creating the FastAPI app with title 'DeepResearch Demo Alpha API', registering error handlers, including four routers (tasks, plans, claims, sources), instrumenting for telemetry, and returning the configured app. It is called once at line 27 to create the module-level app variable.",
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
    "fileCount": 1,
    "warnings": [],
    "summary": "Verified: 2 files read, 1 grep searches, 1 symbol lookups, 3/3 evidence items grounded. All evidence grounded in inspected code."
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
    "filesRead": 2,
    "grepCalls": 1,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 2 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_977ebcc76ecea8d5",
  "session": {
    "id": "sess_977ebcc76ecea8d5",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Contains the create_app function definition with its complete implementation",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 12,
      "endLine": 24
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Shows where create_app is called to create the module-level app variable",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 27,
      "endLine": 27
    },
    {
      "path": "app/main.py",
      "role": "context",
      "reason": "Shows imports used by create_app function",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 1,
      "endLine": 10
    }
  ],
  "discoveredPathsCount": 2,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Definition of create_app function showing its signature, return type, and complete implementation",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Usage of create_app to create the app instance",
      "snippet": "27: app = create_app()"
    },
    {
      "id": "E3",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 10,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Import statements showing dependencies used in create_app",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: "
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 5,
    "toolCalls": 4,
    "filesRead": 2,
    "grepCalls": 1,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 4606,
    "totalTokens": 27366
  }
}
```

ElapsedMs: 4615
McpIsError: false
