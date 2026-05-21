# Implementation Plan: Public Docs Refresh and Full Verification

**Branch**: `009-public-docs-and-verification` | **Date**: 2026-05-21 | **Spec**: ./specs/009-public-docs-and-verification/spec.md

**Input**: Feature specification from `./specs/009-public-docs-and-verification/spec.md`

**Origin Plan**: ./docs/superpowers/plans/2026-05-19-tool-quality-improvements.md — Task 9 (closing task)

## Summary

본 작업은 `2026-05-19-tool-quality-improvements.md`의 closing task다. 선행 Task 1(V2 truncation 문구 정정), Task 2(report-mode `citations[]`/`targets[]` 노출), Task 3(evidence-preservation 벤치마크 추가), Task 6(`explore` 라우터 휴리스틱 확장), Task 7(transcript 기반 adoption 메트릭)가 모두 master에 머지된 상태를 진입 조건으로 한다.

해당 진입 조건이 충족되었을 때 본 작업은 다음 두 가지 산출물만 생성한다.

1. 외부 가시 문서(README, DESIGN, CHANGELOG)에 본 플랜의 **신뢰 가이드라인 라벨**을 부착한다. 즉, V2 런타임이 더 많은 턴과 컨텍스트 압축을 쓰는 대신 도구 결과 truncation과 인용 누락을 어떻게 가시화하는지, report 도구가 어떤 기계 판독 필드(`citations[]`/`targets[]`)를 노출하는지, V2가 단독 보고 백엔드로 승격되기 위한 게이트 조건이 무엇인지를 공개 문서에서 직접 확인 가능하도록 갱신한다.
2. 위 라벨링의 정당성을 보장하는 **검증 파이프라인**을 실행한다. 포커스 테스트 → 전체 `npm test` → 비-provider 벤치마크 JSON 파싱 → 선택적 provider 벤치마크 순서로 실행하며, 앞 세 단계는 게이트, 마지막 단계는 기록 단계다.

본 작업은 코드/런타임/스키마/CLI 변경을 일체 포함하지 않는다. 새로운 외부 계약을 추가하지 않고, 이미 머지된 외부 계약을 공개 문서에 라벨링하는 것이 본 작업의 전부다.

## Technical Context

**Language/Version**: Node.js 20+ (저장소 기존 런타임). 본 작업 자체는 코드 변경이 없어 런타임 의존성을 추가하지 않는다.

**Primary Dependencies**: docs-only 작업이므로 신규 의존성 없음. 검증 단계에서 이미 설치된 `node:test` 기반 테스트 러너와 저장소 자체 벤치마크 스크립트만 사용한다.

**Storage**: 해당 없음.

**Testing**: 저장소 표준인 `node --test` 기반 `npm test`. 본 작업의 검증 절차는 (a) Task 1~3, 6, 7에서 추가/수정된 포커스 테스트 파일 묶음, (b) 전체 `npm test`, (c) `./benchmarks/adoption.json`과 `./benchmarks/evidence-preservation.json`의 JSON 파싱, (d) provider 키가 존재할 때만 `npm run benchmark`와 `npm run benchmark:evidence`를 수행한다.

**Target Platform**: 로컬 개발자/운영자 머신(Windows, macOS, Linux). MCP stdio 서버 자체는 변경되지 않는다.

**Project Type**: Single-package Node.js MCP 서버. 본 작업 범위는 문서 3개 + 검증 절차 실행으로 한정된다.

**Performance Goals**: 본 작업은 docs 변경이므로 런타임 성능 목표를 갖지 않는다. 단, 검증 단계 (1)~(3)이 provider 키 없이도 합리적인 시간 내에 완주되어야 한다(저장소 기존 테스트/벤치마크 인프라가 이미 그렇게 설계되어 있음).

**Constraints**:

- 코드/스키마/응답 계약 변경 금지. 새로운 환경 변수, 새로운 도구, 새로운 응답 필드 추가 금지.
- provider 키(`CEREBRAS_API_KEY` 등)는 본 작업의 게이트 단계에서 요구되지 않는다. provider 벤치마크는 선택적이며 게이트가 아닌 기록 단계다.
- README/DESIGN/CHANGELOG의 변경 영역은 본 플랜이 다룬 다섯 가지 외부 가시 변경(아래 Implementation Outline 참조)에만 한정한다. 그 외 기존 문구는 회귀시키지 않는다.

**Scale/Scope**: 변경 대상 파일은 3개(`./README.md`, `./DESIGN.md`, `./CHANGELOG.md`). 추가 또는 갱신되는 문서 분량은 README 도구 섹션 일부 갱신, DESIGN 신규 1개 섹션(“V2 Evidence Reliability Gates”), CHANGELOG 1개 릴리즈 묶음 항목으로 추산한다.

## Constitution Check

본 저장소의 `./.specify/memory/constitution.md` 또는 동등한 governance 문서를 기준으로 docs-only 작업의 게이트를 다음과 같이 자체 평가한다.

- **Read-only repo toolkit 회귀 없음**: 본 작업은 코드 변경이 없으므로 read-only 어노테이션, path 검증, secret deny-list, redaction 정책에 영향을 주지 않는다. 갱신되는 README/DESIGN 문구는 위 정책에 대한 기존 진술을 유지한다(`FR-007` 대응).
- **외부 계약 안정성**: 본 작업은 새로운 도구, 새로운 응답 필드, 새로운 환경 변수, 새로운 install 스니펫 형식을 도입하지 않는다. 변경되는 것은 “이미 존재하는 외부 계약을 외부 독자가 알 수 있도록 라벨링하는 문구”뿐이다.
- **테스트 게이트**: 본 작업은 신규 테스트를 추가하지 않으나, Task 1~3, 6, 7에서 도입된 테스트가 0 failure로 통과하는지를 게이트로 사용한다. 따라서 게이트 단계 (1)~(3)의 실패는 본 작업의 머지를 차단한다.
- **추적성**: CHANGELOG 항목이 본 플랜의 다섯 가지 외부 가시 변경을 외부 독자가 한 묶음으로 식별 가능하게 기록하므로, 다음 작업 사이클에서 어떤 변경이 본 플랜에서 왔는지를 외부 독자가 재구성할 수 있다.

Constitution 게이트 위반 사항 없음. `Complexity Tracking` 항목은 비어 있다.

## Project Structure

### Documentation (this feature)

```text
specs/009-public-docs-and-verification/
├── spec.md          # 이미 존재 (입력)
├── plan.md          # 본 문서가 채택되는 위치
└── tasks.md         # /speckit-tasks 단계 산출물 (본 plan에서는 생성하지 않음)
```

### Repository Layout (touched files)

```text
./README.md          # 도구 섹션 갱신 (FR-001, FR-002, FR-003 대응)
./DESIGN.md          # "V2 Evidence Reliability Gates" 신규 섹션 추가 (FR-004, FR-005 대응)
./CHANGELOG.md       # 본 플랜 외부 가시 변경 5개를 묶음으로 기록 (FR-006 대응)
```

**Structure Decision**: 본 작업은 코드 변경이 없는 docs-only 작업이므로 단일 저장소의 루트 문서 3개만 수정 대상이다. `./src`, `./tests`, `./benchmarks`, `./bin` 트리는 본 작업에서 변경하지 않는다. 검증 단계에서는 위 트리들의 기존 산출물(이미 머지된 테스트/벤치마크 스크립트)을 **실행만** 한다.

## Predecessor Gate

본 작업은 closing task다. 다음 다섯 가지 선행 Task가 **모두** `master`에 머지된 상태가 본 작업의 진입 조건이다.

| 선행 Task | 외부에서 식별 가능한 머지 신호 |
|---|---|
| Task 1 — V2 truncation 문구 정정 | V2 런타임 코드 또는 그 인접 테스트에서 “tool-result truncation precedes model synthesis” 라벨링이 도입되어 있음 |
| Task 2 — report-mode `citations[]`/`targets[]` 노출 | `explore`/`explore_v2` 응답의 `structuredContent`가 Markdown 본문과 더불어 `citations[]`/`targets[]`를 함께 노출하도록 변경되어 있음 |
| Task 3 — evidence-preservation 벤치마크 추가 | `./benchmarks/evidence-preservation.json` 및 대응하는 `npm run benchmark:evidence` 스크립트가 존재함 |
| Task 6 — `explore` 라우터 휴리스틱 확장 | `explore`가 broad/deep 보고 프롬프트에 한해 내부적으로 V2 백엔드를 선택하는 라우터 로직이 도입되어 있음 |
| Task 7 — transcript 기반 adoption 메트릭 | `./benchmarks/adoption.json` 또는 그 동등 산출물이 transcript에서 산출된 adoption 메트릭을 포함함 |

진입 조건 검사 절차:

1. `master` 브랜치 상의 최신 커밋이 위 다섯 Task 각각에 대한 머지 커밋을 모두 포함하는지 git log로 식별한다.
2. 다섯 신호 중 **하나라도 누락**되면 본 plan에 대응하는 docs 변경을 **진행하지 않는다**. 부분 머지 상태에서 docs만 선반영되면 README/DESIGN 문구가 코드와 어긋나 신뢰성 회귀가 발생하므로, 이는 본 작업의 hard precondition이다.
3. 다섯 신호가 모두 충족된 경우에만 아래 Implementation Outline의 단계 (a)~(d)를 시작한다.

## Implementation Outline

본 작업은 네 단계로 구성된다. 단계 (a)~(c)는 docs 갱신, 단계 (d)는 검증 파이프라인 실행이다.

### (a) `./README.md` — 도구 섹션 갱신

목표: 한 사람이 한 번의 정독으로 wrapper / `explore_repo` / `explore` / `explore_v2`의 역할 구분과 report 도구의 `citations[]`/`targets[]` 노출을 모두 식별할 수 있도록 한다(SC-001 대응).

갱신 영역:

- **도구 구분 일관화 (FR-001)**: `explore_repo`가 구조화 핸드오프의 정상 표면이고, wrapper 도구 6개(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`)가 내부적으로 `explore_repo`에 위임하는 목적형 표면이며, `explore`가 사람용 Markdown 보고 도구이고, `explore_v2`가 의도적 opt-in 상태(`CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true`)라는 점을 한 곳에서 일관되게 진술한다.
- **V2 내부 사용 가능성 (FR-002)**: `explore`가 broad 또는 deep 보고 프롬프트에 한해 내부적으로 V2 백엔드를 쓸 수 있음을 명시한다. 이것은 parent-agent가 입력으로 결정하는 것이 아니라 서버 라우터의 런타임 판단이라는 점을 분명히 한다.
- **Report 도구의 structuredContent 노출 (FR-003)**: `explore`/`explore_v2`의 report 도구가 Markdown 본문을 `text`로 반환하면서 동시에, 본문에서 파생된 기계 판독용 `citations[]`와 인용 `targets[]`를 `structuredContent`에 포함한다는 점을 명시한다. 의도는 parent agent가 file:line 인용을 regex로 긁어내지 않아도 되게 하려는 것임을 함께 적는다.
- **회귀 금지 (FR-007)**: 기존 README의 read-only 어노테이션 설명, secret deny-list 진술, install 스니펫 형식은 변경하지 않는다. 본 단계의 변경은 “도구 섹션” 영역에 한정한다.

위치 가이드: 기존 README의 “공개 MCP 도구” 섹션(`./README.md`의 도구 표와 `explore_repo`/`explore`/`explore_v2` 하위 섹션)을 1차 갱신 영역으로 삼는다. wrapper 도구 설명 표/문단은 본 갱신과 정합되도록 인접 영역만 정렬한다.

### (b) `./DESIGN.md` — “V2 Evidence Reliability Gates” 신규 섹션

목표: DESIGN 내에 단일 출처의 신규 섹션을 두어, 본 플랜이 도입한 V2 신뢰 가이드라인을 한 곳에서 확인할 수 있게 한다(SC-002 대응).

신규 섹션 제목: `V2 Evidence Reliability Gates` (정확히 한 곳만 존재해야 한다).

섹션 안에 포함되어야 하는 진술(FR-004, FR-005):

1. **Truncation 라벨링 (a)**: V2 런타임의 도구 결과 truncation은 모델이 결과를 합성하기 **이전** 단계에서 발생하며, 이 사실은 응답에 라벨 형태로 가시화된다. 따라서 V2 응답이 깔끔해 보여도 truncation 라벨이 있는 경우 호출자는 누락 가능성을 인지해야 한다.
2. **`searchCoverage.warnings` 복구 경로 (b)**: `searchCoverage.warnings`는 단순한 경고가 아니라, 호출자가 누락된 증거를 어떤 follow-up 호출로 복구할 수 있는지를 알려주는 복구 경로다. 호출자는 이를 무시하지 말고 다음 호출의 입력으로 사용해야 한다.
3. **Report-mode `citations[]`/`targets[]` 노출 (c)**: `explore`/`explore_v2`가 report-mode일 때 응답은 Markdown 본문과 함께 `structuredContent`의 `citations[]`(파일/라인 인용)와 인용에서 파생된 `targets[]`(다음 읽기/검증 대상)을 노출한다. 본 필드는 V1 `explore_repo`의 `targets[]`/`evidence[]`와는 별도의 report-mode용 필드라는 점을 분명히 한다.
4. **V2 단독 백엔드 게이트 조건 (d)**: V2가 `explore`/`explore_v2`의 **단독** 보고 백엔드로 승격되기 위한 게이트는 다음 두 조건이다.
   - evidence-preservation 벤치마크(Task 3)가 안정적인 citation 보존을 보일 것.
   - 동일 벤치마크에서 미해명 citation gap 경고(`searchCoverage.warnings` 또는 동등 신호)가 부재할 것.
   - 본 단계 전까지 V2는 opt-in/내부 사용으로 한정된다.

회귀 방지:

- 기존 DESIGN의 짧은 V2/V1 critic 차이 진술(예: `./DESIGN.md`의 critic pass 섹션, 도구 표)이 본 신규 섹션과 같은 메시지를 다른 말로 반복하지 않도록, 본 섹션을 V2 신뢰 가이드라인의 **단일 출처**로 두고 인접 기존 문단은 본 섹션으로의 짧은 참조만 남긴다.
- DESIGN의 기존 read-only/redaction/scope 관련 진술은 변경하지 않는다.

위치 가이드: 신규 섹션은 critic pass 섹션 인근(`./DESIGN.md`의 “11. deterministic critic pass” 이후, “12. 경계 강화 정책” 이전 영역)에 두어 신뢰 평가 관련 진술의 흐름과 맞춘다.

### (c) `./CHANGELOG.md` — 외부 가시 변경 5개 묶음 기록

목표: 본 플랜의 외부 가시 변경을 외부 독자가 “하나의 변경 묶음”으로 식별 가능하게 한다(SC-003 대응, FR-006).

묶음에 포함되는 5개 항목:

1. V2 truncation 문구 정정 (Task 1)
2. report-mode `citations[]`/`targets[]` 노출 (Task 2)
3. evidence-preservation 벤치마크 추가 (Task 3)
4. `explore` 라우터 휴리스틱 확장 (Task 6)
5. transcript 기반 adoption 메트릭 (Task 7)

형식 가이드:

- 본 작업은 기존 `## v0.2.0 - 2026-05-19` 항목과는 **별도의 릴리즈 묶음**(예: `## v0.3.0 - 2026-05-21`)을 생성한다. 다섯 항목은 `### Added`/`### Changed`/`### Documentation` 등의 하위 그룹으로 분배되, 외부 독자가 “이 묶음은 본 플랜의 산출물”임을 알 수 있도록 묶음 머리말 한 줄을 둔다.
- 각 항목 문구는 README/DESIGN 갱신과 같은 신뢰 가이드라인을 짧게 반복하되, 같은 메시지를 길게 늘이지 않는다.

### (d) 검증 파이프라인 실행

본 단계는 docs 머지 직전에 수행한다. 단계 (1)~(3)은 게이트, 단계 (4)는 기록 단계다.

1. **포커스 테스트**: Task 1~3, 6, 7이 도입/수정한 테스트 파일 묶음만 실행한다(예: `node --test <focus paths>`). 0 failure를 게이트로 한다(SC-004).
2. **전체 `npm test`**: 저장소 루트에서 `npm test`를 실행한다. 종료 코드 0과 failure 수 0을 게이트로 한다. skip 수는 환경(Windows/git 가용성) 의존이며 게이트가 아니다(SC-005, FR-009).
3. **비-provider 벤치마크 JSON 파싱**: `./benchmarks/adoption.json`과 `./benchmarks/evidence-preservation.json`을 JSON으로 파싱하는 명령(저장소 표준 절차에 따른 short script 또는 `node -e`)을 실행한다. 두 파일 모두 예외 없이 파싱되고 명령이 종료 코드 0으로 끝나야 한다(SC-006).
4. **(선택) Provider 벤치마크**: provider 키가 있는 환경에서만 `npm run benchmark`와 `npm run benchmark:evidence`를 순서대로 실행한다. 결과는 케이스별 PASS/FAIL과 점수·경고로 기록되며, 실패 케이스가 있어도 본 단계는 docs 머지를 차단하지 않는다. 결과는 V2가 단독 보고 백엔드로 승격될 수 있는지에 대한 판단 자료로 보관된다(SC-007, FR-009).

기록 의무: 단계 (4)를 수행한 경우, 그 결과 요약(케이스별 PASS/FAIL, 점수, 경고)은 본 작업의 PR 본문 또는 동등한 머지 기록에 남긴다. 키가 없는 환경에서 단계 (4)를 건너뛴 사실 자체도 기록 대상이다.

## Risks & Mitigations

| 위험 | 발생 시나리오 | 완화 |
|---|---|---|
| 선행 머지 위반 | Task 1, 2, 3, 6, 7 중 하나라도 미머지 상태에서 본 docs 변경이 먼저 머지되면, README/DESIGN 문구가 실제 코드 동작과 어긋나 외부 통합이 잘못된 신뢰 가정 위에서 동작한다. | 위 **Predecessor Gate** 섹션의 다섯 신호를 머지 직전에 git log로 재확인하고, 하나라도 누락 시 본 plan에 대응하는 docs 변경을 진행하지 않는다. |
| 기존 outdated V2 언급과 신규 섹션 중복 | DESIGN의 critic pass 섹션과 도구 표에는 V1/V2 차이에 대한 짧은 기존 진술이 이미 있다. 신규 “V2 Evidence Reliability Gates” 섹션이 같은 메시지를 다른 말로 반복하면 단일 출처가 깨지고, 외부 독자는 어느 쪽이 권위 있는 진술인지 알 수 없게 된다. | 신규 섹션을 V2 신뢰 가이드라인의 **단일 출처**로 두고, 인접 기존 문단은 메시지 본문을 옮기는 대신 신규 섹션으로의 짧은 참조만 남긴다. README의 도구 표 또한 같은 단일 출처를 가리키도록 정렬한다. |
| `npm test` skip 수 환경 의존성 | Windows 환경 또는 git이 일부 경로에서 사용 불가능한 환경에서는 일부 테스트가 skip된다. 운영자가 skip 수 변동을 failure 회귀로 오해하면 docs 머지가 잘못 차단된다. | 단계 (2)의 게이트는 “종료 코드 0 + failure 수 0”로 명시하고, skip 수는 게이트가 아님을 본 plan과 CHANGELOG 항목 양쪽에서 분명히 한다. |
| Provider 벤치마크 결과를 게이트로 오인 | provider 키가 있는 운영자가 단계 (4)의 실패 케이스를 docs 머지 차단 사유로 잘못 적용하면 closing task가 영구적으로 멈춘다. | 단계 (4)는 기록 단계임을 본 plan 본문, CHANGELOG, 단계 명령 출력 위치에서 모두 명시한다. provider 벤치마크 결과는 V2 단독 백엔드 승격 판단 자료로만 사용된다. |
| Docs 변경이 본 플랜 외 영역으로 확산 | 단일 PR에서 본 플랜과 무관한 README/DESIGN 문구를 함께 손대면, 회귀 추적이 어려워지고 본 작업의 산출물이 무엇이었는지 외부 독자가 재구성하기 어려워진다. | 본 plan의 단계 (a)~(c)에 명시한 영역(README 도구 섹션, DESIGN 신규 섹션, CHANGELOG 신규 묶음)만 수정한다. 그 외 문구는 회귀 금지 정책(FR-007) 아래 그대로 둔다. |

## Test Strategy

본 작업의 “테스트”는 신규 테스트 코드 추가가 아니라, 이미 머지된 게이트들이 docs 변경 시점에도 통과하는지를 확인하는 회귀 게이트다.

게이트 정의:

- **G1 — 포커스 테스트**: 단계 (d)(1) 명령이 0 failure로 종료. 실패 시 docs 머지를 차단하고 선행 Task의 회귀 가능성을 먼저 조사한다.
- **G2 — 전체 `npm test`**: 단계 (d)(2) 명령이 종료 코드 0과 failure 수 0으로 종료. skip 수 변동은 게이트가 아니다.
- **G3 — 비-provider 벤치마크 JSON 파싱**: `./benchmarks/adoption.json`과 `./benchmarks/evidence-preservation.json` 두 파일을 JSON 파서가 예외 없이 파싱하며 명령이 종료 코드 0으로 끝남.
- **R1 — Provider 벤치마크 (기록 단계, 게이트 아님)**: provider 키가 있는 환경에서 `npm run benchmark`와 `npm run benchmark:evidence`가 정상 종료. 실패 케이스가 있으면 점수와 경고가 함께 기록된다. R1의 실패는 docs 머지를 차단하지 않는다.

판정 규칙:

- G1, G2, G3가 모두 통과한 경우에만 docs 변경을 `master`에 머지한다.
- 단계 (4) R1은 키가 있는 환경에서만 수행하며, 결과는 PR 본문 또는 동등 머지 기록에 남긴다. 키가 없는 환경에서의 R1 미수행은 docs 머지를 차단하지 않는다.
- G1 또는 G2가 실패한 경우, 우선 선행 Task 1~3, 6, 7의 회귀를 의심하고 본 작업의 docs 변경 자체는 회귀 원인이 아닐 수 있음을 함께 고려한다(본 작업은 코드 변경이 없기 때문).

## Complexity Tracking

본 작업은 Constitution 게이트 위반이 없는 docs-only 작업이므로 본 섹션은 비어 있다.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (없음) | (해당 없음) | (해당 없음) |
