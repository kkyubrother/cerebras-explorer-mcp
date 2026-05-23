# Implementation Plan: Symbol Precision Extension — Edge Case Baselines

**Branch**: `master` (직접 작업, 솔로 유지보수) | **Date**: 2026-05-23 | **Spec**: `specs/012-symbol-precision-extension/spec.md`

**Input**: Feature specification from `specs/012-symbol-precision-extension/spec.md`

## Summary

spec 008(`symbol-precision-baseline`)이 Edge Cases 섹션에서 명시적으로 미래 작업으로 분리한 5개 영역(공백 멤버 호출, 다중 패턴 라인, JSX, 데코레이터, 동적 임포트)에 대한 현재 분류기 출력을 단위 테스트로 굳힌다. 사전 측정에서 일부 분류는 의미상 부정확(예: `session . touch ( );` → `call`)하지만 본 spec은 **현재 동작을 baseline으로 굳히는 것**이 목적이며 분류기 의미 정밀도 개선은 별도 후속 spec의 대상이다.

기술적 접근은 spec 008의 패턴을 그대로 계승한다. (1) 기존 `classifyReference distinguishes member, call, constructor, and type relations` 테스트 바로 아래에 동일한 스타일(`assert.deepEqual`)의 신규 테스트를 한 개 추가해 User Story 1의 8개 acceptance scenario를 한 번에 굳힌다. (2) `DESIGN.md`의 parser-free 경계 단락 끝에 5개 영역 각각의 현재 처리/한계를 명시한 단락을 덧붙인다. (3) `plan/extension-backlog.md` §4 항목 옆에 본 spec으로 진행 중임을 한 줄로 표시한다. `src/explorer/symbols.mjs`는 본 작업에서 수정하지 않는다.

## Technical Context

**Language/Version**: Node.js (ES modules, `.mjs`), 저장소 기본 런타임을 따른다.

**Primary Dependencies**: 추가 의존성 없음. `node:test`, `node:assert/strict`만 사용.

**Storage**: N/A (테스트 + 문서)

**Testing**: `node --test tests/symbols.test.mjs` (단독 실행), 또는 `node --test tests/symbols.test.mjs --test-name-pattern "edge case"`.

**Target Platform**: Node.js 런타임 (저장소 CI 매트릭스 기본값).

**Project Type**: MCP 서버 라이브러리 + 검증 테스트. 본 작업은 테스트 + 문서 변경에 한정.

**Performance Goals**: 신규 테스트는 ms 단위로 완료되어야 한다. 정규식 8건 평가만 수행하므로 별도 목표 없음.

**Constraints**: 신규 분류 카테고리 추가 금지 (spec 008 FR-004 정책 계승). `classifyReference` 반환 형태(`{ type, relation }`)와 legacy `categorizeReference`(`definition|import|usage`) 반환값 계약 불변. `src/explorer/symbols.mjs` 수정 금지.

**Scale/Scope**: `tests/symbols.test.mjs` 신규 테스트 1개(8 assertions), `DESIGN.md` 단락 1개 추가, `plan/extension-backlog.md` §4에 진행 표시 1줄.

## Constitution Check

본 저장소는 별도 constitution을 두지 않으므로 spec의 FR/SC와 spec 008의 정책을 게이트로 적용한다.

- **FR-001 / FR-002 게이트**: 신규 테스트 1개를 spec 008 테스트 바로 아래에 둔다.
- **FR-003 게이트**: `src/explorer/symbols.mjs` 수정 금지. 측정한 현재 분류 결과가 기대 라벨이다.
- **FR-004 게이트**: 분류 카테고리 집합(`call|member_call|constructor|type_reference|property|reference|export|import|type_import|definition`)을 늘리지 않는다.
- **FR-005 게이트**: `DESIGN.md` 갱신은 기존 parser-free 경계 단락 의미를 보존하면서 추가 정보만 덧붙인다.
- **FR-006 / FR-007 게이트**: `npm test` 전체 PASS, spec 008의 기존 테스트 영향 없음.
- **FR-008 게이트**: `plan/extension-backlog.md` §4에 spec 012 진행 표시 한 줄 추가.
- **범위 게이트**: 분류기 의미 정밀도 개선은 본 작업 범위 밖.

게이트 평가 결과: 위반 없음.

## Project Structure

### Documentation (this feature)

```text
specs/012-symbol-precision-extension/
├── spec.md              # 본 feature의 요구사항/시나리오
├── plan.md              # 본 문서
└── tasks.md             # 작업 단계 (`/tasks` 생성)
```

### Source Code (repository root)

```text
tests/symbols.test.mjs    # 신규 단위 테스트 추가 위치
DESIGN.md                 # parser-free 경계 단락 갱신
plan/extension-backlog.md # §4 진행 표시
src/explorer/symbols.mjs  # 본 spec에서는 수정하지 않음 (분류기 의미 개선은 후속 spec)
```

**Structure Decision**: 단일 프로젝트. 신규 디렉터리/모듈 없음.

## Implementation Outline

(a) **사전 측정 확인**: 본 spec 작성 시점에 측정한 8개 acceptance scenario의 분류 결과를 한 번 더 재현해 spec.md의 기대 라벨과 정확히 일치하는지 검증한다 (코드 변경 없음, 단순 측정 한 번).

(b) **신규 테스트 추가**: `tests/symbols.test.mjs`의 `classifyReference distinguishes member, call, constructor, and type relations` 테스트 바로 아래에 `classifyReference baselines edge case patterns for spaced member calls, multi-pattern lines, JSX, decorators, and dynamic imports` 테스트를 추가한다. 8개 `assert.deepEqual` 호출.

(c) **DESIGN.md 단락 추가**: 기존 parser-free 경계 단락 바로 뒤에 5개 영역의 현재 처리/한계를 한 단락(최대 ~150 단어)으로 명시한다. 각 영역은 한 문장씩.

(d) **backlog 표시**: `plan/extension-backlog.md` §4의 우선순위 부근에 "→ spec 012로 진행 중" (작업 후 "완료")를 짧게 추가.

(e) **검증**: `node --test tests/symbols.test.mjs` 전체 PASS, 이어서 `npm test` 전체 PASS. spec 008 기존 테스트가 그대로 PASS함도 확인.

(f) **커밋**: 단일 커밋. 메시지: `test(spec-012): baseline edge case classifier behavior for parser-free symbols`.

## Complexity Tracking

본 작업은 spec 008과 동일하게 테스트 + 문서 변경에 한정되어 추가 복잡도가 없다. Complexity Tracking 표는 비워 둔다.
