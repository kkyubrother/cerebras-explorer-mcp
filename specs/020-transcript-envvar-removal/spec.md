# Feature Spec: remove legacy transcript envvars (v0.7.0 BREAKING)

**Spec**: 020-transcript-envvar-removal | **Date**: 2026-05-31 | **Status**: implemented

## Summary

spec 018에서 hidden alias로 남겨둔 `CEREBRAS_EXPLORER_TRANSCRIPT` / `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` 환경변수를 완전히 제거한다. transcript 로깅은 `CEREBRAS_EXPLORER_LOG_PATH`(path-implies-opt-in) + `CEREBRAS_EXPLORER_LOG_RAW`로만 제어된다. v0.6.1 CHANGELOG에 예고된 v0.7.0 BREAKING 변경이다.

## Motivation

- spec 018이 `CEREBRAS_EXPLORER_LOG_PATH`를 도입하고 기존 두 envvar를 문서에서 제거(코드만 hidden alias로 수용)했다. v0.6.x deprecation 기간이 끝났다.
- 두 opt-in 경로(legacy enable flag + 별도 dir vs. path-implies-opt-in)가 공존하면 동작 추론이 어렵다. 단일 surface가 "trust = context saving" 원칙에 부합한다.

## User decision (2026-05-31)

- **Q: 제거 후 레거시 envvar가 설정돼 있으면?** → **A: 조용히 무시(silent ignore)**. deprecation 경고 없음. legacy envvar는 no-op.

## Functional Requirements

- **FR-001**: `isTranscriptEnabled()`는 `CEREBRAS_EXPLORER_LOG_PATH`가 설정된 경우에만 `true`. `CEREBRAS_EXPLORER_TRANSCRIPT`는 더 이상 enable 신호가 아니다.
- **FR-002**: `resolveTranscriptDir()`는 `CEREBRAS_EXPLORER_LOG_PATH`만 디렉토리 override로 사용한다. `CEREBRAS_EXPLORER_TRANSCRIPT_DIR`는 무시된다.
- **FR-003**: 레거시 envvar만 설정된 경우 transcript은 비활성(no-op recorder)이며 경고를 출력하지 않는다.
- **FR-004**: README/DESIGN/integrations 문서에 레거시 토큰이 0회 등장한다(기존 가드 유지). CHANGELOG는 v0.6.1 deprecation 안내 + v0.7.0 제거 기록에서만 토큰을 포함한다.
- **FR-005**: `CEREBRAS_EXPLORER_LOG_RAW` 동작은 변경 없음.

## Out of Scope

- 다른 envvar 정리/제거.
- transcript schema/포맷 변경.
- v0.7.0 릴리스 컷(버전 bump/태그) — 별도 release 단계. 본 spec은 구현 + 문서까지.

## Acceptance

- `npm test` 0 fail. 레거시 enable 테스트가 "비활성" 검증으로 뒤집힌다.
- `tests/integrations.test.mjs`의 docs/CHANGELOG 토큰 가드 통과.
