# Implementation Plan: TESTING.md 고정 테스트 수치 제거 및 Drift 가드

**Branch**: `004-testing-md-drift-guard` | **Date**: 2026-05-21 | **Spec**: `specs/004-testing-md-drift-guard/spec.md`

**Input**: Feature specification from `specs/004-testing-md-drift-guard/spec.md`

## Summary

`TESTING.md`에서 시간이 지나면 즉시 낡아 버리는 절대 수치(`320 tests`, `319 pass`, `1 skipped`, `5/5 통과`, `기본 공개 도구 8개`)를 제거하고, 합격 기준을 "어떤 명령을 실행해 `0 fail`을 본다"는 행위 기준으로 재서술한다. 동시에 `tests/integrations.test.mjs`에 doc-drift 가드 테스트 한 건을 추가해, 향후 누군가 동일 패턴을 다시 박아 넣을 경우 `npm test` 단계에서 즉시 빨갛게 떨어지도록 한다. 런타임 코드(`src/**`) 변경은 없다. 본 작업은 원본 plan(`docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md` Task 4)이 단위 테스트 단락만 다루던 정규식 범위를 통합 테스트 표와 stdio smoke 표기까지 확장한 상위 계약을 구현한다.

## Technical Context

**Language/Version**: Node.js (ESM), 저장소가 보장하는 최소 버전(`engines` 기준). 본 작업은 신규 문법을 도입하지 않는다.

**Primary Dependencies**: 표준 라이브러리만 사용. 추가 의존성 도입 금지. `node:test`, `node:assert/strict`, `node:fs/promises`, `node:path`, `node:url`만 import한다.

**Storage**: 해당 없음. 문서(`TESTING.md`) 및 테스트 파일(`tests/integrations.test.mjs`)만 다룬다.

**Testing**: `node:test` 단독. 외부 러너(`jest`, `mocha`) 도입 금지. 기존 `tests/integrations.test.mjs`의 doc-snapshot 가드 패턴(`fs.readFile` -> `assert.match` / `assert.doesNotMatch`)을 그대로 따른다.

**Target Platform**: 저장소가 지원하는 모든 OS/셸. 가드 테스트는 파일 내용만 읽으므로 OS 의존성이 없다.

**Project Type**: MCP 서버 라이브러리(`src/`) + 통합 산출물(`integrations/`, `examples/`) + 검증 문서(`TESTING.md`). 본 작업은 문서/테스트 레이어에만 머무른다.

**Performance Goals**: 가드 테스트 1건 추가가 `npm test` 총 실행 시간에 의미 있는 영향을 주지 않아야 한다(파일 1개 단발 read).

**Constraints**:
- 가드 정규식은 API 에러 코드 표(`400`, `429`, `500` 등)와 환경 메타데이터(날짜 `2026-05-21`)를 매칭하지 않아야 한다.
- 합격 기준 자체(`npm test`, `0 fail`)는 본문에 보존되어야 한다.
- `TESTING.md`는 한국어 산문을 유지한다. 영문 번역본 동기화는 본 작업 범위 밖이다.

**Scale/Scope**: 파일 2개 변경. `TESTING.md` 본문 약 100줄 중 3개 섹션(단위/통합/smoke) 4~5줄 편집, 가드 테스트 1건(어서션 5건 + 양성 어서션 2건) 추가.

## Constitution Check

*GATE: 본 저장소는 별도 `constitution.md`를 두지 않고 `AGENTS.md`가 운영 규약을 담는다. 아래 게이트를 통과해야 Phase 1 설계로 진입한다.*

- **doc-snapshot 가드 정책 일치**: `AGENTS.md`는 "이미 8개 이상의 doc-snapshot 가드가 통합되어 있으며, `src/` 변경 후 동기화 매트릭스 확인 없이 commit 금지"라고 규정한다. 본 작업은 그 가드 군에 `TESTING.md` 한 건을 추가하는 동질 작업이며, 새 가드도 같은 위치(`tests/integrations.test.mjs`)에 같은 패턴(`fs.readFile` + `assert.doesNotMatch`/`assert.match`)으로 들어간다. → PASS.
- **런타임 코드 변경 금지**: 본 작업은 spec FR-001~FR-007 어디에도 `src/**` 또는 `scripts/**` 수정 요건이 없다. plan도 그 경계를 유지한다. → PASS.
- **외부 의존성 추가 금지**: 표준 라이브러리만 사용. `package.json` 변경 없음. → PASS.
- **테스트 러너 단일화**: `node:test`로 충분하며 기존 파일에 테스트 블록만 append한다. → PASS.
- **한국어 산문 정책**: `TESTING.md`와 spec/plan 모두 한국어를 유지한다. → PASS.

Phase 0 진입 게이트 통과. 재검사 시점: Phase 1 산출물 작성 직후 동일 항목을 재확인한다.

## Project Structure

### Documentation (this feature)

```text
specs/004-testing-md-drift-guard/
├── spec.md              # 이미 존재 (입력)
├── plan.md              # 본 문서가 채울 출력
└── tasks.md             # /speckit-tasks 단계 산출물
```

### Source Code (repository root)

본 작업이 실제로 건드리는 파일은 두 개뿐이다.

```text
TESTING.md                       # 단위/통합/smoke 섹션 본문 편집
tests/integrations.test.mjs      # 새 doc-drift 가드 테스트 블록 append
```

참고만 하는(읽기 전용) 파일:

```text
docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md   # 원본 plan, Task 4
AGENTS.md                                                        # doc-snapshot 가드 운영 규약
```

**Structure Decision**: 본 작업은 신규 디렉터리/모듈을 만들지 않는다. 기존 `tests/integrations.test.mjs`가 README/integrations/examples drift 가드를 모아 둔 단일 진입점이므로, `TESTING.md` 가드도 같은 파일 안의 별도 `test('TESTING.md ...', ...)` 블록 하나로 들어간다. 별도 파일 분리는 명백한 가치가 발견되기 전까지 보류한다(spec Assumptions 항목과 일치).

## Implementation Outline

`TESTING.md` 편집과 가드 테스트 추가를 한 PR로 묶되, 편집 -> 가드 -> 자기 검증 순서로 진행한다.

### Phase A. `TESTING.md` 본문 정리

(a) **단위 테스트 섹션 절대 수치 제거**
- 현재 17행 "최근 관측 결과(2026-05-21): `320 tests`, `319 pass`, `1 skipped`, `0 fail`." 문장에서 `320 tests`, `319 pass`, `1 skipped` 세 절대 수치를 제거한다.
- "성공 기준 = `npm test`가 `0 fail`로 종료"라는 행위 기준 한 문장으로 대체한다. `0 fail` 또는 `0 failures` 토큰은 본문에 반드시 남긴다(FR-006 양성 어서션 대상).
- 21행 "이 문서의 숫자는 마지막 관측값입니다. 실제 기준은 항상 위 `npm test` 실행 결과입니다." 디스클레이머 문장은 유지하며, 단위 섹션 안에 1회는 반드시 보이도록 위치를 보장한다(FR-004).

(b) **통합 테스트 표의 합계 제거**
- 39행 "전체 결과: `5/5` 통과." 문장을 삭제하고, "스크립트가 보고하는 모든 케이스가 통과(스크립트가 `0 fail`로 종료)"라는 합격 기준 문장으로 대체한다.
- 케이스별 결과 표(31~37행)는 운영 정보로 유지한다. 표 본문의 "통과/실패" 마커는 가드 정규식 대상이 아니다(spec Assumptions 일치).

(c) **stdio smoke의 도구 개수 제거**
- 58행 "`tools/list`에서 기본 공개 도구 8개 확인" 문장에서 `8개`를 제거하고, "`tools/list` 응답에서 공개 도구 목록이 누락 없이 반환되는 것을 확인"으로 바꾼다.
- 동일 섹션 다른 줄에 다른 형태의 도구 개수 표기(`도구 N개`, `N개 공개 도구` 등)가 없는지 확인하고 있으면 같은 방식으로 제거한다.

(d) **디스클레이머 1회 이상 유지**
- "이 문서의 숫자는 마지막 관측값이며 실제 기준은 항상 현재 checkout에서의 `npm test` 결과"라는 취지의 디스클레이머가 단위/통합/smoke 세 섹션 중 적어도 한 곳에서 독자의 시야에 들어오도록 유지한다. 현재 본문(21행)이 단위 섹션에 위치하므로 그대로 둔다. 별도 추가 문장은 만들지 않는다.

(e) **건드리지 않는 영역 명시**
- "최근 확인 환경" 메타데이터 블록(3~9행)의 날짜/Node/npm/OS 값은 관측 메타이므로 유지한다.
- "Cerebras API 에러 코드 참조" 표(80~94행)의 HTTP 코드(400, 401, 408, 429 등)는 외부 사양 식별자이므로 건드리지 않는다. 가드 정규식도 이 영역을 매칭하지 않도록 설계한다(아래 Phase B 참조).

### Phase B. `tests/integrations.test.mjs` 가드 테스트 추가

기존 파일 말미에 단일 `test(...)` 블록을 추가한다. 블록 이름은 `TESTING.md`라는 식별 키워드를 포함해야 한다(SC-001의 `--test-name-pattern "TESTING.md"` 호환). 예: `test('TESTING.md does not pin absolute test totals or fixed tool counts', ...)`.

테스트 본문 구성:

1. `const testingMd = await read('TESTING.md');` 한 줄로 본문을 메모리에 적재한다.
2. **금지 패턴 어서션 5건**(`assert.doesNotMatch`):
   - `/\b\d+\s+tests\b/` — 단위 테스트 총수 (예: `320 tests`).
   - `/\b\d+\s+pass\b/` — 단위 테스트 통과수 (예: `319 pass`). 주: 단어 경계로 `bypass` 등을 배제한다.
   - `/\b\d+\s+skipped\b/` — skip 수 (예: `1 skipped`).
   - `/\b\d+\s*\/\s*\d+\s*통과\b/` — 통합 테스트 고정 분수 (예: `5/5 통과`). 공백 변형 허용.
   - `/\b\d+\s*개\s*(공개\s*)?도구\b/` — stdio smoke 도구 개수 (예: `8개 도구`, `8개 공개 도구`).
3. **양성 어서션 2건**(`assert.match`):
   - `/\bnpm test\b/` — 합격 기준 명령이 본문에 살아 있는지 (FR-006).
   - `/\b0\s+(fail|failures)\b/` — `0 fail`(또는 `0 failures`) 표기가 본문에 살아 있는지 (FR-006).
4. **메시지 식별 가능성**(FR-007): 각 `assert.doesNotMatch`/`assert.match` 호출의 세 번째 인자에 어떤 정규식이 어떤 의도를 검사했는지 표시한다. 예: `'TESTING.md must not pin absolute unit test count (\\d+ tests)'`. `node:test`가 실패 시 이 문자열을 출력하므로 위반 패턴 식별이 가능하다.

### Phase C. 자기 검증

- `node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"`로 새 가드 단독 실행해 0 fail 통과 확인 (SC-001).
- 더미 위반 inject: `TESTING.md` 사본에 `320 tests`를 임시 삽입하고 같은 명령 재실행 -> 실패와 위반 패턴 메시지 확인 후 사본을 폐기 (SC-004). 본 검증은 작업자의 로컬 확인 절차이며 PR에는 inject 흔적을 남기지 않는다.
- 전체 회귀: `npm test`가 0 fail로 종료하는지 확인. 기존 doc-snapshot 가드들과 충돌이 없어야 한다.

## Risks & Mitigations

| 리스크 | 발생 시 영향 | 완화 |
|--------|-------------|------|
| API 에러 코드 표(400, 401, 408, 429, 500, 502, 503, 504)가 `\b\d+\s+tests\b` 같은 정규식과 우연 매칭 | 가드가 외부 사양 식별자에 대해 오탐 -> 무관한 PR이 빨갛게 떨어짐 | 정규식 5종 모두 "테스트 결과 단어(`tests`, `pass`, `skipped`, `통과`, `도구`)"가 숫자 뒤에 결합된 형태만 매칭하도록 좁힌다. 단독 숫자(`400`, `429`)는 어떤 정규식과도 매칭되지 않는다. spec Edge Cases 마지막 항목과 일치. |
| `0 fail` 양성 어서션이 본문 정리 과정에서 실수로 함께 삭제됨 | 합격 기준이 사라진 상태로 가드만 통과 -> 문서가 의미를 잃음 | FR-006 양성 어서션(`assert.match(testingMd, /\b0\s+(fail\|failures)\b/)`)이 이를 직접 차단한다. Phase A에서 단위 섹션의 절대 수치를 제거할 때 `0 fail` 토큰은 의도적으로 남긴다. |
| `pass`가 `bypass`, `passport`, `passing` 같은 무관한 단어에 매칭 | 무관한 문장이 가드를 트리거 | 정규식에 `\b\d+\s+pass\b` 형태로 "숫자 + 공백 + pass + 단어 경계"를 강제. `bypass`는 앞에 숫자+공백 결합이 없어 매칭 불가. |
| `\d+\s*개\s*도구`가 향후 본문이 "API 호출 3개 도구별 …" 같은 운영 설명문에 매칭 | 정상 산문이 가드를 트리거 | 도구 개수 표기는 stdio smoke에만 등장하도록 Phase A에서 정리. 향후 다른 섹션에서 "N개 도구" 패턴이 필요해지면 spec/plan 갱신을 거쳐 정규식 범위를 재조정한다(가드 우회 목적의 즉흥 회피 금지). |
| 향후 통합 테스트 케이스가 7건으로 늘어 `7/7 통과`를 다시 적고 싶은 유혹 | 같은 drift가 재발 | 정규식이 특정 숫자가 아닌 `\d+/\d+\s*통과` 일반형을 차단하므로 어떤 분수든 거부된다. 운영자는 합격 기준을 "스크립트가 0 fail로 종료" 문장으로 표현해야 한다. spec Edge Cases 1번과 일치. |
| 가드 테스트가 다른 doc-snapshot 가드와 같은 `read('TESTING.md')` 경합 | 없음(파일 시스템 read 1회 추가, race 조건 없음) | `node:fs/promises`는 동시 read를 안전하게 처리. 추가 조치 불필요. |
| 한국어 정규식(`통과`, `도구`)이 인코딩 문제로 매칭 실패 | 가드가 사실상 무력화 | `tests/integrations.test.mjs`는 UTF-8 ESM이고 기존 가드도 한국어를 사용 중(예: 145행 `cerebras_explorer.*피하세요`). 동일 인코딩 유지로 충분. |

## Test Strategy

- **단독 실행(SC-001)**: `node --test tests/integrations.test.mjs --test-name-pattern "TESTING.md"`로 새 블록만 실행해 0 fail 확인. 블록 이름에 `TESTING.md`가 포함되도록 Phase B에서 강제한다.
- **양성 위반 inject(SC-004)**: 임의 위반 한 줄 추가로 가드가 실제로 빨갛게 떨어지는지 확인. 3종 위반(`320 tests`, `5/5 통과`, `공개 도구 8개`) 각각 1회씩 inject 후 검증, 위반 메시지에 정규식/의도 문자열이 출력되는지 확인. 검증 후 사본은 폐기하고 커밋에 포함하지 않는다.
- **회귀(전체 가드 군)**: `npm test`로 기존 doc-snapshot 가드 전체와 함께 통과 확인. 기존 가드들이 `TESTING.md`를 별도로 검사하지 않으므로 충돌 가능성은 낮으나, 가드 군 전체가 0 fail로 종료하는지 마지막에 한 번 확인한다.
- **양성 어서션 자기 검증**: 일시적으로 `TESTING.md`에서 `0 fail` 토큰을 지운 사본을 만들어 가드가 양성 어서션 실패로 떨어지는지 확인(FR-006이 실제 작동함을 입증). 검증 후 사본 폐기.
- **테스트 추가 외 변경 금지**: 본 작업은 `src/**`, `scripts/**`, `package.json`을 건드리지 않는다. PR diff가 `TESTING.md`와 `tests/integrations.test.mjs` 두 파일에만 머무는지 최종 점검한다.
