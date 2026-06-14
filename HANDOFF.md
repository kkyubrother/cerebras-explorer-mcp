# HANDOFF — gpt-5.5-pro 외부 소스 감사 → scope/retry/schema 수정 (v0.8.8 → v0.8.9)

**작성**: 2026-06-14 세션 (대화형 — 사용자 동석)
**상태**: **종결 (2026-06-14)** — v0.8.9 릴리스 완료(PR #46 merge → master `ee795b5`, annotated tag + GitHub release, CI success). master clean, 465/465.
**이전 핸드오프**: production-readiness 감사 + deny-list 케이스 왕복(v0.8.7→v0.8.8, 종결 2026-06-14)은 git 이력에 보존 — `git log -- HANDOFF.md` 또는 `git show 0852ad7:HANDOFF.md` 직후 버전.

이 문서는 이번 세션의 (a) gpt-5.5-pro에 의뢰한 외부 소스 감사와 그 결과 재검증, (b) 확정된 4건의 수정과 의도적으로 보류/드롭한 2건의 판단·근거, (c) 후임자가 알아야 할 잔존 리스크를 기록합니다.

---

## 1. 무엇을 했나 (요약)

| 단계 | 산출/커밋 | 결과 |
|---|---|---|
| 감사 의뢰서 작성 | `reports/gpt55-pro-audit-commission-2026-06-14.md` | 내부 프롬프트 인벤토리(19) + DESIGN R-규칙(~80) + README 약속(~80) 체크리스트. 소스 zip과 함께 gpt-5.5-pro에 전달 |
| 외부 감사 수신 | (대화) | gpt-5.5-pro가 F-001~F-007 보고 |
| 독립 재검증 | (워크플로우, 무커밋) | 적대 verifier 6 + 직접 read. **F-001은 오탐**(아래), F-002~007은 전부 실재 확인 |
| 4건 수정 (test-first) | `56f3d66` (v0.8.9 release commit) | F-002/003/005 코드 + F-004 문서. 신규 회귀 테스트 3개 |
| v0.8.9 릴리스 | `56f3d66` + merge `ee795b5` | 16개 버전 ref 동기화 + CHANGELOG + PR #46 → merge → tag + GitHub release |

**최종 상태**: 최신 태그 **v0.8.9**. 공개 도구 표면(8개)·`schemaVersion`(2)·와이어 프로토콜 불변. deny-list 케이스 동작은 v0.8.8과 동일(이번 세션에서 안 건드림).

---

## 2. 감사 결과와 재검증 (핵심)

**의뢰 방식**: 내부 프롬프트를 표로 정리하고 DESIGN/README 규칙을 체크리스트화한 의뢰서 + 소스 zip을 gpt-5.5-pro에 전달. **수신한 finding은 코드로 직접 재검증한 뒤에만 행동**([[feedback-option-honesty]] 원칙) — 외부 감사관은 브리프를 못 받았다고 했고 라인번호가 어긋날 수 있어 맹신 금지.

| ID | 감사관 판정 | 재검증 | 처리 | 비고 |
|---|---|---|---|---|
| F-001 (`npm test` 실패) | P1 FAIL | **오탐** | — | **내가 만든 zip에서 `.specify`를 빼서** 생긴 것. 실제 레포는 465/465 통과. → 재감사 zip엔 `.specify` 포함할 것 |
| F-002 (git rename scope 유출) | P1 | CONFIRMED → 실제 **Medium** | **수정** | 경로 메타데이터만(내용 X), 트리거 좁음 — 감사관이 심각도 과대 |
| F-003 (`explore` retry recipe) | P2/High | CONFIRMED → **Low-Med** | **수정** | explore·provider오류 한정. 자기 계약(OUT-07) 위반이라 수정 |
| F-004 (DESIGN gzip 4KB) | P3 | CONFIRMED | **수정(문서)** | 코드 32KB가 의도(주석에 근거). 문서가 stale |
| F-005 (`critic.status` schema) | P3 PARTIAL | CONFIRMED | **수정** | 항상 방출 + DESIGN 계약인데 required 누락. 1줄 |
| F-006 (빈 보고서 finalize 프롬프트) | P3 | CONFIRMED | **보류** | "Budget exhausted." 문구 재사용. 기능 영향 없음, 저가치 |
| F-007 (projectContext untrusted 라벨) | P3 | CONFIRMED | **드롭** | §3 판단 참조 |

**총평**: 외부 감사는 고품질이고 6/7이 실재했으나 **심각도를 일관되게 과대평가**했고 헤드라인 F-001은 내 패키징 실수였다.

### 수정 상세 (모두 RED→GREEN)

- **F-002** `repo_git_diff`/`repo_git_show`에 `--no-renames` 추가(`repo-tools.mjs`). 원인: `_filterGitDiffFiles`가 scope를 `file.path`(새 경로)만 검사 — `isSecretDiffFile`은 이미 양쪽을 보는데 비대칭. scope 안으로 rename된 파일의 `patch`/`--stat`에 `rename from <out-of-scope old>`가 남아 옛 경로가 유출. `--no-renames`면 rename이 delete(옛, scope에서 필터)+add(새)로 분해되어 일괄 차단. **트레이드오프**: scope 내 rename도 add+delete로 표시됨(읽기전용 evidence 도구엔 수용 가능).
- **F-003** `server.mjs` provider-error 핸들러에서 `retryArgs`를 도구별 분기: `explore`=`prompt`, `explore_repo`/wrapper=`task`.
- **F-005** `CRITIC_SCHEMA.required`에 `status` 추가(`schemas.mjs`).
- **F-004** DESIGN gzip 임계 4KB→32KB + 보수적 임계 근거 문장.

---

## 3. 자율/협의 판단과 근거

### 판단 1 — F-001을 "프로젝트 결함"으로 보고하지 않음 (정직성)

- **상황**: gpt-5.5-pro가 `npm test` 3건 실패를 P1로 보고.
- **결정**: 오탐으로 분류하고 **내 책임**으로 명시.
- **근거**: 실제 레포는 465/465 통과. 실패는 내가 audit zip에서 `.specify/`(speckit-security 테스트가 요구)를 누락해서 생긴 것. `.specify`는 git 추적됨(39 files). → **재감사 zip엔 `.specify` 포함**(재생성 완료).

### 판단 2 — 수정 범위: 추천 세트(F-002·003·004·005)만 (사용자 선택)

- **결정**: 보안 경계 + retry 정합 + 문서/스키마 trivial 4건만 수정. F-006 보류, F-007 드롭.
- **근거**: 심각도 재산정 후 "깔끔한 correctness/보안/문서" 항목만 채택.

### 판단 3 — F-007 드롭 (절제 = on-thesis)

- **상황**: repo 제어 `.cerebras-explorer.json`의 `projectContext`가 system 프롬프트에 per-block untrusted 라벨 없이 주입됨(전역 untrusted hard-rule은 존재).
- **결정**: **드롭.**
- **근거**: 위협모델이 약함 — `.cerebras-explorer.json`을 통제하는 주체는 repo 소유자(= 도구 실행자) 본인이고, 도구는 read-only라 파괴적 행위로 유도 불가하며, 전역 untrusted 규칙이 이미 defense-in-depth. system-role 섹션에 라벨 한 줄 추가하는 것은 [[project-gpt55-review-2026-06]]·[[project-spec027-echo-cleanup]]에서 반복적으로 드롭해온 "복잡도만 늘리는" 종류. **체크리스트 반사로 다시 추가하지 말 것.**

---

## 4. 후임자 주의 (잔존 리스크)

- **⚠️ deny-list 대소문자 — 변함없이 유효 (v0.8.8 이후 그대로).** 시크릿 차단은 관용 소문자 이름에만 작동(`.env`, `id_rsa`, `*.pem`, `*.key`, `credentials.json`, `*service-account*.json`). 케이스 변형(`.ENV`, `Secret.PEM`, `ID_RSA`, `Credentials.JSON`)은 차단되지 않고 evidence로 외부 모델에 나갈 수 있다. 대응은 직전 핸드오프 §5와 동일(관용 소문자 유지 / 프로젝트 ignore 보강 / 필요 시 case-insensitive 재도입 트레이드오프 수용). `security.mjs`와 `repo-tools.mjs`의 두 `globToRegExp`를 "중복 제거"로 합치면 security 쪽 case-sensitive 의도가 깨진다 — 주의.
- **⚠️ git rename 표시 — `--no-renames` 의존(F-002 수정).** scope hard boundary가 이 플래그로 유지된다. "압축된 rename 표시 복원"이나 "diff 가독성 개선"을 이유로 `--no-renames`를 제거하거나 `diff.renames`를 켜면 **F-002 유출이 재발**한다. 굳이 rename 탐지를 되살리려면 scope 밖 `oldPath`를 patch/stat에서 마스킹/필터하는 대체 방어를 먼저 넣을 것. 회귀 테스트: `tests/repo-tools.test.mjs`의 "rename into scope" 2건이 가드.
- **(드롭됨, 문서화) projectContext 프롬프트 주입** — F-007. system-role 주입이지만 위협모델 약하고 전역 untrusted 규칙으로 완화됨. 의도적 미수정.
- **(보류, 문서화) 빈 보고서 finalize 프롬프트** — F-006. budget 소진이 아닌 빈 보고서 경로도 "Budget exhausted." 프롬프트를 재사용(`runtime.mjs` finalize 분기). 모델에 원인을 잘못 전달하나 기능 영향 없음.
- **감사는 static(코드 기반).** 라이브 provider 상대 카오스 테스트는 미실행 — 마지막 1% 확신엔 관측하 스모크 테스트가 유일.

---

## 5. 검증 재현

```bash
npm test                                    # 465 pass / 0 fail / 0 skip (git+ripgrep 있는 환경)
node ./scripts/integration-test.mjs         # 실 API (CEREBRAS_API_KEY 필요)
git describe --tags --exact-match HEAD       # v0.8.9 (master 기준)
git log --oneline -2                         # ee795b5 (merge #46) → 56f3d66 (release v0.8.9)
grep -n -- '--no-renames' src/explorer/repo-tools.mjs   # F-002 가드 2곳 (gitDiff, gitShow)
node --test --test-name-pattern="rename into scope" tests/repo-tools.test.mjs   # 2 pass
```
