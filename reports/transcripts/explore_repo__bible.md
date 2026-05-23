# Test: explore_repo on bible

## Request
```json
{"task": "Identify how the bible search v3 hook differs from v4 — what storage and ranking does each use", "repo_root": "/home/kyubr/IdeaProjects/bible"}
```

## Response
- **directAnswer**: "Bible search v3 uses React state arrays storing flat objects {t, b, c, l}, loads from offline cache or JSON endpoint, and ranks via simple includes() filtering. V4 uses FlexSearch.Document index with tokenize:'full', loads via getBooks/getSearch APIs, and uses FlexSearch relevance ranking plus book ID sorting."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=3
- **8 evidence items**:
  - E1: useSearchV3.tsx:14-19 — `interface SearchV3Item { t, b, c, l }`
  - E2: useSearchV3.tsx:58-63 — `useState<SearchV3Item[]>`
  - E3: useSearchV3.tsx:88-112 — offline cache logic with `downloadManager.isItemDownloaded(SEARCH_INDEX, language)`
  - E4: useSearchV3.tsx:123-130 — `data.filter((s) => keywords.every((k) => s.t.includes(k)))`
  - E5: useSearchV4.tsx:83-92 — `new FlexSearch.Document({ ..., tokenize: "full" })`
  - E6: useSearchV4.tsx:96-112 — `getBooks(language)` + `getSearch(language)` + indexing
  - E7: useSearchV4.tsx:145-153 — `flexSearchDocumentRef.current.search(query, { enrich: true, limit: 99999 })`
  - E8: database.ts:77-83 — V3 JSON endpoint
- **searchCoverage**: filesRead=5, grepCalls=2

## Notable
- Side-by-side comparison from 8 grounded snippets
- Correctly identifies different data shapes: V3 ({t,b,c,l}) vs V4 (FlexSearch documents)
- Correctly notes V3 uses `includes()` filter (substring) vs V4 uses FlexSearch relevance

## Cost: turns=7, toolCalls=8, elapsedMs=9211, totalTokens=70413
