# Test: explore_repo on studious-memory

## Request
```json
{"task": "Identify how the access profile (work_safe / full / custom) restricts memory queries at the database level", "repo_root": "/home/kyubr/IdeaProjects/studious-memory"}
```

## Response
- **directAnswer**: "Access profiles restrict memory queries at the database level through `apply_access_context_scope()` in `backend/app/access_context.py` (lines 99-129). This function applies WHERE clauses to SQLAlchemy Select statements: 1) If `allowed_group_ids` is set, adds `data_group_id IN (allowed_group_ids)`, 2) If `deny_sensitivity_levels` is set, excludes those sensitivity levels, 3) If `hide_restricted` is True, filters out `visibility_policy = 'restricted'`, 4) If `hide_ungrouped` is True, requires `data_group_id IS NOT NULL`. Work-safe mode pre-configures `deny_sensitivity_levels` to exclude 'private', 'confidential', and 'system_secret' (lines 15-19)."
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=8, fileCount=4
- **8 evidence items, all exact**:
  - E1: access_context.py:11-19 — PROFILE_MODE_FULL/WORK_SAFE/CUSTOM + `WORK_SAFE_DENY_SENSITIVITY_LEVELS = ("private", "confidential", "system_secret")`
  - E2: access_context.py:27-43 — `@dataclass(frozen=True) class AccessContext` with allowed_group_ids, deny_sensitivity_levels, hide_ungrouped, hide_restricted
  - E3: access_context.py:99-129 — `apply_access_context_scope()` WHERE clause logic
  - E4-E5: memory_provenance.py:96, 111 — apply_access_context_scope call sites
  - E6-E7: source.py:77-82, 107-112 — repository call sites
  - E8: api/v1/memory.py:20 — `access_context: AccessContext = Depends(get_request_access_context)`
- **searchCoverage**: filesRead=8, grepCalls=7

## Notable
- Reconstructs 4-rule filtering logic and traces the dependency-injected access_context all the way down to SQL WHERE clauses
- Identifies that work_safe mode's deny list is at the constants level (line 15-19), not request-time
- Identifies 3 call sites for the function (memory_provenance.py and source.py)

## Cost: turns=12, toolCalls=18, elapsedMs=13511, totalTokens=225333
