# map_change_impact on cerebras-explorer-mcp

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
  "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp",
  "scope": [
    "src/**",
    "tests/**",
    "examples/**"
  ],
  "change": "rename or refactor the public tool output contract fields around evidenceQuality and searchCoverage",
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
  "directAnswer": "Renaming evidenceQuality and searchCoverage impacts 3 core files (schemas.mjs, runtime.mjs, server.mjs) and 6 test suites. Centralized at schema definitions and builder functions. Requires updating 60+ assertions across tests and public example documentation.",
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
    "fileCount": 4,
    "warnings": [],
    "summary": "Verified: 12 files read, 3 grep searches, 1 symbol lookups, 8/8 evidence items grounded, cross-verified across 4 files. All evidence grounded in inspected code."
  },
  "failure": null,
  "nextAction": {
    "type": "read_target",
    "reason": "Read src/explorer/runtime.mjs:417-434 before editing.",
    "target": {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "buildEvidenceQuality constructs evidenceQuality object",
      "evidenceRefs": [
        "line:417-434",
        "E3"
      ],
      "startLine": 417,
      "endLine": 434
    }
  },
  "searchCoverage": {
    "scope": [
      "src/**",
      "tests/**",
      "examples/**"
    ],
    "scopeLimited": true,
    "filesRead": 12,
    "grepCalls": 3,
    "listDirCalls": 0,
    "symbolCalls": 1,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "warnings": [
      "Result is limited to scope: src/**, tests/**, examples/**"
    ],
    "summary": "scope-limited search across src/**, tests/**, examples/**; 12 file read(s), 3 grep search(es)."
  },
  "critic": null,
  "sessionId": "sess_f4cf93bd51a42b1d",
  "session": {
    "id": "sess_f4cf93bd51a42b1d",
    "status": "created",
    "remainingCalls": 4
  },
  "targets": [
    {
      "path": "src/explorer/schemas.mjs",
      "role": "config",
      "reason": "EVIDENCE_QUALITY_SCHEMA defines all subfield names",
      "evidenceRefs": [
        "line:192-205",
        "E1"
      ],
      "startLine": 192,
      "endLine": 205
    },
    {
      "path": "src/explorer/schemas.mjs",
      "role": "config",
      "reason": "SEARCH_COVERAGE_SCHEMA defines all subfield names",
      "evidenceRefs": [
        "line:218-245",
        "E2"
      ],
      "startLine": 218,
      "endLine": 245
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "buildEvidenceQuality constructs evidenceQuality object",
      "evidenceRefs": [
        "line:417-434",
        "E3"
      ],
      "startLine": 417,
      "endLine": 434
    },
    {
      "path": "src/explorer/runtime.mjs",
      "role": "edit",
      "reason": "attachAgentFacingContract assigns both fields",
      "evidenceRefs": [
        "line:577-578",
        "E4"
      ],
      "startLine": 574,
      "endLine": 580
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "edit",
      "reason": "Default functions construct fallback objects",
      "evidenceRefs": [
        "line:686-711",
        "E5"
      ],
      "startLine": 686,
      "endLine": 711
    },
    {
      "path": "src/mcp/server.mjs",
      "role": "edit",
      "reason": "toAgentFacingResult assigns fields with fallback",
      "evidenceRefs": [
        "line:783-784"
      ],
      "startLine": 763,
      "endLine": 790
    },
    {
      "path": "tests/mcp-server.test.mjs",
      "role": "test",
      "reason": "Assertions on both field properties",
      "evidenceRefs": [
        "line:266-270",
        "E8"
      ],
      "startLine": 266,
      "endLine": 270
    },
    {
      "path": "src/mcp/server.mjs",
      "startLine": 623,
      "endLine": 628,
      "role": "read",
      "reason": "formatExploreResult reads both fields for display",
      "evidenceRefs": [
        "E6"
      ]
    }
  ],
  "discoveredPathsCount": 12,
  "evidence": [
    {
      "id": "E1",
      "path": "src/explorer/schemas.mjs",
      "startLine": 192,
      "endLine": 205,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "EVIDENCE_QUALITY_SCHEMA defines all evidenceQuality subfields",
      "snippet": "192: const EVIDENCE_QUALITY_SCHEMA = {\n193:   type: 'object',\n194:   additionalProperties: false,\n195:   properties: {\n196:     level: { type: 'string', enum: ['low', 'medium', 'high'] },\n197:     exactCount: { type: 'integer' },\n198:     partialCount: { type: 'integer' },\n199:     droppedCount: { type: 'integer' },\n200:     fileCount: { type: 'integer' },\n201:     warnings: { type: 'array', items: { type: 'string' } },\n202:     summary: { type: 'string' },\n203:   },\n... [snippet truncated]"
    },
    {
      "id": "E2",
      "path": "src/explorer/schemas.mjs",
      "startLine": 218,
      "endLine": 245,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "SEARCH_COVERAGE_SCHEMA defines all searchCoverage subfields",
      "snippet": "218: const SEARCH_COVERAGE_SCHEMA = {\n219:   type: 'object',\n220:   additionalProperties: false,\n221:   properties: {\n222:     scope: { type: 'array', items: { type: 'string' } },\n223:     scopeLimited: { type: 'boolean' },\n224:     filesRead: { type: 'integer', minimum: 0 },\n225:     grepCalls: { type: 'integer', minimum: 0 },\n226:     listDirCalls: { type: 'integer', minimum: 0 },\n227:     symbolCalls: { type: 'integer', minimum: 0 },\n228:     toolResultsTruncated: { type: 'integer', minimum: 0 },\n229:     stoppedByBudget: { type: 'boolean' },\n... [snippet truncated]"
    },
    {
      "id": "E3",
      "path": "src/explorer/runtime.mjs",
      "startLine": 417,
      "endLine": 434,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "buildEvidenceQuality constructs evidenceQuality object",
      "snippet": "417: function buildEvidenceQuality(result, stats, grounding = {}) {\n418:   const evidence = Array.isArray(result.evidence) ? result.evidence : [];\n419:   const exactCount = evidence.filter(item => item.groundingStatus === 'exact').length;\n420:   const partialCount = evidence.filter(item => item.groundingStatus === 'partial').length;\n421:   const droppedCount = (grounding.droppedUngrounded ?? 0) + (grounding.droppedMalformed ?? 0);\n422:   const fileCount = new Set(evidence.map(item => item.path).filter(Boolean)).size;\n423:   const warnings = Array.isArray(result.status?.warnings) ? result.status.warnings.slice(0, 5) : [];\n424:   const summary = result.trustSummary || buildTrustSummary(result, stats);\n425:   return {\n426:     level: result.status?.confidence ?? 'low',\n427:     exactCount,\n428:     partialCount,\n... [snippet truncated]"
    },
    {
      "id": "E4",
      "path": "src/explorer/runtime.mjs",
      "startLine": 574,
      "endLine": 580,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "attachAgentFacingContract assigns both fields to result",
      "snippet": "574: function attachAgentFacingContract(result, stats, grounding = {}) {\n575:   result.schemaVersion = AGENT_FACING_SCHEMA_VERSION;\n576:   result.failure = buildFailure(result, stats);\n577:   result.evidenceQuality = buildEvidenceQuality(result, stats, grounding);\n578:   result.searchCoverage = buildSearchCoverage(stats);\n579:   return result;\n580: }"
    },
    {
      "id": "E5",
      "path": "src/mcp/server.mjs",
      "startLine": 686,
      "endLine": 711,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Default functions construct fallback objects for both fields",
      "snippet": "686:   function defaultEvidenceQuality(summary = 'No grounded evidence was retained.', warnings = []) {\n687:     return {\n688:       level: 'low',\n689:       exactCount: 0,\n690:       partialCount: 0,\n691:       droppedCount: 0,\n692:       fileCount: 0,\n693:       warnings: warnings.filter(item => typeof item === 'string').slice(0, 5),\n694:       summary,\n695:     };\n696:   }\n697: \n... [snippet truncated]"
    },
    {
      "id": "E6",
      "path": "src/mcp/server.mjs",
      "startLine": 623,
      "endLine": 628,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "formatExploreResult reads both fields for display",
      "snippet": "623:     if (result.evidenceQuality) {\n624:       lines.push(`Evidence Quality: ${result.evidenceQuality.level} (${result.evidenceQuality.exactCount} exact, ${result.evidenceQuality.partialCount} partial, ${result.evidenceQuality.droppedCount} dropped)`);\n625:     }\n626:     if (result.searchCoverage) {\n627:       lines.push(`Search Coverage: ${result.searchCoverage.summary}`);\n628:     }"
    },
    {
      "id": "E7",
      "path": "src/mcp/server.mjs",
      "startLine": 783,
      "endLine": 784,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "toAgentFacingResult assigns both fields with defaults",
      "snippet": "783:       evidenceQuality: result.evidenceQuality ?? defaultEvidenceQuality(result.trustSummary),\n784:       searchCoverage: result.searchCoverage ?? defaultSearchCoverage(),"
    },
    {
      "id": "E8",
      "path": "tests/mcp-server.test.mjs",
      "startLine": 266,
      "endLine": 270,
      "groundingStatus": "exact",
      "evidenceType": "file_range",
      "why": "Test assertions check multiple properties of both fields",
      "snippet": "266:   assert.equal(called.structuredContent.evidenceQuality.level, called.structuredContent.status.confidence);\n267:   assert.equal(called.structuredContent.evidenceQuality.exactCount, 2);\n268:   assert.equal(called.structuredContent.evidenceQuality.fileCount, 2);\n269:   assert.deepEqual(called.structuredContent.searchCoverage.scope, ['src/**']);\n270:   assert.equal(called.structuredContent.searchCoverage.scopeLimited, true);"
    }
  ],
  "uncertainties": [],
  "stats": {
    "turns": 6,
    "toolCalls": 16,
    "filesRead": 12,
    "grepCalls": 3,
    "symbolCalls": 1,
    "stoppedByBudget": false,
    "elapsedMs": 9062,
    "totalTokens": 118249
  }
}
```

ElapsedMs: 9073
McpIsError: false
