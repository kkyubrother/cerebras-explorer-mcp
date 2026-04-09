# Active Roadmap

Last updated: 2026-04-09

이 문서는 앞으로 구현하거나 정리해야 할 항목만 남깁니다.
Phase 1–7 구현은 완료되었고, 완료된 구현 기록은 더 이상 이 폴더에서 추적하지 않습니다.

## Current Status

- Phase 1–7 핵심 기능 모두 구현 완료
- Phase 6: `execFileSync` → async 전환, `explore()` 루프 bounded concurrency(cap 4) 적용
- 구현 상세는 메인 [README](../README.md), `src/`, `tests/`를 기준으로 본다

## Active Backlog

현재 미구현 항목 없음. 아래는 선택적 후속 개선 후보입니다.

### `repo_symbol_context.depth > 1` 실제 구현

현재 `effectiveDepth = 1`로 clamp됨. 진짜 caller graph 탐색은 regex 아키텍처로 어렵고, LSP/tree-sitter 도입 없이는 구현 비용이 큼. 후속 RFC로 분리.

### `find_similar_code` 수치형 similarity score

자연어 설명 중심으로 정착됨. 수치 score 추가는 가짜 precision 위험이 있어 별도 RFC 필요.

### `explore()` loop 추가 최적화

- duplicate file read dedupe (in-flight)
- `Promise.allSettled` 기반 부분 실패 허용 정책 명시
- `freeExplore()`도 parallelToolCalls 활성화 검토

## Constraints

- zero dependencies 원칙 유지
- Node 22+ 유지
- read-only 원칙 유지
- `explore_repo` 입출력 스키마는 additive change 중심으로 유지

## Not Tracked Here

- 초기 Foundation / Intelligence / Output Quality / Scalability / DX 계획은 완료됨
- 완료된 구현 기록은 이 폴더에 다시 복원하지 않음
- 필요 시 코드와 테스트를 기준으로 현재 상태를 재확인
