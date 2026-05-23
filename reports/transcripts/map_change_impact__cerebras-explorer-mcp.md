# Test: map_change_impact on cerebras-explorer-mcp

## Request
```json
{"change": "Rename the env var CEREBRAS_API_KEY to EXPLORER_API_KEY across the codebase", "repo_root": "/home/kyubr/IdeaProjects/cerebras-explorer-mcp"}
```

## Response
- **directAnswer**: "Renaming CEREBRAS_API_KEY to EXPLORER_API_KEY affects 4 core implementation files, 6 test files, 4 integration examples, and extensive documentation. Critical edit targets: src/explorer/cerebras-client.mjs (reads env var + error message), scripts/integration-test.mjs (validation check), and all integration example configs. Test assertions in tests/integrations.test.mjs explicitly regex-match the old name and will fail. Documentation in README.md has 15+ instances requiring updates."
- **status**: confidence=high, verification=follow_up_needed, complete=false
- **status.warnings**: ["2 evidence item(s) are grounded only by grep, blame, or nearby line observations."]
- **evidenceQuality**: level=high, exactCount=6, partialCount=2, fileCount=8
- **failure**: null
- **8 targets, roles=edit×7, read×8 (separate items)**:
  - cerebras-client.mjs:93-94 (env var read) — role=edit
  - cerebras-client.mjs:116 (error message) — role=edit
  - scripts/integration-test.mjs:317-318 — role=edit
  - tests/integration-script.test.mjs:70 — role=edit
  - tests/integrations.test.mjs:124 (`assert.regex /CEREBRAS_API_KEY/`) — role=edit
  - integrations/gemini/settings.json.example:7 — role=edit
  - integrations/cursor/README.md:23 — role=edit
  - README.md:13-16 — role=edit
- **uncertainties**: ["No evidence of [REDACTED:secret-path] files or Docker Compose files in this repo", "Unclear if external CI/CD configurations exist outside this repo", "Unclear if users have hardcoded CEREBRAS_API_KEY in local configs"]
- **searchCoverage**: filesRead=10, grepCalls=3, stoppedByBudget=false
- Evidence snippets visibly show `process[REDACTED:secret-path]` (redaction working)

## Cost: turns=11, toolCalls=14, elapsedMs=18846, totalTokens=289376
