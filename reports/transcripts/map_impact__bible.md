# Test: map_impact on bible (via direct invocation)

## Request
```json
{"anchor": "src/store.tsx", "changeType": "refactor", "repo_root": "/home/kyubr/IdeaProjects/bible"}
```

## Response
- **directAnswer**: "Anchor src/store.tsx exports useStore hook and 9 types. 32+ files across features (exam, reader, search, bookmark, shared) import it. Store internals: types.ts, selectors.ts, createActions.ts, initialState.ts, 6 slice files. No unit tests; only e2e scripts in package.json. Config files (tsconfig.json, vite.config.js) define @/* alias used by imports."
- **status**: confidence=high, verification=targeted_read_needed, complete=true
- **status.warnings**: ["3 evidence item(s) are grounded only by grep, blame, or nearby line observations."]
- **evidenceQuality**: level=high, exactCount=5, partialCount=3, fileCount=8
- **8 evidence items**:
  - 5 exact: store.tsx definition + types.ts + selectors.ts + 2 example callers
  - 3 partial: tsconfig.json + vite.config.js + createActions.ts
- **searchCoverage**: filesRead=5, grepCalls=3, symbolCalls=3
- **Cost**: turns=11, toolCalls=21, elapsedMs=17031, totalTokens=168400

## Notable
- Correctly catches `useStore.getState()` direct access pattern (vs hook usage) as a different callsite type
- Identifies `@/*` path alias as a config dependency — non-obvious refactor concern
- "No unit tests; only e2e scripts" — honest about test gap
- 9 types exported is a claim NOT directly cited in evidence (could be a slight overcount)
