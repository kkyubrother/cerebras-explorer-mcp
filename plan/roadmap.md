# Active Roadmap

Last updated: 2026-04-08

이 문서는 앞으로 구현하거나 정리해야 할 항목만 남깁니다.
초기 Phase 1-5 계획의 대부분은 이미 구현되었고, 완료된 구현 기록은 더 이상 이 폴더에서 추적하지 않습니다.

## Current Status

- 원래 계획했던 핵심 기능은 대부분 반영됨
- 현재 남은 일은 일부 동작 불일치, 문서/스키마 정리, 선택적 후속 개선에 집중됨
- 구현 상세는 메인 [README](../README.md), `src/`, `tests/`를 기준으로 본다

## Active Backlog

### P1. Session exhaustion enforcement

현재 `SessionStore.isExhausted()`는 존재하지만 런타임 탐색 경로에서 실제로 사용되지 않는다.

- `session` 재사용 시 maxCalls 초과 여부를 실제로 검사
- 허용 동작을 결정
- 후보:
  - 명확한 에러와 함께 재사용 거부
  - 새 세션으로 자동 회전
- 관련 테스트를 런타임 경로 기준으로 보강

## P2. `repo_symbol_context.depth` 정합성

현재 API는 `depth`를 받지만 실질적으로 다단계 호출 체인 확장을 수행하지 않는다.

- 둘 중 하나를 선택
- `depth > 1`을 실제 구현
- 또는 파라미터/문서를 `depth = 1` 수준으로 축소
- 공개 인터페이스와 실제 동작이 어긋나지 않도록 정리

## P2. `find_similar_code` structured similarity

문서상 예시에는 구조화된 `similarity` 수치가 있으나 현재 구현은 자연어 설명 중심이다.

- 둘 중 하나를 선택
- 수치형 `similarity` 필드를 실제 반환
- 또는 관련 기대치를 문서에서 제거
- 유지한다면 재현 가능한 계산 기준을 먼저 정해야 함

## P3. Project config field cleanup

설정 파일의 일부 필드는 문서/정규화 코드에는 존재하지만 실제 기능으로 소비되지 않는다.

- 대상 필드:
- `languages`
- `customSymbolPatterns`
- `entryPoints`
- 둘 중 하나를 선택
- 실제 기능으로 연결
- 또는 설정 문서와 주석에서 제거

## P1. Explorer Mode — 자유형 탐색 도구

Claude Code의 Explore 에이전트와 유사한 자유형 탐색 기능을 새 MCP 도구 `explore`로 추가.

- 기존 `explore_repo`의 구조화된 JSON 출력과 별도로, 자연어 프롬프트 → 자연어 리포트 방식
- thoroughness (quick/medium/thorough) 기반 탐색 깊이 제어
- 전략 미지정, 자유로운 도구 조합, 병렬 도구 실행
- 상세 기획: [explorer-mode.md](explorer-mode.md)

## P3. Public docs polish

별도 phase로 관리할 정도는 아니지만, 공개 문서는 한 번 더 정리할 가치가 있다.

- README의 출력 스키마 설명을 현재 반환 필드 기준으로 유지
- 특화 도구 예시와 설정 파일 예시가 실제 동작과 어긋나지 않는지 확인

## Constraints

- zero dependencies 원칙 유지
- Node 18.17+ 유지
- read-only 원칙 유지
- `explore_repo` 입출력 스키마는 additive change 중심으로 유지

## Not Tracked Here

- 초기 Foundation / Intelligence / Output Quality / Scalability / DX 계획은 완료됨
- 완료된 구현 기록은 이 폴더에 다시 복원하지 않음
- 필요 시 코드와 테스트를 기준으로 현재 상태를 재확인
