# Plan

`plan/` 폴더에는 활성 backlog와 과거 계획/감사 스냅샷을 구분해 둡니다.

활성 backlog:

- `extension-backlog.md`: README "다음 확장 포인트" 4개 후보(`map_impact`, `find_entrypoints`, repo-specific ignore, symbol engine 정밀도)의 동작·입력·영향을 풀어쓴 문서. 다음 spec NNN을 끊을 때 입력으로 사용한다.

과거 작업 기록:

- `v0.2.0-release-plan.md`: v0.2.0 릴리스 계획 스냅샷
- `checklist.md`: v0.2.0 단계별 완료 증거
- `legacy-audit.md`: 2026-05-20 기준 legacy/misalignment 감사 스냅샷

과거 문서 안의 테스트 수치와 구현 상태는 당시 증거이며 최신 상태를 의미하지 않습니다.
이미 구현된 내용은 메인 `README.md`, `DESIGN.md`, `src/`, `tests/`를 기준으로 확인합니다.
현재 테스트 상태는 `TESTING.md`를 기준으로 확인합니다.
