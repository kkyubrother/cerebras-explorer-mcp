# Feature Specification: Symbol Precision Extension — Edge Case Baselines

**Feature Branch**: `012-symbol-precision-extension`

**Created**: 2026-05-23

**Status**: Implemented; later refined by spec 016

**Input**: User description: "spec 008(`symbol-precision-baseline`)의 Edge Cases 섹션이 명시적으로 미래 작업으로 분리한 5개 영역(공백 멤버 호출, 다중 패턴 라인, JSX, 데코레이터, 동적 임포트)에 대해 현재 parser-free 분류기의 동작을 단위 테스트로 굳히고, DESIGN.md의 parser-free 경계 단락에 새 처리 영역과 한계를 명시한다. 원본 plan: `plan/extension-backlog.md` §4 (symbol engine 정밀도 확장). 카테고리: P3, long-term baseline 연장."

> 범위 메모: spec 008은 4개 baseline 케이스를 회귀 가드로 굳혔고, Edge Cases 섹션에서 "공백이 섞인 멤버 호출", "다중 패턴 라인", "JSX/데코레이터/동적 임포트"를 본 베이스라인의 회귀 범위 **밖**으로 명시했다. 본 spec은 그 미래 작업을 한 단계 더 좁힌다. 사전 측정 결과 일부 케이스에서 분류기가 의미상 부정확한 라벨을 반환하지만(예: `session . touch ();` → `call`이 아니라 `member_call`이 의미상 정확) **분류기 의미 정밀도 개선은 본 spec 범위 밖이며 별도 후속 spec의 대상**이다. 본 spec은 현재 분류 결과를 그대로 baseline으로 굳혀, 후속 의미 개선 작업이 의도적인 결정을 거치도록 강제한다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edge case 분류 결과 baseline 확정 (Priority: P1)

기여자와 향후 분류기 변경자는 spec 008이 미래 작업으로 분리한 5개 edge case 영역(공백 멤버 호출, 다중 패턴 라인, JSX, 데코레이터, 동적 임포트)에서 현재 분류기가 어떤 분류 결과를 내는지 명시적으로 알 수 있어야 한다. 그렇지 않으면 정규식 한 줄을 바꾸는 변경이 이 영역에서 조용히 다른 분류를 만들어내도 회귀 가드가 잡지 못한다. 본 스토리는 5개 영역의 현재 분류 결과를 단위 테스트로 굳혀, 정규식 또는 ordered checks 변경이 우발적으로 이 baseline을 깰 때 즉시 실패하도록 한다.

**Why this priority**: spec 008과 동일한 P1 동기. 회귀 가드는 본 작업의 핵심 산출물이며, baseline이 없으면 후속 분류기 개선 spec이 어떤 변화가 일어나는지 측정할 수 없다.

**Independent Test**: `node --test tests/symbols.test.mjs --test-name-pattern "edge case"` (또는 spec 008의 패턴 일관성을 위해 `--test-name-pattern "classifyReference"`)만 단독 실행해도 5개 영역의 분류 결과가 검증된다.

**Acceptance Scenarios**:

1. **Given** `classifyReference('session . touch ( );', 'touch', 'session.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'call' }` 이다 (의미상은 member_call이 정확하지만 현재 분류기는 공백을 처리하지 못해 call로 분류한다는 점이 baseline의 핵심).
2. **Given** `classifyReference('const arr = [new Foo(), foo()];', 'Foo', 'app.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'constructor' }` 이다 (다중 패턴 라인에서 constructor가 우선한다는 spec 008 Edge Cases의 단언을 회귀 가드로 굳힘).
3. **Given** `classifyReference('const arr = [new Foo(), foo()];', 'foo', 'app.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'type_reference' }` 이다 (의미상 부정확하지만 현재 정규식이 `,`를 type_reference 트리거로 잡는 동작을 baseline으로 굳힘).
4. **Given** `classifyReference('return <MyComponent />;', 'MyComponent', 'view.tsx')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'type_reference' }` 이다 (TypeScript에서 JSX 태그가 현재 type_reference로 분류되는 false positive를 baseline으로 굳힘).
5. **Given** `classifyReference('return <MyComponent />;', 'MyComponent', 'view.jsx')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'reference' }` 이다 (`.jsx` 확장자에서는 type_reference 분기가 적용되지 않아 reference로 떨어진다는 동작 baseline).
6. **Given** `classifyReference('@Injectable()', 'Injectable', 'service.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'call' }` 이다 (데코레이터 별도 카테고리 없이 call로 분류되는 동작 baseline).
7. **Given** `classifyReference('@deps.Injectable()', 'Injectable', 'service.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'member_call' }` 이다 (한정자가 붙은 데코레이터는 member_call로 정확히 분류되는 동작).
8. **Given** `classifyReference("const mod = await import('./mod.js');", 'mod', 'app.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'definition', relation: 'definition' }` 이다 (동적 임포트의 좌변 변수가 definition으로 분류됨).

---

### User Story 2 - parser-free 경계 단락에 edge case 처리 명시 (Priority: P2)

`DESIGN.md`의 parser-free 경계 단락은 spec 008에서 추가됐다. 본 스토리는 그 단락에 "공백 멤버 호출 / 다중 패턴 라인 / JSX / 데코레이터 / 동적 임포트에 대해 현재 분류기가 어떤 한계를 가지는지" 한 단락을 덧붙여, 분류기 출력에 의존하는 호출자가 라인 범위를 별도 검증해야 하는 영역을 더 구체적으로 인지할 수 있게 한다.

**Why this priority**: 테스트(스토리 1)는 코드 회귀를 막고, 문서(스토리 2)는 호출자의 오해를 막는다. 문서 부재 시 호출자가 부정확한 분류 라벨을 정확한 것으로 신뢰할 위험은 있지만 즉각적 실패로 이어지지 않으므로 P2.

**Independent Test**: `DESIGN.md`의 parser-free 경계 단락 부근에 본 spec의 5개 영역이 모두 짧게 언급되어 있고, "분류 라벨이 의미와 다를 수 있는 영역이며 호출자는 라인 범위를 별도 검증해야 한다"는 안내가 포함된다. 사람 리뷰 또는 단순 `Grep` 검증으로 확인한다.

**Acceptance Scenarios**:

1. **Given** 새 기여자가 `DESIGN.md`만 읽는 상황, **When** parser-free 경계 단락을 찾음, **Then** "공백 멤버 호출", "다중 패턴 라인", "JSX", "데코레이터", "동적 임포트" 다섯 영역이 모두 명시되어 있고 각 영역에 대해 "현재 분류기 출력이 의미와 다를 수 있다"는 단서가 포함된다.
2. **Given** 부모 에이전트가 `relation: 'type_reference'`를 받았을 때, **When** `DESIGN.md` 가이드를 따름, **Then** TypeScript에서 JSX 태그가 type_reference로 잘못 분류될 수 있다는 사실과 라인 범위 별도 검증 권고가 한 곳에서 확인된다.

---

### Edge Cases

- 공백이 더 다양한 형태로 섞인 멤버 호출(예: `session\n  .touch();` 멀티라인)은 본 spec의 baseline 책임 경계 **밖**이다. 본 spec은 `session . touch ( );` 형태의 단일 라인 공백 케이스만 굳힌다.
- JSX fragment(`<>...</>`)와 namespace 컴포넌트(`<Foo.Bar />`)는 본 spec의 baseline 책임 경계 **밖**이다. self-closing 태그 한 형태만 굳힌다.
- 비-TypeScript/비-JavaScript 언어(Python, Go 등)의 edge case는 본 spec 범위가 아니다. 본 spec은 `.ts` / `.tsx` / `.jsx` 확장자에 한정.
- 분류기가 추후 토크나이저/AST 기반으로 교체될 경우 본 baseline의 일부 테스트는 의도적으로 FAIL할 수 있다 (예: JSX type_reference false positive가 정확한 `jsx_element`로 바뀌는 경우). 그런 변경은 본 spec의 baseline을 명시적으로 갱신하는 후속 spec에서 처리한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tests/symbols.test.mjs`는 `classifyReference recognizes edge case patterns for spaced member calls, multi-pattern lines, JSX, decorators, and dynamic imports` 또는 의미가 동등한 이름의 단위 테스트를 포함해야 하며, User Story 1 Acceptance Scenarios 8건을 동일한 입력 인자와 동일한 기대 결과로 검증해야 한다.
- **FR-002**: 신규 테스트는 spec 008이 추가한 `classifyReference distinguishes member, call, constructor, and type relations` 테스트 근처에 위치해 분류기 회귀 가드를 한 영역에 모은다.
- **FR-003**: `src/explorer/symbols.mjs`는 본 spec 범위에서 수정하지 않는다. 본 spec의 목적은 **현재 분류기 출력**을 굳히는 것이며, 분류기 의미 정밀도 개선은 별도 후속 spec의 대상이다.
- **FR-004**: 신규 분류 카테고리는 추가하지 않는다 (spec 008 FR-004 정책 계승). 본 spec의 baseline은 기존 `{ type, relation }` 형식 안에서 표현되어야 한다.
- **FR-005**: `DESIGN.md`의 parser-free 경계 단락에 본 spec의 5개 영역에 대한 처리/한계 안내를 추가한다. 기존 단락의 의미(분류 카테고리 6개, LSP 비완전성, 라인 범위 별도 검증 권고)는 그대로 유지한다.
- **FR-006**: `node --test tests/symbols.test.mjs` 전체 실행이 0 failures로 종료해야 한다.
- **FR-007**: spec 008의 4 baseline 케이스(`member_call`, `constructor`, `type_reference`, `call`) 단위 테스트는 본 spec의 변경 이후에도 동일한 결과로 PASS 해야 한다 (spec 008 회귀 가드는 본 spec과 독립적으로 유지).
- **FR-008**: `plan/extension-backlog.md` §4 항목 옆에 본 spec(012)으로 진행되었음을 한 줄로 표시한다. backlog 문서를 stale 상태로 두지 않는다.

### Key Entities *(N/A — 본 작업은 데이터 모델을 도입하지 않는다)*

## Success Criteria *(mandatory)*

- **SC-001**: `tests/symbols.test.mjs`의 신규 edge case 테스트가 0 failures로 PASS.
- **SC-002**: spec 008의 기존 분류기 테스트가 본 spec 변경 이후에도 0 failures로 PASS.
- **SC-003**: `npm test` 전체가 0 failures로 종료.
- **SC-004**: `DESIGN.md`의 parser-free 경계 단락에 5개 영역이 모두 언급되었음을 `grep`으로 확인 가능.

## Assumptions

- 분류기 의미 정밀도 개선(예: 공백 멤버 호출을 `member_call`로 정확히 분류, JSX false positive 제거)은 본 spec 범위 **밖**이며, 별도 후속 spec에서 결정한다.
- 본 spec 변경 직전에 측정한 분류기 출력(`session . touch ( );` → `call`, 다중 패턴 라인 foo → `type_reference`, JSX → `type_reference` 등)이 본 spec의 baseline이다. 측정 결과가 다르면 본 spec의 Acceptance Scenarios를 다시 확인한다.
- spec 008의 분류기는 본 spec 변경 시점에 이미 master에 반영되어 있다.
- 본 작업은 P0/P1 작업을 차단하지 않는다 (long-term baseline 연장).
