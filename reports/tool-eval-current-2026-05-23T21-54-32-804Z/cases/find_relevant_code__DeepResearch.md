# find_relevant_code on DeepResearch

## Tool Description
Use first when you need to locate the files and line ranges relevant to a feature, bug, config, route, or behavior before deciding what to read or edit. Give the natural-language query plus any known anchors. Returns targets and cited evidence; read only returned edit/read targets afterward.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {
      "type": "string",
      "description": "What code to locate and why."
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
    "query"
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
  "query": "Find the smallest useful files and line ranges for understanding FastAPI app, orchestration, provider, and repository wiring.",
  "knownFiles": [
    "app/main.py"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "FastAPI app uses app factory pattern with router registration, error handlers, and telemetry. Orchestration uses LangGraph with nodes wired through build_graph() and invoked from workers. Providers follow base protocol with log_sink injection via singleton service. Repositories use generic base class with AsyncSession dependency injection.",
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
    "fileCount": 7,
    "warnings": [],
    "summary": "Verified: 18 files read, 4 grep searches, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
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
    "filesRead": 18,
    "grepCalls": 4,
    "listDirCalls": 2,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**"
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 18 file read(s), 4 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_0f94322d9ca2ec8c",
  "session": {
    "id": "sess_0f94322d9ca2ec8c",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "app/main.py",
      "role": "read",
      "reason": "FastAPI app factory with router registration, error handlers, telemetry wiring",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 28
    },
    {
      "path": "app/orchestrator/graph.py",
      "role": "read",
      "reason": "LangGraph build_graph with node registration and edge routing",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 100
    },
    {
      "path": "app/workers/tasks.py",
      "role": "read",
      "reason": "Shows graph invocation from Celery worker with checkpointer",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 60
    },
    {
      "path": "app/providers/base.py",
      "role": "read",
      "reason": "ProviderLogSink protocol, audit dataclasses, error handling base",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 108
    },
    {
      "path": "app/providers/anthropic.py",
      "role": "read",
      "reason": "Provider __init__ showing log_sink dependency injection pattern",
      "evidenceRefs": [],
      "startLine": 37,
      "endLine": 53
    },
    {
      "path": "app/repositories/base.py",
      "role": "read",
      "reason": "Generic Repository base class with CRUD and UnitOfWork pattern",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 43
    },
    {
      "path": "app/db/session.py",
      "role": "read",
      "reason": "Database session factory and get_session() dependency function",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 18
    },
    {
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 24,
      "role": "read",
      "reason": "FastAPI app factory wiring routers, error handlers, telemetry",
      "evidenceRefs": [
        "E1"
      ]
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
      "why": "FastAPI app factory wiring routers, error handlers, telemetry",
      "snippet": "12: def create_app() -> FastAPI:\n13:     settings = get_settings()\n14:     configure_logging(settings.log_level)\n15:     configure_telemetry(settings.otel_service_name)\n16: \n17:     app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n18:     register_error_handlers(app)\n19:     app.include_router(tasks.router)\n20:     app.include_router(plans.router)\n21:     app.include_router(claims.router)\n22:     app.include_router(sources.router)\n23:     instrument_fastapi_app(app)\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "app/orchestrator/graph.py",
      "startLine": 39,
      "endLine": 92,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "LangGraph build_graph function with node and edge wiring",
      "snippet": "39: def build_graph(\n40:     nodes: ResearchGraphNodes | None = None,\n41:     checkpointer: Any | None = None,\n42:     debug: bool = False,\n43: ):\n44:     graph_nodes = nodes or ResearchGraphNodes()\n45:     graph = StateGraph(ResearchState)\n46: \n47:     graph.add_node(\"query_understanding\", graph_nodes.query_understanding)\n48:     graph.add_node(\"planner\", graph_nodes.planner)\n49:     graph.add_node(\"plan_approval_gate\", plan_approval_gate)\n50:     graph.add_node(\"search\", graph_nodes.search)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "app/orchestrator/graph.py",
      "startLine": 22,
      "endLine": 36,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ResearchGraphNodes dataclass defining orchestration nodes",
      "snippet": "22: @dataclass(frozen=True)\n23: class ResearchGraphNodes:\n24:     query_understanding: ResearchNode = query_understanding_node\n25:     planner: ResearchNode = planner_node\n26:     search: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"search\"))\n27:     policy_guard: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"policy_guard\"))\n28:     fetcher: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"fetcher\"))\n29:     parser: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"parser\"))\n30:     evidence_extractor: ResearchNode = field(\n31:         default_factory=lambda: _unconfigured_node(\"evidence_extractor\")\n32:     )\n33:     synthesizer: ResearchNode = field(default_factory=lambda: _unconfigured_node(\"synthesizer\"))\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "app/workers/tasks.py",
      "startLine": 30,
      "endLine": 38,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Graph invocation pattern from worker with checkpointer",
      "snippet": "30:     graph = build_graph(checkpointer=InMemorySaver())\n31:     result = await graph.ainvoke(\n32:         {\n33:             \"task_id\": task_uuid,\n34:             \"question\": record.question,\n35:             \"language\": record.language,\n36:         },\n37:         config={\"configurable\": {\"thread_id\": str(task_uuid)}},\n38:     )"
    },
    {
      "id": "E5",
      "path": "app/providers/base.py",
      "startLine": 57,
      "endLine": 73,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "ProviderLogSink protocol defining provider interface",
      "snippet": "57: class ProviderLogSink(Protocol):\n58:     async def record_tool_call(self, record: ToolCallAudit) -> None: ...\n59: \n60:     async def record_cost(self, record: CostAudit) -> None: ...\n61: \n62:     async def record_provider_config(self, record: ProviderConfigSnapshotAudit) -> None: ...\n63: \n64: \n65: class NullProviderLogSink:\n66:     async def record_tool_call(self, record: ToolCallAudit) -> None:\n67:         return None\n68: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "app/providers/anthropic.py",
      "startLine": 38,
      "endLine": 53,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Provider __init__ showing log_sink dependency injection",
      "snippet": "38:     def __init__(\n39:         self,\n40:         api_key: str,\n41:         model: str,\n42:         temperature: float,\n43:         http_client: httpx.AsyncClient | None = None,\n44:         log_sink: ProviderLogSink | None = None,\n45:         base_url: str = \"https://api.anthropic.com\",\n46:     ) -> None:\n47:         self.api_key = api_key\n48:         self.model = model\n49:         self.temperature = temperature\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "app/repositories/base.py",
      "startLine": 12,
      "endLine": 32,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Repository base class with session-based CRUD operations",
      "snippet": "12: class Repository[ModelT: Base]:\n13:     def __init__(self, session: AsyncSession, model: type[ModelT]) -> None:\n14:         self.session = session\n15:         self.model = model\n16: \n17:     async def get(self, item_id: UUID) -> ModelT | None:\n18:         return await self.session.get(self.model, item_id)\n19: \n20:     async def list(self, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:\n21:         result = await self.session.scalars(select(self.model).limit(limit).offset(offset))\n22:         return result.all()\n23: \n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "app/db/session.py",
      "startLine": 11,
      "endLine": 18,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session factory and get_session() dependency function",
      "snippet": "11: engine = create_async_engine(settings.database_url, pool_pre_ping=True)\n12: AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)\n13: \n14: \n15: async def get_session() -> AsyncIterator[AsyncSession]:\n16:     async with AsyncSessionLocal() as session:\n17:         yield session\n18: "
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 24,
    "filesRead": 18,
    "grepCalls": 4,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 10473,
    "totalTokens": 138783
  }
}
```

ElapsedMs: 10487
McpIsError: false
