# Implementation Plan: V2 Truncation Trust Wording

**Branch**: `001-v2-truncation-trust-wording` | **Date**: 2026-05-21 | **Spec**: `specs/001-v2-truncation-trust-wording/spec.md`

**Input**: Feature specification from `specs/001-v2-truncation-trust-wording/spec.md`

## Summary

이 기능은 `src/explorer/runtime.mjs`의 `applyToolResultCharBudget()`이 도구 결과를 잘라낸 뒤 모델에게 다시 넘길 때 붙이는 신뢰성 메시지를 교정한다. 현재 메시지는 "Full data was inspected; key content preserved above"라고 단언하지만 실제로는 직렬화된 결과의 꼬리를 잘라 버렸기 때문에, 모델은 자신이 보지 못한 증거까지 인용하거나 보고서의 커버리지를 과대 평가한다. 또한 `buildSearchCoverage()`가 노출하는 `toolResultsTruncated` 경고도 단순 카운트만 제공하고 상위 에이전트(Claude Code, Codex, Gemini CLI)에게 복구 액션을 안내하지 않는다.

기술 접근은 (1) 새로운 상수 `TRUNCATED_TOOL_RESULT_MARKER`를 도입해 절단 이벤트의 단일 진실 공급원을 마련하고, (2) `applyToolResultCharBudget()` 반환 문자열을 정직한 절단 선언과 복구 지침("re-run with a narrower query or read specific ranges if expected evidence is missing")으로 교체하며, (3) V2 카운터를 substring `[truncated:`가 아닌 새 마커 기반으로 전환하고, (4) `buildSearchCoverage()` 경고 텍스트를 동일한 복구 지침과 정렬한다. 공개 도구 표면, 환경 변수, JSON Schema는 건드리지 않으며 압축·캐시·redaction 경로에도 영향이 없는 plain-text 변경이다. 신규 회귀 테스트 한 건을 `tests/runtime.mock.test.mjs`에 추가해 envelope와 `searchCoverage.warnings`를 한 fixture에서 동시 검증한다.

## Technical Context

**Language/Version**: Node.js 20+ (ESM only)

**Primary Dependencies**: 없음. 본 레포는 zero runtime dependency 불변을 유지하고 있고, 이번 변경은 새 dep을 추가하지 않는다.

**Storage**: 해당 없음 (탐색기는 read-only이며 영속 저장소를 갖지 않는다)

**Testing**: built-in `node:test`. 신규 회귀는 `tests/runtime.mock.test.mjs`에 단일 케이스로 추가하며, 전체 스위트는 `npm test`로 회귀를 차단한다.

**Target Platform**: Node 20+ 위에서 동작하는 MCP JSON-RPC stdio 서버. 변경 대상은 호스트 OS와 무관한 순수 JS 헬퍼다.

**Project Type**: MCP server library (single project, `src/` + `tests/` 구조)

**Performance Goals**: 현행 per-tool 문자 예산(`TOOL_RESULT_CHAR_BUDGETS`)을 그대로 유지한다. 절단 사실 자체와 카운트 증감 동작은 기존과 같으며, 마커 문자열 길이가 수 십 바이트 늘어나는 정도 외에는 모델 컨텍스트 부담 변화가 없다.

**Constraints**:
- Zero runtime dependency 유지 (AGENTS.md 불변).
- Read-only 파일 접근 정책 유지 — 본 변경은 새 I/O 경로를 만들지 않는다.
- Secret deny-list / `redactValue` 호출 순서를 변경하지 않는다 (절단 전 redaction이 먼저 수행되어야 함).
- 공개 도구 표면(8개)과 compact contract(`directAnswer`, `status`, `targets`, `evidence`, `uncertainties`, `nextAction`, `sessionId`, `searchCoverage`)에 새 필드를 추가하지 않는다.

**Scale/Scope**: 단일 helper 함수 교체 + 마커 상수 1개 + 카운터 1줄 수정 + `buildSearchCoverage` 경고 텍스트 1줄 수정 + 회귀 테스트 1건. 변경 LOC는 10~20 줄 수준.

## Constitution Check

저장소 `constitution.md`은 현재 템플릿 자리 표시자 상태이므로 본 plan은 AGENTS.md와 CLAUDE.md에서 명문화된 가드레일을 기준으로 게이트를 통과한다:

- **Zero-dep 유지**: `package.json`의 `dependencies` / `devDependencies` 변동 없음. 통과.
- **Read-only 경계 유지**: 새 쓰기/삭제 경로 없음. 통과.
- **공개 표면 보존**: wrapper 8종, `explore`, `explore_v2` opt-in 정책에 변동 없음. JSON Schema 변경 없음. 통과.
- **Secret redaction 정책**: `applyToolResultCharBudget()`는 `redactValue()` 결과를 직렬화한 뒤 절단한다. 본 변경도 동일 순서를 유지하므로 마커가 redaction 이전 데이터에 노출되지 않는다. 통과.
- **문서-코드 동기화 매트릭스**: 이번 변경은 사용자 노출 문자열 한 가지("Full data was inspected" → 새 마커/메시지)이며 `examples/expected-response.json`은 절단 분기를 직접 표시하지 않으므로 별도 갱신 대상이 아니다. 단, `tests/integrations.test.mjs`의 prose-drift 스냅샷이 동일 표현을 잡고 있지 않은지 npm test로 검증한다(현재 grep으로 미발견). 통과 조건부.

위반 사항 없음 → Complexity Tracking 표 작성 불필요.

## Project Structure

### Documentation (this feature)

```text
specs/001-v2-truncation-trust-wording/
├── spec.md              # 작성 완료 (feature 브랜치 한정)
├── plan.md              # 본 문서
├── research.md          # N/A — 외부 라이브러리 조사 없음, 단일 helper 교체
├── data-model.md        # N/A — 새 엔터티/필드 없음, 텍스트 마커만 변경
├── quickstart.md        # N/A — 사용자 워크플로 변경 없음
├── contracts/           # N/A — JSON Schema / 공개 도구 contract 무변동
└── tasks.md             # /speckit-tasks 단계에서 생성
```

### Source Code (repository root)

```text
src/
└── explorer/
    └── runtime.mjs          # [변경] applyToolResultCharBudget(), 마커 상수, V2 카운터, buildSearchCoverage() 경고

tests/
└── runtime.mock.test.mjs    # [추가] freeExploreV2 truncation envelope + searchCoverage warning 회귀
```

**Structure Decision**: 본 레포의 기존 단일 프로젝트 구조(`src/` + `tests/`)를 그대로 사용한다. 새 디렉터리나 모듈을 만들 필요가 없고, 변경 대상은 정확히 한 파일의 두 함수와 한 호출부, 그리고 한 테스트 파일이다.

## Implementation Outline

각 단계는 작고 독립적으로 검증 가능하도록 구성한다. 회귀 테스트를 먼저 작성해 red→green 사이클을 따른다(원본 plan Task 1과 동일 구조).

1. **마커 상수 도입**: `src/explorer/runtime.mjs` 상단(또는 `applyToolResultCharBudget()` 바로 위)에 `const TRUNCATED_TOOL_RESULT_MARKER = '[truncated-tool-result-before-synthesis]';`를 추가한다. 이 상수가 envelope·카운터·경고의 단일 진실 공급원이 된다.

2. **`applyToolResultCharBudget()` 교체**: 반환 문자열에서 "Full data was inspected; key content preserved above" 문구를 제거하고 `TRUNCATED_TOOL_RESULT_MARKER`와 함께 "Result was truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing." 문장을 포함하도록 한다. preview slice 길이도 새 마커 + 메시지 길이에 맞춰 `budget - 180` 정도로 조정한다.

3. **V2 카운터를 마커 기반으로 전환**: 현재 `serialized.includes('[truncated:')` 휴리스틱을 `serialized.includes(TRUNCATED_TOOL_RESULT_MARKER)`로 교체한다. 호출부는 `src/explorer/runtime.mjs` 2188행 인근 `freeExploreV2` 루프 안 한 곳이다. (V1 `freeExplore` 경로도 동일 helper를 거치므로 별도 수정은 불필요하나, V1 측에서 카운터를 읽는 코드가 있다면 같은 마커로 통합한다.)

4. **`buildSearchCoverage()` 경고 강화**: 443행의 "N tool result(s) were truncated before final synthesis." 문장을 "N tool result(s) were truncated before model synthesis; re-run with a narrower query or read specific ranges if expected evidence is missing." 로 교체해 envelope 메시지와 동일한 복구 지침을 노출한다.

5. **회귀 테스트 추가**: `tests/runtime.mock.test.mjs`에 원본 plan Step 1의 `freeExploreV2 labels truncated tool results as incomplete before synthesis` 테스트를 삽입한다. 한 fixture가 700행짜리 대용량 파일을 만들고 단일 tool call을 발생시켜 (a) tool 메시지에 "Result was truncated before model synthesis"가 포함되고 "Full data was inspected"가 포함되지 않음, (b) `searchCoverage.toolResultsTruncated === 1`, (c) `searchCoverage.warnings` 중 적어도 하나가 `/expected evidence is missing/i`에 매칭됨을 한 블록에서 검증한다.

6. **`npm test` 전수 확인**: 회귀 외에 prose-drift 가드(`tests/integrations.test.mjs`)와 기존 스냅샷 테스트들이 새 메시지에 충돌하지 않는지 확인한다. 충돌 시 본 plan의 Risks 항목에 따라 옛 문구를 어서션하는 테스트가 있는지 추가 점검한다(현재 grep 결과 tests/ 하위에는 충돌 후보 없음).

## Risks & Mitigations

- **옛 문구를 어서션하는 기존 회귀 테스트가 잠복**: 사전 grep으로 `tests/` 디렉터리에는 "Full data was inspected"를 단언하는 테스트가 없음을 확인했다. 그러나 `tests/integration-script.test.mjs`와 `tests/schemas.test.mjs`가 `toolResultsTruncated` 필드를 참조하므로, 카운터 의미는 유지(절단 envelope 당 1 증가)하여 회귀를 피한다. 만약 새 메시지가 prose-drift 스냅샷에 걸리면 동일 PR에서 스냅샷도 갱신한다(매트릭스 항목 "사용자 노출 문자열").
- **캐시 / transcript 재생과 옛 문구의 잔존**: spec FR 가정대로 옛 envelope 문구는 캐시·transcript replay 어느 경로에도 하드코딩되어 있지 않다. `src/explorer/runtime.mjs` 외에서는 텍스트가 발견되지 않음. transcript는 `transcript.record('tool', ...)`로 원본 객체를 기록하므로 envelope 문자열을 재가공하지 않는다. mitigation: PR 진입 전 `git grep "Full data was inspected"`를 한 번 더 돌려 잔존 0을 확인한다.
- **마커 기반 카운터 false-negative**: 다른 코드 경로가 helper를 우회해 자체적으로 절단 문자열을 만들 가능성. 현재 호출은 V1·V2 단일 진입점이므로 위험은 낮으나, 마커 상수는 module-level export 없이 함수 위에 두고 동일 파일 내 호출자만 사용하도록 제한한다(공개 API 누출 방지).
- **redaction 순서 회귀**: helper는 `JSON.stringify(redactValue(toolResult).value)`를 먼저 수행하고 그 결과를 잘라낸다. 마커 문자열에 secret-like 패턴(예: `[A-Z0-9]{20,}`)이 포함되지 않도록 plain ASCII로만 유지한다. 현재 제안 마커 `[truncated-tool-result-before-synthesis]`는 redact deny-list 패턴과 무관하다.

## Test Strategy

- **신규 단위 테스트 (1건)**: `tests/runtime.mock.test.mjs::"freeExploreV2 labels truncated tool results as incomplete before synthesis"` — 원본 plan Step 1 코드를 그대로 사용. 한 fixture에서 envelope 텍스트와 `searchCoverage.warnings`를 동시 검증해 SC-001/SC-002/SC-003/SC-004를 한 블록으로 커버한다.
- **기존 truncation 관련 테스트 영향**:
  - `tests/integration-script.test.mjs:40` — `toolResultsTruncated: 0` 기대값만 사용하므로 변경 없음 예상.
  - `tests/schemas.test.mjs:266` — 필드 존재성만 검증하므로 변경 없음.
  - `tests/integrations.test.mjs` prose-drift 스냅샷 — 회귀 실행으로 충돌 여부 확인. 충돌 시 새 메시지를 반영해 스냅샷 갱신(같은 PR).
- **수동 검증**: 변경이 추론 경로를 건드리므로 AGENTS.md 규칙에 따라 `CEREBRAS_API_KEY` 보유 시 `node scripts/integration-test.mjs`도 한 번 실행해 실제 모델이 새 envelope 텍스트를 받아도 회귀 없음을 확인한다(필수는 아님, 비용 발생).
- **합격 기준**: `npm test` 전수 통과 + 신규 테스트 1건 green + grep으로 옛 문구 잔존 0건.
