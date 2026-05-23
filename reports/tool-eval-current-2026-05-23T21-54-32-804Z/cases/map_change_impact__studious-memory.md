# map_change_impact on studious-memory

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
  "repo_root": "/home/kyubr/IdeaProjects/studious-memory",
  "scope": [
    "backend/**",
    "frontend/src/**",
    "extensions/firefox-inbox/src/**",
    "scripts/**",
    "android/**"
  ],
  "change": "harden API-key bearer authentication across frontend extension and backend endpoints",
  "knownFiles": [
    "backend/mcp_server.py"
  ],
  "knownSymbols": [
    "scoped_tool"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Authentication flow: all clients send `Authorization: Bearer <credential>` to backend. AuthMiddleware extracts and validates via extract_bearer_token(), distinguishing API keys (0 dots) from session tokens (1+ dots). API keys verified by ApiKeyRepository.verify() with argon2id/sha256. MCP tools use @scoped_tool decorator calling require_mcp_scopes(). Hardening requires changes to 5 backend files plus client updates in frontend, Firefox extension, and Android.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
    "complete": true,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ]
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 7,
    "partialCount": 1,
    "droppedCount": 0,
    "fileCount": 6,
    "warnings": [
      "1 evidence item(s) are grounded only by grep, blame, or nearby line observations."
    ],
    "summary": "Verified: 10 files read, 5 grep searches, 2 symbol lookups, 7/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read backend/app/middleware/auth.py:59-77 before editing.",
    "target": {
      "path": "backend/app/middleware/auth.py",
      "role": "edit",
      "reason": "Core bearer extraction and query param fallback logic",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 59,
      "endLine": 77
    }
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
    "filesRead": 10,
    "grepCalls": 5,
    "listDirCalls": 0,
    "symbolCalls": 2,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**"
    ],
    "summary": "scope-limited search across backend/**, frontend/src/**, extensions/firefox-inbox/src/**, scripts/**, android/**; 10 file read(s), 5 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_eb79b9c00a604bf3",
  "session": {
    "id": "sess_eb79b9c00a604bf3",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "backend/app/middleware/auth.py",
      "role": "edit",
      "reason": "Core bearer extraction and query param fallback logic",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 59,
      "endLine": 77
    },
    {
      "path": "backend/app/middleware/auth.py",
      "role": "edit",
      "reason": "MCP authentication with OAuth/API-key dual mode",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 281,
      "endLine": 325
    },
    {
      "path": "backend/app/middleware/auth.py",
      "role": "edit",
      "reason": "Main dispatcher distinguishing API keys from session tokens",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 328,
      "endLine": 368
    },
    {
      "path": "backend/app/repositories/api_key.py",
      "role": "edit",
      "reason": "API key verification with argon2id/sha256 hashes",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 84,
      "endLine": 107
    },
    {
      "path": "backend/app/mcp/server.py",
      "role": "edit",
      "reason": "scoped_tool decorator wrapping MCP tools with scope validation",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 79,
      "endLine": 91
    },
    {
      "path": "frontend/src/api.ts",
      "role": "edit",
      "reason": "Axios interceptor adds Authorization: Bearer header",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 253,
      "endLine": 260
    },
    {
      "path": "extensions/firefox-inbox/src/shared/apiClient.ts",
      "role": "edit",
      "reason": "bearerHeaders() constructs Authorization: Bearer for extension",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 137,
      "endLine": 141
    },
    {
      "path": "android/app/src/main/java/com/studiousmemory/android/core/network/BackendApiClient.kt",
      "role": "edit",
      "reason": "Android client sets Authorization: Bearer header",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 49,
      "endLine": 49
    }
  ],
  "discoveredPathsCount": 62,
  "evidence": [
    {
      "id": "E1",
      "path": "backend/app/middleware/auth.py",
      "startLine": 59,
      "endLine": 77,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines extract_bearer_token and extract_api_key_from_request for parsing",
      "snippet": "59: def extract_bearer_token(auth_header: str | None) -> str | None:\n60:     if not auth_header or not auth_header.startswith(\"Bearer \"):\n61:         return None\n62:     token = auth_header[len(\"Bearer \") :]\n63:     return token or None\n64: \n65: \n66: def extract_api_key_from_request(request: Request, path: str) -> str | None:\n67:     bearer_token = extract_bearer_token(request.headers.get(\"Authorization\"))\n68:     if bearer_token:\n69:         return bearer_token\n70: \n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "backend/app/middleware/auth.py",
      "startLine": 281,
      "endLine": 325,
      "groundingStatus": "partial",
      "evidenceType": "file_range",
      "why": "MCP authentication with OAuth/API-key dual mode and query fallback",
      "snippet": "281: async def ensure_authenticated_mcp_request(request: Request) -> str:\n282:     mode = _mcp_auth_mode()\n283:     bearer_token = extract_bearer_token(request.headers.get(\"Authorization\"))\n284:     query_token = (\n285:         request.query_params.get(MCP_QUERY_KEY_PARAM)\n286:         if settings.MCP_ALLOW_QUERY_KEY\n287:         else None\n288:     )\n289:     raw_api_key = bearer_token or query_token\n290: \n291:     oauth_error: OAuthTokenError | None = None\n292:     if bearer_token and mode in {\"oauth\", \"dual\"}:\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "backend/app/middleware/auth.py",
      "startLine": 328,
      "endLine": 368,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Main auth dispatcher distinguishing API keys from session tokens",
      "snippet": "328: async def ensure_authenticated_request(\n329:     request: Request,\n330: ) -> str:\n331:     path = request.url.path\n332: \n333:     is_mcp_request = is_mcp_path(path)\n334:     if is_mcp_request:\n335:         return await ensure_authenticated_mcp_request(request)\n336: \n337:     bearer_token = extract_bearer_token(request.headers.get(\"Authorization\"))\n338:     if bearer_token is None:\n339:         raise HTTPException(status_code=401, detail=\"Missing or invalid Authorization header\")\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "backend/app/repositories/api_key.py",
      "startLine": 84,
      "endLine": 107,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "API key verification with argon2id/sha256 and timing protection",
      "snippet": "84:     async def verify(self, raw_key: str) -> ApiKey | None:\n85:         key_prefix = raw_key[:8]\n86:         now = now_utc()\n87:         result = await self.session.execute(\n88:             select(ApiKey).where(\n89:                 ApiKey.key_prefix == key_prefix,\n90:                 ApiKey.is_active.is_(True),\n91:                 or_(ApiKey.expires_at.is_(None), ApiKey.expires_at > now),\n92:             )\n93:         )\n94:         candidates = list(result.scalars().all())\n95:         for api_key in candidates:\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "backend/app/mcp/server.py",
      "startLine": 79,
      "endLine": 91,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "scoped_tool decorator wrapping MCP tools with scope validation",
      "snippet": "79: def scoped_tool(*required_scopes: str):\n80:     def _decorator(func: Callable[..., Any]):\n81:         @mcp.tool(meta={\"required_scopes\": list(required_scopes)})\n82:         @wraps(func)\n83:         async def _wrapped(*args: Any, **kwargs: Any):\n84:             require_mcp_scopes(*required_scopes)\n85:             return await func(*args, **kwargs)\n86: \n87:         return _wrapped\n88: \n89:     return _decorator\n90: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "frontend/src/api.ts",
      "startLine": 253,
      "endLine": 260,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Axios interceptor adding Authorization: Bearer from sessionStorage",
      "snippet": "253: api.interceptors.request.use((config) => {\n254:   const token = sessionStorage.getItem(SESSION_TOKEN_STORAGE)\n255:   if (token) {\n256:     config.headers = config.headers ?? {}\n257:     ;(config.headers as Record<string, string>).Authorization = `Bearer ${token}`\n258:   }\n259:   return config\n260: })"
    },
    {
      "id": "E7",
      "path": "extensions/firefox-inbox/src/shared/apiClient.ts",
      "startLine": 137,
      "endLine": 141,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "bearerHeaders function constructing Authorization: Bearer",
      "snippet": "137: function bearerHeaders(apiKey: string): Record<string, string> {\n138:   return {\n139:     Authorization: `Bearer ${apiKey}`,\n140:   }\n141: }"
    },
    {
      "id": "E8",
      "path": "android/app/src/main/java/com/studiousmemory/android/core/network/BackendApiClient.kt",
      "startLine": 49,
      "endLine": 49,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Android client setting Authorization: Bearer header",
      "snippet": "49:         .header(\"Authorization\", \"Bearer $trimmedApiKey\")"
    }
  ],
  "uncertainties": [
    "1 evidence item(s) are grounded only by grep, blame, or nearby line observations.",
    "Android API key rotation strategy during hardening needs verification"
  ],
  "stats": {
    "turns": 7,
    "toolCalls": 18,
    "filesRead": 10,
    "grepCalls": 5,
    "symbolCalls": 2,
    "stoppedByBudget": false,
    "elapsedMs": 15397,
    "totalTokens": 185019
  }
}
```

ElapsedMs: 15412
McpIsError: false
