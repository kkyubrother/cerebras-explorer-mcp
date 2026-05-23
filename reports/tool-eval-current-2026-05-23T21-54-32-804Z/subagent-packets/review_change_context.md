# Code-blind evaluator packet: review_change_context

You are evaluating this MCP tool as a parent coding agent. Do not inspect the filesystem, repository, or source code. Use only this packet: tool description, input schema, request, and response summaries. Decide whether you would use this tool as a parent agent and why. Check whether the response contains enough reliability signals to trust or whether it needs follow-up verification.

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

## Case cerebras-explorer-mcp

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp",
  "scope": [
    "src/**",
    "tests/**",
    "examples/**"
  ],
  "reviewGoal": "Review the current public MCP surface for fixed 10-tool behavior and removed explore_v2/budget inputs.",
  "path": "src/mcp/server.mjs"
}
```

### Response
```json
{
  "directAnswer": "Two major spec-driven changes: (1) Tool surface fixed at 10 tools (spec-013, v0.4.0): added map_impact (anchor-based deep dependency analysis) and find_entrypoints (HTTP/CLI/cron/MCP/event detection). Surface no longer controlled by legacy envvars. (2) explore_v2 removed (spec-1): collapsed into single explore tool; removed shouldUseV2ForExplore router and all envvar branches. Budget input removed from explore_repo; all calls use single deep runtime config. Review risks: new tools need client integration awareness; existing explore_v2 references will fail; budget-dependent workflows may break.",
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
    "fileCount": 3,
    "warnings": [],
    "summary": "Verified: 4 files read, 1 grep searches, 8/8 evidence items grounded, cross-verified across 3 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 4,
    "grepCalls": 1,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 4 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_5753a327227d8ed9",
  "session": {
    "id": "sess_5753a327227d8ed9",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Fixed 10-tool surface array; no envvar branching",
      "evidenceRefs": [
        "e1",
        "E1"
      ],
      "startLine": 277,
      "endLine": 290
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "NEW map_impact tool definition added",
      "evidenceRefs": [
        "e2",
        "E2"
      ],
      "startLine": 193,
      "endLine": 222
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "NEW find_entrypoints tool definition added",
      "evidenceRefs": [
        "e3",
        "E3"
      ],
      "startLine": 224,
      "endLine": 246
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "read",
      "reason": "EXPLORE_TOOL after explore_v2 removal",
      "evidenceRefs": [
        "e4",
        "E4"
      ],
      "startLine": 250,
      "endLine": 273
    },
    {
      "path": "src/explorer/schemas.mjs",
      "role": "read",
      "reason": "EXPLORE_REPO_INPUT_SCHEMA lacks budget property",
      "evidenceRefs": [
        "e5",
        "E5"
      ],
      "startLine": 1,
      "endLine": 57
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Test confirms budget input removed",
      "evidenceRefs": [
        "e6",
        "E6"
      ],
      "startLine": 221,
      "endLine": 223
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Verifies fixed 10-tool surface regardless of envvars",
      "evidenceRefs": [
        "e7",
        "E7"
      ],
      "startLine": 480,
      "endLine": 510
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "Import shows freeExploreRepository is single backend",
      "evidenceRefs": [
        "e8",
        "E8"
      ],
      "startLine": 1,
      "endLine": 2
    }
  ],
  "discoveredPathsCount": 14,
  "evidence": [
    {
      "id": "E1",
      "path": "src/mcp/server.mjs",
      "startLine": 277,
      "endLine": 290,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows fixed 10-tool surface with new tools added",
      "snippet": "277: function buildToolList() {\n278:   return [\n279:     FIND_RELEVANT_CODE_TOOL,\n280:     TRACE_SYMBOL_TOOL,\n281:     MAP_CHANGE_IMPACT_TOOL,\n282:     MAP_IMPACT_TOOL,\n283:     EXPLAIN_CODE_PATH_TOOL,\n284:     COLLECT_EVIDENCE_TOOL,\n285:     REVIEW_CHANGE_CONTEXT_TOOL,\n286:     FIND_ENTRYPOINTS_TOOL,\n287:     EXPLORE_REPO_TOOL,\n288:     EXPLORE_TOOL,\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/mcp/server.mjs",
      "startLine": 193,
      "endLine": 222,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "New map_impact tool definition added in spec-013",
      "snippet": "193: const MAP_IMPACT_TOOL = {\n194:   name: 'map_impact',\n195:   title: 'Map impact from anchor',\n196:   description:\n197:     'Use when the parent already knows the specific anchor (a file path or symbol name) that is about to change and wants a deeper dependency chain plus test/config blast radius. ' +\n198:     'Differs from map_change_impact: this tool puts the anchor in front and runs a deeper reference chase; map_change_impact takes a natural-language change description.',\n199:   inputSchema: {\n200:     type: 'object',\n201:     additionalProperties: false,\n202:     properties: {\n203:       anchor: {\n204:         type: 'string',\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 224,
      "endLine": 246,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "New find_entrypoints tool definition added in spec-013",
      "snippet": "224: const FIND_ENTRYPOINTS_TOOL = {\n225:   name: 'find_entrypoints',\n226:   title: 'Find entry points',\n227:   description:\n228:     'Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. ' +\n229:     'Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.',\n230:   inputSchema: {\n231:     type: 'object',\n232:     additionalProperties: false,\n233:     properties: {\n234:       entryKind: {\n235:         type: 'string',\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 250,
      "endLine": 273,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Current EXPLORE_TOOL schema after explore_v2 removal",
      "snippet": "250: const EXPLORE_TOOL = {\n251:   name: 'explore',\n252:   title: 'Free-form repository exploration',\n253:   description:\n254:     'Use for a user-facing Markdown investigation report with inline file:line citations. ' +\n255:     'Best for architecture walkthroughs, onboarding explanations, code review context, or broad \"how does X work?\" answers. ' +\n256:     'Do NOT use when the parent agent needs structured edit planning or programmatic next steps; use explore_repo instead. ' +\n257:     'Omit thoroughness in normal agent use unless an advanced workflow explicitly requires quick, normal, or deep.',\n258:   inputSchema: {\n259:     type: 'object',\n260:     additionalProperties: false,\n261:     properties: {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/explorer/schemas.mjs",
      "startLine": 1,
      "endLine": 57,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Confirms no budget property in input schema",
      "snippet": "1: export const EXPLORE_REPO_INPUT_SCHEMA = {\n2:   type: 'object',\n3:   additionalProperties: false,\n4:   properties: {\n5:     task: {\n6:       type: 'string',\n7:       description:\n8:         'Natural-language exploration request. Be specific for best results: ' +\n9:         '\"How does the auth middleware validate JWT tokens and where is it applied?\" ' +\n10:         'is better than \"explain auth\".',\n11:     },\n12:     repo_root: {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 221,
      "endLine": 223,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test assertion verifying budget removal",
      "snippet": "221:   // spec 011: budget input was removed; every call runs against the single deep runtime config.\n222:   assert.equal(exploreRepoTool.inputSchema.properties.budget, undefined, 'budget input was removed in spec 011');\n223:   assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');"
    },
    {
      "id": "E7",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 480,
      "endLine": 510,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test verifies fixed 10-tool surface",
      "snippet": "480:   assert.equal(called.structuredContent.status.verification, 'verified');\n481: });\n482: \n483: test('MCP request handler declares read-only annotations for the fixed 10-tool surface', async () => {\n484:   // spec 013: tool surface is fixed at 10 (spec 011 added 8; spec 013 added\n485:   // map_impact and find_entrypoints) regardless of legacy envvars.\n486:   const expectedNames = [\n487:     'find_relevant_code',\n488:     'trace_symbol',\n489:     'map_change_impact',\n490:     'map_impact',\n491:     'explain_code_path',\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/mcp/server.mjs",
      "startLine": 1,
      "endLine": 2,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Import showing single backend after V2 removal",
      "snippet": "1: import { DEFAULT_PROTOCOL_VERSION, getExplorerModel } from '../explorer/config.mjs';\n2: import { exploreRepository, freeExploreRepository } from '../explorer/runtime.mjs';"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 8,
    "filesRead": 4,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 10431,
    "totalTokens": 197417
  }
}
```
## Case DeepResearch

### Request
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

### Response
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
## Case aicc_manage

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/aicc_manage",
  "scope": [
    "src/**",
    "websocket-server/src/**",
    "lambda/**",
    "prisma/**",
    "scripts/**"
  ],
  "reviewGoal": "Review recent auth and websocket-related changes for security or behavior risk.",
  "path": "websocket-server/src/middleware/auth.ts"
}
```

### Response
```json
{
  "directAnswer": "Recent WebSocket auth changes address critical security vulnerabilities: (1) Removed JWT_SECRET fallback to 'your-secret-key' which allowed auth bypass, (2) Removed query parameter token extraction to prevent log/referrer exposure, (3) Added tenant authorization validating companyId+sessionId against database for all chat events, (4) Added role-based authorization restricting agent-only operations. Broader auth fixes include: 2FA email send failure now invalidates challenges, replaced Math.random() with crypto.randomInt() for OTP/temp passwords, fixed fail-open CRON_SECRET validation to fail-closed structure. All changes are defensive security improvements.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 6,
    "partialCount": 2,
    "droppedCount": 0,
    "fileCount": 6,
    "warnings": [
      "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 4 files read, 6/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "websocket-server/src/**",
      "lambda/**",
      "prisma/**",
      "scripts/**"
    ],
    "scopeLimited": true,
    "filesRead": 4,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 4 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_51772e8c68b2fa6f",
  "session": {
    "id": "sess_51772e8c68b2fa6f",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "JWT_SECRET strict validation - IIFE throws at startup if not set, preventing auth bypass from default secret",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 24,
      "endLine": 28
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "Token extraction removed query parameter support to prevent token exposure in logs/referrers",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 67,
      "endLine": 70
    },
    {
      "path": "websocket-server/src/lib/db.ts",
      "role": "read",
      "reason": "New tenant authorization helper - validates sessionId belongs to user's companyId before granting access",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 28,
      "endLine": 44
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "context",
      "reason": "join-session handler now validates tenant ownership via findChatSession before allowing room join",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 49,
      "endLine": 61
    },
    {
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "role": "context",
      "reason": "accept-chat handler adds both tenant validation and agent role check",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 160,
      "endLine": 175
    },
    {
      "path": "src/app/api/auth/login/route.ts",
      "role": "read",
      "reason": "2FA email send failure handling - invalidates challenge and returns 503 to prevent stuck state",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 276,
      "endLine": 285
    },
    {
      "path": "src/lib/utils/password.ts",
      "role": "read",
      "reason": "Cryptographically secure random generation - replaced Math.random() with crypto.randomInt()",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 1,
      "endLine": 16
    },
    {
      "path": "src/app/api/cron/data-retention/route.ts",
      "role": "read",
      "reason": "Fail-closed CRON_SECRET validation - requires super_admin session when CRON_SECRET not set",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 9,
      "endLine": 23
    }
  ],
  "discoveredPathsCount": 11,
  "evidence": [
    {
      "id": "E1",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 24,
      "endLine": 28,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT_SECRET validation change from commit 350728c2 - IIFE ensures startup failure if not set",
      "snippet": "24: const JWT_SECRET: string = (() => {\n25:   const secret = process.env.JWT_SECRET\n26:   if (!secret) throw new Error('JWT_SECRET must be set')\n27:   return secret\n28: })()"
    },
    {
      "id": "E2",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 67,
      "endLine": 70,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Token extraction simplified to auth/header only, query token removed per commit 350728c2",
      "snippet": "67:     // 토큰 추출 (auth 또는 헤더에서만 — query는 로그 노출 위험으로 제외)\n68:     const token =\n69:       socket.handshake.auth.token ||\n70:       socket.handshake.headers.authorization?.replace('Bearer ', '')"
    },
    {
      "id": "E3",
      "path": "websocket-server/src/lib/db.ts",
      "startLine": 28,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "New findChatSession function added in commit cae48b88 for tenant authorization",
      "snippet": "28: export async function findChatSession(\n29:   sessionId: string,\n30:   companyId: string\n31: ): Promise<ChatSessionRow | null> {\n32:   const client = await getPool().connect()\n33:   try {\n34:     const { rows } = await client.query<ChatSessionRow>(\n35:       `SELECT id, assigned_to, status\n36:        FROM chat_sessions\n37:        WHERE id = $1 AND company_id = $2\n38:        LIMIT 1`,\n39:       [sessionId, companyId]\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 49,
      "endLine": 61,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "join-session handler added tenant check in commit cae48b88",
      "snippet": "49:   socket.on('join-session', async (data: JoinSessionData) => {\n50:     const { sessionId } = data\n51: \n52:     if (!isValidSessionId(sessionId)) {\n53:       socket.emit('error', { message: '유효하지 않은 세션 ID입니다.' })\n54:       return\n55:     }\n56: \n57:     const chatSession = await findChatSession(sessionId, companyId)\n58:     if (!chatSession) {\n59:       socket.emit('error', { message: '권한이 없는 세션입니다.' })\n60:       return\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "websocket-server/src/socket-handlers/chat.ts",
      "startLine": 160,
      "endLine": 175,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "accept-chat handler added tenant validation and agent role restriction in commit cae48b88",
      "snippet": "160:   socket.on('accept-chat', async (data: JoinSessionData) => {\n161:     const { sessionId } = data\n162: \n163:     if (!isValidSessionId(sessionId)) return\n164: \n165:     // 상담원 role만 허용\n166:     if (!AGENT_ROLES.has(role)) {\n167:       socket.emit('error', { message: '상담원 권한이 필요합니다.' })\n168:       return\n169:     }\n170: \n171:     const chatSession = await findChatSession(sessionId, companyId)\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/app/api/auth/login/route.ts",
      "startLine": 276,
      "endLine": 285,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "2FA email send failure handling added in commit 78785c12",
      "snippet": "276:           await sendTwoFactorCode(user.email, code)\n277:         } catch (emailError) {\n278:           console.error('2FA email send error:', emailError)\n279:           // 발송 실패 시 생성한 코드를 무효화하고 에러 반환\n280:           await prisma.twoFactorCode.updateMany({\n281:             where: { userId: user.id, used: false },\n282:             data: { used: true },\n283:           })\n284:           return NextResponse.json(\n285:             { error: '인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' },"
    },
    {
      "id": "E7",
      "path": "src/lib/utils/password.ts",
      "startLine": 1,
      "endLine": 16,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "crypto.randomInt replaced Math.random for secure RNG in commit 7d0f1599",
      "snippet": "1: import bcrypt from 'bcryptjs'\n2: import { randomInt } from 'crypto'\n3: \n4: // 임시 비밀번호 생성 (8자리 영문+숫자)\n5: export function generateTempPassword(): string {\n6:   const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'\n7:   let password = ''\n8:   for (let i = 0; i < 8; i++) {\n9:     password += chars.charAt(randomInt(0, chars.length))\n10:   }\n11:   return password\n12: }\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/app/api/cron/data-retention/route.ts",
      "startLine": 9,
      "endLine": 23,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Fail-closed CRON_SECRET validation fixed in commit f894b841",
      "snippet": "9:     const authHeader = request.headers.get('authorization')\n10:     const cronSecret = process.env.CRON_SECRET\n11: \n12:     if (cronSecret) {\n13:       // CRON_SECRET 설정됨: Bearer 토큰 일치 여부만 확인\n14:       if (authHeader !== `Bearer ${cronSecret}`) {\n15:         return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })\n16:       }\n17:     } else {\n18:       // CRON_SECRET 미설정: 수동 실행 경로 → super_admin 세션 필수\n19:       const { getSession } = await import('@/lib/auth')\n20:       const session = await getSession()\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "2 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 7,
    "toolCalls": 12,
    "filesRead": 4,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8573,
    "totalTokens": 98967
  }
}
```
## Case bible

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "reviewGoal": "Review current reader/search/bookmark changes for user-visible regressions and API contract risk.",
  "path": "src/store.tsx"
}
```

### Response
```json
{
  "directAnswer": "Review of src/store.tsx reveals four significant commits affecting reader/search/bookmark functionality:\n\n1. **Security Hardening (Apr 17)**: Removed `auth` from persisted state - users must re-authenticate after refresh.\n\n2. **Major Refactor (Mar 11)**: Split 386-line monolith into modular architecture (types.ts, initialState.ts, createActions.ts, slices/). Added `experimentalModeEnabled` field.\n\n3. **Reader Routing Fix (Mar 10)**: Removed database side effects from `updateBookId`/`updateChapter`. Added `setCurrentPassage(bookId, chapter)` for atomic updates.\n\n4. **Bookmark Workflow (Mar 9)**: Added `bookmarkDraftCount` to UiState and `setBookmarkDraftCount` action.\n\n**Key Risks**: Auth no longer persists; navigation actions lost DB persistence; new `setCurrentPassage` may not be used; import paths changed from relative to absolute (`@/shared/*`).",
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
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 8 files read, 8/8 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 8,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 8 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_6e2e202671be24aa",
  "session": {
    "id": "sess_6e2e202671be24aa",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "context",
      "reason": "Security: auth removed from persistence partialize - verify re-auth flow",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 53,
      "endLine": 56
    },
    {
      "path": "src/store.tsx",
      "role": "read",
      "reason": "Current store structure - verify modular integration with consumers",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 1,
      "endLine": 59
    },
    {
      "path": "src/store/types.ts",
      "role": "read",
      "reason": "SettingsState with experimentalModeEnabled - verify type safety",
      "evidenceRefs": [],
      "startLine": 12,
      "endLine": 25
    },
    {
      "path": "src/store/types.ts",
      "role": "read",
      "reason": "UiState with bookmarkDraftCount - verify UI integration",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 47,
      "endLine": 54
    },
    {
      "path": "src/store/slices/currents.ts",
      "role": "read",
      "reason": "setCurrentPassage implementation - verify routing logic uses it",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 17,
      "endLine": 24
    },
    {
      "path": "src/store/slices/ui.ts",
      "role": "read",
      "reason": "Bookmark draft action - verify UI updates correctly",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 16,
      "endLine": 22
    },
    {
      "path": "src/store.tsx",
      "startLine": 2,
      "endLine": 41,
      "role": "read",
      "reason": "Major refactor: store split into modules",
      "evidenceRefs": [
        "E2"
      ]
    },
    {
      "path": "src/store.tsx",
      "startLine": 256,
      "endLine": 283,
      "role": "read",
      "reason": "Routing fix: removed DB side effects, added setCurrentPassage",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 8,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 53,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Security: auth removed from persistence",
      "snippet": ""
    },
    {
      "id": "E2",
      "path": "src/store.tsx",
      "startLine": 2,
      "endLine": 41,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Major refactor: store split into modules",
      "snippet": ""
    },
    {
      "id": "E3",
      "path": "src/store.tsx",
      "startLine": 256,
      "endLine": 283,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Routing fix: removed DB side effects, added setCurrentPassage",
      "snippet": ""
    },
    {
      "id": "E4",
      "path": "src/store.tsx",
      "startLine": 49,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "git_diff_hunk",
      "why": "Bookmark workflow: added bookmarkDraftCount",
      "snippet": ""
    },
    {
      "id": "E5",
      "path": "src/store.tsx",
      "startLine": 1,
      "endLine": 59,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Current store structure after refactor",
      "snippet": "1: import { create } from \"zustand\";\n2: import { createJSONStorage, persist } from \"zustand/middleware\";\n3: \n4: import { FONT_SIZE_DEFAULT, applyHtmlFontSize } from \"@/shared/constants/fontSize\";\n5: import { createStoreActions } from \"./store/createActions\";\n6: import {\n7:   INITIAL_AUTH,\n8:   INITIAL_CURRENTS,\n9:   INITIAL_GLOBALS,\n10:   INITIAL_SEARCH,\n11:   INITIAL_SETTINGS,\n12:   INITIAL_UI,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/store/types.ts",
      "startLine": 47,
      "endLine": 54,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "UiState with bookmarkDraftCount field",
      "snippet": "47: export interface UiState {\n48:   sideOpen: boolean;\n49:   bookmarkDraftCount: number;\n50:   windowSize: {\n51:     innerWidth: number;\n52:     innerHeight: number;\n53:   };\n54: }"
    },
    {
      "id": "E7",
      "path": "src/store/slices/currents.ts",
      "startLine": 17,
      "endLine": 24,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "setCurrentPassage action for reader routing",
      "snippet": "17:   setCurrentPassage: (bookId, chapter) =>\n18:     set((state) => ({\n19:       currents: {\n20:         ...state.currents,\n21:         currentBookId: bookId,\n22:         currentChapter: chapter,\n23:       },\n24:     })),"
    },
    {
      "id": "E8",
      "path": "src/store/slices/ui.ts",
      "startLine": 16,
      "endLine": 22,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "setBookmarkDraftCount implementation",
      "snippet": "16:   setBookmarkDraftCount: (bookmarkDraftCount) =>\n17:     set((state) => ({\n18:       ui: {\n19:         ...state.ui,\n20:         bookmarkDraftCount,\n21:       },\n22:     })),"
    }
  ],
  "uncertainties": [
    "Components using updateBookId/updateChapter expecting DB persistence may break",
    "Components importing from old relative paths (./constants/*) may fail",
    "setCurrentPassage adoption in routing logic unknown",
    "experimentalModeEnabled has no visible toggle action in reviewed types"
  ],
  "stats": {
    "turns": 6,
    "toolCalls": 13,
    "filesRead": 8,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 8013,
    "totalTokens": 74785
  }
}
```
## Case studious-memory

### Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/studious-memory",
  "scope": [
    "backend/**",
    "frontend/src/**",
    "extensions/firefox-inbox/src/**",
    "scripts/**",
    "android/**"
  ],
  "reviewGoal": "Review recent backend/frontend contract changes around source intake, API keys, and MCP tools.",
  "path": "backend/mcp_server.py"
}
```

### Response
```json
{
  "directAnswer": "Three major contract changes: (1) Capability Result Envelope (commit 85de129f, May 24) - introduced typed OkResult/ErrorResult/ApprovalRequiredResult dataclasses in result.py; handlers now use blocked.to_dict(); wire format preserved. Backend 0.62.1→0.63.0. (2) Bearer Auth Unification (commit 4e82091f, May 23) - removed cookie auth; dot-count dispatch: 0 dots=API key, 1 dot=session token; frontend uses sessionStorage with Bearer interceptor; CORS allow_credentials=False. Backend 0.61.0→0.62.0, Frontend 0.54.1→0.55.0. (3) Backend Directory Separation (Apr 26) - added ensure_runtime_directories() to mcp_server.py; structural change only.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": [
      "3 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 5,
    "partialCount": 3,
    "droppedCount": 0,
    "fileCount": 7,
    "warnings": [
      "3 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 3 files read, 1 grep searches, 5/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "searchCoverage": {
    "scope": [
      "backend/**",
      "frontend/src/**",
      "extensions/firefox-inbox/src/**",
      "scripts/**",
      "android/**"
    ],
    "scopeLimited": true,
    "filesRead": 3,
    "grepCalls": 1,
    "listDirCalls": 0,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 3 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_a541980937cdb534",
  "session": {
    "id": "sess_a541980937cdb534",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/app/capabilities/result.py",
      "role": "context",
      "reason": "Envelope dataclasses with to_dict() for backward-compatible wire format",
      "evidenceRefs": [
        "backend/app/capabilities/result.py:1-32",
        "E1"
      ],
      "startLine": 1,
      "endLine": 32
    },
    {
      "path": "backend/app/middleware/auth.py",
      "role": "read",
      "reason": "Bearer token dot-count dispatch: 0=API key, 1=session token",
      "evidenceRefs": [
        "backend/app/middleware/auth.py:337-357",
        "E2"
      ],
      "startLine": 337,
      "endLine": 357
    },
    {
      "path": "backend/app/api/v1/auth.py",
      "role": "read",
      "reason": "AuthSessionTokenResponse returns session_token in body, not cookie",
      "evidenceRefs": [
        "backend/app/api/v1/auth.py:104-180",
        "E3"
      ],
      "startLine": 104,
      "endLine": 180
    },
    {
      "path": "frontend/src/api.ts",
      "role": "read",
      "reason": "Axios interceptor attaches Bearer header from sessionStorage",
      "evidenceRefs": [
        "frontend/src/api.ts:244-265",
        "E4"
      ],
      "startLine": 244,
      "endLine": 265
    },
    {
      "path": "backend/app/services/auth_session.py",
      "role": "read",
      "reason": "set_auth_session_cookie() removed - cookie auth eliminated",
      "evidenceRefs": [
        "backend/app/services/auth_session.py:265-277",
        "E5"
      ],
      "startLine": 265,
      "endLine": 277
    },
    {
      "path": "backend/main.py",
      "role": "read",
      "reason": "CORS allow_credentials=False, OriginGuardMiddleware removed",
      "evidenceRefs": [
        "backend/main.py:570-579",
        "E6"
      ],
      "startLine": 570,
      "endLine": 579
    },
    {
      "path": "git_commit",
      "startLine": 1,
      "endLine": 1,
      "role": "read",
      "reason": "Commit 85de129f introduced capability envelope system",
      "evidenceRefs": [
        "E7",
        "E8"
      ]
    }
  ],
  "discoveredPathsCount": 41,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/app/capabilities/result.py",
      "startLine": 1,
      "endLine": 32,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Typed envelope dataclasses define result contracts with to_dict() serialization",
      "snippet": "1: \"\"\"Typed result envelope for capability handlers.\n2: \n3: `CapabilityResult` is a discriminated union of `OkResult`, `ErrorResult`,\n4: and `ApprovalRequiredResult`. Handlers in `app/capabilities/*_handlers.py`\n5: return one of these instead of an ad-hoc dict; wrappers in\n6: `app/services/chat_tool_runtime.py` and `app/mcp/tools/*.py` serialize via\n7: `.to_dict()` which preserves the existing wire format for backward\n8: compatibility with chat SSE chunks and MCP tool responses.\n9: \"\"\"\n10: from __future__ import annotations\n11: \n12: from dataclasses import dataclass, field\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "backend/app/middleware/auth.py",
      "startLine": 337,
      "endLine": 357,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bearer token extraction and dot-count dispatch is core auth contract",
      "snippet": "337:     bearer_token = extract_bearer_token(request.headers.get(\"Authorization\"))\n338:     if bearer_token is None:\n339:         raise HTTPException(status_code=401, detail=\"Missing or invalid Authorization header\")\n340: \n341:     dot_count = bearer_token.count(\".\")\n342:     if dot_count not in (0, 1):\n343:         raise HTTPException(status_code=401, detail=\"Invalid Authorization token\")\n344: \n345:     async with AsyncSessionLocal() as session:\n346:         repo = ApiKeyRepository(session)\n347:         if dot_count == 0:\n348:             is_verified = await verify_and_touch_api_key(request, bearer_token, repo)\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/app/api/v1/auth.py",
      "startLine": 104,
      "endLine": 180,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "AuthSessionTokenResponse shows session_token in body, not cookie",
      "snippet": "104:     allowed_group_ids: list[str] | None = None\n105: \n106: \n107: class AuthSessionTokenResponse(AuthSessionResponse):\n108:     \"\"\"로그인·2FA·프로파일 전환 응답: AuthSessionResponse 의 모든 필드 + raw session token. 클라이언트는 session_token 을 sessionStorage 에 보관하고 후속 요청의 Authorization: Bearer 헤더로 부착한다.\"\"\"\n109: \n110:     session_token: str\n111: \n112: \n113: class AuthSessionRevokedResponse(BaseModel):\n114:     revoked: bool = True\n115: \n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "frontend/src/api.ts",
      "startLine": 244,
      "endLine": 265,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "Frontend axios interceptor attaches Bearer from sessionStorage",
      "snippet": "244: \n245: const api = axios.create({\n246:   baseURL: API_BASE_URL,\n247: })\n248: \n249: const unauthenticatedClient = axios.create({\n250:   baseURL: API_BASE_URL,\n251: })\n252: \n253: api.interceptors.request.use((config) => {\n254:   const token = sessionStorage.getItem(SESSION_TOKEN_STORAGE)\n255:   if (token) {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "backend/app/services/auth_session.py",
      "startLine": 265,
      "endLine": 277,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "set_auth_session_cookie() removed confirms cookie auth elimination",
      "snippet": "265:     return claims.api_key_id if claims else None\n266: \n267: \n268: @dataclass(frozen=True)\n269: class PendingTwoFactorClaims:\n270:     owner_id: str\n271:     api_key_id: str\n272:     issued_at: int\n273:     access_profile_id: str | None = None\n274:     profile_mode: str | None = None\n275:     profile_locked: bool | None = None\n276: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "backend/main.py",
      "startLine": 570,
      "endLine": 579,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "CORS config and removed OriginGuardMiddleware show cookie removal",
      "snippet": "570: app.add_middleware(RateLimitMiddleware)\n571: app.add_middleware(IPBlockMiddleware)\n572: _cors_origins = settings.CORS_ORIGINS or []\n573: app.add_middleware(\n574:     CORSMiddleware,\n575:     allow_origins=_cors_origins,\n576:     allow_credentials=False,\n577:     allow_methods=[\"*\"],\n578:     allow_headers=[\"Authorization\", \"Content-Type\", \"X-Requested-With\"],\n579: )"
    },
    {
      "id": "E7",
      "path": "git_commit",
      "startLine": 1,
      "endLine": 1,
      "groundingStatus": "exact",
      "evidenceType": "git_commit",
      "why": "Commit 85de129f introduced capability envelope system",
      "snippet": ""
    },
    {
      "id": "E8",
      "path": "git_commit",
      "startLine": 1,
      "endLine": 1,
      "groundingStatus": "exact",
      "evidenceType": "git_commit",
      "why": "Commit 4e82091f unified Bearer auth and removed cookies",
      "snippet": ""
    }
  ],
  "uncertainties": [
    "3 evidence item(s) are grounded only by grep, blame, or nearby line observations."
  ],
  "stats": {
    "turns": 8,
    "toolCalls": 14,
    "filesRead": 3,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 14308,
    "totalTokens": 206850
  }
}
```
