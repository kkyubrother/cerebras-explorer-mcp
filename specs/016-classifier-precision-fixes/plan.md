# Implementation Plan: parser-free 분류기 의미 정밀도 개선

**Branch**: `master` | **Date**: 2026-05-24 | **Spec**: `specs/016-classifier-precision-fixes/spec.md`

## Summary

`src/explorer/symbols.mjs`의 `relationForUsage()`와 `classifyReference()`에 세 가지 정밀도 패치를 적용한다: (1) 공백 멤버 호출 검출, (2) type_reference의 함수 호출 false positive 제거, (3) `.tsx`/`.jsx` 파일에서 JSX 태그 검출. 신규 카테고리는 추가하지 않으며 기존 `{ type, relation }` 형식 안에서만 분류 결과를 더 정확하게 만든다. spec 012 단위 테스트의 baseline 분류 라벨은 명시적으로 새 결과로 갱신하고 spec 008의 4 baseline은 그대로 유지한다.

## Technical Context

**Language/Version**: Node.js ESM.

**Primary Dependencies**: 변경 없음.

**Testing**: `npm test` 전체. 핵심 회귀는 `node --test tests/symbols.test.mjs`.

**Constraints**: 신규 카테고리 추가 금지(spec 008 FR-004). 환경변수 추가 금지. legacy `categorizeReference` 반환값(`definition|import|usage`) 불변.

**Scale/Scope**: `src/explorer/symbols.mjs`의 `relationForUsage()`와 `classifyReference()`에 ~25 라인 추가/수정, `tests/symbols.test.mjs`의 spec 012 테스트 8 assertion 중 5개 갱신 + 신규 generic 회귀 1개 추가, `DESIGN.md`의 분류기 한계 단락 ~6 라인 갱신.

## Constitution Check

- **FR-001 / FR-002 게이트**: 새 member_call 분기 위치 + 기존 분기 제거. spec 008 case 1/4가 가드.
- **FR-003 게이트**: type_reference 끝에 `\\s*(?!\\()`. spec 008 case 3이 가드.
- **FR-004 / FR-005 게이트**: JSX 검출이 type_reference보다 우선, import/definition보다 뒤. `.tsx`/`.jsx`만 적용.
- **FR-006 게이트**: relation 카테고리 set 불변.
- **FR-007 / FR-008 게이트**: spec 008 baseline 유지 + spec 012 baseline 갱신.
- **FR-009 게이트**: generic 회귀 가드 추가.
- **FR-010 게이트**: DESIGN.md 갱신.
- **FR-011 게이트**: `npm test` 0 failures.

게이트 평가: 위반 없음.

## Project Structure

```text
specs/016-classifier-precision-fixes/
├── spec.md
├── plan.md
└── tasks.md
```

코드 변경:
```text
src/explorer/symbols.mjs        # relationForUsage()와 classifyReference() 패치
tests/symbols.test.mjs          # spec 012 단위 테스트 5 assertion 갱신 + 신규 generic 회귀 1개
DESIGN.md                       # 분류기 한계 단락 갱신
plan/extension-backlog.md       # (선택) spec 016 진행 명시
```

## Implementation Outline

(a) **`relationForUsage`에 spaced-member-call 분기 추가**: ordered checks에서 `constructor` 다음, `call` *위에* 다음 분기 삽입.

```javascript
// Spec 016: spaced member call (`obj . method ()`) used to fall into 'call';
// the .X(\s*\() bare call check below would match when X had no leading dot.
// Add a `\\.\\s*X\\s*\\(` check first so spaced member calls resolve to
// member_call. This absorbs the old `\\.X\\s*\\(` check below.
if (new RegExp(`\\.\\s*${escaped}\\s*\\(`).test(trimmed)) {
  return 'member_call';
}
```

기존 member_call 분기 (`\\.${escaped}\\s*\\(`)는 위 정규식의 부분 집합이므로 제거.

(b) **`relationForUsage`의 `call` 분기 변경 없음**: spaced 분기가 이미 dot-with-whitespace를 잡으므로 call 분기는 그대로 둔다.

(c) **`relationForUsage`의 `type_reference` 분기에 lookahead 추가**: 끝에 `\\s*(?!\\()` 추가해서 심볼 직후가 `(`이면 type_reference로 분류하지 않게.

```javascript
if (
  lang === 'typescript' &&
  new RegExp(`(?:[:<|&,]|\\b(?:as|satisfies|implements|extends)\\s+)\\s*[^=;(){}]*\\b${escaped}\\b\\s*(?!\\()`).test(trimmed)
) {
  return 'type_reference';
}
```

(d) **`classifyReference`에 JSX 검출 분기 추가**: `isImportLine`/`isDefinitionLine` 검사 이후, `relationForUsage` 호출 이전에 다음 검사 추가.

```javascript
// Spec 016: JSX tags in .tsx/.jsx used to false-positive as type_reference
// (the `<` character triggered the TS type_reference branch). Treat JSX
// elements as plain 'reference' since spec 008 FR-004 forbids adding a
// new jsx_element category.
if ((lang === 'typescript' || lang === 'javascript')
    && /\.(tsx|jsx)$/.test(filePath || '')) {
  const jsxOpen = new RegExp(`(?:^|\\s|[(,{=>])\\s*<\\s*${escapeRegex(symbol)}\\s*(?:\\s+\\w+\\s*=|\\s*/?\\s*>)`);
  const jsxClose = new RegExp(`</\\s*${escapeRegex(symbol)}\\s*>`);
  if (jsxOpen.test(line) || jsxClose.test(trimmed)) {
    return { type: 'usage', relation: 'reference' };
  }
}
```

근거: file extension 검사는 `detectLanguage(filePath)`보다 단순한 직접 검사. `escapeRegex`는 기존 helper. `jsxOpen`은 `line` (trim 전)으로 평가해 line 시작 공백을 보존.

(e) **단위 테스트 갱신**: `tests/symbols.test.mjs`의 spec 012 단위 테스트에서 5개 assertion만 새 결과로 바꾼다 (FR-008 명시). 다른 assertion은 그대로. comment 한 줄로 "spec 016에서 의미 정밀도 개선됨" 명시.

(f) **신규 회귀 가드**: 같은 테스트(또는 별도 테스트)에 `classifyReference('const items: Array<MyType> = [];', 'MyType', 'types.ts')` → `type_reference` 검증 추가. TypeScript generic이 본 spec 패치 이후에도 그대로 분류되는지 확인.

(g) **DESIGN.md 갱신**: 분류기 한계 단락의 5개 영역 설명 중 A1/B2/C1-3 항목을 새 결과로 갱신. 갱신 사유 한 줄에 "spec 016에서 의미 정밀도가 개선됨"을 명시. 변경 없는 항목(C4, D, E)은 그대로.

(h) **(선택) backlog 갱신**: `plan/extension-backlog.md`에 본 spec이 spec 012 후속임을 한 줄 명시 (extension-backlog는 4개 후보 문서이고 spec 016은 그 후속작이라 별도 표시는 강제 아님).

(i) **검증**: `npm test` 전체 0 failures.

(j) **커밋**: 단일 commit. 메시지: `fix(spec-016): improve parser-free classifier precision for spaced calls, multi-pattern lines, and JSX`.

## Complexity Tracking

- **정규식 순서의 미묘성**: 공백 member_call 분기를 call 분기 위에 두면 `foo()` 같은 일반 call이 dot이 없으니 그대로 call에 매치. 위치만 정확하면 문제 없음.
- **JSX vs TypeScript generic 구분**: lookbehind `(?:^|\\s|[(,{=>])`로 식별자 뒤의 `<`는 제외. `Array<MyType>`은 `Array` 다음 `<`이므로 lookbehind에 매치 안 됨 → JSX로 잘못 분류되지 않음. 회귀 가드(FR-009)로 명시 확인.
- **type cast `(<MyType>x)`**: TypeScript 옛 syntax. `<MyType>x`의 `<MyType` 앞은 `(`. lookbehind `[(,{=>]`이 매치 → JSX로 false positive 분류. 본 spec은 이 케이스를 무시 (TypeScript 4.0+ `as` 사용 추세, `<X>` cast는 deprecated). 후속 spec에서 다룰 수 있음.
- **`.ts` 파일에서는 JSX 분기 안 탐**: `.tsx`/`.jsx`만 대상이라 일반 `.ts` 코드 영향 없음.
