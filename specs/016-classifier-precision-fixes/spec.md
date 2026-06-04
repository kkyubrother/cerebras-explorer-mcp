# Feature Specification: parser-free 분류기 의미 정밀도 개선 (spec 012 baseline 일부 교체)

**Feature Branch**: `016-classifier-precision-fixes`

**Created**: 2026-05-24

**Status**: Implemented

**Input**: User description: "spec 012에서 baseline으로 굳혀둔 5개 edge case 중 의미상 부정확한 3개 분류를 패치한다. 신규 분류 카테고리는 추가하지 않으며 기존 `{ type, relation }` 형식 안에서만 분류 결과를 더 정확하게 만든다. spec 012의 단위 테스트는 명시적으로 새 결과로 갱신해 새 baseline을 다시 굳힌다. spec 008의 4 baseline 케이스는 그대로 유지한다."

## Clarifications

### Session 2026-05-24

- **Q: 어떤 false positive를 패치할지** → **A: 3개 — (A1) 공백 멤버 호출, (B2) 다중 패턴 라인의 type_reference 오분류, (C1-3) `.tsx`에서 JSX 태그의 type_reference 오분류.** A3/D1/D2/D3/E1/C4는 현재 분류가 의미상 acceptable하므로 변경하지 않는다.
- **Q: 새 분류 카테고리 추가 여부** → **A: 추가 안 함.** spec 008 FR-004 정책 계승. 모든 변경은 기존 카테고리(`call`, `member_call`, `constructor`, `type_reference`, `import`, `export`, `property`, `reference`) 안에서.
- **Q: spec 012 baseline 처리** → **A: 명시적으로 새 결과로 갱신.** spec 012의 단위 테스트가 새 분류 결과를 PASS하도록 변경하고, comment에 "spec 016이 의미 정밀도를 개선했음"을 명시한다. spec 008의 4 baseline 케이스는 그대로 유지.
- **Q: 회귀 안전성** → **A: spec 008의 4 baseline 케이스가 그대로 PASS해야 한다.** 별도 회귀 가드 + 전체 `npm test` 0 failures.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 공백 멤버 호출이 `member_call`로 정확히 분류 (Priority: P1)

`session . touch ( );` 같이 점과 심볼 사이 공백이 있는 멤버 호출을 분류기가 의미상 정확한 `member_call`로 분류해야 한다. 현재(spec 012 baseline)는 `call`로 분류되어 parent agent가 "전역 함수 호출"로 오해할 수 있다.

**Why this priority**: 가장 단순한 정밀도 향상이고 자주 발생하는 false positive(특히 코드 포매팅이 일관되지 않은 저장소). P1.

**Independent Test**: `classifyReference('session . touch ( );', 'touch', 'session.ts')`이 `{ type: 'usage', relation: 'member_call' }`을 반환한다. 같은 함수의 spec 008 case 1 `classifyReference('session.touch();', 'touch', 'session.ts')`도 그대로 `member_call`을 반환한다.

**Acceptance Scenarios**:

1. **Given** `classifyReference('session . touch ( );', 'touch', 'session.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'member_call' }`.
2. **Given** spec 008 case 1 `classifyReference('session.touch();', 'touch', 'session.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'member_call' }` (변경 없음 회귀 가드).
3. **Given** spec 008 case 4 `classifyReference('return requireAuth(req, res, next);', 'requireAuth', 'routes.js')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'call' }` (변경 없음 회귀 가드 — 공백 패치가 일반 call을 member_call로 잘못 분류하지 않음).

---

### User Story 2 - 다중 패턴 라인의 두 번째 심볼이 `call`로 정확히 분류 (Priority: P1)

`const arr = [new Foo(), foo()];` 같이 한 라인에 `new Foo()`와 `foo()`가 함께 나오는 경우, 두 번째 심볼 `foo`가 현재(spec 012 baseline)는 type_reference로 false positive 분류된다. 의미상은 함수 호출(`call`)이 정확하다.

**Why this priority**: 분류기 오분류가 코드 리뷰/리팩터링 시 잘못된 가정으로 이어질 수 있어 P1.

**Independent Test**: `classifyReference('const arr = [new Foo(), foo()];', 'foo', 'app.ts')`이 `{ type: 'usage', relation: 'call' }`을 반환. 같은 함수의 첫 심볼 `Foo`는 그대로 `constructor`를 반환.

**Acceptance Scenarios**:

1. **Given** `classifyReference('const arr = [new Foo(), foo()];', 'foo', 'app.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'call' }`.
2. **Given** 같은 라인 `classifyReference(..., 'Foo', 'app.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'constructor' }` (변경 없음).
3. **Given** spec 008 case 3 `classifyReference('type Handler = (req: Request) => Response;', 'Request', 'types.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'type_reference' }` (변경 없음 회귀 가드 — type_reference 패치가 진정한 type reference를 깨뜨리지 않음).

---

### User Story 3 - `.tsx` 파일의 JSX 태그가 `reference`로 정확히 분류 (Priority: P2)

`.tsx` 파일에서 `return <MyComponent />;` 같은 JSX 태그가 현재(spec 012 baseline)는 type_reference로 false positive 분류된다. JSX 컴포넌트는 type reference가 아니라 컴포넌트 참조이므로 의미상 `reference`가 적절하다 (별도 `jsx_element` 카테고리는 spec 008 FR-004로 금지).

**Why this priority**: JSX 사용 저장소에서 자주 등장하지만, JSX 자체가 framework-specific하므로 P2.

**Independent Test**: `.tsx` 파일에서 `<MyComponent />`와 `<MyComponent foo="bar" />` 같은 JSX 태그가 `reference`로 분류되고, TypeScript generic `Array<MyType>` 같은 진정한 type reference는 여전히 `type_reference`로 분류된다.

**Acceptance Scenarios**:

1. **Given** `classifyReference('return <MyComponent />;', 'MyComponent', 'view.tsx')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'reference' }`.
2. **Given** `classifyReference('return <MyComponent foo="bar" />;', 'MyComponent', 'view.tsx')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'reference' }`.
3. **Given** `classifyReference('const items: Array<MyType> = [];', 'MyType', 'types.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'type_reference' }` (변경 없음 — 진정한 generic은 그대로 type_reference).
4. **Given** spec 008 case 3 `classifyReference('type Handler = (req: Request) => Response;', 'Request', 'types.ts')` 호출, **When** 결과 확인, **Then** `{ type: 'usage', relation: 'type_reference' }` (변경 없음 회귀 가드).
5. **Given** `.jsx` 파일에서 `<MyComponent />` (spec 012 case C4), **When** 결과 확인, **Then** `{ type: 'usage', relation: 'reference' }` (변경 없음 — `.jsx`는 type_reference 분기를 안 타므로 이미 `reference`).

---

### Edge Cases

- A1 패치가 일반 함수 호출 `foo()`을 member_call로 잘못 분류하면 안 된다 — 공백 + 점이 있는 경우에만 member_call로 가야 한다. spec 008 case 4가 회귀 가드.
- B2 패치가 진정한 type reference (`type X = Y` 안의 `Y`)를 깨면 안 된다. spec 008 case 3이 회귀 가드.
- C 패치가 TypeScript의 옛 type cast syntax `(<MyType>x)`를 JSX로 잘못 분류할 가능성 — `.tsx` 파일에서만 JSX 검출 분기를 타고, JSX 형식(`<Name` 다음 attribute 또는 `/>` 또는 `>`)을 더 엄격히 확인해 false positive를 줄인다.
- TypeScript 클래스 메서드 시그니처 `someMethod<T extends X>(arg: T)` 안의 `T` 같은 케이스는 본 spec 범위 밖이다. spec 012/008 baseline 그대로.
- 새로운 false positive를 발견하면 별도 spec에서 다룬다. 본 spec은 3개 케이스에만 집중.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `src/explorer/symbols.mjs`의 `relationForUsage()`에 spaced-member-call 검출을 추가한다. 정규식 `\\.\\s*${escaped}\\s*\\(`가 매치하면 `member_call` 반환. 이 분기는 기존 `call` 분기 *위에* 배치되어 공백 멤버 호출이 일반 call로 잘못 떨어지지 않게 한다.
- **FR-002**: 기존 `member_call` 분기 (`\\.${escaped}\\s*\\(`)는 위의 공백 허용 분기에 흡수되므로 제거된다. spec 008 case 1 (`session.touch();`)은 새 분기에서도 그대로 매치된다.
- **FR-003**: `relationForUsage()`의 `type_reference` 분기에 negative lookahead를 추가한다. 현재 정규식 `(?:[:<|&,]|...)\\s*[^=;(){}]*\\b${escaped}\\b`에 `\\s*(?!\\()` lookahead를 끝에 더해, 심볼 직후가 `(` (함수 호출)이면 type_reference로 분류하지 않는다.
- **FR-004**: `classifyReference()`의 `usage` 분기에 JSX 검출을 type_reference 분기 *앞에* 추가한다. 파일 확장자가 `.tsx` 또는 `.jsx`이고 `(?:^|\\s|[(,{=>])\\s*<\\s*${escaped}\\s*(?:\\s+\\w+\\s*=|\\s*/?\\s*>)` 패턴이 매치하면 `reference` 반환. 닫는 태그 `</${escaped}>`도 같은 분기로 처리.
- **FR-005**: JSX 검출 분기는 type_reference 분기보다 우선하지만, isImportLine/isDefinitionLine보다는 뒤에 위치한다 (definition/import는 먼저 검사).
- **FR-006**: 신규 분류 카테고리는 추가하지 않는다 (spec 008 FR-004 정책 계승).
- **FR-007**: spec 008의 4 baseline 단위 테스트(`tests/symbols.test.mjs`의 `classifyReference distinguishes member, call, constructor, and type relations`)는 본 spec 변경 이후에도 0 failures로 PASS해야 한다.
- **FR-008**: spec 012의 baseline 단위 테스트(`classifyReference baselines edge case patterns ...`)는 본 spec의 패치 결과로 명시적으로 갱신된다. 변경 라인:
  - A1: `'call'` → `'member_call'`
  - B2: `'type_reference'` → `'call'`
  - C1: `'type_reference'` → `'reference'`
  - C2: `'type_reference'` → `'reference'`
  - C3: `'type_reference'` → `'reference'`
  - C4: 변경 없음 (`'reference'`)
  - D1/D2/D3/E1: 변경 없음
- **FR-009**: `tests/symbols.test.mjs`에 새 회귀 가드 단위 테스트를 추가한다 (User Story 3 case 3): TypeScript generic `Array<MyType>`은 그대로 `type_reference`로 분류됨.
- **FR-010**: `DESIGN.md`의 parser-free 경계 단락 (spec 012가 추가한 "분류기 한계" sub-section)을 새 baseline에 맞춰 갱신한다. A1/B2/C1-3의 "현재 분류 결과" 라인을 새 결과로 바꾸고, 변경 사유로 spec 016을 한 줄 명시한다.
- **FR-011**: `npm test` 전체가 0 failures로 종료한다.

### Key Entities

- **공백 허용 member_call 정규식**: `\\.\\s*${escaped}\\s*\\(`. 기존 정규식의 공백 한 글자 차이.
- **type_reference의 함수 호출 lookahead**: 끝에 `\\s*(?!\\()` 추가.
- **JSX 검출 정규식**: `.tsx`/`.jsx` 파일 한정. open tag `(?:^|\\s|[(,{=>])\\s*<\\s*${escaped}\\s*(?:\\s+\\w+\\s*=|\\s*/?\\s*>)` + close tag `</\\s*${escaped}\\s*>`.

## Success Criteria *(mandatory)*

- **SC-001**: `npm test` 전체 0 failures.
- **SC-002**: spec 008의 4 baseline 단위 테스트가 그대로 PASS.
- **SC-003**: spec 012의 baseline 단위 테스트가 새 결과로 PASS (분류 라벨이 FR-008대로 갱신됨).
- **SC-004**: 신규 회귀 가드 (TypeScript generic이 그대로 type_reference로 분류됨)가 PASS.
- **SC-005**: `DESIGN.md`의 분류기 한계 단락이 새 baseline을 반영함을 grep으로 확인.

## Assumptions

- 본 spec은 backwards-incompatible **공개 API 측면에서는 변경 없음**이다 (분류기는 외부 직접 호출 surface가 아니라 `repo_references`/`repo_symbol_context`의 `relation` 필드 내부 로직). 단, `relation` 값에 의존하는 parent agent가 `'type_reference'`로 가정하던 케이스가 `'call'`/`'reference'`로 바뀔 수 있다 — README/DESIGN 안내로 충분.
- 본 spec의 변경이 새 false positive를 만들 가능성은 단위 가드(spec 008 4 케이스 + 신규 generic 회귀)로 차단한다.
- 추가 케이스(예: JSX namespace `<Foo.Bar />`, JSX fragment `<>`, type cast `<MyType>x`)는 본 spec 범위 밖. 후속 spec에서 다룬다.
- 본 작업은 P0/P1 작업을 차단하지 않으며 minor/patch bump는 다음 release에 묶어 처리한다.
