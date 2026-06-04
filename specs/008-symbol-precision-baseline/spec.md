# Feature Specification: Symbol Precision Baseline Coverage

**Feature Branch**: `008-symbol-precision-baseline`

**Created**: 2026-05-21

**Status**: Implemented

**Input**: User description: "Task 8 (Add Symbol Precision Baseline Coverage). src/explorer/symbols.mjs의 분류 로직은 이미 구현됨. 남은 작업은 (a) 4개 parser-free relation case(session.touch() member_call, (req: Request) type_reference 등)를 명시적 단위 테스트로 굳히고 (b) DESIGN.md에 parser-free 경계 문서 추가. 원본 plan: docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md Task 8. 카테고리: P3, long-term baseline."

> 범위 메모: 본 스펙은 원본 plan Task 8의 의미를 그대로 따르되, 사전 검증 결과 `src/explorer/symbols.mjs:379-410`의 `relationForUsage()`와 `classifyReference()`가 이미 plan Step 3의 패치와 동등한 분류 (`constructor` → `call` → `member_call` ordered checks, `type_reference`, `export`, `property`, `reference`)를 구현하고 있다. 따라서 본 스펙의 실제 작업 범위는 **분류기 신규 구현이 아니라 이미 구현된 분류 결과를 회귀 테스트로 고정하고, parser-free 경계를 문서에 명시하는 것**으로 좁혀진다. 원본 plan Task 8의 Step 3 (분류기 패치) 는 조건부 가드일 뿐 실제 수정으로 이어지지 않을 가능성이 높다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 분류기 회귀 베이스라인 확정 (Priority: P1)

부모 에이전트와 향후 기여자는 `repo_references`, `repo_symbol_context`가 돌려주는 `relation` 필드에 의존해 후속 편집 위치를 정한다. 현재 `classifyReference()`는 `member_call`, `constructor`, `type_reference`, `call`을 모두 분류해 주지만, 이 동작이 단위 테스트로 고정되어 있지 않아 향후 정규식이나 ordered-checks 순서가 우발적으로 깨져도 알아채기 어렵다. 본 스토리는 plan이 명시한 4가지 대표 케이스를 회귀 테스트로 굳혀, parser-free 분류 결과의 의미 계약을 코드 변경으로부터 보호한다.

**Why this priority**: plan은 본 작업을 "long-term quality baseline, P0/P1 차단 불가"로 명시했지만, 이 스펙 내부에서는 단위 테스트 확정이 다른 작업의 전제이므로 P1로 둔다. 테스트가 없으면 경계 문서가 보장하는 분류 카테고리가 코드 회귀로 조용히 무효화될 수 있다.

**Independent Test**: `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference"` 만 단독 실행해도 4개 케이스의 분류 결과를 검증할 수 있다.

**Acceptance Scenarios**:

1. **Given** `classifyReference('session.touch();', 'touch', 'session.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'member_call' }` 이다.
2. **Given** `classifyReference('const manager = new SessionManager();', 'SessionManager', 'session.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'constructor' }` 이다.
3. **Given** `classifyReference('type Handler = (req: Request) => Response;', 'Request', 'types.ts')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'type_reference' }` 이다.
4. **Given** `classifyReference('return requireAuth(req, res, next);', 'requireAuth', 'routes.js')` 호출, **When** 테스트를 실행, **Then** 결과는 `{ type: 'usage', relation: 'call' }` 이다.

---

### User Story 2 - parser-free 경계 문서화 (Priority: P2)

부모 에이전트는 `repo_references` 결과의 `relation`이 LSP 수준의 완전성을 보장한다고 오해할 수 있다. 본 스토리는 `DESIGN.md`에 parser-free 분류의 의도와 한계를 명시해, 분류 결과를 "타겟 맵"으로만 사용하고 라인 범위를 별도 검증하도록 유도한다.

**Why this priority**: 테스트(스토리 1)가 코드 회귀를 막는 반면, 문서(스토리 2)는 호출자 오용을 막는다. 문서는 사용자 행동을 바꾸지만 실패 시 조용한 오해로 이어지므로 P2로 둔다.

**Independent Test**: `DESIGN.md`의 symbol/reference 디자인 섹션 부근에 parser-free 경계 단락이 포함되어 있고, 본문이 `call`, `member_call`, `constructor`, `type_reference`, `import`, `export` 카테고리와 LSP 비완전성 단서, 라인 범위 검증 권고를 모두 언급하는지 사람 리뷰 또는 단순 `Grep` 검증으로 확인한다.

**Acceptance Scenarios**:

1. **Given** 새 기여자가 `DESIGN.md`만 읽는 상황, **When** symbol/reference 섹션에서 분류 결과의 신뢰 한계를 찾으려 함, **Then** parser-free 경계 단락이 존재하고 LSP 비완전성과 라인 범위 검증 요구가 명시되어 있다.
2. **Given** `repo_references`가 `relation: 'call'`을 돌려주는 상황, **When** 부모 에이전트가 편집을 결정하기 전에 `DESIGN.md` 가이드를 따름, **Then** 가이드는 라인 범위를 별도 검증하라고 안내한다.

---

### User Story 3 - 분류기 갭 발견 시 보정 (Priority: P3)

스토리 1의 새 테스트가 실패하는 경우, 원본 plan Step 3에 명시된 ordered-checks 패치를 `relationForUsage()`에 적용해 갭을 메운다. 사전 검증 시점에는 4개 케이스가 모두 통과할 것으로 예상되지만, 향후 분류기 리팩터에 의한 회귀를 대비한 안전망이다.

**Why this priority**: 현재 분류기는 이미 패치와 동등하므로 실제 발동 가능성이 낮다. 다만 회귀 시 행동 기준을 미리 정의해 두지 않으면 분류 카테고리 자체가 변경될 위험이 있어 P3 안전망으로 명시한다.

**Independent Test**: 의도적으로 분류기에서 `member_call` 검사를 제거해 한 케이스가 FAIL하도록 한 뒤, plan Step 3의 패치를 적용했을 때 단일 테스트가 다시 PASS하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 스토리 1의 4 케이스 중 하나가 FAIL, **When** plan Step 3의 ordered-checks 패치를 `relationForUsage()`에 적용, **Then** 해당 케이스가 PASS하고 `categorizeReference()`의 legacy `definition|import|usage` 반환값은 변하지 않는다.
2. **Given** 분류기를 패치해야 하는 상황, **When** 변경 범위를 결정함, **Then** `classifyReference().relation`에만 정밀도를 추가하고 legacy type 계약은 유지된다.

---

### Edge Cases

- `session . touch ( )` 같이 공백이 섞인 멤버 호출은 본 베이스라인의 회귀 범위에 들지 않는다. 본 스펙은 plan이 명시한 4 케이스의 정확한 문자열 형태만을 분류 회귀의 책임 경계로 둔다.
- 동일 라인에 `new Foo()` 와 `foo()` 가 함께 나오는 경우 ordered checks 순서에 따라 `constructor`가 우선한다. 본 스펙은 단일 케이스만 검증하므로 다중 패턴 라인은 별도 후속 작업의 대상이다.
- 분류기가 추후 정규식 기반에서 토크나이저 기반으로 교체될 경우, 본 베이스라인 테스트는 그대로 PASS해야 한다. 분류 결과의 형태(`{ type, relation }`)와 4 케이스의 분류 라벨이 외부 계약이다.
- JSX, 데코레이터, 동적 임포트 등 본 4 케이스를 벗어나는 형태는 LSP 비완전성 단서가 적용되는 영역으로, 본 스펙의 acceptance에는 포함하지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tests/symbols.test.mjs`는 `classifyReference distinguishes member, call, constructor, and type relations` 라는 이름의 단위 테스트를 포함해야 하며, plan Task 8 Step 1의 4 케이스를 동일한 입력 인자와 동일한 기대 결과로 검증해야 한다.
- **FR-002**: 단위 테스트는 기존 `classifyReference adds relation details without changing legacy type` 테스트 근처에 추가되어, 분류기의 동일 책임 단면을 한 곳에 묶어 유지해야 한다.
- **FR-003**: `src/explorer/symbols.mjs`의 `categorizeReference()`는 본 작업 범위에서 legacy 반환값 (`definition|import|usage`) 계약을 변경하지 않아야 한다.
- **FR-004**: 정밀 분류는 `classifyReference()`의 `relation` 필드로만 표현되어야 하며, 본 작업에서 신규 분류 카테고리는 추가하지 않는다.
- **FR-005**: 만약 새 테스트가 FAIL하는 경우, `relationForUsage()`의 ordered checks 는 `constructor` → `member_call` → `call` 순으로 유지되어야 하고 `type_reference` 분기는 별도 검사로 남아야 한다.
- **FR-006**: `DESIGN.md`는 symbol/reference 디자인 섹션 부근에 parser-free 경계 단락을 포함해야 한다. 본문은 (a) `repo_references`와 `repo_symbol_context`가 분류하는 카테고리 목록(`call`, `member_call`, `constructor`, `type_reference`, `import`, `export`), (b) LSP 수준 완전성을 주장하지 않는다는 단서, (c) 신뢰가 중요할 때는 호출자가 라인 범위를 별도 검증해야 한다는 권고를 모두 명시해야 한다.
- **FR-007**: `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference"` 가 0 failures 로 종료해야 한다.
- **FR-008**: `node --test tests/symbols.test.mjs` 전체 실행이 0 failures 로 종료해야 한다.
- **FR-009**: 본 작업의 커밋은 `tests/symbols.test.mjs`, `src/explorer/symbols.mjs` (변경된 경우에 한해), `DESIGN.md` 만 포함해야 하며, 다른 파일 변경을 함께 묶지 않는다.

### Key Entities *(include if feature involves data)*

- **classifyReference 반환값**: `{ type: 'definition' | 'import' | 'usage', relation: 'export' | 'import' | 'constructor' | 'member_call' | 'call' | 'type_reference' | 'property' | 'reference' | 'definition' }` 형태. 본 베이스라인은 4 케이스에 대한 `type`/`relation` 쌍을 외부 계약으로 고정한다.
- **parser-free 경계 단락**: `DESIGN.md` 안의 문서 엔티티. 분류 카테고리 목록, LSP 비완전성 단서, 라인 범위 검증 권고의 세 요소를 모두 가진다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `node --test tests/symbols.test.mjs` 가 본 작업 후 0 failures 로 종료한다.
- **SC-002**: `tests/symbols.test.mjs` 의 `classifyReference` 패턴 테스트 수가 본 작업 전 대비 정확히 1개 증가하고, 새 테스트는 4 케이스를 모두 `assert.deepEqual` 로 검증한다.
- **SC-003**: `DESIGN.md` 의 symbol/reference 디자인 섹션을 처음 읽는 기여자가, 별도 코드를 읽지 않고도 `repo_references`의 `relation` 분류 카테고리 6개와 라인 범위 재검증 권고를 모두 파악할 수 있다.
- **SC-004**: 본 작업 커밋 이후 임의의 향후 분류기 회귀 (예: `member_call` 검사 제거) 가 PR 단계에서 즉시 단위 테스트 FAIL로 포착된다.
- **SC-005**: 본 작업은 P0/P1 작업 (Task 1~7) 의 실행 일정을 차단하지 않는다.

## Assumptions

- 사전 검증 결과대로 `src/explorer/symbols.mjs:379-410` 의 `relationForUsage()` 와 `classifyReference()` 가 plan Step 3 패치와 동등한 분류를 이미 제공하므로, 본 작업의 분류기 코드 변경은 기본적으로 발생하지 않는다. 발생할 경우 User Story 3 시나리오로 처리한다.
- 기존 `tests/symbols.test.mjs:240-257` 와 `:340` 부근의 분류 테스트들은 본 작업의 신규 테스트와 공존하며, 본 작업은 기존 테스트를 삭제하거나 의미를 바꾸지 않는다.
- `DESIGN.md` 에는 이미 symbol/reference 관련 섹션이 존재하며, parser-free 경계 단락은 해당 섹션 근처에 자연스럽게 삽입될 수 있다. 해당 섹션이 비어 있다면 단락 단독으로도 의미가 성립하도록 작성한다.
- 본 작업은 plan의 Task 9 (문서/검증 마감) 와 별도 커밋으로 진행되며, Task 9의 전체 `npm test` 검증 단계가 본 베이스라인을 다시 확인하는 회귀 게이트 역할을 한다.
- 본 작업의 우선순위는 plan의 Execution Order 항목 6에 따라 long-term baseline 으로 유지되며, P0/P1 작업과 병렬로 진행 가능하다.
