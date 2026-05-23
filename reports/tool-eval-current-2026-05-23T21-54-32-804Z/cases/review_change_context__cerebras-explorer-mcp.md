# review_change_context on cerebras-explorer-mcp

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

## Response Summary
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

ElapsedMs: 10443
McpIsError: false
