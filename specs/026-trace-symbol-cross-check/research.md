# Phase 0 Research: trace_symbol usage cross-check enforcement

**Date**: 2026-06-10 | **Spec**: [spec.md](./spec.md)

조사 방법: 두 개의 독립 조사(빈 재현 실측, 통합 지점 매핑)와 근원 원인 주장에 대한
적대적 검증(독립 재현 6회 포함)을 수행했다. 검증 verdict: **confirmed**.
모든 line 번호는 2026-06-10 working tree (`057d4d8`) 기준 — 구현 전 재확인 필요.

## R1. FR-001 근원 원인 baseline (실측 확정)

**Decision**: 2026-06-10 프로브의 호출처 누락은 **defect + inherent cap 복합**
(`inherentCapOrDefect=both`)으로 분류한다. 인과 체인:

1. `repo_symbol_context`(`symbolContext`)의 내부 grep이 `maxResults: 40`
   하드코딩 (`repo-tools.mjs:1085`) — budget 기본 `maxSearchResults=80`
   (`config.mjs:157`)의 절반이며, `this.grep` 직접 호출이라 grep 캐시
   (`:1700-1717`)도 우회한다 (`:1815`의 "internally uses cached grep" 주석은
   스테일 — 실제 미사용).
2. `buildReportCritic`의 저장소 전수 매치는 **58개** (md 30: specs 18 +
   reports 9 + plan/docs 3; mjs 28: critic.test 21 + runtime.mock.test 2 +
   **runtime.mjs 4** + critic.mjs 정의 1) — 40-cap을 초과해 매 호출 18개가
   절단된다.
3. ripgrep fast path는 정렬 없이 병렬 실행 (`repo-tools.mjs:790-815, :834,
   :867` 선착순 break) → **어떤 18개가 떨어질지 호출마다 비결정**.
4. `isCallableUsage`가 `reference` relation(markdown 산문 언급 포함)까지
   caller로 집계 (`repo-tools.mjs:48-51`) → 53개 비프로덕션 매치가
   `callers.slice(0, 20)` 2차 절단 (`:1147, :1161`)의 슬롯을 잠식.
5. 결과: 재현 11회(조사 5 + 검증 6) 중 runtime.mjs 호출처 포함 **3회뿐**,
   1~2회는 정의(critic.mjs:528)조차 null (40-cap 탈락). `discoveredPaths`는
   절단된 도구 반환에서만 수집되므로(`runtime.mjs:1665-1667` +
   `repo-tools.mjs:1857-1866`) 프로브의 discoveredPaths 누락과 정확히 일치.
6. 모든 반환이 `truncated: true`, `callerCount 39~40 > callers.length 20`을
   노출했지만, symbol-first 전략 프롬프트는 **"If no result"일 때만** fallback을
   지시 (`prompt.mjs:291`) — truncation 신호에 대한 후속 지시 부재.

**Rationale**: 분류기 결함이 아니다 — runtime.mjs:2394는 살아남기만 하면
`call`로 정상 분류된다. 검색 결함도 아니다 — maxResults=500 grep은 매회
4개 라인을 안정적으로 반환한다. 누락은 순수하게 **절단 정책**(cap 크기,
비결정 순서, 다양성 없는 2차 절단)과 **신호 무시 유도**(truncated에 대한
프롬프트 침묵)의 조합이다.

**부수 발견** (이번 spec의 1차 원인 아님, 기록용):
- `estimateEndLineBraces`가 구조분해 파라미터의 `}`를 본문 종료로 오인해
  `buildReportCritic` 정의를 528-535로 과소 추정 (실제 본문 끝 :672)
  (`symbols.mjs:216-248`).
- report(freeExplore) 모드의 `repo_symbol_context` char budget 8000자
  (`runtime.mjs:157-187`, `:2229` 적용)를 직렬화 길이(5729~8286자)가
  넘나들며, runtime.mjs가 살아남은 결과일수록 8000을 초과해 report 모드에서
  추가 절단될 가능성이 높다. compact 루프는 char budget 없이 원문 전달
  (`:1743`).
- `mergeDiscoveredPaths`의 50개 상한(`runtime.mjs:360, :799-818`)은 이론상
  추가 탈락 지점이나 이번 프로브의 원인이 아님.

**Alternatives considered**: scope/secret/ignore 필터 배제설(기각 — 500-cap
grep이 매회 포함), classifyReference 분류 결함설(기각 — run4에서 4개 전부
caller 집계), 모델 측 8000자 절단설(기각 — compact 루프는 budget 없음,
discoveredPaths는 절단 전 기준).

## R2. 인덱서 fix 방향 (FR-001 후속 fix)

**Decision**: **우선순위화 + 다양성 보존 절단**을 채택한다.
1. `symbolContext` 내부 grep을 `budgetConfig.maxSearchResults`(80)로 상향
   (이 저장소 전수 58 < 80).
2. `slice(0, 20)` 전에 결정적 정렬: (a) 코드 파일 우선
   (`detectLanguage(path) !== 'generic'` — .md 후순위), (b) relation 가중치
   `call/member_call/constructor` > `reference`, (c) 파일당 상한(3개)
   round-robin — 단일 테스트 파일 21개 매치의 cap 독식 방지.
3. 수집 직후 (path, line) 정렬로 결정성 확보 — 동일 입력 동일 출력.
4. 프롬프트 보강: `prompt.mjs:291`의 "If no result"를 "If no result **or the
   result reports `truncated: true`**"로 확장 (FR-006과 결합).

**Rationale**: 기존 `classifyReference`/`detectLanguage` 재사용만으로 구현
가능 — zero-dep regex 원칙 내. cap 상향 단독으로는 58>cap인 더 큰 저장소에서
불충분하므로 (b)(c)가 본체다. 정렬은 우선순위 정렬과 결합해야 의미 있다
(`--sort path` 단독은 알파벳순으로 docs/·plan/·reports/·specs/가 src/보다
앞이라 **결정적으로 누락**시킬 수 있음 — 검증 run4가 실증).

**Alternatives considered**:
- `rg --sort path` 단독 (기각 — 위 결정적-누락 문제 + 단일 스레드 강제로
  대형 저장소 지연).
- 비코드 매치를 callers에서 제외하거나 별도 `docMentions` 필드로 분리
  (기각 — 반환 스키마 변경으로 소비자 동반 수정 필요; `reference` 강등은
  다중 행 import의 named import(runtime.mjs:41)도 강등시킴. 정렬 가중치로
  같은 효과를 스키마 변경 없이 달성).

## R3. Gate 통합 지점 (FR-002/FR-003)

**Decision**: gate는 `buildResultStatus`(`runtime.mjs:984-1014`)의 verified
확정 **이후** 후처리 분기로 넣는다: `taskMode === 'symbol_trace'`이고 usage
cross-check 미관측이면 `verification = 'targeted_read_needed'`.
- 대상 심볼은 `args.hints.symbols[0]` (trace_symbol wrapper가
  `server.mjs:362-373`에서 항상 설정; 별도 입력 추가 불필요 — FR-007 충족).
- `complete`는 기존 규칙(`:1003` — targeted_read_needed도 true)을 그대로
  따른다 (FR-003).
- 판정 호출부(`runtime.mjs:1868-1881`)에 args/stats가 모두 있으므로 자연
  합류. 부수효과: `buildNextAction`(:1016-1028)이 stop→read_target.
- critic fail(:993 분기)이 먼저 걸리는 경우 gate는 발화하지 않는다 — 이중
  경고 금지 edge case 충족.

**관측 기록**: compact tool loop의 관측 표준 위치(`runtime.mjs:1655-1663`,
`observedRanges`/`observedGit` 초기화 :1473-1474와 동일 패턴)에서 **args
기반**으로 수집한다: `repo_grep` → `toolArgs.pattern`, `repo_references` →
`toolArgs.symbol`. 기존 grep 기록(:1675)은 matches **결과** 기반이라
0-match 시도를 놓치므로 args 기반 기록이 별도로 필요하다 (spec edge case
"attempt counts"). `repo_symbol_context`는 gate 충족으로 치지 않는다 —
프로브의 실패 모드가 바로 단일 symbol lookup 신뢰다. report 루프
(`:2182-2230`)는 비대상 (FR-007).

**매칭 규칙**: 관측된 grep pattern이 bare symbol name을 substring으로
포함하거나, `repo_references`가 해당 symbol로 호출됐을 것 (대소문자 구분).

## R4. Confidence cap 재사용 (FR-003)

**Decision**: `runDeterministicCriticPass`(`critic.mjs:436-483`)의
`evaluateConfidence` 결과에 gate-fail 시 `finalConfidence`를 **medium으로
cap**한다 (modelConfidence는 보존). 기존 `confidence_downgraded` 경고
(`critic.mjs:395-402`)가 자동 발화하므로 별도 경고 불필요.
- **cap은 반드시 medium까지만**: low로 떨어뜨리면 `buildResultStatus`의
  `:995` 분기(low→`follow_up_needed`)에 걸려 FR-003 위반 + complete:false로
  뒤집힘 (통합 조사가 식별한 결정적 제약).
- `runDeterministicCriticPass` 호출부(`runtime.mjs:1829-1837`)에 gate 입력
  (`usageCrossCheck = { required, observed, symbol }`)을 optional 인자로
  추가. critic pass(:1830)가 sufficiency 판정(:1868)보다 먼저 실행되므로
  관측 사실은 tool loop에서 미리 수집돼 있어야 한다 (R3의 기록이 충족).

## R5. Critic warning 삽입과 예산 (FR-004)

**Decision**: `buildCriticWarnings`(`critic.mjs:358-428`)에
`usage_cross_check_missing`(severity **medium**)을 **confidence_downgraded
블록(:395) 앞에** push한다.
- 정렬-후-절단 구조(severity 정렬 + stable sort + `slice(0,3)`, :422-427)가
  "높은 severity를 밀어내지 않는다" edge case를 자동 보장. medium tier 내
  경쟁에서 항상 노출되도록 앞 위치 push가 안전 (gate 발화 시
  confidence_downgraded와 동시 추가되어 3개 예산 중 2자리 차지).
- `buildCriticWarnings` 시그니처는 optional 인자 + default 비발화 —
  `critic.test.mjs:208`이 구 시그니처로 직접 호출하므로 호환 필수. 이것이
  FR-007 "non-symbol-trace byte-identical"의 구현 조건이기도 하다.
- 부수 계약 변화: 경고 1개 이상이면 `buildCriticStatus`(:430-434)가
  `caution` 반환 — 이전 `pass`였던 symbol_trace run이 caution이 되어
  `:999` 분기를 새로 탄다. sufficiency 충족 시 결과는 동일(verified→이후
  gate 강등)이므로 허용; 분기 순서를 건드리지 않는 구현이어야 한다.
- 경고는 `status.warnings`(:986)와 `uncertainties`(:889-906)로도 전파된다.

## R6. Scope-aware 충족 (FR-005)

**Decision**: **별도 scope 비교 로직 불필요** — 구조적으로 자동 충족.
DESIGN §12에 따라 도구 호출의 추가 scope는 base scope를 좁히기만 할 수
있으므로, 루프에서 관측된 모든 grep/references는 정의상 active scope 안에서
실행된 것이다. gate는 "관측 여부 + 패턴에 bare symbol 포함"만 검사한다.
warning의 `action` 문구는 scope 밖 검색을 암시하지 않도록 작성한다.

## R7. 전략 프롬프트 (FR-006)

**Decision**: `prompt.mjs:291`의 symbol-first approach 문구를 확장: 정의
확인 후 finalize 전에 bare symbol로 scope-wide `repo_grep` 1회 교차 확인,
그리고 "If no result **or truncated**" fallback. `STRATEGY_DESCRIPTIONS`
(:4)와 시스템 프롬프트 전략 카탈로그(:197-198)의 한 줄도 동기화.
- 프롬프트 본문을 고정하는 snapshot 테스트는 현재 **없음**
  (`runtime.mock.test.mjs:2404-2416`은 detectStrategy 라벨만) — US3의
  snapshot 테스트는 신규 작성.

## R8. 벤치마크 반영 (FR-008)

**Decision**: 기존 `trace-symbol` 케이스(`benchmarks/adoption.json:35-60`,
symbol=`normalizeExploreResult`)는 추이 연속성을 위해 유지하고, 재현 심볼
`buildReportCritic`으로 **새 케이스 `trace-symbol-cross-check`를 추가**한다:
- expectation: target_paths에 `src/explorer/runtime.mjs` (프로덕션 호출처)
  그룹 포함.
- 새 check type 1개를 evaluator(`evaluator.mjs:103-153` switch)에 추가:
  `critic_warning_absent` (인자: warning type) — `usage_cross_check_missing`
  부재를 검사 (기존 `hasCitationGapWarning` 패턴 `:30-33` 재사용). 공개
  `structuredContent`만으로 판정 가능 (`critic.warnings`) — evaluator
  시그니처 확장 불필요.
- evaluator의 unknown-type throw(:151-152)에 걸리지 않도록
  `tests/benchmark-evaluator.test.mjs`에 새 type 테스트 동반.
- record-only 원칙 유지 (spec 021): 점수는 기록일 뿐 게이트가 아니며,
  케이스 추가는 기존 케이스의 점수 분포를 바꾸지 않는다.

## R9. 회귀 위험 목록 (구현 시 주의)

1. `tests/mcp-server.test.mjs:401` — trace_symbol wrapper 테스트가
   `verification==='verified'` 단언. MockChatClient가 1턴에
   `repo_grep({pattern:'requireAuth'})`를 수행하므로 substring 매칭이
   정확하면 통과 — gate 구현 실수의 1차 카나리아.
2. `tests/runtime.mock.test.mjs:3291-3310` — symbol_trace + 'unlikely-N'
   grep(심볼 미포함) → gate 발화로 verified→targeted_read_needed 강등.
   기존 단언은 두 값 모두 허용 + complete:true 유지로 통과 예상이나,
   nextAction stop→read_target과 경고 추가가 이 주변에서 일어남.
3. `tests/critic.test.mjs:208-226` — 구 시그니처 직접 호출 호환 필수.
4. confidence cap을 low로 내리면 FR-003 위반 (R4).
5. stats에 새 관측 필드를 넣으면 `_meta.ops`/transcript에 노출 (additive,
   안전)되나 공개 `structuredContent`에 넣으면 FR-007 위반 — stats/내부 전용.
6. `schemas.test.mjs:214-216` — public hints에 taskMode 거부 계약 유지
   (gate가 hints에 새 키를 추가하는 구현 금지).
7. FR-006의 grep 턴 추가로 record-only 턴/토큰 평균 증가 — SC-004 한도
   (+2턴/+25%) 내인지 라이브 검증에서 확인.
