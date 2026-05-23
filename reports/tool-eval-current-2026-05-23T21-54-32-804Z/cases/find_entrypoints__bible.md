# find_entrypoints on bible

## Tool Description
Use to surface where execution starts in a repository: HTTP routes, CLI commands, cron handlers, MCP tools, or event handlers. Faster than running find_relevant_code with manual regex hints. Detection is regex-based and may include false positives — verify cited lines before acting.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entryKind": {
      "type": "string",
      "enum": [
        "http",
        "cli",
        "cron",
        "mcp",
        "event",
        "all"
      ],
      "description": "Optional. Restrict detection to one entry kind. Defaults to \"all\"."
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
  }
}
```

## Request
```json
{
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "entryKind": "http"
}
```

## Response Summary
```json
{
  "directAnswer": "Found 13 HTTP route entries across 8 API endpoints using Cloudflare Pages Functions export pattern (onRequest{Method}). File paths map to URL paths under /api/.\n\n**POST (5):** /api/auth/logout, /api/auth/telegram, /api/bookmarks/sync, /api/exam/local-sync, /api/exam/submit\n**GET (5):** /api/auth/me, /api/bookmarks/list, /api/exam/history, /api/exam/local-sync, /api/exam/stats\n**OPTIONS (3 CORS):** /api/auth/me, /api/bookmarks/list, /api/bookmarks/sync\n**Middleware (1):** Catch-all for all routes\n\nRegex detection caveat: verify each cited line before acting.",
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
    "fileCount": 8,
    "warnings": [],
    "summary": "Verified: 4 files read, 17 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
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
    "filesRead": 4,
    "grepCalls": 17,
    "listDirCalls": 3,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 4 file read(s), 17 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f591e5096914a2d3",
  "session": {
    "id": "sess_f591e5096914a2d3",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "functions/_middleware.ts",
      "role": "context",
      "reason": "Catch-all middleware for all routes",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 31,
      "endLine": 31
    },
    {
      "path": "functions/api/auth/logout.ts",
      "role": "read",
      "reason": "POST /api/auth/logout handler export",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 13,
      "endLine": 13
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "read",
      "reason": "GET /api/auth/me handler export",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 38,
      "endLine": 38
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "POST /api/auth/telegram handler export",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 148,
      "endLine": 148
    },
    {
      "path": "functions/api/bookmarks/list.ts",
      "role": "read",
      "reason": "GET /api/bookmarks/list handler export",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 43,
      "endLine": 43
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "role": "read",
      "reason": "POST /api/bookmarks/sync handler export",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 176,
      "endLine": 176
    },
    {
      "path": "functions/api/exam/submit.ts",
      "role": "read",
      "reason": "POST /api/exam/submit handler export",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 27,
      "endLine": 27
    },
    {
      "path": "functions/api/exam/stats.ts",
      "role": "read",
      "reason": "GET /api/exam/stats handler export",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 13,
      "endLine": 13
    }
  ],
  "discoveredPathsCount": 52,
  "evidence": [
    {
      "id": "E1",
      "path": "functions/_middleware.ts",
      "startLine": 31,
      "endLine": 31,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Middleware export intercepts all requests",
      "snippet": "31: export const onRequest: PagesFunction = async (context) => {"
    },
    {
      "id": "E2",
      "path": "functions/api/auth/logout.ts",
      "startLine": 13,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/auth/logout handler export",
      "snippet": "13: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E3",
      "path": "functions/api/auth/me.ts",
      "startLine": 38,
      "endLine": 38,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /api/auth/me handler export",
      "snippet": "38: export const onRequestGet: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E4",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 148,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/auth/telegram handler export",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E5",
      "path": "functions/api/bookmarks/list.ts",
      "startLine": 43,
      "endLine": 43,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /api/bookmarks/list handler export",
      "snippet": "43: export const onRequestGet: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E6",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 176,
      "endLine": 176,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/bookmarks/sync handler export",
      "snippet": "176: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E7",
      "path": "functions/api/exam/submit.ts",
      "startLine": 27,
      "endLine": 27,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "POST /api/exam/submit handler export",
      "snippet": "27: export const onRequestPost: PagesFunction<Env> = async (context) => {"
    },
    {
      "id": "E8",
      "path": "functions/api/exam/stats.ts",
      "startLine": 13,
      "endLine": 13,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "GET /api/exam/stats handler export",
      "snippet": "13: export const onRequestGet: PagesFunction<Env> = async (context) => {"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 26,
    "filesRead": 4,
    "grepCalls": 17,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 12365,
    "totalTokens": 89709
  }
}
```

ElapsedMs: 12376
McpIsError: false
