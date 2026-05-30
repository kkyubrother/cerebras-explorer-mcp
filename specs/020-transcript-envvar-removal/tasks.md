# Tasks: remove legacy transcript envvars (spec 020)

- [x] T001 Baseline: branch `020-transcript-envvar-removal` from clean `master` (post v0.6.2). `npm test` 382 pass.
- [x] T010 `src/explorer/transcript.mjs` `resolveTranscriptDir()`: drop `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`, keep `CEREBRAS_EXPLORER_LOG_PATH` only.
- [x] T011 `src/explorer/transcript.mjs` `isTranscriptEnabled()`: `Boolean(process.env.CEREBRAS_EXPLORER_LOG_PATH)`; remove legacy fallback.
- [x] T012 `src/explorer/runtime.mjs`: update opt-in comment to `CEREBRAS_EXPLORER_LOG_PATH`.
- [x] T020 `tests/transcript.test.mjs`: flip legacy-enable test to legacy-ignored (disabled, no-op recorder); rename precedence test to "ignored alongside LOG_PATH".
- [x] T021 `tests/free-explore.test.mjs`: switch transcript-trigger env to `CEREBRAS_EXPLORER_LOG_PATH`.
- [x] T022 `tests/integrations.test.mjs`: update CHANGELOG token line-count guard (1 → 3).
- [x] T030 `README.md` / `TESTING.md`: replace legacy envvar guidance with `CEREBRAS_EXPLORER_LOG_PATH`.
- [x] T031 `CHANGELOG.md`: add `## v0.7.0 - Unreleased` BREAKING removal + migration section.
- [x] T032 Update Speckit plan pointer in `CLAUDE.md` and `AGENTS.md` to spec 020.
- [x] T040 `npm test` — 382 pass, 0 fail.

## Deferred (release step)

- [ ] v0.7.0 release finalize: bump version refs 0.6.2 → 0.7.0, date the CHANGELOG heading, tag, `gh release create --prerelease` (breaking). Not part of this spec.
