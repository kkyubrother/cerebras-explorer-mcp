# Test: explore_repo on DeepResearch

## Request
```json
{"task": "Identify how the citation_validator's quote-match and semantic-entailment two-stage checks reject unsupported claims", "repo_root": "/home/kyubr/IdeaProjects/DeepResearch"}
```

## Response
- **directAnswer**: Stage 1 (quote-match: EXACT or HIGH_CONFIDENCE_FUZZY @ 95% threshold; if neither, short-circuit with UNSUPPORTED). Stage 2 (semantic entailment via judge.judge() returning SemanticJudgment with support_type / entailment_score / recommended_action)
- **status**: confidence=high, verification=verified, complete=true
- **evidenceQuality**: level=high, exactCount=7, fileCount=6
- **7 evidence items, all exact** covering:
  - citation_validator.py:104-122 (stage 1 short-circuit)
  - citation_validator.py:124-137 (stage 2)
  - fuzzy.py:25-39 (95% threshold)
  - enums.py:95-110 (QuoteMatchStatus + SemanticStatus)
  - models.py:34-46 (SemanticJudgment pydantic)
  - hashing.py:11-14 (normalize before match)
  - test:497-530 (test confirms two-stage order)
- **searchCoverage**: filesRead=7, grepCalls=4

## Notable
- Reconstructs the rejection mechanism from 6 files + 1 test
- Cites the unit test that ASSERTS the two-stage order (`test_citation_validator_runs_quote_match_then_entailment_judge`) as evidence — testing the test layer is a strong signal

## Cost: turns=7, toolCalls=11, elapsedMs=10754, totalTokens=83096
