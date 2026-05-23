# map_impact on DeepResearch

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
  "repo_root": "/home/kyubr/IdeaProjects/DeepResearch",
  "scope": [
    "app/**",
    "main.py",
    "migrations/**"
  ],
  "anchor": "app/main.py",
  "changeType": "refactor",
  "knownSymbols": [
    "create_app"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "anchor \"app/main.py\" has no direct callers, imports, tests, or configuration references within the codebase. The create_app() function is only called internally (line 27). It likely serves as an external ASGI/WSGI entry point (e.g., uvicorn app.main:app) rather than being imported by other modules.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
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
    "summary": "Verified: 2 files read, 6 grep searches, 2 symbol lookups, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read app/main.py:1-28 before final verification.",
    "target": {
      "path": "app/main.py",
      "role": "read",
      "reason": "Anchor file containing create_app() factory and FastAPI app instance",
      "evidenceRefs": [
        "app/main.py:1-28",
        "app/main.py:12-24",
        "app/main.py:27",
        "E1"
      ],
      "startLine": 1,
      "endLine": 28
    }
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 2,
    "grepCalls": 6,
    "listDirCalls": 2,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 2 file read(s), 6 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_2fb8d94cbab3effb",
  "session": {
    "id": "sess_2fb8d94cbab3effb",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Anchor file containing create_app() factory and FastAPI app instance",
      "evidenceRefs": [
        "app/main.py:1-28",
        "app/main.py:12-24",
        "app/main.py:27",
        "E1"
      ],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/api/claims.py",
      "role": "read",
      "reason": "Dependency of app/main.py - claims router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E5"
      ],
      "startLine": 7,
      "endLine": 8
    },
    {
      "path": "app/api/plans.py",
      "role": "read",
      "reason": "Dependency of app/main.py - plans router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E6"
      ],
      "startLine": 7,
      "endLine": 8
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "Dependency of app/main.py - sources router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E7"
      ],
      "startLine": 8,
      "endLine": 9
    },
    {
      "path": "app/api/tasks.py",
      "role": "read",
      "reason": "Dependency of app/main.py - tasks router imported",
      "evidenceRefs": [
        "app/main.py:5",
        "E8"
      ],
      "startLine": 12,
      "endLine": 14
    },
    {
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "role": "read",
      "reason": "create_app() definition - the main factory function that configures and returns FastAPI app",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "role": "read",
      "reason": "Only call site of create_app() within the codebase - module-level instantiation",
      "evidenceRefs": [
        "E3"
      ]
    },
    {
      "path": "app/main.py",
      "startLine": 5,
      "endLine": 9,
      "role": "read",
      "reason": "Outgoing dependencies from app/main.py to routers and core modules",
      "evidenceRefs": [
        "E4"
      ]
    }
  ],
  "discoveredPathsCount": 51,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Anchor file containing create_app() factory function (lines 12-24) and app instantiation (line 27). Imports 4 routers and 3 core modules.",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: \n11: \n12: def create_app() -> FastAPI:\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "create_app() definition - the main factory function that configures and returns FastAPI app",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/main.py",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Only call site of create_app() within the codebase - module-level instantiation",
      "snippet": "27: app = create_app()"
    },
    {
      "id": "E4",
      "path": "app/main.py",
      "startLine": 5,
      "endLine": 9,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Outgoing dependencies from app/main.py to routers and core modules",
      "snippet": "5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app"
    },
    {
      "id": "E5",
      "path": "app/api/claims.py",
      "startLine": 7,
      "endLine": 8,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Claims router - one of 4 routers imported by app/main.py",
      "snippet": "7: from app.api.errors import ApiError\n8: from app.services.claim_service import get_claim_evidence"
    },
    {
      "id": "E6",
      "path": "app/api/plans.py",
      "startLine": 7,
      "endLine": 8,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Plans router - one of 4 routers imported by app/main.py",
      "snippet": "7: from app.api.errors import ApiError\n8: from app.services.task_service import approve_task_plan, serialize_task"
    },
    {
      "id": "E7",
      "path": "app/api/sources.py",
      "startLine": 8,
      "endLine": 9,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Sources router - one of 4 routers imported by app/main.py",
      "snippet": "8: from app.api.errors import ApiError\n9: from app.services.source_registry import ("
    },
    {
      "id": "E8",
      "path": "app/api/tasks.py",
      "startLine": 12,
      "endLine": 14,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Tasks router - one of 4 routers imported by app/main.py",
      "snippet": "12: from app.api.errors import ApiError\n13: from app.services.cost_service import aggregate_task_cost\n14: from app.services.task_service import ("
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 22,
    "filesRead": 2,
    "grepCalls": 6,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 8256,
    "totalTokens": 54668
  }
}
```

ElapsedMs: 8268
McpIsError: false
