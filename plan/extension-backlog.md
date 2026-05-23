# Extension Backlog

> **목적**: README "다음 확장 포인트"에 짧게 나열된 4개 확장 후보의 동작·입력·영향·전제 조건을 풀어쓴 살아있는 백로그. 다음 spec NNN을 끊을 때 이 문서를 입력으로 사용한다.
>
> **상태**: 모두 idea 단계. 어느 후보도 아직 spec/branch가 없으며, 진행할 때마다 개별 `specs/NNN-slug/` 디렉토리를 끊고 본 문서의 해당 절은 "→ specs/NNN-slug에서 진행 중/완료" 처럼 짧게 갱신한다.

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

## 우선순위와 다음 단계

이번 결정(2026-05-23): **#4 symbol engine 정밀도 확장**부터 spec 012로 진행.
→ `specs/012-symbol-precision-extension/` 로 완료 (5개 edge case 영역 baseline + `DESIGN.md` parser-free 경계 단락 보강).

선택 근거:
- 신규 도구 (#1, #2)는 spec 011의 "surface 영구 고정 8개" 정책과 직접 충돌하므로 추가 사전 결정이 필요하다.
- ignore 정책 (#3)은 사용자 면 영향이 직접적이라 회귀 가드 범위가 크다.
- #4는 spec 008이 명시적으로 후속으로 남긴 항목을 줄이는 작업이라 입력·출력·영향이 가장 명확하고 리스크가 가장 낮다.

#1, #2, #3은 본 문서에 보관해 두고, surface 정책 또는 ignore 정책 결정이 익을 때 다시 spec을 끊는다.
