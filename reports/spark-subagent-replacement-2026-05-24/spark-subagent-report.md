## 목적 이해

요청은 `cerebras-explorer` MCP를 호출하지 않고, 기존 산출물 기반으로 **Spark만으로 기존 MCP의 parent-agent 토큰 절감형 탐색/평가 역할을 대체할 수 있는지**를 판단하는 것입니다.  
핵심 판단 축은 `public tool surface`의 일관성, 증거 보존성(coverage/evidence/verification), 재현성, 보안 경계, 보고서 일관성입니다.

## 실행 환경

- MCP 도구는 사용하지 않음.  
- 읽기형 쉘 탐색(`rg`, `ls`, `find`, `sed`, `wc` 등)으로만 조사.  
- 수정 없음.  
- 대상 산출물:
  - 현재 레포: `/home/kyubr/IdeaProjects/cerebras-explorer-mcp`
  - 이전 실행 보고/데이터: `reports/tool-trust-evaluation-current-2026-05-24.md`, `reports/tool-eval-current-2026-05-23T21-54-32-804Z/...`

- 테스트 레포 목록 자체는 요청 조건상 5개로 고정 확인됨:
  - `/home/kyubr/IdeaProjects/cerebras-explorer-mcp`
  - `/home/kyubr/IdeaProjects/DeepResearch`
  - `/home/kyubr/IdeaProjects/aicc_manage`
  - `/home/kyubr/IdeaProjects/bible`
  - `/home/kyubr/IdeaProjects/studious-memory`

## 이전 산출물 재현 확인

- 공개 도구 수: **10개**  
- 레포 수: **5개**  
- 총 케이스 수: **50개** (`10 × 5`)  
- 각 조합별 산출물 존재: `cases/*.json`, `cases/*.md` 각각 도구별 5개, 레포별 5개로 50개씩 존재.  
- `run-current-tool-evaluation.mjs`의 실행 계획도 동일: 도구 10개, 레포 5개 조합으로 결과를 저장하도록 고정되어 있음.

- 요약 메트릭(요약 JSON 기반):
  - failure: **0/50**
  - stoppedByBudget: **0/50**
  - scopeLimited: **50/50**
  - toolResultsTruncated: `explore`에서만 발생(사유: 출력 단일/단건형 특성), 그 외 9개 도구는 0

- 도구별 verification/complete(요약 JSON 기준):
  - `find_relevant_code`: verified / complete=true
  - `trace_symbol`: verified / complete=true
  - `collect_evidence`: verified / complete=true
  - `review_change_context`: verified / complete=true
  - `explain_code_path`: verified / complete=true
  - `find_entrypoints`: verified / complete=true
  - `map_change_impact`: targeted_read_needed / complete=true
  - `map_impact`: targeted_read_needed / complete=true
  - `explore_repo`: targeted_read_needed / complete=true
  - `explore`: 구조화 status 없음(서술형 스타일 출력)

- Evidence quality 집계(전체 50건 합산):
  - exact: 높음 집계 경향(대부분 높은 비중), 일부 partial 존재, explore는 기존 스키마 외형식으로 별도 집계.
  - `review_change_context`, `map_impact`에 partial가 상대적으로 더 많이 보임.

## Spark-only 검토 결과

- 이번 평가는 실제 Spark 서브에이전트를 실제 호출하지 못했으므로, 요청 조건에 따라 **blind reviewer 모드**로 수행(도구 description/input schema/request/response 텍스트만 기반 판단).
- 읽기/탐색 전용 도구 집합(10개 wrapper + `explore`)에 대한 “스키마 신뢰성”만으로는 MCP 대비 동일한 역할 수행이 제한적입니다.
- MCP는 런타임이 scope, secret masking, evidence 구조를 강제하는 반면, Spark-only는 이 강제 레이어를 별도 구현하지 않으면:
  - 탐색 규칙 편차,
  - evidence 형식 편차,
  - 경계 위반 여부 추적 누락
  이 발생할 여지가 큽니다.

## 동일성 비교

- **Parent 토큰 절약**  
  - MCP: 고정된 `targets`, `status`, `evidence` 구조로 부모는 읽기/grep 기반 자유 탐색보다 구조화 도구 호출 위주로 운영 가능.
  - Spark-only: 호출 간 프롬프트/요약 부담이 커져 동일한 작업량에서 토큰 소모가 오히려 증가할 수 있음(특히 다중 레포 케이스에서).

- **지연시간(latency)**  
  - MCP: 단일 회수형 규격 호출 + 캐리어 필드 표준화로 응답 단축 기대.
  - Spark-only: 도구별 재해석/요약/후처리 지연이 생기기 쉬움.

- **재현성(reproducibility)**  
  - MCP: 동일 입력/동일 스키마에서 결과 비교 용이.
  - Spark-only: 사람/세션별 서술 습관 차이 때문에 run-to-run 변동성 증가 가능.

- **tool-call 구조**  
  - MCP: `tools/call` 단일 contract + 내부에서 엄격한 라우팅.
  - Spark-only: 동일한 contract를 외부에서 재현하려면 별도 클라이언트 계층과 검사기 필요.

- **scope boundary**  
  - MCP: `_enforceScopedPath`, `omittedOutOfScopeFiles`, `searchCoverage` 기반으로 hard boundary가 코드에 내장.
  - Spark-only: 규칙을 구현하지 않으면 경계 누수/은폐 경로 노출 가능성.

- **secret redaction**  
  - MCP: `src/explorer/redact.mjs` 기반으로 secret 패턴/secret 파일 경로 마스킹이 기본 동작.
  - Spark-only: 동일 redaction 정책을 일관되게 강제하지 않으면 민감정보 유출 위험 상승.

- **report consistency**  
  - MCP: `status.verification`, `complete`, `evidenceQuality`, `failure`, `searchCoverage` 형식이 고정되어 후속 자동 처리가 쉬움.
  - Spark-only: 동일 형식 준수 자체가 구현 의존; 누락 시 자동 분석 파이프라인이 깨짐.

## 도구별 판단

- `find_relevant_code`: 사용 가능(높은 안정도). 코드 베이스 탐색 정확도와 증거 구조가 선명.
- `trace_symbol`: 사용 가능. 심볼 추적 신뢰도 양호.
- `map_change_impact`: 부분 사용. targeted_read_needed 비중으로 follow-up 코드 열람 필요.
- `map_impact`: 부분 사용. targeted_read_needed로 깊이 검증 필요.
- `explain_code_path`: 사용 가능. 경로 설명 품질은 높으나 과잉 단언 여지 점검 필요.
- `collect_evidence`: 사용 가능. 증거 수집 품질 우수.
- `review_change_context`: 조건부 사용. partial/evidenceDropped가 존재해 샘플 내 교차 확인 필요.
- `find_entrypoints`: 사용 가능. 엔트리 탐지 기반은 안정적.
- `explore_repo`: 조건부 사용. complete=true 이지만 targeted_read_needed가 다수라 2단계 확인 필요.
- `explore`: 조건부 사용. 비구조화 결과라 자동 판정 파이프라인 적합도 하락.

## 대체 가능성 판단

- 기존 MCP의 대체성은 **부분 대체 가능**입니다.  
- 이유: Spark-only로 인간이 유사 규약을 모사할 수는 있으나, MCP가 제공하는 경계·스키마·메타 신호의 강제성과 자동화 일관성을 완전 동등하게 대체하지 못함.  
- 특히 parent agent 토큰 절감 목적(“read/grep 다중 사용 최소화”)은 일부만 달성되며, 보고서 형식 재현성은 낮아집니다.

## 한계

- 실제 Spark sub-agent를 실행한 런타임 데이터가 없어, 이번 평가는 과거 산출물 기반의 정성-정량 재검토입니다.
- 과거 산출물에 대한 재해석이라 실제 최신 코드 변경 반영을 자동 증명하려면 추가 최신 스냅샷 재실행이 필요합니다.
- `explore`는 기존 규격과 다르게 구조화가 약해 도구 체인 자동화와 결합 시 취약점 존재.

## 권장 결론

**최종 결론: 부분 대체 가능**

- 권장: Spark-only를 단독 대체로 쓰지 말고, MCP와 병행 운용(또는 MCP 결과를 Spark 요약 보조로 사용).  
- MCP 유지 이유: scope boundary, redaction, structured output, reproducible 보고 포맷, 증거 메타(`verification/complete/failure/searchCoverage`)의 자동성은 현재로서는 대체가 가장 어려운 핵심 이점입니다.