# Test: trace_symbol on aicc_manage

## Request
```json
{"symbol": "getSubscriptionDatesInSeoul", "repo_root": "/home/kyubr/IdeaProjects/aicc_manage"}
```

## Response
- **directAnswer**: "getSubscriptionDatesInSeoul is defined in src/lib/subscription-dates.ts (lines 17-31). It calculates subscription start/end dates and next billing date based on Seoul timezone. Parameters: billingCycle ('monthly' | 'yearly'). Returns: { startDate, endDate, nextBillingDate } (all Date objects). Dates are stored as 00:00 UTC for correct DB display. Called in three API routes: subscribe/route.ts (line 52), confirm-payment/route.ts (line 262), and confirm-billing/route.ts (line 271)."
- **status**: confidence=high, verification=verified, complete=true, warnings=[]
- **evidenceQuality**: level=high, exactCount=5, partialCount=0, fileCount=4
- **5 evidence items, all exact**:
  - E1: subscription-dates.ts:17-31 — full function definition with Seoul timezone logic
  - E2: subscription-dates.ts:1-6 — JSDoc + BillingCycle type
  - E3: subscribe/route.ts:52-54 — caller `const { startDate, endDate, nextBillingDate } = getSubscriptionDatesInSeoul(billingCycle as 'monthly' | 'yearly')`
  - E4: confirm-payment/route.ts:262 — single-line caller
  - E5: confirm-billing/route.ts:271 — single-line caller
- **searchCoverage**: filesRead=4, grepCalls=0, symbolCalls=1, stoppedByBudget=false
- **failure**: null
- **nextAction**: stop

## Notable
- Korean JSDoc comment preserved in snippet
- "00:00 UTC for correct DB display" claim sourced from E2 snippet
- All 3 callers found and cited with exact line numbers

## Cost
- turns=4, toolCalls=5, elapsedMs=3329, totalTokens=23717
