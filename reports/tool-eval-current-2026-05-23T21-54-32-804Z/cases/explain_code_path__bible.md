# explain_code_path on bible

## Tool Description
Use for route, middleware, request, event, job, or CLI flow tracing across files. Returns the verified path through the code and the targets worth reading next.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "pathQuery": {
      "type": "string",
      "description": "The runtime path or flow to explain."
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
    "entryPoint": {
      "type": "string"
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
    "pathQuery"
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
  "pathQuery": "Telegram auth Pages Function creates or authenticates a user session and exposes session state to the frontend",
  "entryPoint": "src/store.tsx",
  "knownFiles": [
    "src/store.tsx"
  ],
  "knownSymbols": [
    "useStore"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Telegram auth flow: User clicks TelegramLoginButton → POST /api/auth/telegram → backend validates HMAC-SHA256 signature, upserts user to DB, creates session via createSession(), sets cookie, returns user → frontend calls setAuthUser() to update Zustand store. On page load, useAuthSessionBootstrap calls /api/auth/me → authenticateSession() validates cookie → restores or clears auth state. Frontend exposes auth state via useStore hook with selectors (selectAuthSession, selectAuthBootstrap).",
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
    "summary": "Verified: 13 files read, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 7 files. All evidence grounded in inspected code."
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
    "filesRead": 13,
    "grepCalls": 0,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, functions/**, scripts/**, migrations/**"
    ],
    "summary": "scope-limited search across src/**, functions/**, scripts/**, migrations/**; 13 file read(s), 0 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_7633d1a0632e0afe",
  "session": {
    "id": "sess_7633d1a0632e0afe",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/shared/components/TelegramLoginButton.tsx",
      "role": "read",
      "reason": "Entry point: handleTelegramAuth posts to /api/auth/telegram and calls setAuthUser",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 38,
      "endLine": 55
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "role": "read",
      "reason": "Backend auth: validates signature, upserts user, creates session, sets cookie",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 148,
      "endLine": 232
    },
    {
      "path": "functions/api/_lib/session.ts",
      "role": "read",
      "reason": "Session creation: generates token, hashes with HMAC-SHA256, stores in DB",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 57,
      "endLine": 78
    },
    {
      "path": "src/store/slices/auth.ts",
      "role": "read",
      "reason": "setAuthUser action: updates auth state with user and isAuthenticated flag",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 6,
      "endLine": 12
    },
    {
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "role": "read",
      "reason": "Session restoration: calls fetchAuthSession on mount, then setAuthUser or logout",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 21,
      "endLine": 44
    },
    {
      "path": "functions/api/auth/me.ts",
      "role": "read",
      "reason": "Session validation: uses authenticateSession to verify cookie and return user",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 48,
      "endLine": 84
    },
    {
      "path": "src/store.selectors.ts",
      "role": "read",
      "reason": "Auth selectors: expose auth.user, isAuthenticated, and logout to components",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 41,
      "endLine": 56
    },
    {
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "role": "read",
      "reason": "Telegram HMAC-SHA256 signature verification implementation",
      "evidenceRefs": [
        "E3"
      ]
    }
  ],
  "discoveredPathsCount": 30,
  "evidence": [
    {
      "id": "E1",
      "path": "src/shared/components/TelegramLoginButton.tsx",
      "startLine": 38,
      "endLine": 55,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows entry point flow: POST to /api/auth/telegram, setAuthUser call on success",
      "snippet": "38:     const handleTelegramAuth = async (user: any) => {\n39:       console.log(\"Telegram auth received:\", user);\n40: \n41:       try {\n42:         // Send authentication data to backend for verification\n43:         const response = await fetch(\"/api/auth/telegram\", {\n44:           method: \"POST\",\n45:           headers: {\n46:             \"Content-Type\": \"application/json\",\n47:           },\n48:           body: JSON.stringify(user),\n49:         });\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 148,
      "endLine": 232,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Backend auth flow: signature validation (206), user upsert (216), session creation (218), cookie (229)",
      "snippet": "148: export const onRequestPost: PagesFunction<Env> = async (context) => {\n149:   const { request, env } = context;\n150: \n151:   // CORS headers\n152:   const corsHeaders = {\n153:     'Access-Control-Allow-Origin': '*',\n154:     'Access-Control-Allow-Methods': 'POST, OPTIONS',\n155:     'Access-Control-Allow-Headers': 'Content-Type',\n156:   };\n157: \n158:   // Handle OPTIONS request for CORS preflight\n159:   if (request.method === 'OPTIONS') {\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "functions/api/auth/telegram.ts",
      "startLine": 65,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Telegram HMAC-SHA256 signature verification implementation",
      "snippet": "65: async function verifyTelegramAuth(\n66:   data: TelegramUser,\n67:   botToken: string\n68: ): Promise<boolean> {\n69:   const { hash, ...userData } = data;\n70: \n71:   // Create data-check-string: sorted key=value pairs joined with \\n\n72:   const dataCheckString = Object.keys(userData)\n73:     .sort()\n74:     .map((key) => `${key}=${userData[key as keyof typeof userData]}`)\n75:     .join('\\n');\n76: \n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "functions/api/_lib/session.ts",
      "startLine": 57,
      "endLine": 78,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session creation: generates token, hashes it, stores with 7-day expiry in auth_sessions",
      "snippet": "57: export const createSession = async (\n58:   db: D1Database,\n59:   userId: number,\n60:   authSecret: string\n61: ): Promise<string> => {\n62:   const now = Math.floor(Date.now() / 1000);\n63:   const expiresAt = now + SESSION_MAX_AGE_SECONDS;\n64:   const sessionId = crypto.randomUUID();\n65:   const rawToken = createRawSessionToken();\n66:   const tokenHash = await hashSessionToken(rawToken, authSecret);\n67: \n68:   await db\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/store/slices/auth.ts",
      "startLine": 6,
      "endLine": 12,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "setAuthUser action: sets auth.user and auth.isAuthenticated based on user != null",
      "snippet": "6:   setAuthUser: (user) =>\n7:     set(() => ({\n8:       auth: {\n9:         user,\n10:         isAuthenticated: user !== null,\n11:       },\n12:     })),"
    },
    {
      "id": "E6",
      "path": "src/shared/hooks/useAuthSessionBootstrap.ts",
      "startLine": 21,
      "endLine": 44,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session restoration: calls fetchAuthSession, then setAuthUser(session.user) or logout()",
      "snippet": "21: export const useAuthSessionBootstrap = () => {\n22:   const { logout, setAuthUser } = useStore(selectAuthBootstrap, shallow);\n23: \n24:   useEffect(() => {\n25:     let active = true;\n26:     const controller = new AbortController();\n27: \n28:     const restoreSession = async () => {\n29:       try {\n30:         const session = await fetchAuthSession(controller.signal);\n31:         if (!active) return;\n32: \n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "functions/api/auth/me.ts",
      "startLine": 48,
      "endLine": 84,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session validation: authenticateSession validates cookie, fetches user from DB",
      "snippet": "48:     const session = await authenticateSession(\n49:       context.request,\n50:       context.env.DB,\n51:       context.env.AUTH_SECRET\n52:     );\n53: \n54:     if (!session) {\n55:       return json({\n56:         success: true,\n57:         authenticated: false,\n58:         user: null,\n59:       });\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "src/store.selectors.ts",
      "startLine": 41,
      "endLine": 56,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Auth selectors exposing state.auth.user, isAuthenticated, and logout action",
      "snippet": "41: export const selectAuthSession = (state: AppStore) => ({\n42:   user: state.auth.user,\n43:   isAuthenticated: state.auth.isAuthenticated,\n44:   logout: state.logout,\n45: });\n46: \n47: export const selectExamAuth = (state: AppStore) => ({\n48:   isAuthenticated: state.auth.isAuthenticated,\n49:   language: state.settings.language,\n50:   logout: state.logout,\n51: });\n52: \n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 10,
    "toolCalls": 17,
    "filesRead": 13,
    "grepCalls": 0,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 14405,
    "totalTokens": 151715
  }
}
```

ElapsedMs: 14417
McpIsError: false
