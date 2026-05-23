# review_change_context on studious-memory

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
  "reviewGoal": "Review recent backend/frontend contract changes around source intake, API keys, and MCP tools.",
  "path": "backend/mcp_server.py"
}
```

## Response Summary
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

ElapsedMs: 14321
McpIsError: false
