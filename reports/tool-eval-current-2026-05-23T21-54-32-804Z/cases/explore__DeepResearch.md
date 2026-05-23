# explore on DeepResearch

## Tool Description
Use for a user-facing Markdown investigation report with inline file:line citations. Best for architecture walkthroughs, onboarding explanations, code review context, or broad "how does X work?" answers. Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "prompt": {
      "type": "string",
      "description": "What to explore — a natural-language question or task."
    },
    "thoroughness": {
      "type": "string",
      "enum": [
        "quick",
        "normal",
        "deep"
      ],
      "description": "Advanced only. Omit for normal agent use; defaults to normal report depth."
    },
    "scope": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional path prefixes to focus on."
    },
    "repo_root": {
      "type": "string",
      "description": "Repository root path."
    },
    "session": {
      "type": "string",
      "description": "Session ID from a previous call."
    },
    "language": {
      "type": "string",
      "description": "BCP-47 language tag for the report (e.g. \"ko\", \"en\")."
    },
    "context": {
      "type": "string",
      "description": "Optional additional context from the parent agent."
    }
  },
  "required": [
    "prompt"
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
  "prompt": "Give a concise architecture report for FastAPI app, orchestration, provider, and repository wiring. Include inline file:line citations and flag uncertainty.",
  "language": "en"
}
```

## Response Summary
```json
{
  "reportPreview": "# DeepResearch Architecture Report\n\n## Summary\n\nDeepResearch is a FastAPI-based research orchestration system that uses **LangGraph** for workflow orchestration, **Celery** for background task execution, and **async SQLAlchemy** for data persistence. The app follows a layered architecture with **protocol-based provider abstractions**, an **in-memory demo store** for tasks, and **budget gates** between orchestrator nodes to enforce limits. Key external integrations include Anthropic (LLM), Tavily (search), and Firecrawl (web scraping) with comprehensive audit logging via a **ProviderLogSink** protocol.\n\n---\n\n## Findings\n\n### 1. FastAPI Application Structure\n\n**App Factory Pattern** (`app/main.py:L12-L27`):\n```python\ndef create_app() -> FastAPI:\n    settings = get_settings()\n    configure_logging(settings.log_level)\n    configure_telemetry(settings.otel_service_name)\n    app = FastAPI(title=\"DeepResearch Demo Alpha API\", version=\"0.1.0\")\n    register_error_handlers(app)\n    app.include_router(tasks.router)  # /tasks/*\n    app.include_router(plans.router)  # /tasks/{id}/plan/approve\n    app.include_router(claims.router)\n    app.include_router(sources.router)\n    instrument_fastapi_app(app)\n    return app\n```\n\nThe app is modular with four routers registered at startup. **Error handlers** and **OpenTelemetry instrumentation** are applied globally.\n\n**Configuration** (`app/core/config.py:L10-L33`):\n- Uses `pydantic_settings.BaseSettings` with environment file\n- Configures PostgreSQL (`database_url`), Redis (`redis_url`), S3, and provider API keys\n- Default model: `anthropic_model: claude-sonnet-4-6`\n- Budget defaults: `task_default_budget_usd: 2.0`, `task_default_timeout_s: 1500`\n\n---\n\n### 2. Database & Migrations\n\n**Async Session Setup** (`app/db/session.py:L11-L17`):\n```python\nengine = create_async_engine(settings.database_url, pool_pre_ping=True)\nAsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)\n\nasync def get_session() -> AsyncIterator[AsyncSession]:\n    async with AsyncSessionLocal() as session:\n        yield session\n```\n\n**Models** (`app/models/base.py`, `app/models/research.py`):\n- `Base` extends `DeclarativeBase` with JSONB mapping for dicts\n- Mixins: `IdMixin` (UUID PK), `TimestampMixin` (created/updated), `TableNameMixin` (auto snake_case table names)\n- Core models: `ResearchTask`, `ResearchPlan`, `SubQuestion` with relationships\n\n**Migration** (`migrations/versions/202605210001_initial_domain_schema.py:L23-L24`):\n```python\ndef upgrade() -> None:\n    Base.metadata.create_all(bind=op.get_bind())\n```\nSingle migration creates all ta\n... [truncated 14745 chars]",
  "citations": [
    {
      "type": "file_range",
      "path": "app/main.py",
      "startLine": 12,
      "endLine": 27,
      "raw": "`app/main.py:L12-L27`"
    },
    {
      "type": "file_range",
      "path": "app/core/config.py",
      "startLine": 10,
      "endLine": 33,
      "raw": "`app/core/config.py:L10-L33`"
    },
    {
      "type": "file_range",
      "path": "app/db/session.py",
      "startLine": 11,
      "endLine": 17,
      "raw": "`app/db/session.py:L11-L17`"
    },
    {
      "type": "file_range",
      "path": "migrations/versions/202605210001_initial_domain_schema.py",
      "startLine": 23,
      "endLine": 24,
      "raw": "`migrations/versions/202605210001_initial_domain_schema.py:L23-L24`"
    },
    {
      "type": "file_range",
      "path": "app/repositories/base.py",
      "startLine": 12,
      "endLine": 32,
      "raw": "`app/repositories/base.py:L12-L32`"
    },
    {
      "type": "file_range",
      "path": "app/repositories/base.py",
      "startLine": 34,
      "endLine": 42,
      "raw": "`app/repositories/base.py:L34-L42`"
    },
    {
      "type": "file_range",
      "path": "app/repositories/task_repository.py",
      "startLine": 9,
      "endLine": 11,
      "raw": "`app/repositories/task_repository.py:L9-L11`"
    },
    {
      "type": "file_range",
      "path": "app/providers/base.py",
      "startLine": 57,
      "endLine": 63,
      "raw": "`app/providers/base.py:L57-L63`"
    },
    {
      "type": "file_range",
      "path": "app/providers/anthropic.py",
      "startLine": 37,
      "endLine": 52,
      "raw": "`app/providers/anthropic.py:L37-L52`"
    },
    {
      "type": "file_range",
      "path": "app/providers/tavily.py",
      "startLine": 44,
      "endLine": 55,
      "raw": "`app/providers/tavily.py:L44-L55`"
    },
    {
      "type": "file_range",
      "path": "app/providers/firecrawl.py",
      "startLine": 37,
      "endLine": 50,
      "raw": "`app/providers/firecrawl.py:L37-L50`"
    },
    {
      "type": "file_range",
      "path": "app/orchestrator/state.py",
      "startLine": 92,
      "endLine": 110,
      "raw": "`app/orchestrator/state.py:L92-L110`"
    }
  ],
  "targets": [
    {
      "path": "app/main.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 12,
      "endLine": 27
    },
    {
      "path": "app/core/config.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 10,
      "endLine": 33
    },
    {
      "path": "app/db/session.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 11,
      "endLine": 17
    },
    {
      "path": "migrations/versions/202605210001_initial_domain_schema.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 23,
      "endLine": 24
    },
    {
      "path": "app/repositories/base.py",
      "role": "reference",
      "reason": "Markdown report citations merged from 2 ranges.",
      "evidenceRefs": [],
      "startLine": 12,
      "endLine": 42
    },
    {
      "path": "app/repositories/task_repository.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 9,
      "endLine": 11
    },
    {
      "path": "app/providers/base.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 57,
      "endLine": 63
    },
    {
      "path": "app/providers/anthropic.py",
      "role": "reference",
      "reason": "Markdown report citation",
      "evidenceRefs": [],
      "startLine": 37,
      "endLine": 52
    }
  ],
  "filesRead": [
    "main.py",
    "app/main.py",
    "app/core/config.py",
    "app/db/session.py",
    "app/api/tasks.py",
    "app/api/plans.py",
    "app/providers/base.py",
    "app/repositories/base.py",
    "app/providers/anthropic.py",
    "app/providers/tavily.py",
    "app/orchestrator/graph.py",
    "app/orchestrator/state.py",
    "app/repositories/task_repository.py",
    "app/services/task_service.py",
    "migrations/versions/202605210001_initial_domain_schema.py",
    "app/workers/celery_app.py",
    "app/workers/tasks.py",
    "app/models/research.py",
    "app/orchestrator/nodes/search.py",
    "app/orchestrator/nodes/planner.py",
    "app/models/base.py",
    "app/services/cost_service.py",
    "app/providers/firecrawl.py",
    "app/storage/s3.py",
    "app/domain/enums.py",
    "app/orchestrator/nodes/fetcher.py",
    "app/orchestrator/nodes/parser.py"
  ],
  "toolsUsed": [
    "repo_list_dir",
    "repo_read_file",
    "repo_grep"
  ],
  "critic": {
    "status": "caution",
    "warnings": [
      {
        "type": "truncated_tool_results",
        "severity": "low",
        "message": "7 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing.",
        "action": "Use a narrower follow-up query or read specific ranges before relying on missing evidence."
      }
    ]
  },
  "searchCoverage": {
    "scope": [
      "app/**",
      "main.py",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 27,
    "grepCalls": 5,
    "listDirCalls": 4,
    "symbolCalls": 0,
    "toolResultsTruncated": 7,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: app/**, main.py, migrations/**",
      "7 tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing."
    ],
    "summary": "scope-limited search across app/**, main.py, migrations/**; 27 file read(s), 5 grep search(es)."
  },
  "stats": {
    "turns": 14,
    "toolCalls": 36,
    "filesRead": 27,
    "grepCalls": 5,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 18334,
    "totalTokens": 303044
  }
}
```

ElapsedMs: 18345
McpIsError: false
