# Test: find_entrypoints on aicc_manage (via direct invocation; strategy bug worked around)

## Request
```json
{"entryKind": "http", "repo_root": "/home/kyubr/IdeaProjects/aicc_manage"}
```

## Response
- **directAnswer**: "This Next.js App Router repository has ~150+ HTTP routes in src/app/api/. Routes use export async function GET/POST/PUT/DELETE/PATCH pattern. Grouped by kind: Auth (13 routes), Admin (32), Billing (36), Core Business (30), Chat/Lex (20), Widget/External (14), Onboarding (12), Settings (8), Cron (6)."
- **status**: confidence=high, verification=verified, complete=true
- **status.warnings**: ["1 evidence item(s) were removed because their line ranges were not inspected."]
- **evidenceQuality**: level=high, exactCount=7, droppedCount=1, fileCount=5
- **11 targets, 7 evidence items**
- **searchCoverage**: filesRead=5, grepCalls=9
- **Cost**: turns=9, toolCalls=38, elapsedMs=18008, totalTokens=224377

## Notable
- Doesn't enumerate all 150+ routes individually — instead groups by category
- Drops 1 evidence item that wasn't actually read (honest reporting)
- All cited routes use Next.js `export async function GET/POST/PUT/DELETE/PATCH` pattern, which is correctly identified
- Categories (Auth, Admin, Billing, Chat/Lex, etc.) are summary-level claims, NOT individually grounded — sub-agents should treat numbers cautiously
