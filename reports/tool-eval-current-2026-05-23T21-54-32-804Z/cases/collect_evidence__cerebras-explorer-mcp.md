# collect_evidence on cerebras-explorer-mcp

## Tool Description
Use when you already have a claim, hypothesis, or review point and need a compact bundle of grounded file:line evidence with snippets. Best for verifying facts before replying or reviewing a change.

## Input Schema
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "claim": {
      "type": "string",
      "description": "The claim or hypothesis to verify."
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
    "claim"
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
  "claim": "explore_repo rejects a public budget input and all public tools are read-only annotated",
  "knownFiles": [
    "src/mcp/server.mjs"
  ],
  "knownSymbols": [
    "createMcpRequestHandler"
  ]
}
```

## Response Summary
```json
{
  "directAnswer": "Both claims verified. (1) explore_repo rejects 'budget' as unknown argument per spec 011—confirmed by schema (no budget property), validation logic (throws error), and test assertions. (2) All 10 public MCP tools use read-only annotations (readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true).",
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
    "fileCount": 5,
    "warnings": [],
    "summary": "Verified: 8 files read, 4 grep searches, 8/8 evidence items grounded, cross-verified across 5 files. All evidence grounded in inspected code."
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
    "filesRead": 8,
    "grepCalls": 4,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 8 file read(s), 4 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_4fe1ba236d8bdc84",
  "session": {
    "id": "sess_4fe1ba236d8bdc84",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/explorer/schemas.mjs",
      "role": "config",
      "reason": "EXPLORE_REPO_INPUT_SCHEMA lacks 'budget' property; only allows task, repo_root, scope, hints, session, language",
      "evidenceRefs": [
        "E1"
      ],
      "startLine": 1,
      "endLine": 57
    },
    {
      "path": "src/explorer/schemas.mjs",
      "role": "config",
      "reason": "validateExploreRepoArgs throws 'Unknown explore_repo argument: budget' for unrecognized keys",
      "evidenceRefs": [
        "E2"
      ],
      "startLine": 344,
      "endLine": 354
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "READ_ONLY_TOOL_ANNOTATIONS constant defines all read-only hint flags",
      "evidenceRefs": [
        "E3"
      ],
      "startLine": 17,
      "endLine": 29
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "EXPLORE_REPO_TOOL uses readOnlyToolAnnotations and description says 'Omit budget'",
      "evidenceRefs": [
        "E4"
      ],
      "startLine": 33,
      "endLine": 46
    },
    {
      "path": "tests/runtime.mock.test.mjs",
      "role": "test",
      "reason": "Test '011 US2' confirms explore_repo rejects budget input with error message",
      "evidenceRefs": [
        "E5"
      ],
      "startLine": 2319,
      "endLine": 2332
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Assertion confirms budget property is undefined per spec 011",
      "evidenceRefs": [
        "E6"
      ],
      "startLine": 221,
      "endLine": 223
    },
    {
      "path": "tests/schemas.test.mjs",
      "role": "test",
      "reason": "Test asserts budget input was removed in spec 011",
      "evidenceRefs": [
        "E7"
      ],
      "startLine": 167,
      "endLine": 172
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "context",
      "reason": "buildToolList confirms all 10 public tools are exposed via MCP",
      "evidenceRefs": [
        "E8"
      ],
      "startLine": 277,
      "endLine": 291
    }
  ],
  "discoveredPathsCount": 57,
  "evidence": [
    {
      "id": "E1",
      "path": "src/explorer/schemas.mjs",
      "startLine": 1,
      "endLine": 57,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_REPO_INPUT_SCHEMA does not define 'budget' property",
      "snippet": "1: export const EXPLORE_REPO_INPUT_SCHEMA = {\n2:   type: 'object',\n3:   additionalProperties: false,\n4:   properties: {\n5:     task: {\n6:       type: 'string',\n7:       description:\n8:         'Natural-language exploration request. Be specific for best results: ' +\n9:         '\"How does the auth middleware validate JWT tokens and where is it applied?\" ' +\n10:         'is better than \"explain auth\".',\n11:     },\n12:     repo_root: {\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/explorer/schemas.mjs",
      "startLine": 344,
      "endLine": 354,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "validateExploreRepoArgs throws error for unrecognized arguments including 'budget'",
      "snippet": "344: export function validateExploreRepoArgs(args, { allowInternal = false } = {}) {\n345:   if (!args || typeof args !== 'object') {\n346:     throw new Error('Arguments must be an object.');\n347:   }\n348:   const allowedKeys = new Set(Object.keys(EXPLORE_REPO_INPUT_SCHEMA.properties));\n349:   if (allowInternal) allowedKeys.add('taskMode');\n350:   for (const key of Object.keys(args)) {\n351:     if (!allowedKeys.has(key)) {\n352:       throw new Error(`Unknown explore_repo argument: ${key}`);\n353:     }\n354:   }"
    },
    {
      "id": "E3",
      "path": "src/mcp/server.mjs",
      "startLine": 17,
      "endLine": 29,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "READ_ONLY_TOOL_ANNOTATIONS defines readOnlyHint: true, destructiveHint: false",
      "snippet": "17: const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({\n18:   readOnlyHint: true,\n19:   destructiveHint: false,\n20:   idempotentHint: true,\n21:   openWorldHint: true,\n22: });\n23: \n24: function readOnlyToolAnnotations(title) {\n25:   return {\n26:     title,\n27:     ...READ_ONLY_TOOL_ANNOTATIONS,\n28:   };\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/mcp/server.mjs",
      "startLine": 33,
      "endLine": 46,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EXPLORE_REPO_TOOL uses readOnlyToolAnnotations and description omits budget",
      "snippet": "33: const EXPLORE_REPO_TOOL = {\n34:   name: 'explore_repo',\n35:   title: 'Autonomous repository explorer',\n36:   description:\n37:     'Use FIRST for read-only code discovery when the exact files are unknown, the task may span 3+ files, or you need cross-file evidence: ' +\n38:     'architecture, symbol usage, dependency/call tracing, bug root cause, change impact, config origin, or evidence collection. ' +\n39:     'Do NOT use for a single known file/range or when immediate editing is cheaper. ' +\n40:     'Returns structured JSON with directAnswer, status, targets, grounded file:line evidence with snippets, and nextAction. ' +\n41:     'After this tool, avoid broad grep/read; only read cited targets needed for verification or edits. ' +\n42:     'Omit budget and hints.strategy unless required by an advanced workflow. Pass sessionId as \"session\" for follow-up calls.',\n43:   inputSchema: EXPLO\n... [truncated 93 chars]"
    },
    {
      "id": "E5",
      "path": "tests/runtime.mock.test.mjs",
      "startLine": 2319,
      "endLine": 2332,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test showing explore_repo throws 'Unknown explore_repo argument: budget'",
      "snippet": "2319: test('011 US2 — explore_repo rejects budget input as unknown property', async () => {\n2320:   class StubClient {\n2321:     constructor() { this.model = 'zai-glm-4.7'; }\n2322:     async createChatCompletion() {\n2323:       return { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, message: { content: '', toolCalls: [] } };\n2324:     }\n2325:   }\n2326:   const root = await makeRepoFixture();\n2327:   const runtime = new ExplorerRuntime({ chatClient: new StubClient() });\n2328:   await assert.rejects(\n2329:     runtime.explore({ task: '테스트', repo_root: root, budget: 'quick' }),\n2330:     /Unknown explore_repo argument: budget/,\n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 221,
      "endLine": 223,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test assertion confirms budget input was removed in spec 011",
      "snippet": "221:   // spec 011: budget input was removed; every call runs against the single deep runtime config.\n222:   assert.equal(exploreRepoTool.inputSchema.properties.budget, undefined, 'budget input was removed in spec 011');\n223:   assert.ok(exploreRepoTool.outputSchema.properties.targets, 'explore_repo must expose outputSchema targets');"
    },
    {
      "id": "E7",
      "path": "tests/schemas.test.mjs",
      "startLine": 167,
      "endLine": 172,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test asserts EXPLORE_REPO_INPUT_SCHEMA.properties.budget is undefined",
      "snippet": "167: test('agent-facing strategy hint stays advanced only and budget input was removed in spec 011', () => {\n168:   assert.equal(\n169:     EXPLORE_REPO_INPUT_SCHEMA.properties.budget,\n170:     undefined,\n171:     'spec 011: budget input was removed',\n172:   );"
    },
    {
      "id": "E8",
      "path": "src/mcp/server.mjs",
      "startLine": 277,
      "endLine": 291,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "buildToolList lists all 10 public tools that use readOnlyToolAnnotations",
      "snippet": "277: function buildToolList() {\n278:   return [\n279:     FIND_RELEVANT_CODE_TOOL,\n280:     TRACE_SYMBOL_TOOL,\n281:     MAP_CHANGE_IMPACT_TOOL,\n282:     MAP_IMPACT_TOOL,\n283:     EXPLAIN_CODE_PATH_TOOL,\n284:     COLLECT_EVIDENCE_TOOL,\n285:     REVIEW_CHANGE_CONTEXT_TOOL,\n286:     FIND_ENTRYPOINTS_TOOL,\n287:     EXPLORE_REPO_TOOL,\n288:     EXPLORE_TOOL,\n... [snippet truncated]"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 13,
    "filesRead": 8,
    "grepCalls": 4,
    "symbolCalls": 0,
    "stoppedByBudget": false,
    "elapsedMs": 12915,
    "totalTokens": 134595
  }
}
```

ElapsedMs: 12927
McpIsError: false
