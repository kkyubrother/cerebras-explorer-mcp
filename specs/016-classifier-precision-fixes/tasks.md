---
description: "Task list for spec 016 — parser-free 분류기 의미 정밀도 개선"
---

# Tasks: parser-free 분류기 의미 정밀도 개선

**Input**: Design documents from `specs/016-classifier-precision-fixes/`

**Tests**: Required. spec 008 4 baseline 유지 + spec 012 baseline 갱신 + 신규 TypeScript generic 회귀 가드.

## Format: `[ID] [P?] [Story] Description`

- US1 = 공백 멤버 호출, US2 = 다중 패턴 라인, US3 = JSX
- 경로는 저장소 루트 기준.

## Phase 1: Setup

- [x] T001 master 작업 트리 깨끗 확인 (`git status` clean). 기존 분류기 단위 테스트가 모두 PASS인지 baseline 확인 (`node --test tests/symbols.test.mjs --test-name-pattern "classifyReference"`).

- [x] T002 사전 측정: spec 016이 패치할 5개 acceptance case의 현재 분류 결과가 spec 016 spec.md User Story 1/2/3의 "패치 *전*" 라벨과 일치하는지 1회 측정 (`node -e "import('./src/explorer/symbols.mjs').then(...)"` 임시 스크립트). 차이가 있으면 spec.md를 다시 확인.

## Phase 2: User Story 1 — 공백 멤버 호출 (P1)

- [x] T003 [US1] `src/explorer/symbols.mjs`의 `relationForUsage()`에서 `constructor` 검사 다음, `call` 검사 위에 spaced-member-call 검사 추가:
  ```js
  if (new RegExp(`\\.\\s*${escaped}\\s*\\(`).test(trimmed)) {
    return 'member_call';
  }
  ```

- [x] T004 [US1] 기존 `member_call` 검사 (`\\.${escaped}\\s*\\(`)를 제거한다. 위의 공백 허용 분기가 흡수했으므로 중복 제거.

- [x] T005 [US1] `tests/symbols.test.mjs`의 spec 012 baseline 테스트에서 A1 assertion을 갱신:
  - 변경 전: `assert.deepEqual(classifyReference('session . touch ( );', 'touch', 'session.ts'), { type: 'usage', relation: 'call' });`
  - 변경 후: `assert.deepEqual(classifyReference('session . touch ( );', 'touch', 'session.ts'), { type: 'usage', relation: 'member_call' });`

- [x] T006 [US1] `node --test tests/symbols.test.mjs` 실행. spec 008 4 baseline + 갱신된 spec 012 A1이 PASS함을 확인.

## Phase 3: User Story 2 — 다중 패턴 라인 type_reference 패치 (P1)

- [x] T007 [US2] `relationForUsage()`의 `type_reference` 정규식 끝에 `\\s*(?!\\()` lookahead 추가:
  ```js
  if (
    lang === 'typescript' &&
    new RegExp(`(?:[:<|&,]|\\b(?:as|satisfies|implements|extends)\\s+)\\s*[^=;(){}]*\\b${escaped}\\b\\s*(?!\\()`).test(trimmed)
  ) {
    return 'type_reference';
  }
  ```

- [x] T008 [US2] `tests/symbols.test.mjs`의 spec 012 baseline 테스트에서 B2 assertion을 갱신:
  - 변경 전: `assert.deepEqual(classifyReference('const arr = [new Foo(), foo()];', 'foo', 'app.ts'), { type: 'usage', relation: 'type_reference' });`
  - 변경 후: `assert.deepEqual(classifyReference('const arr = [new Foo(), foo()];', 'foo', 'app.ts'), { type: 'usage', relation: 'call' });`

- [x] T009 [US2] spec 008 case 3 (`type Handler = (req: Request) => Response;` 안의 `Request` → `type_reference`)이 그대로 PASS함을 확인 (`node --test tests/symbols.test.mjs --test-name-pattern "classifyReference distinguishes"`).

## Phase 4: User Story 3 — JSX 검출 (P2)

- [x] T010 [US3] `classifyReference()`에서 `isDefinitionLine` 검사 다음, `relationForUsage` 호출 *이전*에 JSX 검출 분기 추가:
  ```js
  if ((lang === 'typescript' || lang === 'javascript')
      && /\.(tsx|jsx)$/.test(filePath || '')) {
    const escapedSym = escapeRegex(symbol);
    const jsxOpen = new RegExp(`(?:^|\\s|[(,{=>])\\s*<\\s*${escapedSym}\\s*(?:\\s+\\w+\\s*=|\\s*/?\\s*>)`);
    const jsxClose = new RegExp(`</\\s*${escapedSym}\\s*>`);
    if (jsxOpen.test(line) || jsxClose.test(trimmed)) {
      return { type: 'usage', relation: 'reference' };
    }
  }
  ```

- [x] T011 [US3] `tests/symbols.test.mjs`의 spec 012 baseline 테스트에서 C1/C2/C3 assertion 3개 갱신:
  - C1 변경 전: `{ ..., relation: 'type_reference' }` → 변경 후: `{ ..., relation: 'reference' }`
  - C2 동일.
  - C3 동일.
  - C4 (`.jsx`)는 변경 없음.

- [x] T012 [US3] `tests/symbols.test.mjs`에 신규 회귀 가드 단위 테스트 추가: TypeScript generic이 본 spec 패치 이후에도 그대로 type_reference로 분류됨.
  ```js
  test('Spec 016 — TypeScript generic Array<MyType> stays classified as type_reference', () => {
    assert.deepEqual(
      classifyReference('const items: Array<MyType> = [];', 'MyType', 'types.ts'),
      { type: 'usage', relation: 'type_reference' },
    );
  });
  ```

## Phase 5: 문서 + 회귀

- [x] T013 `DESIGN.md`의 parser-free 분류기 한계 단락(spec 012 추가분)의 A1/B2/C 항목 3개를 새 결과로 갱신한다. 각 항목 끝에 "(spec 016에서 의미 정밀도가 개선됨)" 한 줄 추가. C4/D/E는 변경 없음.

- [x] T014 `npm test` 전체 0 failures 확인.

## Phase 6: Wrap-up

- [x] T015 변경분을 단일 commit으로 묶는다. 메시지: `fix(spec-016): improve parser-free classifier precision for spaced calls, multi-pattern lines, and JSX`. 변경 파일: `src/explorer/symbols.mjs`, `tests/symbols.test.mjs`, `DESIGN.md`, `specs/016-classifier-precision-fixes/`.
