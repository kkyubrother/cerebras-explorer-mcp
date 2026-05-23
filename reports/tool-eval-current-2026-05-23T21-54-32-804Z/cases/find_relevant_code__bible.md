# find_relevant_code on bible

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
  "repo_root": "/home/kyubr/IdeaProjects/bible",
  "scope": [
    "src/**",
    "functions/**",
    "scripts/**",
    "migrations/**"
  ],
  "query": "Find the smallest useful files and line ranges for understanding React reader state, Cloudflare Pages Functions auth, bookmarks, and exam APIs.",
  "knownFiles": [
    "src/store.tsx"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Found smallest useful files and line ranges: React reader state uses Zustand (src/store/slices/currents.ts). Cloudflare Pages Functions auth uses Telegram login with HMAC-SHA256 session tokens (functions/api/_lib/session.ts, telegram.ts). Bookmarks support delta sync via client_id (list.ts, sync.ts). Exam APIs track results/stats/history for authenticated users (submit.ts, stats.ts, history.ts). Security middleware protects mutating API requests.",
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
    "fileCount": 6,
    "warnings": [],
    "summary": "Verified: 14 files read, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
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
    "filesRead": 14,
    "grepCalls": 0,
    "listDirCalls": 6,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 14 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_62c1b0b262e05fb5",
  "session": {
    "id": "sess_62c1b0b262e05fb5",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/store/slices/currents.ts",
      "role": "read",
      "reason": "Reader state actions: setCurrentPassage, updateBookId, updateChapter, updateMode",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 81
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "read",
      "reason": "Session creation and authentication with HMAC-SHA256 token hashing",
      "evidenceRefs": [],
      "startLine": 57,
      "endLine": 111
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Telegram auth verification using HMAC-SHA256 and user upsert logic",
      "evidenceRefs": [],
      "startLine": 65,
      "endLine": 146
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Telegram auth handler: validation, verification, session cookie setting",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 148,
      "endLine": 232
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "read",
      "reason": "Session inspection endpoint to restore authenticated user from cookie",
      "evidenceRefs": [],
      "startLine": 38,
      "endLine": 84
    },
    {
      "path": "functions/api/bookmarks/sync.ts",
      "role": "read",
      "reason": "Bookmark sync: upsert by client_id with conflict resolution, soft-delete",
      "evidenceRefs": [],
      "startLine": 176,
      "endLine": 269
    },
    {
      "path": "functions/api/exam/submit.ts",
      "role": "read",
      "reason": "Exam submit: validates fields, inserts result with authenticated user_id",
      "evidenceRefs": [],
      "startLine": 27,
      "endLine": 116
    },
    {
      "path": "src/store/slices/currents.ts",
      "startLine": 16,
      "endLine": 80,
      "role": "read",
      "reason": "Reader state actions for book/chapter/mode selection",
      "evidenceRefs": [
        "E1"
      ]
    }
  ],
  "discoveredPathsCount": 88,
  "evidence": [
    {
      "id": "E1",
      "path": "src/store/slices/currents.ts",
      "startLine": 16,
      "endLine": 80,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Reader state actions for book/chapter/mode selection",
      "snippet": "16: export const createCurrentsSlice: AppStoreSlice<CurrentsActions> = (set) => ({\n17:   setCurrentPassage: (bookId, chapter) =>\n18:     set((state) => ({\n19:       currents: {\n20:         ...state.currents,\n21:         currentBookId: bookId,\n22:         currentChapter: chapter,\n23:       },\n24:     })),\n25:   updateBookId: (bookId) =>\n26:     set((state) => ({\n27:       currents: {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "functions/api/_lib/session.ts",
      "startLine": 57,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session creation with token hashing",
      "snippet": "57: export const createSession = async (\n58:   db: D1Database,\n59:   userId: number,\n60:   authSecret: string\n61: ): Promise<string> => {\n62:   const now = Math.floor(Date.now() / 1000);\n63:   const expiresAt = now + SESSION_MAX_AGE_SECONDS;\n64:   const sessionId = crypto.randomUUID();\n65:   const rawToken = createRawSessionToken();\n66:   const tokenHash = await hashSessionToken(rawToken, authSecret);\n67: \n68:   await db\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/_lib/session.ts",
      "startLine": 80,
      "endLine": 111,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session authentication logic",
      "snippet": "80: export const authenticateSession = async (\n81:   request: Request,\n82:   db: D1Database,\n83:   authSecret: string\n84: ): Promise<{ sessionId: string; userId: number } | null> => {\n85:   const sessionToken = parseCookies(request)[SESSION_COOKIE_NAME];\n86:   if (!sessionToken) return null;\n87: \n88:   const tokenHash = await hashSessionToken(sessionToken, authSecret);\n89:   const now = Math.floor(Date.now() / 1000);\n90: \n91:   const session = await db\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram auth verification using HMAC-SHA256",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 232,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram auth handler with session creation",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {\n149:   const { request, env } = context;\n150: \n151:   // CORS headers\n152:   const corsHeaders = {\n153:     'Access-Control-Allow-Origin': '*',\n154:     'Access-Control-Allow-Methods': 'POST, OPTIONS',\n155:     'Access-Control-Allow-Headers': 'Content-Type',\n156:   };\n157: \n158:   // Handle OPTIONS request for CORS preflight\n159:   if (request.method === 'OPTIONS') {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "functions/api/auth/me.ts",
      "startLine": 48,
      "endLine": 84,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session inspection endpoint",
      "snippet": "48:     const session = await authenticateSession(\n49:       context.request,\n50:       context.env.DB,\n51:       context.env.AUTH_SECRET\n52:     );\n53: \n54:     if (!session) {\n55:       return json({\n56:         success: true,\n57:         authenticated: false,\n58:         user: null,\n59:       });\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "functions/api/bookmarks/sync.ts",
      "startLine": 116,
      "endLine": 174,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bookmark upsert with conflict resolution",
      "snippet": "116: const upsertBookmark = async (\n117:   db: D1Database,\n118:   userId: number,\n119:   bookmark: NormalizedBookmark,\n120:   syncedAt: number\n121: ): Promise<number | null> => {\n122:   const existing = await db\n123:     .prepare(\n124:       `SELECT id, updated_at FROM bookmarks\n125:        WHERE user_id = ? AND client_id = ? LIMIT 1`\n126:     )\n127:     .bind(userId, bookmark.clientId)\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "functions/api/exam/submit.ts",
      "startLine": 49,
      "endLine": 99,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Exam result insertion with user_id",
      "snippet": "49:     const session = await authenticateSession(request, env.DB, env.AUTH_SECRET);\n50:     if (!session) {\n51:       return new Response(\n52:         JSON.stringify({ error: 'Unauthorized' }),\n53:         { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }\n54:       );\n55:     }\n56: \n57:     const body = await request.json<ExamResult>();\n58: \n59:     // Validate required fields\n60:     if (\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 20,
    "filesRead": 14,
    "grepCalls": 0,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 9379,
    "totalTokens": 102282
  }
}
```

ElapsedMs: 9392
McpIsError: false
