# Extension Backlog

> **목적**: 확장 후보의 동작·입력·영향·전제 조건을 풀어쓴 살아있는 백로그. 다음 spec NNN을 끊을 때 이 문서를 입력으로 사용한다. (README "다음 확장 포인트" 절이 이 문서를 가리킨다.)
>
> **상태** (2026-06-10 갱신): #1~#4는 모두 spec으로 소진 완료 — #1·#2 → specs/013 (+#2 언어 확장은 specs/015), #3 → specs/014, #4 → specs/012. **#5 (`trace_symbol` usage cross-check)가 신규 등록된 열린 후보다 (미진행, 수정 기획 포함).** 남은 씨앗: (a) `.npmignore`/`.dockerignore` 옵트인 처리(#3 후속), (b) Lambda handler / K8s CronJob / Pub-Sub subscriber entrypoint 카테고리(#2 후속), (c) `src/benchmark/evaluator.mjs`의 `stopped_by_budget_equals` check가 spec 017 이후 죽은 `result.stats`를 읽어 vacuous — `searchCoverage.stoppedByBudget`로 이전하거나 삭제 (현재 어떤 스위트도 이 check 타입을 사용하지 않음; spec 025 final review 발견), (d) parent-agent 실측 A/B 자동화와 adoption 케이스 입력-기대 키워드 에코 정리 (spec 025 Out of Scope에서 이월). 새 후보가 생기면 본 문서에 절을 추가하고, 진행할 때 개별 `specs/NNN-slug/` 디렉토리를 끊은 뒤 해당 절을 "→ specs/NNN-slug 완료"처럼 갱신한다.

---

## 1. `map_impact` 도구 추가

→ `specs/013-wrapper-surface-expansion/` 로 완료 (v0.4.0). anchor 입력 1급 시민 + reference-chase strategy + test/config 가중치로 정의됨. `map_change_impact`와의 차이는 anchor 입력 유무.

**동작**: 사용자가 지목한 파일/심볼/diff에 대해 "이 변경이 어떤 파일·라인을 깰 수 있는가"를 grounded evidence와 함께 반환하는 신규 wrapper.

**입력 후보**:
- `changeTarget`: 변경 대상 파일 경로, 심볼 이름, 또는 diff 텍스트
- `repo_root`, `scope`, `session` (공통 컨트롤)

**출력 후보**: `explore_repo`와 동일 compact contract (`directAnswer`, `targets[]`, `evidence[]` ...) 단, `role`이 `read|test|edit|config|context` 중심으로 채워지고 `reason`에 "blast radius" 의미가 담긴다.

**영향**:
- **공개 surface가 8 → 9로 늘어남.** spec 011이 surface를 8개로 영구 고정했기 때문에 도구 추가는 그 결정과 직접 충돌. 추가하려면 spec에서 "surface는 9로 확장하되 wrapper 6개 유지" 또는 "기존 `map_change_impact`를 대체" 둘 중 한 방향을 명시적으로 결정해야 한다.
- `map_change_impact` wrapper와 의미가 거의 동일 — 차이점을 sharp하게 정의하지 않으면 surface가 부풀기만 한다. 가능한 차이 축: (a) `map_change_impact`는 "기존 변경"의 영향, `map_impact`는 "예상 변경"의 영향. (b) `map_impact`는 더 깊은 reference chase + test target.

**전제 조건**:
- spec에서 `map_change_impact`와의 surface 정책 정리 (대체 vs 병존).
- 둘이 병존할 경우 README/DESIGN/integrations 예시 모두 동기화 (spec 011 surface 고정 정책 갱신 포함).

**리스크**: 중상. surface 정책을 건드리고, 기존 도구와 의미가 겹친다.

---

## 2. `find_entrypoints` 도구 추가

→ `specs/013-wrapper-surface-expansion/` 로 완료 (v0.4.0). 1차 spec은 JS/TS(Express/Fastify/NestJS), Python(Flask/FastAPI/click/argparse), Go(`net/http`/`chi`), 기본 cron으로 한정.
→ `specs/015-find-entrypoints-language-expansion/` 로 Ruby(Rails/Sinatra/Thor/whenever), PHP(Laravel/Symfony), Java(Spring/picocli), Rust(actix-web/rocket/clap) 확장 완료. Lambda handler / K8s CronJob YAML / Pub-Sub subscriber 같은 별도 의미 카테고리는 후속 spec.

**동작**: 저장소의 entry point(라우터 등록, CLI 정의, cron/queue handler, HTTP handler, MCP tool 정의 등)를 자동으로 식별해서 grounded evidence와 함께 나열하는 신규 wrapper.

**입력 후보**:
- `entryKind` (선택): `http|cli|cron|mcp|all`. 생략 시 자동 감지.
- `repo_root`, `scope`, `session`

**출력 후보**: `targets[]`의 `role`은 `entry|test|config` 중심. `directAnswer`에 entry point 종류별 카운트 요약.

**영향**:
- **공개 surface가 8 → 9.** #1과 동일하게 spec 011 정책과 충돌.
- 의미가 다른 wrapper와 겹치지 않음 (entry point 자동 감지는 신규 영역).
- 실용성 높음 — 초기 온보딩이나 큰 저장소 첫 탐색에서 가장 자주 묻는 질문.

**전제 조건**:
- spec에서 surface 9로 확장한다는 정책 결정.
- 어떤 정규식·패턴으로 entry point를 감지할지 명시. 언어별 fixture 필요.

**리스크**: 중. 신규 영역이지만 패턴 매칭이 false positive를 만들기 쉬워 정밀도 측정 필요.

---

## 3. repo-specific ignore 정책 강화

→ `specs/014-repo-specific-ignore/` 로 완료. nested `.gitignore` prefix-bounded 매처 + `.cerebras-explorer.json:extraIgnorePatterns` 신설. `.npmignore`/`.dockerignore` 자동 처리는 별도 spec.

**동작**: 현재는 저장소 루트의 `.gitignore` 단일 파일만 반영한다. 이를 확장해서:
- nested `.gitignore` (서브디렉토리별 ignore) 처리
- `.cerebras-explorer.json`의 `extraIgnoreDirs`/`extraIgnoreFiles` 키 보강
- 선택적으로 `.npmignore`, `.dockerignore` 같은 인접 ignore 파일 옵트인

**입력 후보**:
- `.cerebras-explorer.json`에 `ignore.{nested, extraDirs, extraFiles, useGitNested}` 같은 nested 구조 추가
- 환경변수 override는 추가하지 않는다 (spec 011 정책: 환경변수 surface 최소화).

**출력 후보**: 표면 변경 없음. 영향은 traversal/find/grep 결과의 sub-tree에서 일부 파일이 제외되는 정도.

**영향**:
- **사용자 면 큰 영향.** 동일 저장소에서 탐색 결과가 달라질 수 있어 회귀 위험.
- 기존 secret deny-list와 정책 우선순위 정의 필요 (deny-list가 항상 우선해야 함).
- benchmarks가 nested ignore에 영향받는지 확인.

**전제 조건**:
- 정책 우선순위 도식: secret deny-list > scope > .gitignore (root) > nested .gitignore > extraIgnoreDirs > defaults.
- 모든 기존 단위 테스트와 benchmark가 변경 후에도 같은 결과를 내는지 회귀 가드.

**리스크**: 중하. 코드 변경은 명확하지만 사용자 영향이 직접적이라 회귀 테스트가 광범위해야 한다.

---

## 4. symbol engine 정밀도 확장 (spec 008 후속)

**동작**: `src/explorer/symbols.mjs`의 `classifyReference`/`relationForUsage` 분류기는 spec 008에서 4개 baseline 케이스(`member_call`, `constructor`, `type_reference`, `call`)를 단위 테스트로 고정했다. 그 spec이 명시적으로 후속 작업으로 남긴 edge case들을 fixture로 확대하고 정밀도 회귀 가드를 추가한다.

**spec 008이 명시적으로 미래 작업으로 분리한 항목** (spec 008 Edge Cases 섹션 인용):
- 공백 섞인 멤버 호출: `session . touch ( )` 같은 형태
- 동일 라인에 `new Foo()`와 `foo()`가 함께 나오는 다중 패턴 라인 (ordered checks 우선순위 검증)
- JSX 사용 (`<MyComponent />`)
- 데코레이터 (`@Injectable()` 등)
- 동적 임포트 (`import('./mod.js')`)

**입력 후보**: 신규 입력 없음. 기존 `classifyReference(line, symbol, filePath)` 시그니처 그대로.

**출력 후보**: 기존 `{ type, relation }` 형식 유지. 새 분류 카테고리는 추가하지 않는다 (spec 008 FR-004 정책 계승).

**영향**:
- **공개 surface 변경 없음.** 분류기 내부 회귀 가드만 추가.
- 기존 `classifyReference`의 `relation` 값에 의존하는 코드(있다면)에 회귀 가능성. spec 008에서 이미 정밀 분류는 `relation`에만 표현되므로 영향 범위는 명확.
- DESIGN.md의 parser-free 경계 단락 갱신 가능 (새 케이스가 어디까지 분류되는지 명시).

**전제 조건**:
- 각 edge case에 대해 "현재 분류기가 어떻게 분류하는가"를 먼저 측정 → 그 결과를 baseline으로 고정할지, 또는 기대 분류와 다르면 분류기 패치를 동반할지 결정.
- 다중 패턴 라인은 spec 008 Edge Cases에서 "constructor가 우선"이라고 단언했으므로 그대로 굳히는 회귀 테스트.

**리스크**: 하. 기존 단위 테스트 패턴(`tests/symbols.test.mjs`)에 케이스 추가가 본질. 신규 surface 없음.

---

## 5. `trace_symbol` usage cross-check 강제 (사용처 누락 과신 완화)

**배경 (2026-06-10 평가에서 실측)**: `trace_symbol`로 `buildReportCritic`을 추적한 라이브 프로브에서 explorer가 정의(`critic.mjs`)는 정확히 찾았지만 **프로덕션 호출처(`runtime.mjs:2394`)를 누락**하고 테스트 사용처만 보고했다. 탐색은 `repo_symbol_context` 1회 + 파일 read 5회로 끝났고 **repo-wide grep을 한 번도 수행하지 않았는데도**(`searchCoverage.grepCalls=0`) `status.verification='verified'`, `complete=true`, `confidence='high'`, `critic.status='pass'`, `uncertainties=[]`를 반환했다. 인용한 것은 전부 사실(거짓 양성 차단은 잘 작동)이지만, "찾아야 할 것을 다 찾았는가"(거짓 음성)는 어떤 신호로도 표면화되지 않았다 — 사용처 추적이 본업인 도구에서 가장 해로운 과신 모드다.

**동작 (수정 기획 — 정책 적합 형태)**: 세 층으로 나누되, 모두 기존 정책 안에서 deterministic하게 동작한다.

1. **원인 측정 먼저 (전제 조사)**: 재현 케이스(`buildReportCritic`)로 `repo_symbol_context`의 caller 수집이 왜 `runtime.mjs`의 호출처를 놓쳤는지 측정한다 — 후보: `maxSearchResults`(80) 한도에서의 정렬/절단, caller 수집 범위, regex 매칭 한계. 인덱서 자체 결함이면 그 fix가 1차 (zero-dep regex 원칙 유지, DESIGN §17 Phase 3 경계 준수).
2. **Sufficiency gate 확장 (DESIGN §11.4, deterministic)**: `taskMode='symbol_trace'`에서 `verified` 판정의 추가 조건으로 **usage cross-check 신호**를 요구한다 — 대상 심볼에 대한 `repo_grep` 또는 `repo_references` 호출이 실제 관측됐을 것. 미관측이면 `verification`을 `targeted_read_needed`로 강등하고 confidence를 high→medium으로 cap(기존 `confidence_downgraded` 메커니즘 재사용). 런타임 tool loop는 호출 args를 이미 파싱하므로 `observedGrepPatterns`/`observedReferenceSymbols`를 내부 stat으로 기록하면 된다(envelope 비노출, ops/transcript 전용).
3. **Additive critic warning (DESIGN §11.3 형식)**: 새 warning type `usage_cross_check_missing` — `{ type, severity: 'medium', message: "Usage tracing relied on a single symbol lookup; no repo-wide grep/reference search was observed for <symbol>.", target: <symbol>, action: "Run repo_grep for the bare symbol name (or repo_references) before trusting the usage list as complete." }`. §11.1 원칙대로 "전체 불신"이 아니라 좁힌 후속 행동을 지시한다. v0.8.2의 `git_citation_gap`과 같은 additive 확장 패턴.
4. **(보조) 전략 프롬프트 보강**: symbol-first 전략 가이드에 "정의 확인 후 최종화 전에 bare symbol로 repo-wide grep 1회 교차 확인"을 명시. 프롬프트만으로는 준수가 비결정적이므로 2·3의 gate가 본체이고 이것은 비용 절감용 유도.

**입력 후보**: 없음 (공개 스키마 변경 없음).

**출력 후보**: `critic.warnings`에 additive type 1개 추가, 기존 `status.verification`/`confidence` 값 범위 내 강등만 사용. `schemaVersion` 불변. 벤치마크 `trace-symbol` 케이스에 프로덕션 호출처 파일 기대 그룹과 cross-check 수행 체크를 추가(record-only 원칙 유지, spec 021).

**영향**:
- **공개 surface 불변** (8-tool 고정, 새 envvar 없음, additive warning만).
- `symbol_trace` 호출의 평균 턴/내부 토큰이 약간 증가(grep 1회 추가 유도). spec 025의 `avgToolTurns`/`avgInternalTokens` 메트릭으로 추이 관측 가능.
- 직접 `explore_repo` + symbol hints 경로는 taskMode가 없어 1차 범위 밖 (DESIGN §5.1의 wrapper-owned intent 비대칭과 일치). 전략 자동 감지(`symbol-first`) 기반 확대는 후속 결정.

**전제 조건**:
- 1번 원인 측정 결과를 spec에 baseline으로 기록 (인덱서 결함 fix와 gate 도입의 분리 가능성 판단).
- `usage_cross_check_missing`이 좁은 scope 호출(예: 단일 파일 scope)에서 과경고가 되지 않는지 확인 — scope 내 grep이면 충족으로 인정.
- 기존 §11.4 판정 순서(critic fail → low confidence → edit 경로 → 임계)와의 합류 지점 명시.

**리스크**: 중하. gate/critic은 순수 함수 확장이라 구현 위험이 낮지만, 과경고 시 상위 AI의 불필요한 재탐색(§11.1이 경계하는 비용)을 유발할 수 있어 임계 설계가 핵심. 프로브 재현 케이스가 있어 회귀 검증은 용이.

---

## 우선순위와 다음 단계

이번 결정(2026-05-23): **#4 symbol engine 정밀도 확장**부터 spec 012로 진행.
→ `specs/012-symbol-precision-extension/` 로 완료 (5개 edge case 영역 baseline + `DESIGN.md` parser-free 경계 단락 보강).

선택 근거:
- 신규 도구 (#1, #2)는 spec 011의 "surface 영구 고정 8개" 정책과 직접 충돌하므로 추가 사전 결정이 필요하다.
- ignore 정책 (#3)은 사용자 면 영향이 직접적이라 회귀 가드 범위가 크다.
- #4는 spec 008이 명시적으로 후속으로 남긴 항목을 줄이는 작업이라 입력·출력·영향이 가장 명확하고 리스크가 가장 낮다.

#1, #2, #3은 본 문서에 보관해 두고, surface 정책 또는 ignore 정책 결정이 익을 때 다시 spec을 끊는다.
