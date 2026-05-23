# explore_repo on bible

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
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "task": "Explain the repository purpose and the main implementation path for React reader state, Cloudflare Pages Functions auth, bookmarks, and exam APIs. Return grounded targets that a parent coding agent should verify before editing."
}
```

## Response Summary
```json
{
  "directAnswer": "Bible reader web app (React + Cloudflare Pages + D1) with scripture reading, search, bookmarks, and exams. React reader state: Zustand store (src/store.tsx) with persist middleware managing settings, current passage, search, UI, and auth. Reader features in src/features/reader/ with controller hooks (useReaderController.ts, useBibleData.tsx). Cloudflare Pages Functions auth: Telegram login widget (functions/api/auth/telegram.ts) validates HMAC-SHA256 signatures, stores users in D1, and creates session tokens. Session management (functions/api/_lib/session.ts) uses HttpOnly cookies with hashed tokens. Bookmarks: Client-side bookmarks (src/features/bookmark/) sync via /api/bookmarks/sync to D1 with soft-delete support (migrations/0004_bookmarks.sql). Exam APIs: Exam system (src/features/exam/) with attempts and chapter progress syncing via /api/exam/local-sync, submissions to /api/exam/submit, history/stats endpoints. Local sync tracked in D1 (migrations/0003_exam_local_sync.sql).",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) were removed because their line ranges were not inspected."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 0,
    "droppedCount": 1,
    "fileCount": 7,
    "warnings": [
      "1 evidence item(s) were removed because their line ranges were not inspected."
    ],
    "summary": "Verified: 17 files read, 7/7 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/features/reader/hooks/useReaderController.ts:1-302 before final verification.",
    "target": {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "read",
      "reason": "Main reader controller orchestrating all reader interactions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 302
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "functions/**",
      "scripts/**",
      "migrations/**"
    ],
    "scopeLimited": true,
    "filesRead": 17,
    "grepCalls": 0,
    "listDirCalls": 4,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 17 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f73798d5c87c2a58",
  "session": {
    "id": "sess_f73798d5c87c2a58",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store.tsx",
      "role": "context",
      "reason": "Root Zustand store with persist middleware managing app state",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 59
    },
    {
      "path": "src/features/reader/hooks/useReaderController.ts",
      "role": "read",
      "reason": "Main reader controller orchestrating all reader interactions",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 302
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Telegram auth endpoint with HMAC-SHA256 verification",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 241
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "read",
      "reason": "Session management utilities (create, authenticate, revoke)",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 134
    },
    {
      "path": "src/features/bookmark/types/bookmark.ts",
      "role": "context",
      "reason": "Bookmark type definitions including sync state",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 50
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "role": "read",
      "reason": "Bookmark sync endpoint with validation and upsert logic",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 270
    },
    {
      "path": "src/features/exam/types/exam.ts",
      "role": "context",
      "reason": "Exam type definitions for attempts, progress, and sync",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 227
    },
    {
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "role": "read",
      "reason": "Zustand store with persist middleware for settings to localStorage",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store.tsx",
      "startLine": 30,
      "endLine": 58,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Zustand store with persist middleware for settings to localStorage",
      "snippet": "30: export const useStore = create<AppStore>()(\n31:   persist(\n32:     (set, get, api) => ({\n33:       settings: INITIAL_SETTINGS,\n34:       currents: INITIAL_CURRENTS,\n35:       globals: INITIAL_GLOBALS,\n36:       search: INITIAL_SEARCH,\n37:       ui: INITIAL_UI,\n38:       auth: INITIAL_AUTH,\n39:       ...createStoreActions(set, get, api),\n40:     }),\n41:     {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/features/reader/hooks/useReaderController.ts",
      "startLine": 42,
      "endLine": 105,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Main reader controller orchestrating data, search, and navigation",
      "snippet": "42: export const useReaderController = ({\n43:   paramBookId,\n44:   paramChapter,\n45:   pathname,\n46:   locationState,\n47:   navigate,\n48:   t,\n49: }: UseReaderControllerParams) => {\n50:   const detectMobile = useMobileDetect();\n51:   const readerControllerState = useStore(selectReaderControllerState, shallow);\n52:   const {\n53:     language,\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram auth verification using HMAC-SHA256 signature",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "functions/api/_lib/session.ts",
      "startLine": 80,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session authentication extracting and validating cookies",
      "snippet": "80: export const authenticateSession = async (\n81:   request: Request,\n82:   db: D1Database,\n83:   authSecret: string\n84: ): Promise<{ sessionId: string; userId: number } | null> => {\n85:   const sessionToken = parseCookies(request)[SESSION_COOKIE_NAME];\n86:   if (!sessionToken) return null;\n87: \n88:   const tokenHash = await hashSessionToken(sessionToken, authSecret);\n89:   const now = Math.floor(Date.now() / 1000);\n90: \n91:   const session = await db\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/features/bookmark/types/bookmark.ts",
      "startLine": 35,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark record structure with sync state and clientId",
      "snippet": "35: export interface BookmarkRecord {\n36:   clientId: string;\n37:   title: string;\n38:   blocks: BookmarkBlock[];\n39:   createdAt: string;\n40:   updatedAt: string;\n41:   schemaVersion: number;\n42:   syncState: BookmarkSyncState;\n43:   serverBookmarkId?: number | string | null;\n44: }"
    },
    {
      "id": "E6",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 116,
      "endLine": 174,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark upsert logic with updatedAt conflict resolution",
      "snippet": "116: const upsertBookmark = async (\n117:   db: D1Database,\n118:   userId: number,\n119:   bookmark: NormalizedBookmark,\n120:   syncedAt: number\n121: ): Promise<number | null> => {\n122:   const existing = await db\n123:     .prepare(\n124:       `SELECT id, updated_at FROM bookmarks\n125:        WHERE user_id = ? AND client_id = ? LIMIT 1`\n126:     )\n127:     .bind(userId, bookmark.clientId)\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "src/features/exam/types/exam.ts",
      "startLine": 20,
      "endLine": 42,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Exam attempt record with sync state and chapter ranges",
      "snippet": "20: export interface ExamAttemptRecord {\n21:   clientId: string;\n22:   source: ExamAttemptSource;\n23:   scopeType: ExamAttemptScopeType;\n24:   bookId: number;\n25:   chapterStart: number;\n26:   chapterEnd: number;\n27:   verseStart?: number | null;\n28:   verseEnd?: number | null;\n29:   totalItems: number;\n30:   correctItems: number;\n31:   wrongItems: number;\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) were removed because their line ranges were not inspected.",
    "Some evidence items were dropped because they were not grounded in inspected line ranges."
  ],
  "stats": {
    "turns": 9,
    "toolCalls": 30,
    "filesRead": 17,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 11408,
    "totalTokens": 168335
  }
}
```

ElapsedMs: 11422
McpIsError: false
