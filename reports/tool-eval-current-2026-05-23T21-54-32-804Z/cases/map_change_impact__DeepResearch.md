# map_change_impact on DeepResearch

## Tool Description
Use before editing when you know the intended change but need blast-radius context: likely edit files, callers, tests, config, and risky dependent paths. Do not use for a one-line known-file edit.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "change": {
      "type": "string",
      "description": "The intended change or suspected bug fix."
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
    "change"
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
  "change": "add request telemetry across FastAPI routes and provider calls",
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
  "directAnswer": "I've mapped the impact of adding request telemetry across FastAPI routes and provider calls. The app already has OpenTelemetry infrastructure (app/main.py:12-24) with configure_telemetry() and instrument_fastapi_app(). Provider HTTP calls (anthropic, firecrawl, tavily) lack detailed telemetry. Edit targets: telemetry.py (add httpx instrumentation), 3 provider files (lines 101-109, 73-78, 93-98), and orchestrator nodes (search, fetcher). No test files found - high risk. Existing ProviderLogSink protocol ensures audit logging compatibility.",
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
    "fileCount": 8,
    "warnings": [],
    "summary": "Verified: 25 files read, 10 grep searches, 2 symbol lookups, 8/8 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read app/core/telemetry.py:1-21 before editing.",
    "target": {
      "path": "app/core/telemetry.py",
      "role": "edit",
      "reason": "Add httpx.AsyncClient instrumentation helper for provider HTTP calls",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 21
    }
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 25,
    "grepCalls": 10,
    "listDirCalls": 7,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 25 file read(s), 10 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_abc55ca6dd9b2d2a",
  "session": {
    "id": "sess_abc55ca6dd9b2d2a",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/core/telemetry.py",
      "role": "edit",
      "reason": "Add httpx.AsyncClient instrumentation helper for provider HTTP calls",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 21
    },
    {
      "path": "app/providers/anthropic.py",
      "role": "edit",
      "reason": "Add telemetry to anthropic HTTP POST call",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 101,
      "endLine": 109
    },
    {
      "path": "app/providers/firecrawl.py",
      "role": "edit",
      "reason": "Add telemetry to firecrawl HTTP POST call",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 73,
      "endLine": 78
    },
    {
      "path": "app/providers/tavily.py",
      "role": "edit",
      "reason": "Add telemetry to tavily HTTP POST call",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 93,
      "endLine": 98
    },
    {
      "path": "app/orchestrator/nodes/search.py",
      "role": "edit",
      "reason": "Add telemetry to search node execution",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 25,
      "endLine": 58
    },
    {
      "path": "app/orchestrator/nodes/fetcher.py",
      "role": "edit",
      "reason": "Add telemetry to fetcher node execution",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 33,
      "endLine": 79
    },
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "Understand existing telemetry setup and FastAPI initialization",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/providers/base.py",
      "role": "read",
      "reason": "Understand existing ProviderLogSink protocol for compatibility",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 57,
      "endLine": 73
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows existing telemetry setup with configure_telemetry() and instrument_fastapi_app()",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/core/telemetry.py",
      "startLine": 1,
      "endLine": 21,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Current OpenTelemetry infrastructure using FastAPIInstrumentor",
      "snippet": "1: from __future__ import annotations\n2: \n3: from opentelemetry import trace\n4: from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor\n5: from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor\n6: from opentelemetry.sdk.resources import Resource\n7: from opentelemetry.sdk.trace import TracerProvider\n8: \n9: \n10: def configure_telemetry(service_name: str) -> None:\n11:     provider = TracerProvider(resource=Resource.create({\"service.name\": service_name}))\n12:     trace.set_tracer_provider(provider)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/providers/anthropic.py",
      "startLine": 101,
      "endLine": 109,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Provider HTTP call pattern - httpx.AsyncClient.post() that needs telemetry",
      "snippet": "101:             response = await self._client.post(\n102:                 \"/v1/messages\",\n103:                 json=payload,\n104:                 headers={\n105:                     \"x-api-key\": self.api_key,\n106:                     \"anthropic-version\": ANTHROPIC_VERSION,\n107:                     \"content-type\": \"application/json\",\n108:                 },\n109:             )"
    },
    {
      "id": "E4",
      "path": "app/providers/firecrawl.py",
      "startLine": 73,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Provider HTTP call pattern - httpx.AsyncClient.post() that needs telemetry",
      "snippet": "73:             response = await self._client.post(\n74:                 \"/v2/scrape\",\n75:                 json=payload,\n76:                 headers={\"Authorization\": f\"Bearer {self.api_key}\"},\n77:             )\n78:             response_body = response.json()"
    },
    {
      "id": "E5",
      "path": "app/providers/tavily.py",
      "startLine": 93,
      "endLine": 98,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Provider HTTP call pattern - httpx.AsyncClient.post() that needs telemetry",
      "snippet": "93:             response = await self._client.post(\n94:                 \"/search\",\n95:                 json=payload,\n96:                 headers={\"Authorization\": f\"Bearer {self.api_key}\"},\n97:             )\n98:             response_body = response.json()"
    },
    {
      "id": "E6",
      "path": "app/providers/base.py",
      "startLine": 57,
      "endLine": 73,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Existing ProviderLogSink protocol with audit logging - ensure compatibility",
      "snippet": "57: class ProviderLogSink(Protocol):\n58:     async def record_tool_call(self, record: ToolCallAudit) -> None: ...\n59: \n60:     async def record_cost(self, record: CostAudit) -> None: ...\n61: \n62:     async def record_provider_config(self, record: ProviderConfigSnapshotAudit) -> None: ...\n63: \n64: \n65: class NullProviderLogSink:\n66:     async def record_tool_call(self, record: ToolCallAudit) -> None:\n67:         return None\n68: \n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "app/orchestrator/nodes/search.py",
      "startLine": 25,
      "endLine": 58,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Search node that calls provider - needs step-level telemetry",
      "snippet": "25: def make_search_node(provider: SearchProvider, max_results: int = 10) -> SearchNode:\n26:     async def search_node(state: ResearchState) -> ResearchState:\n27:         queries = state.get(\"search_queries\", [])\n28:         if not queries:\n29:             return {**state, \"error\": \"missing_search_queries\"}\n30: \n31:         search_results: list[SearchResultDraft] = []\n32:         for query in queries:\n33:             response = await provider.search(\n34:                 task_id=state[\"task_id\"],\n35:                 query=query[\"query\"],\n36:                 max_results=max_results,\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "app/orchestrator/nodes/fetcher.py",
      "startLine": 33,
      "endLine": 79,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Fetcher node that calls provider - needs step-level telemetry",
      "snippet": "33: def make_fetcher_node(\n34:     provider: FetchProvider,\n35:     snapshot_store: SourceSnapshotStore | None = None,\n36: ) -> FetcherNode:\n37:     async def fetcher_node(state: ResearchState) -> ResearchState:\n38:         results = state.get(\"allowed_search_results\", [])\n39:         if not results:\n40:             return {**state, \"error\": \"missing_allowed_search_results\"}\n41: \n42:         snapshots: list[SourceSnapshotDraft] = []\n43:         for result in results:\n44:             snapshot = await provider.scrape(\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Provider instantiation locations not found - may use Protocol-based dependency injection at runtime",
    "Actual implementations of EvidenceExtractor and ClaimSynthesizer protocols not located"
  ],
  "stats": {
    "turns": 18,
    "toolCalls": 45,
    "filesRead": 25,
    "grepCalls": 10,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 84477,
    "totalTokens": 487813
  }
}
```

ElapsedMs: 84491
McpIsError: false
