# Tasks: prompt & contract hygiene for the 8-tool surface (spec 023)

- [x] T001 Update `explore_repo` and specialized wrapper descriptions so `find_relevant_code` remains the only locator that says "Use first", while `explore_repo` is the general fallback.
- [x] T002 Remove stale `budget` / `thoroughness` affordance text from public tool descriptions and reject removed inputs in tests.
- [x] T003 Add `explain_code_path` to the retry-tool vocabulary and pin `RETRY_SCHEMA` / runtime `RETRY_TOOLS` set equality.
- [x] T004 Reword live system-prompt READ-ONLY rules so candidate `role:edit` targets may be identified without permitting mutation or patches.
- [x] T005 Add the untrusted-content hard requirement to the live explorer and report prompts.
- [x] T006 Clarify git evidence line-range expectations without relaxing critic validation.
- [x] T007 Correct `repo_references` description from "all usages" to capped heuristic references.
- [x] T008 Close stale V1/V2 prompt-builder split; keep the current single report-backend builders live and tested.
- [x] T009 Update README/DESIGN/CHANGELOG and regression guards for the prompt-contract hygiene closure.
- [x] T099 Verify closure with `npm test` 411 pass / 0 fail on 2026-06-05.
