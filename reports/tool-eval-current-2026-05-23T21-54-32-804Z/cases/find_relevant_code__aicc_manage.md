# find_relevant_code on aicc_manage

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
  "repo_root": "/home/kyubr/IdeaProjects/aicc_manage",
  "scope": [
    "src/**",
    "websocket-server/src/**",
    "lambda/**",
    "prisma/**",
    "scripts/**"
  ],
  "query": "Find the smallest useful files and line ranges for understanding Next.js app auth, websocket auth, Lambda handlers, and Prisma data model.",
  "knownFiles": [
    "websocket-server/src/middleware/auth.ts"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Found the smallest useful files for Next.js app auth, WebSocket auth, Lambda handlers, and Prisma data models. Key auth files: middleware.ts for route protection, auth/jwt.ts and auth/session.ts for token management, auth/api-route-access.ts for API policy, and login/route.ts for login flow. WebSocket auth: middleware/auth.ts with JWT and rate limiting. Lambda: bedrock-proxy/index.mjs shows API key auth. Prisma: User model has 2FA fields, Company model has settings.",
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
    "summary": "Verified: 15 files read, 1 grep searches, 8/8 evidence items grounded, cross-verified across 8 files. All evidence grounded in inspected code."
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
    "filesRead": 15,
    "grepCalls": 1,
    "listDirCalls": 5,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 15 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_e86cbe084ddb100c",
  "session": {
    "id": "sess_e86cbe084ddb100c",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/middleware.ts",
      "role": "context",
      "reason": "Next.js middleware with JWT verification, protected routes, and 2FA handling",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 170
    },
    {
      "path": "src/lib/auth/jwt.ts",
      "role": "read",
      "reason": "JWT token creation and verification utilities with payload types",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 1,
      "endLine": 77
    },
    {
      "path": "src/lib/auth/session.ts",
      "role": "read",
      "reason": "Session cookie management (get, set, clear) with configuration",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 1,
      "endLine": 54
    },
    {
      "path": "src/lib/auth/api-route-access.ts",
      "role": "read",
      "reason": "API route access rules: public, session, widget-key, secret modes",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 42,
      "endLine": 118
    },
    {
      "path": "src/app/api/auth/login/route.ts",
      "role": "read",
      "reason": "Login API with rate limiting, IP whitelist, and account lockout",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 23,
      "endLine": 95
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "read",
      "reason": "WebSocket JWT auth with brute-force protection and rate limiting",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 51,
      "endLine": 121
    },
    {
      "path": "lambda/bedrock-proxy/index.mjs",
      "role": "read",
      "reason": "Lambda handler with x-api-key header authentication example",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 30,
      "endLine": 36
    },
    {
      "path": "prisma/schema.prisma",
      "role": "read",
      "reason": "User model with 2FA fields and account lockout tracking",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 78,
      "endLine": 104
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "src/middleware.ts",
      "startLine": 1,
      "endLine": 170,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Shows Next.js middleware auth flow with JWT verification and protected routes",
      "snippet": "1: import { NextResponse } from 'next/server'\n2: import type { NextRequest } from 'next/server'\n3: import { jwtVerify } from 'jose'\n4: import {\n5:   decideApiSessionHandling,\n6:   isApiPath,\n7:   matchesPathPrefix,\n8: } from '@/lib/auth/api-route-access'\n9: \n10: // 보호할 경로 (일반 사용자 - 인증 필요)\n11: const PROTECTED_ROUTES = [\n12:   '/dashboard',\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/lib/auth/jwt.ts",
      "startLine": 1,
      "endLine": 77,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT token creation/verification with payload types",
      "snippet": "1: import { SignJWT, jwtVerify, type JWTPayload } from 'jose'\n2: import type { UserRole } from '@/types'\n3: \n4: // JWT 페이로드 타입\n5: export interface JWTTokenPayload extends JWTPayload {\n6:   userId: string\n7:   companyId: string\n8:   companyCode?: string\n9:   role: UserRole\n10:   name?: string\n11:   pending2FA?: boolean\n12:   twoFactorChallengeId?: string\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/lib/auth/session.ts",
      "startLine": 1,
      "endLine": 54,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Session cookie utilities for Next.js auth",
      "snippet": "1: import { cookies } from 'next/headers'\n2: import { verifyToken, type JWTTokenPayload } from './jwt'\n3: \n4: // 세션 쿠키 이름\n5: export const SESSION_COOKIE_NAME = 'session-token'\n6: \n7: // 세션 쿠키 옵션 (기본값)\n8: export const SESSION_COOKIE_OPTIONS = {\n9:   httpOnly: true,\n10:   secure: process.env.NODE_ENV === 'production',\n11:   sameSite: 'lax' as const,\n12:   maxAge: 60 * 60 * 24, // 24시간 (기본값)\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/lib/auth/api-route-access.ts",
      "startLine": 42,
      "endLine": 118,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Defines exact API route access rules for public/session/widget/secret modes",
      "snippet": "42: export const EXACT_API_ACCESS_RULES: readonly ApiAccessRule[] = [\n43:   {\n44:     path: '/api/auth/login',\n45:     mode: 'public',\n46:     reason: 'Login entrypoint must stay outside middleware session enforcement.',\n47:   },\n48:   {\n49:     path: '/api/auth/logout',\n50:     mode: 'public',\n51:     reason: 'Logout must clear stale cookies even when no valid session remains.',\n52:   },\n53:   {\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/app/api/auth/login/route.ts",
      "startLine": 23,
      "endLine": 95,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Login implementation with rate limiting and IP whitelist checks",
      "snippet": "23: export async function POST(request: Request) {\n24:   try {\n25:     // IP 기반 Rate Limiting\n26:     const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'\n27:     const rateLimit = checkRateLimit(ip, AUTH_RATE_LIMIT)\n28:     if (!rateLimit.allowed) {\n29:       return NextResponse.json(\n30:         { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },\n31:         { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }\n32:       )\n33:     }\n34: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "WebSocket auth with JWT verification and IP-based rate limiting",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "lambda/bedrock-proxy/index.mjs",
      "startLine": 30,
      "endLine": 36,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Lambda authentication using x-api-key header against API_KEY env var",
      "snippet": "30:   const apiKey = event.headers?.['x-api-key'];\n31:   if (process.env.API_KEY && apiKey !== process.env.API_KEY) {\n32:     return {\n33:       statusCode: 401,\n34:       headers,\n35:       body: JSON.stringify({ error: 'Unauthorized' }),\n36:     };"
    },
    {
      "id": "E8",
      "path": "prisma/schema.prisma",
      "startLine": 78,
      "endLine": 104,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "User model fields: twoFactorEnabled, twoFactorMethod, failedLoginAttempts, lockedUntil",
      "snippet": "78: model User {\n79:   id                          String                @id @default(dbgenerated(\"uuid_generate_v4()\")) @db.Uuid\n80:   companyId                   String                @map(\"company_id\") @db.Uuid\n81:   username                    String                @db.VarChar(50)\n82:   email                       String?               @db.VarChar(100)\n83:   passwordHash                String                @map(\"password_hash\") @db.VarChar(255)\n84:   name                        String                @db.VarChar(100)\n85:   phone                       String?               @db.VarChar(20)\n86:   role                        user_role?            @default(staff)\n87:   department                  String?               @db.VarChar(100)\n88:   profileImageUrl             String?               @map(\"profile_image_url\") @db.VarChar(500)\n89:   isActive                    Boolean?              @\n... [truncated 55 chars]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 7,
    "toolCalls": 21,
    "filesRead": 15,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 11114,
    "totalTokens": 177513
  }
}
```

ElapsedMs: 11126
McpIsError: false
