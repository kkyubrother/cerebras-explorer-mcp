# Implementation Plan: Evidence Preservation Benchmark Coverage

**Branch**: `003-evidence-preservation-benchmark` | **Date**: 2026-05-21 | **Spec**: `./specs/003-evidence-preservation-benchmark/spec.md`

**Input**: Feature specification from `./specs/003-evidence-preservation-benchmark/spec.md`

**원본 참고**: `./docs/superpowers/plans/completed/2026-05-19-tool-quality-improvements.md`의 Task 3 섹션 (라인 428~597)

## Summary

본 plan은 report-mode 도구(`explore`, `explore_v2` 등 Markdown 보고서를 반환하는 도구)의 citation 보존 품질을 회귀 없이 측정하기 위한 별도의 벤치마크 suite와 평가 체크를 도입하는 작업을 구현 단위로 정리한다. 핵심 산출물은 네 가지다. (1) `./src/benchmark/evaluator.mjs`의 `evaluateCheck()` 스위치에 `min_citation_count`, `min_citation_file_count`, `tool_results_truncated_equals`, `citation_gap_warning_equals` 네 가지 신규 체크 타입을 추가한다. (2) `./benchmarks/evidence-preservation.json`을 신설해 신규 체크 4종을 모두 사용하는 케이스를 정의한다. (3) `./package.json`에 단독 진입점 `benchmark:evidence`를 추가하되, 기존 `benchmark` 스크립트와 `./scripts/run-benchmark.mjs`의 동작은 그대로 둔다. (4) `./tests/benchmark-evaluator.test.mjs`에 신규 체크의 통과/실패 양방향을 검증하는 단위 테스트를 추가한다. 평가기는 결과 객체의 구조화된 `citations[]` 배열, `searchCoverage.toolResultsTruncated`/`stats.toolResultsTruncated`, `critic.warnings[].type === 'citation_gap'`를 입력 신호로 사용한다.

## Technical Context

**Language/Version**: Node.js 22 이상 (`./package.json`의 `engines.node`가 `>=22.0.0`).

**Primary Dependencies**: 외부 런타임 의존성 없음. 표준 모듈(`node:fs/promises`, `node:path`)과 Node 내장 테스트 러너(`node --test`)만 사용한다. 평가기는 ES Module(`.mjs`)로 작성되어 있다.

**Storage**: 영속 저장소 없음. 벤치마크 suite는 `./benchmarks/*.json` 평문 JSON 파일이며, 평가 결과는 메모리 객체 또는 옵션 시 표준 출력/JSON 파일로 흘러간다.

**Testing**: Node 내장 테스트 러너. 본 작업의 테스트는 `./tests/benchmark-evaluator.test.mjs`에 추가되며, 신규 체크 4종에 대한 통과/실패 양방향을 모두 다룬다. provider를 호출하는 풀 실행은 본 spec의 통과 조건이 아니다(spec Assumptions 참조).

**Target Platform**: 로컬 개발자 머신과 CI 러너. Windows PowerShell 환경에서 npm 스크립트로 호출하는 흐름을 1차 대상으로 한다.

**Project Type**: MCP 서버 + 벤치마크 평가 CLI를 함께 갖는 단일 Node 프로젝트.

**Performance Goals**: 단위 테스트 단독 실행은 수초 내에 종료되어야 하며, 신규 suite 파싱은 동기 JSON 파싱 한 번으로 충분해야 한다.

**Constraints**: 기존 체크 타입과 기존 `benchmark` 스크립트의 동작·출력 포맷은 변경 금지(spec FR-008). 신규 체크는 결과 객체에 해당 필드가 누락된 경우에도 예외 없이 안전 기본값으로 평가되어야 한다(spec Edge Cases).

**Scale/Scope**: 신규 체크 4종, 신규 suite 파일 1개, 신규 npm 스크립트 1개, 신규 테스트 1~수 개. 코드 라인 영향 범위는 평가기 함수와 테스트, JSON suite로 한정된다.

## Constitution Check

본 저장소에는 별도의 헌법(`./.specify/memory/constitution.md`)이 강제하는 게이트가 등록되어 있지 않다. 본 plan은 다음의 일반 원칙을 자체 게이트로 적용한다.

- **회귀 금지 원칙**: 기존 `benchmark` 스크립트, 기존 adoption suite(`./benchmarks/adoption.json`), 기존 체크 타입(`min_grounded_evidence_count`, `min_evidence_snippet_count` 등)의 동작과 출력 포맷은 변경되지 않는다(spec FR-008, SC-003).
- **분리 원칙**: 신규 suite는 별도 파일과 별도 npm 스크립트로만 노출되며, 기본 `benchmark` 스크립트의 인자 기본값을 바꾸지 않는다.
- **테스트 우선 원칙**: 평가기 신규 분기 추가 전에 실패하는 단위 테스트를 먼저 작성하고, 구현 후 통과로 전환한다(원본 plan Task 3의 Step 1~Step 6 흐름).
- **안전 기본값 원칙**: `citations`, `critic.warnings`, `searchCoverage` 필드가 없거나 비배열일 때도 평가기는 예외 없이 0 또는 false로 환원한다(spec Edge Cases).

위 게이트는 Phase 0 단계(이 plan 문서) 시작 전과 Phase 1 설계 산출물 작성 후 양쪽에서 동일하게 적용된다. 현재 시점에서 위반은 없다.

## Project Structure

### Documentation (this feature)

```text
specs/003-evidence-preservation-benchmark/
├── spec.md                  # 입력 사양 (이미 존재)
├── plan.md                  # 본 파일이 최종 채택될 위치 (현재는 ./.specify/.spec-drafts/task-3-plan-draft.md 초안)
├── research.md              # Phase 0 산출 (필요 시)
├── data-model.md            # Phase 1 산출 (citations[]/coverage/critic 신호의 형태 정리)
├── quickstart.md            # Phase 1 산출 (benchmark:evidence 실행 방법)
└── tasks.md                 # Phase 2 산출 (/speckit-tasks 단계에서 생성)
```

### Source Code (repository root)

```text
src/
└── benchmark/
    └── evaluator.mjs            # 신규 체크 4종 분기 추가 위치 (evaluateCheck 스위치 + 헬퍼)

benchmarks/
├── adoption.json                # 기존 suite (변경 금지)
└── evidence-preservation.json   # 신규 suite (신규 체크 4종을 모두 사용하는 케이스 포함)

scripts/
└── run-benchmark.mjs            # 기존 진입점 (변경 금지, --suite 인자로 신규 suite 지정 가능)

tests/
└── benchmark-evaluator.test.mjs # 신규 체크의 통과/실패 양방향 단위 테스트 추가 위치

package.json                     # scripts.benchmark:evidence 항목 신설 (기존 benchmark 스크립트는 유지)
```

**Structure Decision**: 단일 Node 프로젝트 구조를 유지한다. 본 feature는 새 디렉터리를 만들지 않고, 평가기 한 파일·suite 한 파일·테스트 한 파일·`package.json`의 scripts 블록만 손댄다. 진입점은 기존 `./scripts/run-benchmark.mjs`의 `--suite` 인자를 재사용하므로 신규 스크립트 파일은 만들지 않는다.

## Dependency Note

본 작업은 **Task 2(공통 `citations[]` 배열 도입)에 강하게 종속**된다. 신규 체크 `min_citation_count`와 `min_citation_file_count`는 결과 객체의 `citations[]` 필드를 직접 읽어 개수와 고유 파일 수를 측정한다. Task 2가 선행되어 모든 report-mode 도구가 구조화된 `citations[]`를 노출하기 전에는, 평가기에 체크 분기를 추가하더라도 실제 결과 객체에는 항상 빈 배열이 들어가게 되어 "회귀 신호"를 만들지 못한다(spec Assumptions). 따라서 다음 순서를 명시한다.

1. Task 2가 머지되어 `citations[]` 노출 표면이 확정된 이후에 본 plan의 구현을 시작한다.
2. 본 plan은 `searchCoverage.toolResultsTruncated`(또는 `stats.toolResultsTruncated`)와 `critic.warnings[].type === 'citation_gap'`의 구조 또한 변하지 않는다는 전제 위에서 작성되었다. 이는 spec Assumptions에 명시된 기존 관행이며, 본 작업이 이 표면을 새로 만들지 않는다.
3. Task 2가 지연되어 `citations[]`가 도입되지 않은 상태로 본 작업만 머지되면, 평가기는 항상 0개 citation을 보고하게 되어 의도와 다른 false negative 회귀 신호를 생성한다. 이 경우 신규 suite의 케이스를 실행하지 않거나, Task 2 머지 후에만 `benchmark:evidence` 스크립트를 호출하도록 운영 절차로 보강한다.

본 의존 관계는 원본 plan의 "Ordering 가이드"(Task 2 before Task 3 because benchmarks need `citations[]`)와도 일치한다.

## Implementation Outline

### (a) 평가기에 신규 체크 4종 추가 (`./src/benchmark/evaluator.mjs`)

- `evaluateCheck()` 스위치 직전에 다음 헬퍼를 둔다(원본 plan의 Step 3 시그니처를 기준 참고로 삼되, 본 plan에서는 구현 코드를 작성하지 않는다).
  - `getCitations(result)`: `result.citations`가 배열일 때만 그대로 반환하고, 그렇지 않으면 빈 배열을 반환한다. spec Edge Cases의 "citation 배열이 `null` 또는 비배열인 경우 0으로 처리" 요구를 충족한다.
  - `countCitationFiles(result)`: `getCitations(result)`의 항목 중 `path`가 truthy인 값만 모아 `Set`으로 중복 제거 후 크기를 반환한다. spec Edge Cases의 "동일 파일을 가리키는 citation이 여러 개일 때 중복 제거" 요구를 충족한다.
  - `hasCitationGapWarning(result)`: `result.critic?.warnings`가 배열이 아닐 때 `false`로 환원하고, 배열일 때만 `warning.type === 'citation_gap'`을 검색한다. spec Edge Cases의 "critic warning 구조가 누락된 경우 false" 요구를 충족한다.
  - `toolResultsWereTruncated(result)`: `result.searchCoverage?.toolResultsTruncated`와 `getStats(result).toolResultsTruncated`(기존 헬퍼 재사용)를 각각 숫자로 강제 환원해 0 이상이면 truncation 발생으로 본다. 두 신호 중 어느 하나라도 양수면 `true`다. 두 신호가 모두 없거나 0이면 `false`다.
- `evaluateCheck()` 스위치에 다음 case를 추가한다.
  - `min_citation_count`: `actual`을 citation 개수로, `passed`를 `actual >= Number(check.value ?? 0)`로 계산.
  - `min_citation_file_count`: `actual`을 고유 cited 파일 수로, 동일하게 비교.
  - `tool_results_truncated_equals`: `actual`을 truncation 발생 여부(boolean)로, `passed`를 `actual === Boolean(check.value)`로 계산.
  - `citation_gap_warning_equals`: `actual`을 citation gap warning 존재 여부(boolean)로, 동일하게 비교.
- 반환 객체(`label`, `type`, `expected`, `actual`, `passed`, `weight`, `pointsEarned`)의 형태는 기존 분기와 동일하게 유지한다. 이로써 `evaluateBenchmarkCase()`의 가중치 합산 로직을 변경하지 않아도 된다.

### (b) 전용 suite 파일 작성 (`./benchmarks/evidence-preservation.json`)

- 최상위 필드는 기존 adoption suite와 동일하게 `name`, `description`, `defaultPassScore`, `cases` 네 가지로 구성한다. `cases`는 비어 있지 않은 배열(spec SC-002)이며, 신규 체크 4종을 모두 최소 한 번 이상 사용한다(spec FR-006).
- 최소 한 개의 케이스를 포함한다. 케이스 골격은 다음과 같다(JSON 키만 명시, 실 값은 구현 단계에서 채운다).
  - `id`, `description`, `tool`(예: `"explore"`), `args`(`prompt`/`thoroughness`/`scope` 등 report-mode 도구 인자), `expectations`(기존 keyword 그룹 방식 재사용), `checks`(신규 체크 4종을 모두 포함).
  - `checks`에는 `min_citation_count`, `min_citation_file_count`, `tool_results_truncated_equals` (`value: false`), `citation_gap_warning_equals` (`value: false`) 각각 한 항목 이상을 둔다. 가중치 합은 1.0 이하로 자유롭게 분배한다.
- 운영 정책상 케이스를 더 추가할 수 있으나, 본 plan의 통과 조건은 "케이스 1개 이상 + 4종 체크가 suite 전체에서 모두 사용"이다.

### (c) 단독 npm 스크립트 추가 (`./package.json`)

- `scripts` 블록에 `"benchmark:evidence": "node ./scripts/run-benchmark.mjs --suite ./benchmarks/evidence-preservation.json"`을 추가한다. 기존 `benchmark` 스크립트는 그대로 둔다.
- 새 스크립트는 `./scripts/run-benchmark.mjs`의 기존 `--suite` 인자를 재사용한다. `run-benchmark.mjs` 자체는 변경하지 않는다. 이는 spec FR-007/FR-008과 SC-003을 동시에 만족시키는 가장 작은 변경이다.
- 명명 충돌 회피: 기존 npm 스크립트 키와 이름이 겹치지 않는다(현재 `start`, `test`, `benchmark`, `prepublishOnly` 네 개만 존재). 콜론 네임스페이스 `benchmark:evidence`를 채택해 "벤치마크 계열의 변형"임을 표시한다.

### (d) 평가기 단위 테스트 추가 (`./tests/benchmark-evaluator.test.mjs`)

- 신규 체크 4종 각각에 대해 통과 케이스와 실패 케이스를 1쌍씩 둔다(총 8개 시나리오, 1~수 개 테스트로 묶을 수 있음). spec SC-001의 "통과/실패 두 방향" 요구를 직접 충족한다.
- 최소 검증 항목.
  - `min_citation_count`: `citations` 길이 2이고 임계 2일 때 통과, 길이 1이고 임계 2일 때 실패. `citations`가 `null`/비배열일 때 0으로 환원되어 실패하는지도 검증.
  - `min_citation_file_count`: 동일 `path` 두 개일 때 고유 1로 환원되어 임계 2에서 실패, 서로 다른 `path` 두 개일 때 통과.
  - `tool_results_truncated_equals`: `searchCoverage.toolResultsTruncated > 0`이거나 `stats.toolResultsTruncated > 0`이면 `actual === true`, 둘 다 0이거나 누락이면 `actual === false`임을 양방향 검증.
  - `citation_gap_warning_equals`: `critic.warnings`에 `type: 'citation_gap'` 항목이 있을 때 `true`, 누락이거나 다른 `type`만 있을 때 `false`.
- 기존 evaluator 테스트의 헬퍼와 호출 패턴(`evaluateBenchmarkCase(caseDefinition, result)`)을 그대로 따른다. 새로운 export는 추가하지 않는다.

## Risks & Mitigations

| 리스크 | 발생 조건 | 완화 |
|--------|-----------|------|
| `citations[]`가 없는 결과에서 신규 체크가 예외를 던져 evaluator 전체가 중단된다 | Task 2 머지 전 또는 일부 도구가 `citations`를 누락하는 경로 | `getCitations()`/`hasCitationGapWarning()`/`toolResultsWereTruncated()`가 비배열/누락 입력을 안전 기본값(빈 배열, false, 0)으로 환원한다. spec Edge Cases와 직접 대응된다. |
| 신규 suite 파일이 기존 adoption suite와 섞여 회귀 흐름을 오염시킨다 | `./benchmarks/adoption.json`에 신규 케이스를 끼워 넣는 경우 | suite는 반드시 `./benchmarks/evidence-preservation.json`이라는 별도 파일로 분리한다. 기존 adoption suite는 본 작업의 어떤 단계에서도 수정하지 않는다(spec FR-008, SC-003). |
| 새 npm 스크립트가 기존 진입점과 충돌하거나 사용자가 혼동한다 | `benchmark` 키를 덮어쓰거나, 기본 suite 경로를 바꾸는 변경 | 신규 키는 `benchmark:evidence`로 콜론 네임스페이스를 사용하고, `./scripts/run-benchmark.mjs`의 기본 `--suite` 값(`benchmarks/adoption.json`)을 변경하지 않는다. |
| 신규 체크가 통과/실패 양방향 중 한 방향만 검증되어 회귀 감지력이 떨어진다 | 단위 테스트가 행복 경로만 작성된 경우 | 평가기 단위 테스트는 4종 체크 각각에 대해 통과/실패 시나리오를 1쌍씩 명시한다(spec SC-001). |
| Task 2 지연으로 suite 실행 시 모든 케이스가 0 citation을 보고해 잘못된 회귀 신호를 만든다 | 본 plan만 먼저 머지된 경우 | 본 plan의 Dependency Note에 명시한 운영 절차(Task 2 머지 이후에만 `benchmark:evidence` 호출)를 따른다. CI 통합 시점도 Task 2 머지 이후로 미룬다. |
| 신규 체크의 boolean 환원 규칙이 모호해 `expected` 값과 `actual` 값의 타입 비교가 어긋난다 | `Boolean(undefined) === false`임을 신뢰하지 않거나 `==`를 사용하는 경우 | 평가기는 `actual === Boolean(check.value)` 형태로 엄격 비교를 유지하고, 헬퍼는 명시적으로 boolean을 반환한다. |

## Test Strategy

- **평가기 단위 테스트(양방향)**: `./tests/benchmark-evaluator.test.mjs`에서 신규 체크 4종 각각에 대해 통과 케이스와 실패 케이스를 함께 작성한다. 실패 케이스에서는 `evaluation.checks[i].passed`가 `false`이고 `actual`이 기대 환원값(예: 0, `false`)임을 함께 단언한다. spec SC-001을 직접 충족한다.
- **Edge case 가드**: `citations`가 `null`/비배열, `critic.warnings`가 누락, `searchCoverage`가 누락된 결과를 입력으로 두는 시나리오를 단위 테스트에 1개 이상 포함한다. spec Edge Cases의 네 항목을 단언으로 묶는다.
- **Suite JSON 파싱 가드**: 별도 통합 테스트 없이도, 원본 plan Step 7의 한 줄 Node 호출(`./benchmarks/evidence-preservation.json`을 `JSON.parse`하고 `Array.isArray(s.cases) && s.cases.length >= 1`을 검증)을 manual smoke 절차로 둔다. 추가로, 가능하다면 `./tests/benchmark-evaluator.test.mjs` 안에서 동일한 가드를 `fs/promises`로 읽어 단언한다(spec SC-002). 본 가드는 provider 호출 없이 동작한다.
- **기존 adoption 회귀 없음 확인**: `npm test` 전체 실행 시 기존 evaluator 테스트가 그대로 통과해야 한다(spec SC-004). 추가로, 운영자가 `npm run benchmark`를 호출했을 때 기본 suite 경로가 여전히 `./benchmarks/adoption.json`이고 출력 포맷이 변경되지 않았음을 코드 리뷰 단계에서 diff로 확인한다(spec FR-008, SC-003).
- **부정 시나리오 회귀 측정**: spec User Story 1의 Acceptance Scenario 2/3에 대응해, "report 본문에는 경로가 언급되지만 `citations[]`가 빈 배열"인 mock 결과와 "`searchCoverage.toolResultsTruncated > 0`" mock 결과 각각을 단위 테스트로 포함해 회귀 신호가 명시적으로 실패로 보고됨을 확인한다.
- **실제 provider 호출은 본 spec의 통과 조건이 아님**: spec Assumptions에 따라, 본 plan의 검증은 suite 파일 파싱과 평가기 로직만으로 종료한다. 실 provider 풀 실행은 별도 운영 결정이며, 본 작업의 acceptance에 포함되지 않는다.
