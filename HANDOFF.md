# HANDOFF — spec 026 (trace_symbol usage cross-check) 야간 자율 실행 기록

**작성**: 2026-06-10 야간 세션 (사용자 퇴근 후 subagent-driven 자율 실행)
**브랜치**: `026-trace-symbol-cross-check`
**상태**: 구현·검증 완료, master로 PR 생성됨. 머지와 릴리즈는 사용자 결정 대기.

이 문서는 자율 실행 중 (a) 사용자 부재로 제가 내린 판단과 근거, (b) 머지 이후 남은 작업을 기록합니다. 작업 완료 후 이 문서도 커밋·푸시했습니다.

---

## 1. 무엇을 했나 (요약)

spec 026 전체(US1~US3 + Polish + 라이브 검증)를 subagent-driven으로 구현했습니다. 각 user story마다 구현자 1 + spec 준수 리뷰 1 + 품질 리뷰 1을 파견하고, 리뷰가 잡은 결함은 추가 fix 라운드로 닫았습니다.

| 단계 | 커밋 | 결과 |
|---|---|---|
| US1 gate + warning + cap | `6421343` `910aa3c` `bdbbbe4` | deterministic usage cross-check gate (mock 양방향 + 4 precedence 경로 억제 + 에러 attempt 제외) |
| US2 인덱서 결정성 fix | `8d6cfaa` `a2f0d82` | symbolContext caller 절단을 결정적·**진짜 round-robin**으로 (cross-file breadth) |
| US3 프롬프트 | `0a1df3f` | symbol-first 전략에 cross-check 지시 + truncated fallback |
| Polish (bench/docs) | `4cafdfb` `f5bfa66` `c7dc672` | `critic_warning_absent` check type, 새 벤치 케이스, DESIGN/CHANGELOG |
| 검증·종결 | (이 커밋) | tasks.md Notes, spec Status, HANDOFF |

최종 검증: `npm test` 458 pass / 0 fail / 2 skipped(win32 환경 가드). 통합 테스트 5/5. SC-001 라이브 0 violations. 벤치마크 9/9(기존 trace-symbol 비회귀 1.0, 새 케이스 0.867).

---

## 2. 자율 판단과 근거 (사용자 확인 없이 결정한 것)

### 판단 1 — US2를 "진짜 round-robin"으로 구현 (주석 수정에 그치지 않음)

- **상황**: 첫 US2 구현은 per-file cap 3을 **greedy groupwise**(우선순위 순서로 파일당 3개씩 채움)로 했고, 품질 리뷰가 "round-robin이 아니라 misnomer; 같은 tier에서 파일 수가 20슬롯을 넘으면 뒤 파일들이 0 슬롯"이라 지적했습니다. 리뷰어는 "주석만 고쳐도 spec 위반은 아님"이라는 약한 옵션도 제시했습니다.
- **결정**: 주석 수정 대신 **진짜 round-robin을 구현**했습니다(`a2f0d82`).
- **근거**: data-model E5가 명시적으로 "round-robin"을 요구했고, `trace_symbol`의 제품 목적이 *여러 파일에 걸친 호출처 breadth*(심볼이 어디어디서 쓰이는지)이므로 cross-file 대표성이 실제 가치입니다. 8개 코드 파일이 각 4 호출인 fixture에서 greedy는 7/8 파일만, round-robin은 8/8 파일을 대표함을 TDD로 입증했습니다. 라이브 재현에서도 20 selected 중 18 distinct files로 breadth가 실측됐습니다.

### 판단 2 — US1 gate 억제 경로를 spec.md 기준으로 확장 (tasks.md보다 엄격)

- **상황**: tasks.md T003(f)는 critic-fail(tool_errors) 경로만 gate 미발화를 요구했으나, spec 준수 리뷰가 spec.md/data-model 기준으로 **low-confidence / no-evidence / abort** 경로에서도 경고가 새는 것을 실측했습니다("정의를 못 찾은 흐름에 중복 경고 금지"라는 spec edge case 위반).
- **결정**: 네 경로 전부 억제하는 `gateSuppressed` 술어를 추가했습니다(`910aa3c`).
- **근거**: tasks.md는 spec의 한 표현일 뿐이고, spec.md edge case와 data-model E2가 "선행 경로가 걸리면 gate 미발화"를 요구합니다. 리뷰가 실측으로 누수를 보였으므로 spec 의도를 우선했습니다.

### 판단 3 — 에러난 grep attempt는 cross-check 충족으로 인정하지 않음

- **상황**: tasks.md는 "결과 무관(0-match 포함)" attempt를 충족으로 인정하라 했고, 품질 리뷰가 "실행 자체가 에러난(잘못된 regex 등) grep은 실제로 아무것도 검색 안 했는데 gate를 통과시킨다 — SC-001이 막으려는 바로 그 과신"이라 지적했습니다.
- **결정**: `!safeToolResult?.error`로 에러 실행을 제외했습니다(`bdbbbe4`). 0-match *성공* grep은 여전히 인정(에러 아님).
- **근거**: spec의 "attempt counts" 의도는 truncated/0-match *실행된* 검색이지 실행 실패가 아닙니다. 더 정직한 predicate가 모든 spec 케이스를 만족하면서 누수만 막습니다.

### 판단 4 — CHANGELOG를 `v0.8.5 - Unreleased`로 기록 (릴리즈 보류)

- **결정**: CHANGELOG에 `## v0.8.5 - Unreleased` 섹션을 추가하고 **버전 bump/tag/release는 하지 않았습니다**.
- **근거**: package.json은 0.8.4 그대로 유지. 릴리즈는 사용자가 시점을 정하는 결정사항(spec 025도 머지 후 별도로 릴리즈했음). doc-sync 가드(`tests/integrations.test.mjs`)는 "최상단 heading이 package version과 일치 + Unreleased 아님"을 package version(0.8.4)에 대해서만 검사하므로 v0.8.5-Unreleased는 가드를 위반하지 않음(확인됨).

### 판단 5 — PR 생성까지 진행, 머지는 보류

- **결정**: 브랜치를 push하고 PR을 생성했습니다. **머지는 하지 않았습니다.**
- **근거**: 사용자 지시는 "작업 완료 후 커밋하고 푸시까지". 머지는 명시되지 않았고, spec 025도 사용자가 직접 머지를 승인했습니다. 코드 리뷰 가능 상태로 PR을 열어두는 것이 안전합니다.

### 판단 6 — 라이브 SC 검증(T021)을 실제 API로 실행

- **결정**: 통합 테스트·SC-001 라이브 5회·벤치마크 전체 스위트를 실 API로 돌렸습니다(throwaway 스크립트는 검증 후 삭제 — `scripts/`는 npm 패키지에 포함되므로 커밋 금지).
- **근거**: spec acceptance(SC-001/003/004)가 라이브 증거를 요구하고 T021이 tasks.md에 정의된 작업입니다. API 토큰 비용이 들지만 "남은 작업 진행" 지시 범위 안입니다.

---

## 3. 알려진 한계 / 리뷰가 남긴 minor 메모 (코드 동작엔 영향 없음, 후속 후보)

머지 차단 사항은 없습니다. 아래는 리뷰가 minor로 남긴 것들:

1. **substring 매칭의 관대함** (`runtime.mjs` gate predicate): `pattern.includes(symbol)`는 심볼이 다른 식별자의 부분 문자열이어도 충족으로 봅니다(예: 'get'이 'getBudgetConfig' 패턴에 매치). **방향이 안전**(gate가 너무 관대 → false downgrade 없음; 과경고가 아니라 과소경고 쪽)하여 SC-003 과경고 위험과 무관. 더 엄격히 하려면 word-boundary 매칭이 후속 옵션.
2. **`gateSuppressed`가 fail *원인*에 키잉**: 현재 compact 경로의 유일한 high-severity 경고가 `tool_errors`(=stoppedByErrors)라 status-keyed와 동치. 미래에 새 high-severity 경고 type을 추가하면 `gateSuppressed`도 같이 갱신해야 함 — `buildCriticStatus`에 가드 주석과 invariant 테스트를 이미 넣어둠(`bdbbbe4`).
3. **gate cap이 `confidence.factors.adjustments`에 흔적 남김**: 추가 완료(`bdbbbe4`). transcript/벤치마크 가독성용.
4. **벤치 새 케이스 `combined_text` 2/3 매치**: 정의+호출처 서술 그룹 중 하나가 모델 문장 변형으로 미스(케이스는 0.867로 통과). record-only라 게이트 아님. 키워드 그룹을 더 관대하게 조정할 여지(후속, 선택).

---

## 4. 머지 이후 남은 작업 (landing tasks)

PR이 머지되면 다음을 수행하세요(spec 025 landing과 동일 패턴):

1. **CLAUDE.md / AGENTS.md SPECKIT 포인터 이동**: 현재 spec 026 plan을 가리킴 — 다음 spec을 열 때 갱신(또는 활성 plan 없음으로). spec 026 자체는 머지 시점에 닫힘.
2. **spec.md Status 최종화**: 현재 "implemented ... Awaiting PR review/merge"로 적어둠 — 머지 후 "Awaiting..." 문구 제거.
3. **릴리즈 결정 (선택, 권장)**: CHANGELOG `v0.8.5 - Unreleased`를 릴리즈하려면 README 릴리즈 절차대로:
   - `npm version 0.8.5 --no-git-tag-version`, `src/mcp/server.mjs` SERVER_INFO.version, `tests/mcp-server.test.mjs`의 버전 단언 3곳 갱신
   - CHANGELOG heading에 날짜 부여
   - tag 스윕: `v0.8.4` → `v0.8.5`를 README·integrations·tests pin에 일괄 치환
   - `npm test` + `npm pack --dry-run` + 통합 테스트 후 commit/tag/push + GitHub release
4. **backlog 갱신**: `plan/extension-backlog.md` #5(trace_symbol cross-check)를 "→ specs/026 완료"로 표시.

### 다음 spec 후보 (백로그 잔여)

- `.npmignore`/`.dockerignore` 옵트인 (spec 014 후속)
- Lambda/K8s CronJob/Pub-Sub entrypoint 카테고리 (spec 013/015 후속)
- evaluator의 vacuous `stopped_by_budget_equals` check 정리 (spec 025 final review 발견 — 죽은 `result.stats` 읽음)
- parent-agent 실측 A/B 자동화 + adoption 입력-기대 에코 정리 (spec 025 Out of Scope 이월)

---

## 5. 검증 재현 방법 (리뷰어용)

```powershell
npm test                                    # 458 pass / 0 fail / 2 skip
node ./scripts/integration-test.mjs         # 실 API, 5/5 (CEREBRAS_API_KEY 필요)
node ./scripts/run-benchmark.mjs --suite ./benchmarks/adoption.json --verbose   # 9/9, record-only
```

gate의 부정 동작(미관측→강등+경고)은 `tests/runtime.mock.test.mjs`·`tests/critic.test.mjs`의 "spec 026" 클러스터가 결정적으로 고정합니다(API 불필요).
