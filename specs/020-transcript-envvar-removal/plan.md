# Implementation Plan: remove legacy transcript envvars (spec 020)

**Branch**: `020-transcript-envvar-removal` | **Date**: 2026-05-31 | **Spec**: [`spec.md`](./spec.md)

## Technical Context

Node.js 22+ ESM, zero-dep, 단일 source root. 변경은 `src/explorer/transcript.mjs` 두 함수에 집중된다. 외부 contract 도입이 없는 internal feature이므로 `research.md`/`data-model.md`/`quickstart.md`/`contracts/`는 생성하지 않는다(spec 014–018 패턴).

## Code changes

- `src/explorer/transcript.mjs`
  - `resolveTranscriptDir()`: override를 `CEREBRAS_EXPLORER_LOG_PATH`만 읽도록 축소.
  - `isTranscriptEnabled()`: `Boolean(process.env.CEREBRAS_EXPLORER_LOG_PATH)`로 단순화. legacy truthy 검사 제거. (`isTruthyEnv`는 `isTranscriptRawMode`가 계속 사용하므로 유지.)
- `src/explorer/runtime.mjs`: opt-in 주석을 `CEREBRAS_EXPLORER_LOG_PATH`로 갱신.

## Test changes

- `tests/transcript.test.mjs`
  - "legacy ... still enable" → "legacy ... no longer enable (removed in v0.7.0)": legacy-only 설정 시 `isTranscriptEnabled()===false`, no-op recorder(filePath/callId null), legacyDir 비어있음 검증.
  - precedence 테스트 → "legacy envvars are ignored even when set alongside LOG_PATH"로 재명명(검증 동일: LOG_PATH dir 사용 + legacyDir empty).
- `tests/free-explore.test.mjs`: transcript trigger 테스트 env를 `CEREBRAS_EXPLORER_LOG_PATH`로 교체.
- `tests/integrations.test.mjs`: CHANGELOG 토큰 라인 카운트 가드 1 → 3 (v0.6.1 deprecation 1줄 + v0.7.0 제거 기록 2줄).

## Doc changes

- `README.md`: hidden-alias 안내 문장을 "v0.7.0에서 제거됨 + LOG_PATH 단일 안내"로 교체(레거시 토큰 미포함, docs 가드 유지).
- `TESTING.md`: transcript trigger 항목을 `CEREBRAS_EXPLORER_LOG_PATH`로 갱신.
- `CHANGELOG.md`: `## v0.7.0 - Unreleased` BREAKING 섹션 추가(제거 + 마이그레이션). package.json version bump은 릴리스 단계에서.
- `CLAUDE.md` / `AGENTS.md`: Speckit plan 포인터를 spec 020으로 갱신.

## Commit units

- C1 `feat(spec-020): remove legacy transcript envvars; unify on CEREBRAS_EXPLORER_LOG_PATH` (code + tests)
- C2 `docs(spec-020): document v0.7.0 transcript envvar removal` (README/TESTING/CHANGELOG/spec/plan pointers)

## Verification

`npm test` 0 fail (382 → 382 유지). v0.7.0 릴리스(버전 sync + 태그 + GitHub Release, pre-release 검토)는 별도 finalize 단계.
