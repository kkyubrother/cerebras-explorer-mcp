# Implementation Plan: Strengthen Explore Router Heuristics

**Branch**: `006-explore-router-heuristics` | **Date**: 2026-05-21 | **Spec**: specs/006-explore-router-heuristics/spec.md

**Input**: Feature specification from `specs/006-explore-router-heuristics/spec.md`

## Summary

`explore` 도구의 내부 V1/V2 런타임 라우터(`shouldUseV2ForExplore`)를 prompt+context 길이, scope 폭, 확장 키워드 신호로 강화한다. 현재 라우터는 `thoroughness === 'deep'` 또는 좁은 키워드 정규식만 검사하므로, README L319-321이 약속한 "deep/large report로 보이면 내부적으로 V2 런타임을 사용" 동작을 충분히 이행하지 못한다.

기술 접근:

- `shouldUseV2ForExplore`에 4개 신호를 OR 조합으로 추가: (1) `thoroughness === 'deep'`(기존), (2) `prompt.length + context.length >= 1200`, (3) `scope.length >= 6` 또는 broad pattern 포함, (4) 확장된 키워드 정규식(영문 7종 + 한글 6종).
- broad scope 패턴 검사를 위한 `hasBroadExploreScope(scope)` 헬퍼를 같은 파일 내에 추가.
- 외부 도구 표면(`tools/list`, 입력 스키마, `explore_v2` opt-in 정책)은 변경하지 않는다.
- `undefined`/`null`/비기대 타입 입력에 대해 라우터가 예외 없이 안전한 기본값으로 동작하도록 방어 코드 작성.

## Technical Context

**Language/Version**: Node.js (ESM, `.mjs`), 프로젝트 기존 런타임 그대로 사용

**Primary Dependencies**: 자체 MCP 서버(`src/mcp/server.mjs`), 자체 Cerebras runtime(`freeExploreRepository`, `freeExploreRepositoryV2`). 외부 라이브러리 신규 추가 없음.

**Storage**: 해당 없음 (라우터는 순수 함수)

**Testing**: `node --test tests/mcp-server.test.mjs` (Node 내장 테스트 러너, `node:test` + `node:assert/strict`)

**Target Platform**: MCP stdio 서버 (Claude Code, Codex CLI 등의 호스트가 소비)

**Project Type**: Single project (Node ESM, src + tests + docs)

**Performance Goals**: 라우터는 동기 분기 함수, 호출당 < 1ms. 정규식·문자열 길이 계산만 수행.

**Constraints**:
- 외부 도구 표면(`tools/list` 결과, 입력 스키마) 무변경.
- `explore_v2` opt-in 환경 변수(`CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`) 정책 유지.
- 기존 V1 경로(짧은 prompt + `thoroughness: 'quick'`)는 회귀 없이 그대로 V1 사용.

**Scale/Scope**: 단일 함수(라우터) + 헬퍼 1개 + 테스트 5종 추가. 변경 라인은 `src/mcp/server.mjs` 약 10~25라인, `tests/mcp-server.test.mjs` 약 60~100라인 예상.

## Constitution Check

본 저장소의 `AGENTS.md` 및 `DESIGN.md`에서 도출되는 게이트는 다음과 같다.

| 게이트 | 통과 여부 | 근거 |
|--------|-----------|------|
| 외부 MCP 도구 표면 무변경 | PASS | 라우터는 `explore` 핸들러 내부에서만 동작. `tools/list`, `EXPLORE_TOOL.inputSchema`, `EXPLORE_V2_TOOL` opt-in 분기 코드는 건드리지 않음. |
| `explore_v2` opt-in 정책 유지 | PASS | `exploreV2ToolEnabled()` 및 `buildToolList()` 분기 무변경. README L319-321, DESIGN L206 약속 그대로 유지. |
| read-only 보장 | PASS | 라우터는 입력 args의 형태만 검사하고 어떤 부수 효과도 일으키지 않음. |
| 보안 경계 (secret redaction, path validation) | PASS | 라우터는 redaction/validation 경로에 끼어들지 않음. 기존 `redactValue` 후처리 흐름 그대로. |
| 기존 테스트 회귀 없음 | PASS 목표 | `tests/mcp-server.test.mjs`의 기존 `tools/list` opt-in 분기 테스트(L355-L394 부근)가 그대로 통과해야 함. |

위반 사항 없음. Complexity Tracking 표는 비워둔다.

## Project Structure

### Documentation (this feature)

```text
specs/006-explore-router-heuristics/
├── spec.md              # 이미 존재
├── plan.md              # 본 문서(초안 → 정식 plan으로 승격 예정)
└── tasks.md             # /speckit-tasks 단계에서 생성
```

연구·데이터 모델·계약 문서는 본 작업에서 필요하지 않다(순수 함수 분기 강화이며 외부 계약 변경 없음). 따라서 `research.md`, `data-model.md`, `contracts/`, `quickstart.md`는 생성하지 않는다.

### Source Code (repository root)

```text
src/
└── mcp/
    └── server.mjs                  # shouldUseV2ForExplore (L259-263), callFreeExploreTool 분기 (L678 근처). 본 작업의 유일한 src 변경 지점.

tests/
└── mcp-server.test.mjs             # 라우터 단위 테스트 5종 추가. tools/list 회귀 테스트는 이미 존재.

docs/superpowers/plans/
└── 2026-05-19-tool-quality-improvements.md   # Task 6 원본 plan(참고). 본 작업으로 변경하지 않음.

README.md                            # L319-321 문구 그대로 유지(변경 금지).
DESIGN.md                            # L206 문구 그대로 유지(변경 금지).
```

**Structure Decision**: 단일 프로젝트 구조 그대로. 모든 코드 변경은 `src/mcp/server.mjs` 1개 파일에 집중되고, 테스트는 `tests/mcp-server.test.mjs` 1개 파일에 집중된다.

## Implementation Outline

### (a) `hasBroadExploreScope(scope)` 헬퍼 추가

- 위치: `src/mcp/server.mjs`, `shouldUseV2ForExplore` 바로 위.
- 시그니처: `function hasBroadExploreScope(scope)` → boolean.
- 동작:
  - `Array.isArray(scope)`가 false면 즉시 false 반환(문자열 단일 값, `null`, `undefined` 등은 broad 신호 아님).
  - 배열 길이가 6 이상이면 true.
  - 각 원소에 대해 다음 중 하나라도 만족하면 true:
    - 정확히 `.` 또는 `./`.
    - 문자열에 `**` 부분 문자열 포함.
    - `**/*` 패턴 포함.
    - `/` 뒤에 `**`로 끝남(예: `src/**`, `*/**`).
  - 모든 원소가 좁은 글롭이면 false.
- 입력 정제: 각 원소는 `typeof === 'string'`인 경우에만 검사. 빈 문자열·`null`·`undefined`는 건너뜀.

### (b) `shouldUseV2ForExplore` 분기 강화

- 위치: `src/mcp/server.mjs` L259-263 기존 함수 본체를 다음 OR 조합으로 교체.
- 신호:
  1. `args?.thoroughness === 'deep'` (기존 유지).
  2. `(prompt.length + context.length) >= 1200`.
     - `prompt = String(args?.prompt ?? '')`, `context = String(args?.context ?? '')`.
     - 한글 1자도 1로 계산(`.length`는 코드포인트 기준이 아니라 UTF-16 unit 기준이지만 임계 1200은 충분히 보수적이라 허용).
  3. `hasBroadExploreScope(args?.scope)`.
  4. 확장된 키워드 정규식 매칭(`prompt.toLowerCase()` 기반, 한글 부분은 원본 prompt에 대해 별도 검사).
- 키워드 정규식(영문 7 + 한글 6):
  - 영문(소문자): `deep dive`, `comprehensive`, `entire codebase`, `large architecture`, `end-to-end`, `architecture review`, `subsystem review`.
  - 한글: `전체`, `대규모`, `심층`, `종합`, `아키텍처`, `흐름`.
  - 구현은 단일 정규식 또는 영문/한글 두 정규식으로 분리 가능. 가독성을 위해 두 정규식 분리 권장.
- 어떤 신호도 일치하지 않으면 false 반환 → V1 런타임 사용.

### (c) `undefined`/`null` 안전 처리

- `args` 자체가 `undefined`/`null`이어도 optional chaining(`args?.`)으로 안전.
- `prompt`/`context`가 비문자열일 때 `String(value ?? '')`로 강제 변환 후 `.length` 계산.
- `scope`가 배열이 아니면 broad 신호 false.
- 라우터는 어떤 입력에도 throw하지 않아야 한다(spec FR-009).

### (d) 라우터 테스트 5종 추가

위치: `tests/mcp-server.test.mjs`. 가능하면 `shouldUseV2ForExplore`를 `src/mcp/server.mjs`에서 named export로 노출하지 않고, 기존 패턴대로 `tools/call name=explore` 요청을 보내고 사용된 런타임을 식별하는 방식(예: `freeExploreRepository` vs `freeExploreRepositoryV2`를 mock으로 갈아끼우거나, 응답 보고서에 포함된 시스템 프롬프트 마커 검사)을 채택한다. 만약 라우터를 단위 테스트하려면 `shouldUseV2ForExplore`를 named export로 추가해야 하므로, **export 추가가 외부 도구 표면에 영향을 주지 않음**을 plan 작성 단계에서 명확히 한다(`tools/list`와 무관한 internal helper export).

추천 접근(최소 변경): `shouldUseV2ForExplore`를 named export로 노출하고, 테스트는 순수 함수로 직접 호출한다.

- **테스트 1 (길이 신호)**: prompt 1200자 이상 → true. 1199자 → false(boundary). 1200자 정확히 → true.
- **테스트 2 (scope 길이)**: scope 배열 길이 6 → true. 길이 5 → false.
- **테스트 3 (broad pattern)**: scope에 `.`, `./`, `src/**`, `**/*.ts`, `*/**` 중 각각을 포함하는 케이스 → 모두 true.
- **테스트 4 (확장 키워드)**: prompt에 `architecture review`(대소문자 혼합), `subsystem review`, `종합`, `아키텍처`, `흐름`이 각각 포함된 케이스 → 모두 true. 기존 키워드(`deep dive`, `전체`)도 회귀 없음.
- **테스트 5 (짧은 quick 회귀)**: `{ prompt: 'explain auth briefly', thoroughness: 'quick' }` → false. `args === undefined` → false (throw 없음). `scope = null` 또는 `scope = 'src/**'`(문자열) → broad 아님.

### (e) `tools/list` 스냅샷 회귀 확인

- 기존 `tests/mcp-server.test.mjs`의 `tools/list` 분기 테스트(L346-L394 부근)가 그대로 통과하는지 확인.
- 별도 스냅샷 파일 생성은 하지 않는다(현재 저장소는 inline assertion 패턴). spec SC-003·SC-004를 기존 테스트가 이미 커버.
- `npm test` 전체가 PASS함을 종료 조건으로 한다.

## Risks & Mitigations

| 리스크 | 영향 | 완화책 |
|--------|------|--------|
| 1200자 임계값이 너무 낮거나 높음 | V1 응답이 잘리거나, 불필요하게 V2가 호출되어 비용·지연 증가 | 1200은 README L319-321 약속의 "deep/large report" 신호 기준으로 보수적으로 선택. 추후 벤치마크(`benchmarks/`)로 재조정 가능하도록 임계값을 상수로 분리(`const V2_LENGTH_THRESHOLD = 1200`). |
| 확장 키워드의 false positive (예: 일상 대화에서 "흐름"이 등장) | 사용자가 의도하지 않은 V2 호출 → 비용·지연 증가 | (1) 키워드는 명확한 보고서 의도 표현(`아키텍처`, `종합`, `심층`)으로 한정. (2) `흐름`은 한국어 사용자의 실무 코드 리뷰 컨텍스트에서 거의 항상 보고서 의도와 정렬되므로 수용. (3) 추후 false positive가 관측되면 부정 룩어라운드(예: "흐름 좀 알려줘"는 보고서 의도이므로 통과) 추가 가능. |
| `thoroughness: 'deep'`의 기존 동작 변경 | 호출자가 명시한 deep 의도가 다른 신호에 가려 V1으로 떨어짐 | OR 조합 첫 번째 조건으로 유지하여 deep은 항상 V2 트리거. |
| `scope`를 문자열 단일 값으로 보내는 호출자 | `hasBroadExploreScope`가 `'src/**'` 같은 broad pattern을 놓침 | spec edge case 명시대로 V1을 기본으로 사용(호환성 우선). 호출자가 broad scope를 의도했다면 배열로 보내야 함을 README/통합 문서에서 안내(별도 PR로 처리 가능). |
| `shouldUseV2ForExplore` named export 추가가 외부 도구 표면 변경으로 오해됨 | spec FR-007 위반 우려 | `tools/list`는 MCP wire surface이며, JS module export는 그와 무관. 테스트는 module export를 직접 호출하지만 MCP 호출자는 이를 보지 않음. |
| 보고서 의도 키워드가 영문/한글 혼합 prompt에서 누락 | "Please give me a comprehensive 흐름 분석" 같은 입력 | 영문 정규식은 `toLowerCase()` prompt 전체에 적용, 한글 정규식은 원본 prompt에 적용. OR 조합이므로 한 정규식만 매치되어도 V2. |
| `prompt`가 매우 긴(>50k자) 입력 | `.length` 계산 자체는 O(n)이지만 라우터 1ms 미만 유지 가능 | 별도 캡 불필요. 1200 임계는 first-match이므로 길이 비교는 한 번만 수행. |

## Test Strategy

### 신호별 독립 단위 테스트

각 신호는 다른 신호 없이도 단독으로 V2를 트리거하는지 검증한다.

1. **길이 신호 단독**: `{ prompt: 'a'.repeat(1200), scope: ['src/foo'], thoroughness: 'normal' }` → V2. `{ prompt: 'a'.repeat(1199), ... }` → V1(경계).
2. **scope 길이 단독**: `{ prompt: 'short', scope: ['a','b','c','d','e','f'] }` → V2. 길이 5 → V1.
3. **broad pattern 단독**: 각 패턴(`.`, `./`, `src/**`, `**/*.ts`, `*/**`)을 단일 원소로 포함한 scope → 모두 V2.
4. **키워드 단독**: 영문 7개 + 한글 6개 키워드 각각을 짧은 prompt에 포함 → 모두 V2.
5. **deep thoroughness 단독**: `{ prompt: 'x', thoroughness: 'deep' }` → V2(기존 동작 회귀 확인).

### 회귀·안전성 테스트

- **짧은 quick 회귀**: `{ prompt: 'explain auth briefly', thoroughness: 'quick' }` → V1.
- **빈 입력**: `shouldUseV2ForExplore({})`, `shouldUseV2ForExplore(undefined)` → V1(throw 없음).
- **비기대 타입**: `{ prompt: 123, context: null, scope: 'src/**' }` → V1(broad pattern은 배열 아님).

### 외부 surface 회귀 테스트 (기존)

- `tests/mcp-server.test.mjs` L346-L394의 `tools/list` 분기 케이스를 그대로 통과해야 한다.
- `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`가 unset이면 `explore_v2`가 도구 목록에 노출되지 않음을 확인.
- `explore` 도구의 `inputSchema`(prompt/context/scope/thoroughness 필드)가 변경되지 않음을 확인(이미 기존 테스트가 검증).

### 실행 명령

- 부분 실행: `node --test tests/mcp-server.test.mjs` (라우터 변경 사항 빠른 피드백).
- 전체 실행: `npm test` (모든 contract/integration 회귀 포함). SC-003 충족 조건.

## Complexity Tracking

위반 사항 없음. 본 변경은 단일 함수 분기 강화이며 외부 surface·계약을 건드리지 않는다.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (없음)    | -          | -                                    |
