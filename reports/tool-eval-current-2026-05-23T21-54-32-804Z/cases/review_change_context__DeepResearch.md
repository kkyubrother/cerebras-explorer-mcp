# review_change_context on DeepResearch

## Tool Description
Use for PR/review preparation or recent-change analysis when you need what changed, why it matters, and which files deserve review attention. Combines git-guided discovery with grounded code evidence.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "reviewGoal": {
      "type": "string",
      "description": "What to review or validate."
    },
    "since": {
      "type": "string"
    },
    "until": {
      "type": "string"
    },
    "path": {
      "type": "string"
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
  },
  "required": [
    "reviewGoal"
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
  "reviewGoal": "Review recent changes that could affect orchestration, provider logging, or API behavior.",
  "path": "app/main.py"
}
```

## Response Summary
```json
{
  "directAnswer": "Reviewed app/main.py changes: 2 commits since May 21. (1) May 21 - Initial FastAPI creation with logging/telemetry setup and routers (tasks, plans, claims). (2) May 24 - Added sources router for FE-007 source registry. No changes to orchestration, provider logging, or telemetry configuration since initial setup.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "4 evidence item(s) were removed because their line ranges were not inspected."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 4,
    "partialCount": 0,
    "droppedCount": 4,
    "fileCount": 3,
    "warnings": [
      "4 evidence item(s) were removed because their line ranges were not inspected."
    ],
    "summary": "Verified: 3 files read, 4/4 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
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
    "filesRead": 3,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 3 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_fe17a09ecc1262f5",
  "session": {
    "id": "sess_fe17a09ecc1262f5",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Main entry point showing all routers and configuration hooks",
      "evidenceRefs": [
        "file_range",
        "E1"
      ],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/api/sources.py",
      "role": "read",
      "reason": "New sources router added - review endpoints for API behavior impact",
      "evidenceRefs": [
        "file_range",
        "E3"
      ],
      "startLine": 1,
      "endLine": 47
    },
    {
      "path": "app/core/config.py",
      "role": "read",
      "reason": "Settings used by logging and telemetry in create_app()",
      "evidenceRefs": [
        "file_range",
        "E4"
      ],
      "startLine": 1,
      "endLine": 30
    },
    {
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 1,
      "role": "read",
      "reason": "Diff showing sources router: import at line 5, include at line 22",
      "evidenceRefs": [
        "E2"
      ]
    }
  ],
  "discoveredPathsCount": 5,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Current create_app() with logging, telemetry, and all routers including sources",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: \n11: \n12: def create_app() -> FastAPI:\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 1,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Diff showing sources router: import at line 5, include at line 22",
      "snippet": ""
    },
    {
      "id": "E3",
      "path": "app/api/sources.py",
      "startLine": 1,
      "endLine": 47,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "New router with list_sources (filtered) and get_source_detail endpoints",
      "snippet": "1: from __future__ import annotations\n2: \n3: from typing import Annotated\n4: from uuid import UUID\n5: \n6: from fastapi import APIRouter, Query\n7: \n8: from app.api.errors import ApiError\n9: from app.services.source_registry import (\n10:     FreshnessToken,\n11:     PolicyRiskToken,\n12:     SourceGradeToken,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "app/core/config.py",
      "startLine": 1,
      "endLine": 30,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Settings class with log_level and otel_service_name properties",
      "snippet": "1: from __future__ import annotations\n2: \n3: from functools import lru_cache\n4: from typing import Literal\n5: \n6: from pydantic import AnyUrl, Field, SecretStr\n7: from pydantic_settings import BaseSettings, SettingsConfigDict\n8: \n9: \n10: class Settings(BaseSettings):\n11:     model_config = SettingsConfigDict(env_file=\"[REDACTED:secret-path]\", env_file_encoding=\"utf-8\", extra=\"ignore\")\n12: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "4 evidence item(s) were removed because their line ranges were not inspected.",
    "Source registry service implementation not reviewed - may have orchestration impact",
    "Provider logging implementation not examined - verify wiring through logging.py",
    "Some evidence items were dropped because they were not grounded in inspected line ranges."
  ],
  "stats": {
    "turns": 8,
    "toolCalls": 12,
    "filesRead": 3,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 10318,
    "totalTokens": 54657
  }
}
```

ElapsedMs: 10328
McpIsError: false
