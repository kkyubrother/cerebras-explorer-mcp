# Test: trace_symbol on bible

## Request
```json
{"symbol": "loadBibleWords", "repo_root": "/home/kyubr/IdeaProjects/bible"}
```

## Response
- **directAnswer**: "loadBibleWords is an exported async function defined in src/shared/utils/database.ts (lines 87-95). It loads Bible word data for a specific language, book, and chapter from IndexedDB cache or server. Parameters: language (string), book_id (string|number), chapter_id (string|number). Returns Promise<Record<string, unknown>[]> by calling loader with URL pattern /static/words/{language}/bible_words.{book_id}.{chapter_id}.json. Re-exported via src/utils/database.tsx (line 12). Referenced in documentation but no runtime callers found in source code."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=4, partialCount=0, fileCount=2
- **uncertainties**: ["No actual runtime call sites found - function may be unused or called dynamically"]
- **4 evidence items, all exact**:
  - E1: database.ts:87-95 — function definition
  - E2: database.ts:49-57 — loader function (caching logic)
  - E3: database.ts:7 — `const URL_BIBLE_WORDS = "/static/words";`
  - E4: utils/database.tsx:12 — `loadBibleWords,` (re-export)
- **searchCoverage**: filesRead=2, grepCalls=3, symbolCalls=1

## Notable
- Correctly reports "no runtime callers found" as uncertainty rather than fabricating
- toolTrace shows it explicitly searched `src/features`, `src/components`, `src/app`, `src/pages` and confirmed 0 matches before concluding

## Cost
- turns=7, toolCalls=6, elapsedMs=4818, totalTokens=41542
