# Implementation Plan: Symbol Precision Baseline Coverage

**Branch**: `008-symbol-precision-baseline` | **Date**: 2026-05-21 | **Spec**: `specs/008-symbol-precision-baseline/spec.md`

**Input**: Feature specification from `specs/008-symbol-precision-baseline/spec.md`

## Summary

이미 구현된 parser-free 분류기(`src/explorer/symbols.mjs`의 `relationForUsage()` / `classifyReference()`)의 의미 계약을 4개 대표 케이스에 대한 회귀 단위 테스트로 고정하고, `DESIGN.md`의 symbol/reference 디자인 섹션에 parser-free 분류의 의도와 한계를 명시하는 단락을 추가한다. 사전 검증에서 분류기는 plan Step 3 패치와 동등한 동작을 이미 제공하므로 본 작업의 기본 변경 면적은 `tests/symbols.test.mjs` 1개 테스트 추가와 `DESIGN.md` 1개 단락 추가다. `src/explorer/symbols.mjs`는 새 테스트가 FAIL할 때에 한해 회귀 보정 목적으로만 수정한다.

기술적 접근은 단순하다. (1) 기존 `classifyReference adds relation details without changing legacy type` 테스트 바로 아래에 동일한 스타일(`assert.deepEqual`)의 신규 테스트를 한 개 추가하여 `member_call` / `constructor` / `type_reference` / `call` 네 케이스를 한 번에 굳힌다. (2) `DESIGN.md`의 Phase 3 — 의존성 최소화 심볼 엔진 정밀도 향상 섹션(라인 615 부근) 끝부분에 parser-free 경계 단락을 추가해 분류 카테고리 6개, LSP 비완전성, 라인 범위 별도 검증 권고를 한 곳에 명시한다.

## Technical Context

**Language/Version**: Node.js (ES modules, `.mjs`), 저장소 기본 런타임을 따른다

**Primary Dependencies**: 추가 의존성 없음. `node:test`, `node:assert/strict`만 사용

**Storage**: N/A (테스트 + 문서)

**Testing**: `node --test tests/symbols.test.mjs` (단독), 또는 패턴 필터로 `--test-name-pattern "classifyReference"`

**Target Platform**: Node.js 런타임 (저장소 CI 매트릭스 기본값)

**Project Type**: MCP 서버 라이브러리 + 검증 테스트. 본 작업은 테스트 + 문서 변경.

**Performance Goals**: 신규 테스트는 ms 단위로 완료되어야 한다. 정규식 4건 평가만 수행하므로 별도 목표 없음.

**Constraints**: 신규 분류 카테고리 추가 금지. legacy `categorizeReference()`의 반환값 (`definition|import|usage`) 계약 불변. `classifyReference` 반환 형태(`{ type, relation }`)도 외부 계약으로 유지.

**Scale/Scope**: 단일 파일 신규 테스트 1개(4 assertions), `DESIGN.md` 신규 단락 1개. 회귀 시에만 `src/explorer/symbols.mjs`의 `relationForUsage()` ordered checks 일부 줄 보정.

## Constitution Check

본 저장소에는 별도 constitution 문서가 정의되어 있지 않으므로, 본 작업의 게이트는 spec.md의 Functional Requirements와 Assumptions로 갈음한다.

- **FR-001 ~ FR-004 게이트**: 신규 테스트 1개를 추가하되 legacy `type` 계약과 분류 카테고리 집합은 변경하지 않는다.
- **FR-005 게이트**: 회귀 보정이 필요할 때만 `relationForUsage()` ordered checks를 손대며, 본 작업에서 분류기 코드를 능동적으로 수정하지 않는다.
- **FR-006 게이트**: `DESIGN.md`에 parser-free 경계 단락을 추가하되, 기존 Phase 3 본문의 의미를 바꾸지 않는다.
- **FR-007 / FR-008 / SC-001 게이트**: `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference"`와 전체 `node --test tests/symbols.test.mjs`가 모두 0 failures.
- **FR-009 게이트**: 커밋 범위는 `tests/symbols.test.mjs` + `DESIGN.md` (+ 회귀 시 `src/explorer/symbols.mjs`)로 제한.
- **범위 게이트**: spec Assumptions에 따라 본 작업은 Task 9(문서/검증 마감)와 별도 커밋이며 P0/P1 작업을 차단하지 않는다.

게이트 평가 결과: 위반 없음. Complexity Tracking 표는 비워 둔다.

## Project Structure

### Documentation (this feature)

```text
specs/008-symbol-precision-baseline/
├── spec.md              # Feature specification (이미 존재, 변경 없음)
├── plan.md              # This file (/speckit-plan 결과물)
└── tasks.md             # Phase 2 output (/speckit-tasks 단계에서 생성, 본 plan은 만들지 않음)
```

본 feature는 데이터 모델, 신규 contract, quickstart가 필요하지 않다 (`research.md`, `data-model.md`, `quickstart.md`, `contracts/` 모두 생략).

### Source Code (repository root)

```text
src/
└── explorer/
    └── symbols.mjs         # 회귀 시에만 수정 (relationForUsage / classifyReference)

tests/
└── symbols.test.mjs        # 신규 테스트 1개 추가 (기존 라인 240-257 근처)

DESIGN.md                   # Phase 3 섹션(라인 615 부근)에 parser-free 경계 단락 추가
docs/
└── superpowers/
    └── plans/
        └── 2026-05-19-tool-quality-improvements.md  # 참고용 원본 plan (변경 없음)
```

**Structure Decision**: 본 작업은 기존 단일 프로젝트 구조(`src/`, `tests/`, 저장소 루트 `DESIGN.md`)를 그대로 사용한다. 신규 디렉터리나 모듈 분리는 없다. 분류 로직과 테스트가 한 파일씩 대응되는 기존 배치를 유지한다.

## Implementation Outline

### Step (a) — 신규 단위 테스트 추가

- 파일: `tests/symbols.test.mjs`
- 위치: 기존 `test('classifyReference adds relation details without changing legacy type', ...)` (라인 240) 바로 다음.
- 신규 테스트 이름: `'classifyReference distinguishes member, call, constructor, and type relations'`.
- 구조: 단일 `test(...)` 블록 안에 네 개의 `assert.deepEqual` 호출.

### Step (b) — 4 케이스 assertion

각 케이스는 spec.md User Story 1 Acceptance Scenarios와 동일한 입력/기대값을 사용한다.

1. **member_call**
   - 입력: `classifyReference('session.touch();', 'touch', 'session.ts')`
   - 기대: `{ type: 'usage', relation: 'member_call' }`
2. **constructor**
   - 입력: `classifyReference('const manager = new SessionManager();', 'SessionManager', 'session.ts')`
   - 기대: `{ type: 'usage', relation: 'constructor' }`
3. **type_reference**
   - 입력: `classifyReference('type Handler = (req: Request) => Response;', 'Request', 'types.ts')`
   - 기대: `{ type: 'usage', relation: 'type_reference' }`
4. **call**
   - 입력: `classifyReference('return requireAuth(req, res, next);', 'requireAuth', 'routes.js')`
   - 기대: `{ type: 'usage', relation: 'call' }`

`assert.deepEqual`을 사용해 형태 자체(`{ type, relation }` 키 집합)도 함께 고정한다. `assert.equal`로 풀어 쓰지 않는다.

### Step (c) — 테스트 PASS 확인

- `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference distinguishes"` 단독 실행으로 신규 테스트 PASS 확인.
- `node --test tests/symbols.test.mjs` 전체 실행으로 기존 테스트 회귀 없음 확인.
- **회귀 시에만** `src/explorer/symbols.mjs`의 `relationForUsage()`를 보정한다. 사전 검증에서 코드는 이미 다음 ordered checks를 수행한다:
  1. `export` (라인 382)
  2. `type_reference` (TS 한정, 라인 386-391)
  3. `constructor` (`\bnew\s+Foo\s*\(`, 라인 393)
  4. `call` (`(?:^|[^.\w$#])Foo\s*\(`, 라인 397) — 왼쪽 경계가 `.`이 아니어야 함
  5. `member_call` (`\.Foo\s*\(`, 라인 401)
  6. `property` → `reference` (라인 405-409)

  실제 코드의 `call` 분기는 왼쪽 경계 negative 클래스(`[^.\w$#]`)로 `session.touch()`의 `touch`를 배제하므로 `member_call`이 `call`보다 뒤에 와도 4 케이스 분류는 정확하다. spec.md FR-005가 명시한 "`constructor` → `member_call` → `call`" 순서는 동일 결과를 보장하는 동치 표현으로 해석한다. 회귀 보정이 필요한 경우, 4 케이스가 모두 PASS하도록 두 분기 사이의 부정 경계와 호출 순서 중 한쪽만 유지하면 충분하며, 신규 카테고리는 추가하지 않는다.
- 회귀가 발생해 `src/explorer/symbols.mjs`를 수정한 경우, `categorizeReference()`가 여전히 `'definition' | 'import' | 'usage'`만 반환하는지 기존 테스트로 재확인한다 (`classifyReference adds relation details without changing legacy type` 테스트와 `repo_references` 통합 테스트가 이 계약을 함께 가드).

### Step (d) — DESIGN.md에 parser-free 경계 단락 추가

- 파일: `DESIGN.md`
- 위치: 기존 `## 17. 추후 확장` 안의 `### Phase 3 — 의존성 최소화 심볼 엔진 정밀도 향상` 본문(현재 라인 615-643) 끝, `### Phase 4 — 런타임 고도화` 직전.
- 단락 제목 후보: **`Parser-free 분류기 경계`** (Phase 3 하위 항목으로 `5.` 또는 별도 소제목으로 추가).
- 단락이 반드시 포함해야 할 세 요소(spec.md FR-006):
  1. **분류 카테고리 목록 6개**: `call`, `member_call`, `constructor`, `type_reference`, `import`, `export`. `repo_references`와 `repo_symbol_context`가 돌려주는 `relation` 값을 한 곳에 명시.
  2. **LSP 비완전성 단서**: 이 분류는 정규식 기반 syntax-lite 추론이며, LSP/tree-sitter 수준의 완전성(스코프 분석, 타입 해석, 매크로/JSX/데코레이터/동적 import 전개)을 주장하지 않는다는 점을 명시.
  3. **라인 범위 별도 검증 권고**: 호출자가 분류 결과를 "타겟 맵"으로만 사용하고, 신뢰가 중요한 편집 직전에는 `repo_read` 등으로 해당 파일의 실제 라인 범위를 재검증하라는 권고.
- 본 단락은 Phase 3 본문의 기존 1~4 항목과 모순되지 않아야 하며, 본 작업 범위에서 카테고리 집합을 확장하지 않음을 함께 명시한다.

## Risks & Mitigations

- **위험 1 — 향후 분류기 리팩터로 외부 계약 침식**
  - 시나리오: 누군가 `relationForUsage()`를 토크나이저 기반으로 교체하면서 `relation` 키 이름을 `kind`로 바꾸거나 `member_call`을 `method_call`로 리네이밍.
  - 완화: 본 작업에서 추가하는 `assert.deepEqual({ type, relation })`이 키 집합과 값 라벨을 동시에 가드한다. spec.md FR-004가 카테고리 확장 금지를, FR-005가 ordered checks 의미를 보호한다. `DESIGN.md` 단락이 6개 카테고리 집합을 외부 계약으로 명시한다.
- **위험 2 — `call` 분기와 `member_call` 분기의 ordered checks 순서 불일치**
  - 시나리오: spec.md FR-005는 "`constructor` → `member_call` → `call`" 순서를 요구하지만, 실제 코드는 `constructor` → `call` (왼쪽 경계 negative class) → `member_call` 순서로 같은 결과를 낸다. 향후 리팩터가 양쪽 중 하나만 손보면 분류가 깨진다.
  - 완화: 신규 단위 테스트가 두 분기 모두를 한 번에 검증한다. `session.touch()`(member_call), `requireAuth(...)`(call), `new SessionManager()`(constructor)가 같은 테스트 안에서 굳어지므로 ordered checks를 재배열해도 4 결과가 모두 유지되는 한 PASS한다. 결과가 깨지면 정확한 메시지로 FAIL한다.
- **위험 3 — JSX / 데코레이터 / 동적 import의 오분류**
  - 시나리오: `<Component prop={value} />`, `@Decorator`, `const m = await import('...')` 같은 형태는 현재 정규식이 일관되게 다루지 않는다.
  - 완화: spec.md Edge Cases와 User Story 3에 따라 본 작업 범위 외로 명시한다. `DESIGN.md` 단락이 LSP 비완전성 단서로 이 영역을 흡수해, 호출자가 신뢰가 중요한 편집 전 라인 범위를 재검증하도록 유도한다. 본 작업은 이 형태들에 대해 신규 테스트를 추가하지 않는다.
- **위험 4 — `DESIGN.md` 단락 위치가 Phase 3 본문과 의미 충돌**
  - 시나리오: Phase 3 본문이 "정밀도 향상 구현 계획"인데 신규 단락이 "현재 분류기의 한계"를 말해 의미가 어긋날 수 있다.
  - 완화: 단락을 Phase 3 마지막에 배치해 "기존 Phase 3 항목 1~4의 결과로 합의된 외부 계약과 그 경계"라는 톤으로 작성한다. 본문 1~4의 의미를 바꾸지 않고, 본 작업 결과 카테고리 집합이 외부 계약으로 확정되었음을 명시한다.

## Test Strategy

- **단독 실행**
  - `node --test tests/symbols.test.mjs --test-name-pattern "classifyReference distinguishes"` → 신규 테스트 단독 PASS 확인. spec.md User Story 1 Independent Test와 동일한 명령.
  - 실패 시 `assert.deepEqual` 출력이 어떤 케이스의 어떤 `relation` 값이 깨졌는지 직접 보여준다. 별도 메시지 인자 없이 `assert.deepEqual`의 기본 diff에 의존한다.
- **전체 실행**
  - `node --test tests/symbols.test.mjs` → 기존 `classifyReference adds relation details without changing legacy type`, `repo_references handles JavaScript private symbol names`(라인 333-341, `#touch` member_call 검증), `repo_references finds symbol definition and usages across files`(라인 315-331, `export` relation 검증)와 공존해 모두 PASS.
- **회귀 시나리오 (User Story 3)**
  - `relationForUsage()`에서 의도적으로 `member_call` 분기를 제거하면 신규 테스트의 case 1만 FAIL해야 한다. case 2/3/4는 PASS 유지.
  - 이 경우 spec.md FR-005의 ordered checks를 복원하면 다시 PASS. 본 plan의 Implementation Outline Step (c)에 따라 코드 보정 범위를 `relationForUsage()`로만 제한한다.
- **회귀 메시지 품질**
  - 신규 테스트가 단일 `test(...)` 블록 안에서 4개 케이스를 묶으므로, FAIL 시 어떤 입력 라인이 어떤 `relation`을 돌려줬는지 `node --test` 기본 diff로 충분히 식별된다. 추가 로깅은 도입하지 않는다.
- **범위 외 명시**
  - `node --test tests/` 전체나 `npm test` 회귀는 본 작업의 게이트가 아니며, spec Assumptions에 따라 Task 9에서 별도 게이트로 처리한다.

## Complexity Tracking

> Constitution Check에 위반 없음. 본 표는 비워 둔다.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (없음)    | (없음)     | (없음)                               |
