# Feature Specification: Public Docs Refresh and Full Verification

**Feature Branch**: `009-public-docs-and-verification`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Task 9 (Update Public Docs and Run Full Verification). Task 1~3, 6, 7 산출물을 README.md, DESIGN.md, CHANGELOG.md에 반영하고 npm test + benchmark JSON parse + optional provider benchmark로 전체 검증. 원본 plan: docs/superpowers/plans/2026-05-19-tool-quality-improvements.md Task 9. 카테고리: closing task, Task 1~3·6·7 선행 필수."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 외부 독자가 V2의 증거 신뢰 경계를 공개 문서만 읽고 이해 (Priority: P1)

저장소를 처음 접하는 parent agent 운영자, 통합 작성자, 검토자는 README와 DESIGN만 읽고도 "V2가 더 많은 턴을 쓰고 컨텍스트를 압축할 권리를 가지는 대신, 도구 결과 truncation과 인용 누락을 가시화해야 한다"는 본 플랜의 신뢰 가이드라인을 이해할 수 있어야 한다. 또한 report 도구가 Markdown 본문 외에 기계가 읽을 수 있는 `citations[]`와 인용에서 파생된 `targets[]`를 structuredContent로 함께 노출한다는 사실, 그리고 V2가 단독 보고 백엔드가 되기 위한 게이트 조건이 무엇인지를 공개 문서에서 직접 확인할 수 있어야 한다.

**Why this priority**: Task 1~3, 6, 7의 변경은 모두 "도구 사용자가 결과를 어디까지 믿어도 되는가"라는 외부 계약을 바꾼다. 코드와 벤치마크만 바뀌고 README/DESIGN/CHANGELOG가 옛 문구를 유지하면, 외부 통합은 잘못된 신뢰 가정 위에서 동작하고 본 플랜의 신뢰성 개선 자체가 사용자 입장에서는 존재하지 않는 것과 같다. 따라서 closing task 중에서도 P1.

**Independent Test**: 코드/벤치마크 변경이 모두 머지된 상태에서, README와 DESIGN과 CHANGELOG만 별도로 검토해도 (1) wrapper/`explore_repo`가 정상 에이전트 표면이고 `explore_v2`는 opt-in이라는 설명, (2) report 도구가 structuredContent의 `citations[]`/`targets[]`를 노출한다는 설명, (3) V2의 evidence reliability gates 섹션이 존재하는지를 정독만으로 확인할 수 있다.

**Acceptance Scenarios**:

1. **Given** Task 1~3, 6, 7의 코드 변경이 이미 본 저장소에 반영된 상태일 때, **When** 독자가 README의 도구 섹션을 읽으면, **Then** wrapper 도구와 `explore_repo`가 구조화 핸드오프용 정상 표면이라는 점, `explore`가 사람용 Markdown 보고 도구라는 점, broad/deep 보고 프롬프트에 한해 내부적으로 V2 백엔드를 쓸 수 있다는 점, `explore_v2`는 의도적으로 opt-in 상태로 남아 있다는 점, 그리고 report 도구가 Markdown 본문과 함께 structuredContent의 `citations[]`/`targets[]`를 반환한다는 점이 한 곳에 정리되어 있다.
2. **Given** 동일 상태에서, **When** 독자가 DESIGN을 읽으면, **Then** "V2 Evidence Reliability Gates"라는 명시적 섹션이 존재하며 (a) 도구 결과 truncation은 모델 합성 이전에 일어남을 라벨로 보이게 한다는 점, (b) `searchCoverage.warnings`가 누락된 증거 복구 경로를 알려준다는 점, (c) report-mode 응답이 `citations[]`와 인용 `targets[]`를 노출한다는 점, (d) V2가 단독 보고 백엔드가 되려면 evidence-preservation 벤치마크가 안정적인 citation 보존과 무경고 상태를 보여야 한다는 점이 한 섹션 안에서 모두 확인된다.
3. **Given** 동일 상태에서, **When** 독자가 CHANGELOG를 읽으면, **Then** 본 플랜의 외부 가시 변경(V2 truncation 문구 정정, report-mode `citations[]`/`targets[]` 노출, evidence-preservation 벤치마크 추가, `explore` 라우터 휴리스틱 확장, transcript 기반 adoption 메트릭)이 사용자 관점에서 한 묶음의 항목으로 식별 가능하게 기록되어 있다.

---

### User Story 2 - 운영자가 단일 명령 세트로 전체 회귀 게이트를 통과 확인 (Priority: P1)

저장소 운영자는 본 플랜에서 손댄 모든 영역(테스트, 벤치마크 suite 파일, 선택적 provider 실행)을 단일하고 재현 가능한 순서로 실행해 모든 게이트가 통과했음을 한 번에 확인하고 싶다. 즉, 포커스 테스트 → 전체 `npm test` → 비-provider 벤치마크 JSON 파싱 → (키가 있는 환경 한정) provider 벤치마크 순서로 실행했을 때 모두 의도된 종료 코드와 출력 형태로 종료되어야 하고, 어느 한 단계라도 실패하면 docs 변경을 머지할 수 없다는 점이 명확해야 한다.

**Why this priority**: docs 변경이 코드 변경의 "마지막 라벨"인 만큼, 라벨이 잘못된 코드 상태 위에 붙으면 그 자체가 새로운 회귀가 된다. 검증 절차가 운영자의 머릿속에만 있고 문서에 없으면 다음 변경 사이클에서 재현 불가능하므로 P1.

**Independent Test**: 본 작업이 머지되었다고 가정한 상태에서, 외부 운영자가 plan의 Task 9 단계만 그대로 따라 해도 (1) 포커스 테스트 명령, (2) 전체 `npm test`, (3) 비-provider 벤치마크 JSON 파싱 명령이 의도된 종료 코드(0)로 끝나고, (4) provider 키가 있을 때만 추가로 실행하는 선택적 명령이 명확히 분리되어 있는지 확인할 수 있다.

**Acceptance Scenarios**:

1. **Given** 본 플랜의 코드/테스트/벤치마크 변경이 머지된 상태일 때, **When** 운영자가 plan Task 9의 포커스 테스트 명령을 그대로 실행하면, **Then** 0 failure로 종료된다.
2. **Given** 동일 상태에서, **When** 운영자가 `npm test`를 실행하면, **Then** 종료 코드 0으로 종료되고 failure 수는 0이며 skip 수만 환경에 따라 달라진다.
3. **Given** 동일 상태에서, **When** 운영자가 `benchmarks/adoption.json`과 `benchmarks/evidence-preservation.json`을 JSON으로 파싱하는 비-provider 검증 명령을 실행하면, **Then** 두 파일 모두 예외 없이 파싱되고 명령은 종료 코드 0으로 끝난다.
4. **Given** provider 키가 있는 환경일 때, **When** 운영자가 `npm run benchmark`와 `npm run benchmark:evidence`를 순서대로 실행하면, **Then** 두 명령이 정상 종료되며 케이스별 PASS/FAIL 요약을 출력한다.

---

### Edge Cases

- Task 1~3, 6, 7 중 하나라도 미머지 상태에서 본 docs 변경만 선반영되는 경우, README/DESIGN 문구가 실제 코드 동작과 어긋난다. 본 작업은 이 순서 위반을 사전에 차단하는 의존성을 명시적으로 가져야 한다.
- README의 도구 설명이 wrapper, `explore_repo`, `explore`, `explore_v2`를 모두 언급하지만 어느 하나가 변경 결과와 모순되는 옛 문구를 남겨 두면 안 된다. 갱신 영역은 한 곳에 모이거나 모두 같은 메시지를 일관되게 반복해야 한다.
- DESIGN의 V2 관련 짧은 기존 언급(truncation, V1/V2 critic 차이)이 신규 "V2 Evidence Reliability Gates" 섹션과 중복되거나 충돌하는 경우, 양쪽이 같은 메시지를 다른 말로 반복하지 않도록 단일 출처를 유지해야 한다.
- CHANGELOG가 본 플랜 항목들을 단일 릴리즈 묶음 대신 흩어진 줄로 기록할 경우, 외부 독자는 어떤 변경이 동일 플랜에서 왔는지 알 수 없다. 한 묶음으로 모이는 표현이 필요하다.
- 전체 `npm test`가 Windows/git 가용성에 따라 skip 수가 달라지지만, failure 수는 환경 무관하게 0이어야 한다. skip 수 변동을 failure로 오해하지 않도록 운영자가 참고할 수 있는 기대 동작이 문서화되어 있어야 한다.
- provider 벤치마크는 키가 없는 환경에서는 실행 자체가 불가능하다. 본 검증 절차는 provider 단계의 실패가 게이트가 아닌 "기록 대상"임을 분명히 해야 한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: README는 wrapper 도구와 `explore_repo`를 구조화 핸드오프의 정상 표면으로, `explore`를 사람용 Markdown 보고 도구로, `explore_v2`를 의도적 opt-in 상태로 한 곳에서 일관되게 설명해야 한다.
- **FR-002**: README는 `explore`가 broad 또는 deep 보고 프롬프트에 한해 내부적으로 V2 백엔드를 쓸 수 있음을, parent-agent 결정 사항이 아닌 런타임 세부사항으로 명시해야 한다.
- **FR-003**: README는 report 도구가 Markdown 본문을 text로 반환하면서 동시에 파생된 `citations[]`와 인용 `targets[]`를 structuredContent에 포함한다는 점을, parent agent가 file:line 인용을 regex로 긁어내지 않아도 되도록 한다는 의도와 함께 설명해야 한다.
- **FR-004**: DESIGN은 "V2 Evidence Reliability Gates" 제목의 단일 섹션을 가져야 하며, (a) 도구 결과 truncation이 모델 합성 이전에 일어남을 라벨로 가시화한다는 점, (b) `searchCoverage.warnings`가 누락된 증거를 복구할 경로를 호출자에게 알려준다는 점, (c) report-mode 응답이 `citations[]`와 인용 `targets[]`를 노출한다는 점을 한 섹션 안에서 모두 진술해야 한다.
- **FR-005**: 동일 DESIGN 섹션은 V2가 단독 보고 백엔드가 되기 위한 게이트 조건(evidence-preservation 벤치마크가 안정적인 citation 보존과 미해명 citation gap 경고 부재를 보일 것)을 명시해야 한다.
- **FR-006**: CHANGELOG는 본 플랜의 외부 가시 변경(V2 truncation 문구 정정, report-mode `citations[]`/`targets[]` 노출, evidence-preservation 벤치마크 추가, `explore` 라우터 휴리스틱 확장, transcript 기반 adoption 메트릭)을 외부 독자가 한 묶음으로 식별할 수 있는 형태로 기록해야 한다.
- **FR-007**: README/DESIGN/CHANGELOG의 신규 또는 갱신 문구는 본 플랜에서 변경되지 않은 기존 외부 계약(예: 도구 read-only 어노테이션, 시크릿 redaction 정책, install 스니펫 형식)에 대한 설명을 회귀시키지 않아야 한다.
- **FR-008**: 검증 절차는 (1) 포커스 테스트 파일 묶음 실행, (2) 전체 `npm test` 실행, (3) `benchmarks/adoption.json`과 `benchmarks/evidence-preservation.json`의 JSON 파싱 확인, (4) provider 키가 있는 환경에 한해 `npm run benchmark`/`npm run benchmark:evidence` 실행이라는 단계 순서로 수행되어야 한다.
- **FR-009**: 검증 절차는 단계 (1)~(3)에서 모두 0 failure 및 종료 코드 0을 게이트로 가져야 하며, 단계 (4)의 결과는 게이트가 아니라 케이스별 PASS/FAIL과 점수·경고를 기록하는 단계로 분리되어야 한다.
- **FR-010**: 본 작업은 Task 1(truncation 문구), Task 2(citations[] 노출), Task 3(evidence-preservation 벤치마크), Task 6(`explore` 라우터 휴리스틱), Task 7(transcript 기반 adoption 메트릭)이 모두 머지된 이후에만 진행되어야 하며, 어느 하나라도 미반영된 상태에서 docs 갱신이 선행되지 않아야 한다.

### Key Entities *(include if feature involves data)*

- **Public Docs Surface**: 외부 독자가 본 플랜의 신뢰 가이드라인을 확인하는 단일 접점. 구성 요소는 README의 도구 섹션, DESIGN의 V2 evidence gates 섹션, CHANGELOG의 본 플랜 항목 묶음.
- **Verification Pipeline**: docs 변경의 정당성을 보장하는 단계 묶음. 포커스 테스트, 전체 테스트, 비-provider 벤치마크 JSON 파싱, 선택적 provider 벤치마크의 네 단계로 구성되며 앞 세 단계는 게이트, 마지막 단계는 기록 단계.
- **Predecessor Task Set**: 본 작업이 정상적으로 진행되기 위해 선행되어야 하는 플랜 내부 작업 집합. Task 1, Task 2, Task 3, Task 6, Task 7로 구성된다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: README의 도구 섹션을 정독했을 때, wrapper/`explore_repo`/`explore`/`explore_v2`의 역할 구분과 report 도구의 structuredContent `citations[]`·`targets[]` 노출이 한 사람의 1회 정독으로 모두 식별 가능하다(여러 섹션을 교차 추적해야만 알 수 있는 상태이면 실패).
- **SC-002**: DESIGN에 "V2 Evidence Reliability Gates" 제목의 섹션이 정확히 한 곳 존재하며, FR-004와 FR-005에서 요구한 모든 진술이 해당 섹션 안에서 확인된다.
- **SC-003**: CHANGELOG를 보았을 때, 본 플랜의 외부 가시 변경 다섯 항목(truncation 문구, `citations[]`/`targets[]`, evidence-preservation 벤치마크, `explore` 라우터, transcript adoption 메트릭)이 외부 독자 입장에서 한 묶음으로 식별 가능하다.
- **SC-004**: plan Task 9의 포커스 테스트 명령이 0 failure로 종료된다.
- **SC-005**: 저장소 루트에서 `npm test`를 실행했을 때 종료 코드 0과 0 failure로 끝난다. skip 수는 환경 의존이며 게이트가 아니다.
- **SC-006**: `benchmarks/adoption.json`과 `benchmarks/evidence-preservation.json`을 JSON으로 파싱하는 비-provider 검증 명령이 두 파일 모두에 대해 예외 없이 통과하고 종료 코드 0으로 끝난다.
- **SC-007**: provider 키가 있는 환경에서 `npm run benchmark`와 `npm run benchmark:evidence`가 정상 종료되어 케이스별 PASS/FAIL 요약을 출력하며, 실패 케이스가 있으면 점수와 경고가 함께 기록된다. 본 단계의 실패는 그 자체로 docs 머지를 차단하지 않고 V2가 단독 보고 백엔드로 승격될 수 있는지에 대한 판단 자료로 보관된다.

## Assumptions

- 본 작업은 closing task이며, Task 1(V2 truncation 문구 정정), Task 2(report-mode `citations[]`/`targets[]` 노출), Task 3(evidence-preservation 벤치마크 추가), Task 6(`explore` 라우터 휴리스틱 확장), Task 7(transcript 기반 adoption 메트릭)이 모두 본 저장소에 머지된 이후에만 진행된다. 어느 하나라도 미머지 상태에서 docs를 먼저 갱신하면 문서가 코드와 어긋나 신뢰성 회귀가 발생하므로, 선행 머지가 본 작업의 진입 조건이다.
- 본 작업의 범위는 README, DESIGN, CHANGELOG의 문구 갱신과 plan에 명시된 검증 절차의 실행 및 기록에 한정한다. 같은 메시지를 코드 주석, 별도 가이드 문서, 통합 예제까지 확산시키는 작업은 범위 밖이며 후속 작업에서 다룬다.
- 본 작업은 새로운 외부 계약(새 도구, 새 응답 필드, 새 환경 변수 등)을 추가하지 않는다. 기존 코드/벤치마크 변경이 이미 만든 외부 계약을 공개 문서에 라벨링하는 작업으로 한정된다.
- 검증 절차의 단계 (1)~(3)은 provider 키 없이도 재현 가능해야 하며, 단계 (4)는 키가 있는 운영자만 수행한다. 키가 없는 환경에서 단계 (4)를 건너뛰는 것은 본 작업 통과의 결격 사유가 아니다.
- 전체 `npm test`의 skip 수는 Windows 또는 git 가용성 등 환경 조건에 따라 달라질 수 있다. failure 수가 0이고 종료 코드가 0이면 본 작업 관점에서 통과로 간주한다.
- provider 벤치마크 결과는 V2가 단독 보고 백엔드로 승격될 수 있는지를 결정하기 위한 판단 자료로 사용된다. 본 작업은 그 판단을 강제하지 않고, 결과를 가시화하는 데에서 종료한다.
