# Test: collect_evidence on bible

## Request — false claim
```json
{"claim": "The bible app ships a service worker that pre-caches all bible JSON files at install time", "repo_root": "/home/kyubr/IdeaProjects/bible"}
```

## Response — ⭐ Correctly rejected the false claim
- **directAnswer**: "The claim is FALSE. The bible app ships a service worker (via vite-plugin-pwa generateSW mode), but it does NOT pre-cache all bible JSON files at install time. The globPatterns configuration explicitly excludes .json files, precaching only js, css, html, ico, png, svg. Bible JSON files (/static/bible_data.v3/*) are cached at runtime using a NetworkFirst strategy with 3-second timeout, not at install time."
- **status**: confidence=high, verification=follow_up_needed, complete=false
- **status.warnings**: ["1 evidence item(s) were removed because their line ranges were not inspected."]
- **evidenceQuality**: level=high, exactCount=4, partialCount=0, droppedCount=1, fileCount=3
- **4 evidence items, all exact**:
  - E1: vite.config.js:128-170 — `globPatterns: ["**/*.{js,css,html,ico,png,svg}"]` (no .json), `runtimeCaching` with NetworkFirst for bible_data.v3
  - E2: PWA-RELEASE-STABILIZATION-2026-05-21.md:58-63 — Korean doc confirming app shell vs runtime data separation
  - E3: PWA-SUPPORT-STATUS-REPORT-2026-03-06.md:66-72 — Korean doc explicitly stating NetworkFirst+3s timeout
  - E4: vite.config.js:58 — VitePWA plugin config

## Notable
- ⭐ **Crucial precision**: distinguished "ships a service worker" (TRUE) vs "pre-caches at install time" (FALSE)
- Read both code config AND project docs to triangulate
- The dropped evidence indicates the tool's own grounding filter caught an ungrounded item

## Cost: turns=6, toolCalls=14, elapsedMs=9234, totalTokens=86831
