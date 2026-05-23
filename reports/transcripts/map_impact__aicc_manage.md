# Test: map_impact on aicc_manage (via direct invocation)

## Request
```json
{"anchor": "getSubscriptionDatesInSeoul", "changeType": "rename", "repo_root": "/home/kyubr/IdeaProjects/aicc_manage"}
```

## Response
- **directAnswer**: "Found 3 direct callers of getSubscriptionDatesInSeoul across billing API routes, no direct tests, and no configuration references. The function is defined in src/lib/subscription-dates.ts and imported/called in three billing route handlers: subscribe, confirm-payment, and confirm-billing. Several files import related exports from the same module but do not use this function directly."
- **status**: confidence=high, verification=targeted_read_needed, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=5
- **8 evidence items, all exact** — definition + 3 imports + 3 call sites + related BillingCycle import
- **searchCoverage**: filesRead=5, grepCalls=5, symbolCalls=1
- **Cost**: turns=7, toolCalls=14, elapsedMs=10434, totalTokens=63716

## Notable
- For a rename refactor, correctly distinguishes:
  - 3 `edit` targets: function def + 3 imports
  - 3 `read` targets: 3 call sites (verify context unchanged)
  - 1 `context` target: usage-summary.ts importing BillingCycle (not the renamed function)
- Honest about "no direct tests" — a useful flag for the parent agent
