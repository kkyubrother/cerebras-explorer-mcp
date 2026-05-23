# explore_repo on aicc_manage

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
  "repo_root": "/home/kyubr/IdeaProjects/aicc_manage",
  "scope": [
    "src/**",
    "websocket-server/src/**",
    "lambda/**",
    "prisma/**",
    "scripts/**"
  ],
  "task": "Explain the repository purpose and the main implementation path for Next.js app auth, websocket auth, Lambda handlers, and Prisma data model. Return grounded targets that a parent coding agent should verify before editing."
}
```

## Response Summary
```json
{
  "directAnswer": "aicc_manage is a multi-tenant AI Contact Center SaaS platform for managing AWS Lex chatbots, customer inquiries, schedules, support tickets, and billing. Uses Next.js with JWT session auth, WebSocket server for real-time features, AWS Lambda for backend services (Bedrock proxy, usage tracking, RDS metrics), and Prisma with PostgreSQL for data persistence.",
  "status": {
    "confidence": "high",
    "verification": "targeted_read_needed",
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
    "summary": "Verified: 22 files read, 1 grep searches, 8/8 evidence items grounded, cross-verified across 6 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read prisma/schema.prisma:10-76 before final verification.",
    "target": {
      "path": "prisma/schema.prisma",
      "startLine": 10,
      "endLine": 76,
      "role": "read",
      "reason": "Company model with multi-tenant structure and AWS Lex integration",
      "evidenceRefs": [
        "E1"
      ]
    }
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
    "filesRead": 22,
    "grepCalls": 1,
    "listDirCalls": 6,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**"
    ],
    "summary": "scope-limited search across src/**, websocket-server/src/**, lambda/**, prisma/**, scripts/**; 22 file read(s), 1 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_2cfc7781fa286b92",
  "session": {
    "id": "sess_2cfc7781fa286b92",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/middleware.ts",
      "role": "context",
      "reason": "Next.js middleware protecting routes with JWT verification and role-based access",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 1,
      "endLine": 170
    },
    {
      "path": "src/lib/auth/api-route-access.ts",
      "role": "context",
      "reason": "API route access control policy with multiple auth modes",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 341
    },
    {
      "path": "src/app/api/auth/login/route.ts",
      "role": "context",
      "reason": "Login API with rate limiting, account locking, and 2FA flow",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 365
    },
    {
      "path": "websocket-server/src/middleware/auth.ts",
      "role": "context",
      "reason": "WebSocket JWT authentication with brute force protection",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 132
    },
    {
      "path": "lambda/bedrock-proxy/index.mjs",
      "role": "context",
      "reason": "AWS Lambda proxy for Bedrock with API key authentication",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 1,
      "endLine": 88
    },
    {
      "path": "prisma/schema.prisma",
      "role": "context",
      "reason": "Complete Prisma schema with 40+ models and enums",
      "evidenceRefs": [],
      "startLine": 1,
      "endLine": 1217
    },
    {
      "path": "prisma/schema.prisma",
      "startLine": 10,
      "endLine": 76,
      "role": "read",
      "reason": "Company model with multi-tenant structure and AWS Lex integration",
      "evidenceRefs": [
        "E1"
      ]
    },
    {
      "path": "prisma/schema.prisma",
      "startLine": 78,
      "endLine": 129,
      "role": "read",
      "reason": "User model with 2FA fields, account locking, and session relationships",
      "evidenceRefs": [
        "E2"
      ]
    }
  ],
  "discoveredPathsCount": 100,
  "evidence": [
    {
      "id": "E1",
      "path": "prisma/schema.prisma",
      "startLine": 10,
      "endLine": 76,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Company model with multi-tenant structure and AWS Lex integration",
      "snippet": "10: model Company {\n11:   id                    String                @id @default(dbgenerated(\"uuid_generate_v4()\")) @db.Uuid\n12:   companyCode           String                @unique @map(\"company_code\") @db.VarChar(50)\n13:   companyName           String                @map(\"company_name\") @db.VarChar(200)\n14:   businessNumber        String?               @map(\"business_number\") @db.VarChar(20)\n15:   representative        String?               @db.VarChar(100)\n16:   contactPhone          String?               @map(\"contact_phone\") @db.VarChar(20)\n17:   contactEmail          String?               @map(\"contact_email\") @db.VarChar(100)\n18:   address               String?\n19:   logoUrl               String?               @map(\"logo_url\") @db.VarChar(500)\n20:   isActive              Boolean?              @default(true) @map(\"is_active\")\n21:   settings              Json?                 @de\n... [truncated 35 chars]"
    },
    {
      "id": "E2",
      "path": "prisma/schema.prisma",
      "startLine": 78,
      "endLine": 129,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "User model with 2FA fields, account locking, and session relationships",
      "snippet": "78: model User {\n79:   id                          String                @id @default(dbgenerated(\"uuid_generate_v4()\")) @db.Uuid\n80:   companyId                   String                @map(\"company_id\") @db.Uuid\n81:   username                    String                @db.VarChar(50)\n82:   email                       String?               @db.VarChar(100)\n83:   passwordHash                String                @map(\"password_hash\") @db.VarChar(255)\n84:   name                        String                @db.VarChar(100)\n85:   phone                       String?               @db.VarChar(20)\n86:   role                        user_role?            @default(staff)\n87:   department                  String?               @db.VarChar(100)\n88:   profileImageUrl             String?               @map(\"profile_image_url\") @db.VarChar(500)\n89:   isActive                    Boolean?              @\n... [truncated 55 chars]"
    },
    {
      "id": "E3",
      "path": "prisma/schema.prisma",
      "startLine": 1022,
      "endLine": 1217,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "All enums for roles, statuses, notification types, billing, payment methods",
      "snippet": "1022: enum UserRole {\n1023:   super_admin\n1024:   admin\n1025:   manager\n1026:   staff\n1027: }\n1028: \n1029: enum InquiryStatus {\n1030:   pending\n1031:   in_progress\n1032:   scheduled\n1033:   completed\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/middleware.ts",
      "startLine": 1,
      "endLine": 170,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Route protection, JWT verification, admin routes, API rate limiting",
      "snippet": "1: import { NextResponse } from 'next/server'\n2: import type { NextRequest } from 'next/server'\n3: import { jwtVerify } from 'jose'\n4: import {\n5:   decideApiSessionHandling,\n6:   isApiPath,\n7:   matchesPathPrefix,\n8: } from '@/lib/auth/api-route-access'\n9: \n10: // 보호할 경로 (일반 사용자 - 인증 필요)\n11: const PROTECTED_ROUTES = [\n12:   '/dashboard',\n... [snippet truncated]"
    },
    {
      "id": "E5",
      "path": "src/lib/auth/api-route-access.ts",
      "startLine": 42,
      "endLine": 118,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Exact API access rules: public, session, widget-key, secret, etc.",
      "snippet": "42: export const EXACT_API_ACCESS_RULES: readonly ApiAccessRule[] = [\n43:   {\n44:     path: '/api/auth/login',\n45:     mode: 'public',\n46:     reason: 'Login entrypoint must stay outside middleware session enforcement.',\n47:   },\n48:   {\n49:     path: '/api/auth/logout',\n50:     mode: 'public',\n51:     reason: 'Logout must clear stale cookies even when no valid session remains.',\n52:   },\n53:   {\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/app/api/auth/login/route.ts",
      "startLine": 1,
      "endLine": 320,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Login with rate limiting, IP whitelist, account lockout, 2FA",
      "snippet": "1: import { NextResponse } from 'next/server'\n2: import bcrypt from 'bcryptjs'\n3: import { randomInt, randomUUID } from 'crypto'\n4: import prisma from '@/lib/db/prisma'\n5: import { loginSchema } from '@/lib/validations/auth'\n6: import { createToken, setSession } from '@/lib/auth'\n7: import {\n8:   TWO_FACTOR_PENDING_TOKEN_TTL_MINUTES,\n9:   getTwoFactorChallengeExpiresAt,\n10:   getTwoFactorCodeExpiresAt,\n11: } from '@/lib/auth/two-factor'\n12: import {\n... [snippet truncated]"
    },
    {
      "id": "E7",
      "path": "websocket-server/src/middleware/auth.ts",
      "startLine": 51,
      "endLine": 121,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "JWT auth for WebSocket with IP-based brute force protection",
      "snippet": "51: export function authMiddleware(socket: Socket, next: (err?: Error) => void) {\n52:   const ip = getSocketIp(socket)\n53: \n54:   // 무차별 대입 공격 차단\n55:   const failure = authFailures.get(ip)\n56:   if (failure && failure.count >= AUTH_BLOCK_THRESHOLD) {\n57:     const elapsed = Date.now() - failure.lastAttempt\n58:     if (elapsed < AUTH_BLOCK_DURATION) {\n59:       logger.warn('Auth', 'Blocked - too many failed attempts', { ip, failCount: failure.count })\n60:       return next(new Error('너무 많은 인증 시도입니다. 잠시 후 다시 시도해주세요.'))\n61:     }\n62:     // 차단 시간 경과 → 초기화\n... [snippet truncated]"
    },
    {
      "id": "E8",
      "path": "lambda/bedrock-proxy/index.mjs",
      "startLine": 1,
      "endLine": 88,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Bedrock proxy Lambda with x-api-key authentication and CORS",
      "snippet": "1: import {\n2:   BedrockRuntimeClient,\n3:   InvokeModelCommand,\n4: } from '@aws-sdk/client-bedrock-runtime';\n5: \n6: const client = new BedrockRuntimeClient({\n7:   region: process.env.AWS_BEDROCK_REGION || 'us-east-1',\n8: });\n9: \n10: const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';\n11: \n12: /**\n... [snippet truncated]"
    }
  ],
  "uncertainties": [
    "Prisma schema is 1217 lines; reviewed key models but some edge-case constraints may exist",
    "WebSocket notification handlers not fully reviewed; assumed similar to chat handlers"
  ],
  "stats": {
    "turns": 10,
    "toolCalls": 29,
    "filesRead": 22,
    "grepCalls": 1,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 19228,
    "totalTokens": 335297
  }
}
```

ElapsedMs: 19242
McpIsError: false
