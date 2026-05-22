# Research: 피드백 검증 기반 5종 신뢰성 수정

본 문서는 plan.md의 5개 Spec 각각에서 채택한 접근의 대안과 결정 근거를 기록한다. RAW.md Phase 5의 "리스크 / 미해결 결정" 항목과 1:1 대응한다.

---

## R-1. 상태 계약 재정의 (Spec-1)

### Decision
`status.complete`/`verification`/`failure.reason`을 결정하는 1차 신호로 **evidence sufficiency**를 사용하고, `stats.stoppedByBudget`은 보조 신호로만 남긴다. sufficiency는 task별 heuristic(`isSimpleCompletionMode` + `taskMode` 분기)으로 평가한다.

### Rationale
- 외부 피드백 다수(F1·F3·F4·F5)가 "budget 소진 = `complete:false`" 강제 동작을 가장 큰 unreliability 원인으로 지목했고, 코드상 실제로 그렇게 동작한다(`buildResultStatus` L806-L828, `buildFailure` L526-L565).
- evidence count + grounding status + critic status는 이미 `evidenceQuality`/`critic`에 존재하므로 신규 데이터 수집 없이 결합만 하면 sufficiency를 정의할 수 있다.
- task별 다른 임계는 RAW.md Phase 5의 acceptance scenarios와 본 spec의 FR-002~FR-005에 1:1 대응한다.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| 상태 계약을 그대로 두고 문서로만 "budget 소진 시 false를 재시도하지 마라"라고 안내 | parent agent는 응답을 그대로 처리하지 문서를 매번 확인하지 않는다. control-plane 필드 자체가 일관되어야 한다. |
| `status.completionReason`을 public schema에 추가 | strict consumer 회귀를 피하려면 1차 구현은 `_debug.evidenceSufficiency`에만 두는 것이 안전. 후속 릴리스에서 demand가 확인되면 promotion 가능. |
| evidence count 단일 임계(예: exact ≥ 1)로 통일 | path_explanation/edit_planning이 1개로 충분하면 false-positive 완료가 늘어난다. task별 분기가 필요. |
| critic confidence score만 사용 | confidence는 이미 `evidenceQuality.level`로 노출되지만 budget penalty가 함께 적용되어 high여도 follow_up이 되는 충돌이 있다(C1). sufficiency를 별도 layer로 둬야 한다. |

### Open Risk
"X는 없다"는 negative finding을 `evidence_verification`에서 exact evidence 1개로 충분하다고 보는 것은 정의상 약하다. 본 spec은 충분하다고 처리하고, 후속 spec에서 negative finding 임계를 별도 도입할 여지를 남긴다.

---

## R-2. `targets[]` / `discoveredPaths[]` 분리 (Spec-2)

### Decision
응답에 신규 top-level `discoveredPaths[]` (additive optional)를 도입하고, runtime은 `repo_list_dir`/`repo_find_files`/`repo_git_diff`/`repo_git_show` 결과를 여기에 라우팅한다. `targets[]`는 grounded evidence와 모델 제안 target만 유지. report 도구의 citation target은 file-level merge.

### Rationale
- Claude Code 최우선 fix 1번과 일치(RAW.md Phase 4 표).
- `targets[]`를 parent automation의 "다음 읽기/편집 대상"으로 신뢰하게 만들려면 discovery noise(README, `.github`, `.specify` 등)와 actionable target을 같은 array에 섞으면 안 된다.
- file-level dedupe는 report 도구가 같은 파일의 여러 citation range를 별도 target으로 부풀리는 현상을 막는다(RAW.md C10).

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| `targets[].role`에 새 `discovered` 값을 추가해 구분 | role enum 변경은 strict consumer 회귀 위험이 있고, parent가 여전히 모든 role을 한 array에서 처리해야 한다. 분리가 본질적이다. |
| listDir entry를 무조건 evidence로 격상 | grounded evidence path와 discovery path의 의미가 다르다. 격상하면 confidence/sufficiency 신호가 부풀려진다. |
| report citation을 file-level이 아닌 range별 dedupe 유지 | RAW.md C10 명시 — 같은 파일의 여러 range citation이 다수 target으로 남는다. file-level merge가 parent UX와 일치. |
| `discoveredPaths[]`를 `_debug`에만 두기 | discovery 정보는 외부 consumer가 follow-up 호출에 사용할 수 있는 신호다. `_debug`는 진단용으로 약속되어 있어 의미 불일치. |

### Open Risk
- 기본 cap 100이 적절한지는 후속 metric로 평가. discoveredPaths가 매우 많은 시나리오(예: `repo_list_dir`로 큰 디렉토리 listing)에서 절단 정책을 더 정교화할 수 있다.
- `repo_grep` match path를 discovered로만 둘지 evidence로 이어진 경우 target으로 둘지 — 본 spec은 evidence에 있는 path만 actionable target으로 둔다.

---

## R-3. Redaction 환경변수 이름 보존 (Spec-3)

### Decision
`SECRET_PATH_MENTION_REGEX`를 word boundary 기반으로 재정의해 `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")` 같은 식별자 표현이 `.env.X` regex에 걸리지 않도록 한다. secret value pattern과 standalone secret path mention은 그대로 마스킹한다. 강한 마스킹은 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1` 옵트인.

### Rationale
- Claude Code 최우선 fix 2번. snippet/report의 `process.env.X`가 `[REDACTED:secret-path]`로 사라지면 코드 인터페이스 이해가 거의 불가능해진다.
- object key는 이미 redaction 대상이 아니다(RAW.md C11). 문제는 문자열 내부 substring matching이라 regex boundary로 해결 가능.
- env var 이름은 일반적으로 public interface(SDK README, OpenAPI spec 등에서 노출됨)이지 secret이 아니다.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| regex는 그대로 두고 `process.env.X` 표현을 발견하면 후처리 단계에서 복원 | replace 후 원본 정보가 손실되므로 복원 어려움. boundary regex가 더 단순. |
| `.env.*` alternation을 regex에서 제거 | standalone `.env.production` path mention이 더 이상 마스킹되지 않아 보안 회귀. |
| env var 이름까지 가리는 것을 기본 동작으로 유지 | secret value도 아닌 식별자를 가리는 것이 가독성을 크게 해친다. |
| ContextualHelper(`isEnvVarExpressionContext`)를 유일한 방어로 사용 | helper 호출 비용과 false-negative 가능성이 boundary regex보다 크다. boundary가 1차 방어, helper는 회귀 방지용 optional. |

### Open Risk
조직 정책에 따라 env var 이름도 secret으로 보고 싶은 경우가 있다. 본 spec은 envvar 옵트인을 제공하지만, 옵트인이 켜진 환경에서 secret value redaction과 함께 정상 동작하는지 별도 테스트로 보호.

---

## R-4. `scope` Hard Boundary for git-guided tools (Spec-4)

### Decision
`_filterGitDiffFiles()` 기본값을 `enforceScope: true`로 변경하고, `gitDiff()`/`gitShow()`/`gitDiff({stat:true})` 모두에서 scope 밖 file을 결과에서 제외한다. 제외 수는 `omittedOutOfScopeFiles` optional field로 노출.

### Rationale
- DESIGN.md와 README가 모두 scope를 hard boundary로 설명하지만 `gitDiff()` 단독으로 예외(`enforceScope: false`)였다. 이는 명세-구현 불일치이며 보안 회귀와 동치(C5).
- 동일 정책(`enforceScope: true`)이 `gitShow()`에는 이미 적용되어 있어 일관성 측면에서 명확한 fix.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| scope 밖 file을 결과에 두되 `outOfScope: true` flag만 부여 | parent가 그 flag를 무시하고 path를 따라가는 회귀가 발생할 수 있다. 결과에서 빼는 것이 안전. |
| `repo_git_diff`만 scope filter 하고 stat 모드는 그대로 | stat 출력도 path mention을 담고 있어 동일한 leakage 위험. 일관성을 위해 stat도 필터링. |
| scope를 explicit option으로 노출(`enforceScope` argument) | public schema 변경 없이 일관 정책을 채택하는 것이 단순하고 안전. caller가 scope를 hint로 쓰고 싶다면 scope 자체를 넓혀 호출. |

### Open Risk
- `git diff --stat` path parsing은 rename/copy 라인에서 취약. 본 spec은 매칭되지 않는 라인을 그대로 통과시켜 summary 보존하지만, rename/copy 정확도는 후속 보강 대상.
- scope 밖 git file을 완전 제외 vs `out-of-scope but git-relevant`로 표시 — DESIGN 기준은 완전 제외. 본 spec 채택.

---

## R-5. Session / Progress / Sub-agent Handoff (Spec-5)

### Decision
- 옵트인 자동 session reuse(`CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`, 기본 off): 같은 repoRoot의 최신 reusable session을 explicit session 없이 사용 가능. `_debug.stats.sessionSource='auto_repo'`로 진단.
- progressToken 권장 규칙과 sub-agent 필수 보존 필드 목록은 README/DESIGN/AGENTS에 문서로 명문화.
- wrapper decision rule을 README 공개 도구 절에 짧게 고정.

### Rationale
- 자동 reuse를 기본 켜지 않는 이유: multi-client 환경에서 의도치 않은 state 공유 위험. 옵트인이 안전.
- progress/sub-agent 보존은 코드 기능이 이미 존재(`makeProgressCallback`, structuredContent compact contract). 문제는 client/agent가 사용 규칙을 모르는 것이라 docs가 1차 fix.
- wrapper decision rule은 도구 surface가 환경변수에 따라 1/8/9개로 변동(C8)할 때 parent mental model을 단순화한다.

### Alternatives Considered

| Alternative | 채택하지 않은 이유 |
|---|---|
| 자동 reuse를 기본 on | multi-client conversation 격리가 깨지는 회귀 위험. 옵트인이 안전. |
| `SESSION_SCHEMA.status` enum에 `auto_reused` 추가 | enum 변경은 strict consumer 회귀. `_debug.stats.sessionSource`로 충분. |
| sub-agent 필수 필드를 machine-readable schema로 강제 | 외부 agent 구현에 hard requirement를 둘 수 있는 mechanism이 현재 없다. docs invariant + integration package는 후속 작업. |
| progress notification을 기본 push로 변경 | client capability 의존성이 크다. token 기반 opt-in이 MCP 표준. |

### Open Risk
- 자동 session reuse는 convenience vs isolation의 trade-off. 기본 off가 안전선이며 multi-client docs에 권고 추가.
- sub-agent template은 문서로만 강제하면 외부 agent가 무시할 수 있음. 향후 integration package에 machine-readable template을 제공할지 결정 필요.
- progressToken은 MCP client capability에 의존. server 단독으로는 모든 UI에 강제 불가.

---

## 공통 결정

### 모든 schema 변경을 additive로 제한
- 신규 필드는 모두 optional. `EXPLORE_REPO_OUTPUT_SCHEMA.required`/enum 미변경. `SESSION_SCHEMA.status` enum 미변경.
- legacy/redact/auto-session envvar 3개로 1 릴리스 migration window 확보.
- CHANGELOG에 본 plan의 5개 Spec을 단일 변경 묶음으로 기록해 외부 독자가 변경 추적 가능.

### Reason
- 본 작업은 단일 릴리스에 5종 fix를 묶어야 하므로 strict schema consumer 회귀가 가장 큰 위험이다. additive 정책이 multi-fix bundle을 안전하게 만든다.

### Alternative Rejected
- 5종 fix를 5개 릴리스로 분할 — RAW.md Phase 4가 한 묶음으로 정의한 fix 집합이고, parent UX 측면에서도 5개 동시 fix가 일관 효과를 낸다. 분할은 release overhead만 키운다.
