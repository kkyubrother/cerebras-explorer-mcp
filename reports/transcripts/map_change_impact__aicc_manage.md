# Test: map_change_impact on aicc_manage

## Request
```json
{"change": "Switch Toss Payments billing flow to use 3DS for one-time payments instead of billing key issuance", "repo_root": "/home/kyubr/IdeaProjects/aicc_manage"}
```

## Response
- **directAnswer**: "Switching Toss Payments from billing key issuance to 3DS for one-time payments impacts 8 files. The system currently has two flows: (1) billing key for subscriptions (requestBillingAuth→issueBillingKey→chargeBillingKey) and (2) one-time via confirm-payment route. The change affects initial subscription payments only; recurring payments must continue using stored billing keys. Key edits: payment-client.tsx (switch to requestPayment), toss-billing.ts (add 3DS function), types (add 3DS params), confirm-billing route (handle paymentKey), success client (handle 3DS response). Test component needs update. Cron renewal route must be verified to preserve billing key usage."
- **status**: confidence=high, verification=follow_up_needed, complete=false
- **evidenceQuality**: level=high, exactCount=7, partialCount=1, fileCount=8
- **failure**: null
- **8 evidence items, 7 exact + 1 partial**:
  - E1 (exact): toss-billing.ts:1-117 — JSDoc + issueBillingKey/chargeBillingKey
  - E2 (exact): payment-client.tsx:200-224 — caller `requestBillingAuth()` at line 213
  - E3 (exact): toss-payments.d.ts:1-31 — SDK type definitions (Window.TossPayments)
  - E4 (exact): confirm-billing/route.ts:1-220 — backend handler
  - E5 (exact): confirm-payment/route.ts:1-220 — one-time payment reference
  - E6 (exact): payment-success-client.tsx:1-220 — success handler
  - E7 (exact): cron/subscription-renewal/route.ts:1-150 — recurring uses chargeBillingKey (CRITICAL: must preserve)
  - E8 (partial): test-billing-client.tsx:1-200 — flow documentation
- **uncertainties**: ["Unclear if billingKey issuance should be removed or kept for separate card registration", "Unknown Toss SDK 3DS parameter names for requestPayment call", "Unclear how to register cards for recurring after 3DS payment - issue billingKey after?", "Unknown impact on card management UI if billing key flow changes"]

## Notable
- Correctly distinguishes "initial subscription" vs "recurring" payment flows
- Warns explicitly that cron renewal must NOT be broken — high-value insight
- Acknowledges unknown Toss SDK 3DS parameter names (honest)

## Cost: turns=10, toolCalls=25, elapsedMs=19104, totalTokens=242409
