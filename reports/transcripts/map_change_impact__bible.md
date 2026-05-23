# Test: map_change_impact on bible

## Request
```json
{"change": "Replace idb-keyval with the Cache API so bible chapters survive a hard refresh", "repo_root": "/home/kyubr/IdeaProjects/bible"}
```

## Response
- **directAnswer**: "Replacing idb-keyval with Cache API affects 10 files. Core storage layer (fetchWithStorage, database, downloadManager) uses get/set/del/entries/clear/update. Bible chapters, user settings, downloads, exam data, bookmarks, and revelation features all depend on IndexedDB storage. High risk due to API differences: Cache API lacks entries(), clear(), update(); only accepts URL keys; stores Response objects not JSON. No tests exist. Migration requires data strategy and service worker integration."
- **status**: confidence=high, verification=targeted_read_needed, complete=true, warnings=[]
- **evidenceQuality**: level=high, exactCount=8, partialCount=0, fileCount=5
- **failure**: null
- **nextAction**: type=read_target, target=fetchWithStorage.tsx:1-140
- **8 evidence items, all exact**:
  - E1: package.json:18 — `"idb-keyval": "^6.1.0"`
  - E2: fetchWithStorage.tsx:1 — `import { get, set } from "idb-keyval";`
  - E3: fetchWithStorage.tsx:41-56 — tryLoadFromCache
  - E4: fetchWithStorage.tsx:60-86 — fetchAndCache
  - E5: database.ts:141-151 — clearCache uses `clear()` — **flagged as no Cache API equivalent**
  - E6: downloadManager.tsx:1 — `import { entries, get, set }`
  - E7: downloadManager.tsx:491-502 — uses `entries()` iteration — **flagged**
  - E8: bookmark/utils/database.ts:1 — `import { get, set, update }` — **update() has no equivalent**
- **uncertainties** (CONCRETE API gaps):
  - Cache API does not support clear() - need iteration with delete()
  - Cache API does not support entries() - need keys() then match() iteration
  - Cache API does not support update() - need read-modify-write (non-atomic)
  - Cache API only accepts URL keys - current code uses arbitrary strings
  - Cache API stores Response objects not JSON - serialization required
  - Migration strategy for existing IndexedDB data undefined
  - Service worker registration may be required for Cache API reliability

## Notable
- This is excellent change-impact analysis: the uncertainties list is genuinely actionable
- The directAnswer correctly flags "High risk" and lists 4 specific API differences
- Identifies that bookmarks/exam/revelation all depend on the same layer (cross-feature impact)

## Cost: turns=10, toolCalls=21, elapsedMs=14658, totalTokens=241401
