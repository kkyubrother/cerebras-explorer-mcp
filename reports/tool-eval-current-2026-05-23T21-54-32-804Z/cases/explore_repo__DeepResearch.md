# explore_repo on DeepResearch

## Tool Description
Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. Do NOT use for a single known file/range or when immediate editing is cheaper. Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as "session" for follow-up calls.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "task": {
      "type": "string",
      "description": "Natural-language exploration request. Be specific for best results: \"How does the auth middleware validate JWT tokens and where is it applied?\" is better than \"explain auth\"."
    },
    "repo_root": {
      "type": "string",
      "description": "Repository root path. Defaults to the current working directory of the MCP server process."
    },
    "scope": {
      "type": "array",
      "description": "Path prefixes or glob patterns to focus exploration. Example: [\"src/api/**\", \"lib/auth/\"]. Omit to search the entire repo.",
      "items": {
        "type": "string"
      }
    },
    "hints": {
      "type": "object",
      "additionalProperties": false,
      "description": "Starting hints to accelerate exploration. Provide known symbols, file paths, or regex patterns so the explorer skips broad scanning.",
      "properties": {
        "symbols": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Known symbol names to start with (e.g. [\"handleAuth\", \"JwtValidator\"])."
        },
        "files": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Known file paths to examine first (e.g. [\"src/middleware/auth.ts\"])."
        },
        "regex": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Advanced only. Prefer wrapper knownText for literal anchors; use regex only when the caller already knows an exact pattern."
        },
        "strategy": {
          "type": "string",
          "enum": [
            "symbol-first",
            "reference-chase",
            "git-guided",
            "breadth-first",
            "blame-guided",
            "pattern-scan"
          ],
          "description": "Advanced only. Omit for normal agent use; strategy is auto-detected from the task and known anchors."
        }
      }
    },
    "session": {
      "type": "string",
      "description": "Optional session ID returned by a previous explore_repo call. When provided, the explorer carries over discovered file paths and prior summaries to accelerate follow-up exploration."
    },
    "language": {
      "type": "string",
      "description": "Advanced/optional. Omit for normal agent use; the explorer infers response language from the task text. Use only when a workflow must force a BCP-47 language tag such as \"ko\", \"en\", or \"ja\"."
    }
  },
  "required": [
    "task"
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
  "task": "Explain the repository purpose and the main implementation path for FastAPI app, orchestration, provider, and repository wiring. Return grounded targets that a parent coding agent should verify before editing."
}
```

## Response Summary
```json
{
  "directAnswer": "DeepResearch is an AI-powered research platform orchestrating multi-step verification workflows. Uses LangGraph for query understanding → planning → search → policy checks → fetching → parsing → evidence extraction → synthesis → citation validation. Tracks costs, sources, evidence, claims, producing markdown reports with validated citations.",
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
    "fileCount": 7,
    "warnings": [],
    "summary": "Verified: 12 files read, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read app/repositories/base.py:12-43 before final verification.",
    "target": {
      "path": "app/repositories/base.py",
      "role": "read",
      "reason": "Generic repository base with CRUD and UnitOfWork.",
      "evidenceRefs": [
        "app/repositories/base.py:12-43",
        "8"
      ],
      "startLine": 12,
      "endLine": 43
    }
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 12,
    "grepCalls": 0,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 12 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f69d901fce6f95bb",
  "session": {
    "id": "sess_f69d901fce6f95bb",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "context",
      "reason": "FastAPI factory with router registration - verify before editing.",
      "evidenceRefs": [
        "app/main.py:1-28",
        "1"
      ],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/core/config.py",
      "role": "config",
      "reason": "Central settings (DB, Redis, S3, API keys) - verify defaults.",
      "evidenceRefs": [
        "app/core/config.py:1-39"
      ],
      "startLine": 1,
      "endLine": 39
    },
    {
      "path": "app/db/session.py",
      "role": "context",
      "reason": "SQLAlchemy async session factory - verify dependency injection.",
      "evidenceRefs": [
        "app/db/session.py:1-18"
      ],
      "startLine": 1,
      "endLine": 18
    },
    {
      "path": "app/orchestrator/graph.py",
      "role": "context",
      "reason": "LangGraph workflow with 8 nodes and budget gates.",
      "evidenceRefs": [
        "app/orchestrator/graph.py:1-92"
      ],
      "startLine": 1,
      "endLine": 92
    },
    {
      "path": "app/orchestrator/state.py",
      "role": "context",
      "reason": "ResearchState TypedDict defining workflow schema.",
      "evidenceRefs": [
        "app/orchestrator/state.py:92-110",
        "6"
      ],
      "startLine": 92,
      "endLine": 110
    },
    {
      "path": "app/providers/base.py",
      "role": "context",
      "reason": "Provider logging protocol - verify before adding providers.",
      "evidenceRefs": [
        "app/providers/base.py:57-90",
        "7"
      ],
      "startLine": 57,
      "endLine": 90
    },
    {
      "path": "app/repositories/base.py",
      "role": "read",
      "reason": "Generic repository base with CRUD and UnitOfWork.",
      "evidenceRefs": [
        "app/repositories/base.py:12-43",
        "8"
      ],
      "startLine": 12,
      "endLine": 43
    },
    {
      "path": "app/core/config.py",
      "startLine": 10,
      "endLine": 39,
      "role": "read",
      "reason": "Settings with database, Redis, S3, API keys, budgets.",
      "evidenceRefs": [
        "2"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "1",
      "path": "app/main.py",
      "startLine": 1,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "FastAPI app factory with routers and error handlers.",
      "snippet": "1: from __future__ import annotations\n2: \n3: from fastapi import FastAPI\n4: \n5: from app.api import claims, plans, sources, tasks\n6: from app.api.errors import register_error_handlers\n7: from app.core.config import get_settings\n8: from app.core.logging import configure_logging\n9: from app.core.telemetry import configure_telemetry, instrument_fastapi_app\n10: \n11: \n12: def create_app() -> FastAPI:\n... [snippet truncated]"
    },
    {
      "id": "2",
      "path": "app/core/config.py",
      "startLine": 10,
      "endLine": 39,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Settings with database, Redis, S3, API keys, budgets.",
      "snippet": "10: class Settings(BaseSettings):\n11:     model_config = SettingsConfigDict(env_file=\"[REDACTED:secret-path]\", env_file_encoding=\"utf-8\", extra=\"ignore\")\n12: \n13:     database_url: str = \"postgresql+asyncpg://dev:dev@localhost:5432/deepresearch\"\n14:     redis_url: str = \"redis://localhost:6379/0\"\n15: \n16:     s3_endpoint_url: AnyUrl | str = \"http://localhost:9000\"\n17:     s3_bucket: str = \"deepresearch-snapshots\"\n18:     s3_access_key: str = \"minio\"\n19:     s3_secret_key: SecretStr = SecretStr(\"miniodev\")\n20: \n21:     tavily_api_key: SecretStr | None = None\n... [snippet truncated]"
    },
    {
      "id": "3",
      "path": "app/db/session.py",
      "startLine": 11,
      "endLine": 17,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "SQLAlchemy async engine and session factory.",
      "snippet": "11: engine = create_async_engine(settings.database_url, pool_pre_ping=True)\n12: AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)\n13: \n14: \n15: async def get_session() -> AsyncIterator[AsyncSession]:\n16:     async with AsyncSessionLocal() as session:\n17:         yield session"
    },
    {
      "id": "4",
      "path": "app/orchestrator/graph.py",
      "startLine": 39,
      "endLine": 92,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "LangGraph with 8 nodes, budget gates, conditional edges.",
      "snippet": "39: def build_graph(\n40:     nodes: ResearchGraphNodes | None = None,\n41:     checkpointer: Any | None = None,\n42:     debug: bool = False,\n43: ):\n44:     graph_nodes = nodes or ResearchGraphNodes()\n45:     graph = StateGraph(ResearchState)\n46: \n47:     graph.add_node(\"query_understanding\", graph_nodes.query_understanding)\n48:     graph.add_node(\"planner\", graph_nodes.planner)\n49:     graph.add_node(\"plan_approval_gate\", plan_approval_gate)\n50:     graph.add_node(\"search\", graph_nodes.search)\n... [snippet truncated]"
    },
    {
      "id": "5",
      "path": "app/orchestrator/graph.py",
      "startLine": 95,
      "endLine": 123,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Plan approval gate with interrupt for human-in-the-loop.",
      "snippet": "95: async def plan_approval_gate(state: ResearchState) -> ResearchState:\n96:     if state.get(\"plan_approved\") is True:\n97:         return state\n98: \n99:     resume_value = interrupt(\n100:         {\n101:             \"task_id\": str(state[\"task_id\"]),\n102:             \"status\": ResearchStatus.WAITING_FOR_USER.value,\n103:             \"plan\": state.get(\"plan\"),\n104:         }\n105:     )\n106:     approved = _resume_approved(resume_value)\n... [snippet truncated]"
    },
    {
      "id": "6",
      "path": "app/orchestrator/state.py",
      "startLine": 92,
      "endLine": 110,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ResearchState with search results, evidence, claims fields.",
      "snippet": "92: class ResearchState(TypedDict):\n93:     task_id: UUID\n94:     question: NotRequired[str]\n95:     language: NotRequired[str]\n96:     normalized_question: NotRequired[str]\n97:     search_queries: NotRequired[list[SearchQueryDraft]]\n98:     search_results: NotRequired[list[SearchResultDraft]]\n99:     allowed_search_results: NotRequired[list[SearchResultDraft]]\n100:     policy_decisions: NotRequired[list[PolicyDecisionDraft]]\n101:     source_snapshots: NotRequired[list[SourceSnapshotDraft]]\n102:     source_evaluations: NotRequired[list[SourceEvaluationDraft]]\n103:     evidence_spans: NotRequired[list[EvidenceSpanDraft]]\n... [snippet truncated]"
    },
    {
      "id": "7",
      "path": "app/providers/base.py",
      "startLine": 57,
      "endLine": 90,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ProviderLogSink protocol for tool/cost/config logging.",
      "snippet": "57: class ProviderLogSink(Protocol):\n58:     async def record_tool_call(self, record: ToolCallAudit) -> None: ...\n59: \n60:     async def record_cost(self, record: CostAudit) -> None: ...\n61: \n62:     async def record_provider_config(self, record: ProviderConfigSnapshotAudit) -> None: ...\n63: \n64: \n65: class NullProviderLogSink:\n66:     async def record_tool_call(self, record: ToolCallAudit) -> None:\n67:         return None\n68: \n... [snippet truncated]"
    },
    {
      "id": "8",
      "path": "app/repositories/base.py",
      "startLine": 12,
      "endLine": 43,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Generic Repository[ModelT] with CRUD and UnitOfWork.",
      "snippet": "12: class Repository[ModelT: Base]:\n13:     def __init__(self, session: AsyncSession, model: type[ModelT]) -> None:\n14:         self.session = session\n15:         self.model = model\n16: \n17:     async def get(self, item_id: UUID) -> ModelT | None:\n18:         return await self.session.get(self.model, item_id)\n19: \n20:     async def list(self, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:\n21:         result = await self.session.scalars(select(self.model).limit(limit).offset(offset))\n22:         return result.all()\n23: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Migration schema not read - table structure unverified",
    "Celery worker config not read - async task wiring unverified",
    "Service layer not read - business logic unverified",
    "Orchestrator nodes not read - individual node logic unverified"
  ],
  "stats": {
    "turns": 5,
    "toolCalls": 15,
    "filesRead": 12,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8265,
    "totalTokens": 67176
  }
}
```

ElapsedMs: 8282
McpIsError: false
