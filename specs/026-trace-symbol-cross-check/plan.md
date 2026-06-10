# Implementation Plan: trace_symbol usage cross-check enforcement

**Branch**: `026-trace-symbol-cross-check` | **Date**: 2026-06-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-trace-symbol-cross-check/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

`trace_symbol`(taskMode `symbol_trace`)이 usage cross-check 없이
`verified/complete/high`를 반환하는 과신 모드를 제거한다. 접근:
(1) **인덱서 fix 먼저** — Phase 0 실측으로 확정된 근원 원인(내부 grep
40-cap 하드코딩 + 비결정 선착순 절단 + `slice(0,20)` 2차 절단의 다양성
부재, [research.md](./research.md) R1)을 우선순위화·다양성 보존·결정적
정렬로 교정 (R2); (2) **deterministic gate** — compact tool loop에서 args
기반으로 grep 패턴/references 심볼을 관측하고, `buildResultStatus`의
verified 확정 이후 `symbol_trace`에서 미관측이면 `targeted_read_needed`
강등 + confidence high→medium cap (기존 `confidence_downgraded` 메커니즘
재사용, R3/R4); (3) **additive critic warning** `usage_cross_check_missing`
(medium, confidence_downgraded 앞 push, R5); (4) **프롬프트 보강** —
symbol-first 전략에 cross-check 지시 + "If no result **or truncated**"
fallback (R7). 공개 surface 동결, 벤치마크는 record-only 케이스 추가 (R8).

## Technical Context

**Language/Version**: Node.js 22+ ESM (`.mjs`), JavaScript (TypeScript 없음)

**Primary Dependencies**: 없음 — zero runtime/dev dependencies (Node 표준
라이브러리만). 외부 도구는 선택적 ripgrep(있으면 fast path).

**Storage**: N/A (탐색 1회 수명의 런타임 내부 값만 — [data-model.md](./data-model.md))

**Testing**: `node --test` (`npm test`), mock chat client 기반 runtime 시나리오
테스트 + 순수 함수 단위 테스트. 실 API 검증은 `scripts/integration-test.mjs`와
벤치마크(record-only).

**Target Platform**: 크로스 플랫폼 Node CLI/stdio MCP 서버 (개발 환경 win32,
CI ubuntu)

**Project Type**: 단일 소스 루트의 MCP 서버 + 벤치마크 하네스

**Performance Goals**: symbol_trace 호출의 탐색 비용 증가 한도 — 평균 +2턴,
내부 토큰 +25% 이내 (SC-004, spec 025 effect metrics로 관측).
`symbolContext` 내부 grep cap 40→80 상향의 파싱 비용 증가는 무시 가능 수준.

**Constraints**: 공개 `structuredContent` 필드 집합·`schemaVersion`(2) 동결;
새 도구/입력/환경변수 금지; critic은 순수 함수(LLM 재호출 금지); 경고 최대
3개 예산 유지; report 모드 비대상; confidence cap은 medium까지만(low는
FR-003 위반 — research R4); `buildCriticWarnings` 구 시그니처 호환.

**Scale/Scope**: 코드 변경 4개 모듈(`repo-tools.mjs`, `runtime.mjs`,
`critic.mjs`, `prompt.mjs`) + evaluator check type 1개 + 벤치마크 케이스
1개 + 테스트/문서. 신규 파일 없음(테스트 제외).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md`는 미작성 템플릿이므로, 프로젝트의 사실상
헌법인 AGENTS.md 불변식 + DESIGN 정책을 게이트로 평가한다.

| 게이트 (출처) | Phase 0 전 | Phase 1 후 |
|---|---|---|
| Zero dependencies (AGENTS.md) | PASS — 계획된 변경 전부 기존 모듈 내 순수 JS | PASS — R2 fix가 기존 `classifyReference`/`detectLanguage` 재사용으로 확정 |
| Read-only 탐색 (AGENTS.md) | PASS — 판정/프롬프트/절단 정책만 변경 | PASS |
| 공개 도구 8개·입력 스키마·envvar 동결 (spec 011, FR-007) | PASS — 설계상 additive warning만 | PASS — 대상 심볼을 기존 `args.hints.symbols[0]`에서 읽어 입력 추가 불필요 확인 (R3) |
| `structuredContent` additive-only·schemaVersion 불변 (DESIGN §1.1) | PASS | PASS — warning 스키마가 type을 enum 제한하지 않음 확인; 관측 기록은 stats/내부 전용 (R9-5) |
| Deterministic critic — LLM 재호출 금지 (DESIGN §11.2) | PASS — gate는 관측 사실의 순수 함수 | PASS — gate 입력이 tool loop에서 사전 수집됨 확인 (R4) |
| 경고 예산·형식 (DESIGN §11.3) | PASS — 기존 shape/3개 예산 내 | PASS — 정렬-후-절단이 고severity 보존 자동 보장 (R5) |
| Scope hard boundary (DESIGN §12, FR-005) | PASS — scope 밖 요구 없음 | PASS — 구조적 자동 충족, 비교 로직 불필요 확정 (R6) |
| 벤치마크 record-only (spec 021) | PASS | PASS — 새 check type도 점수 기록일 뿐 (R8) |
| commit 전 npm test (AGENTS.md) | 절차 게이트 — tasks에 반영 | 동일 |

위반 없음 → Complexity Tracking 불요.

## Project Structure

### Documentation (this feature)

```text
specs/026-trace-symbol-cross-check/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output — 근원 원인 실측(confirmed) + 통합 지점 매핑
├── data-model.md        # Phase 1 output — 관측/게이트/경고 엔티티와 상태 전이
├── quickstart.md        # Phase 1 output — 5단계 검증 절차
├── contracts/
│   └── critic-warning-usage-cross-check.md  # 공개 표면 변경의 전부 (additive warning + 벤치 check)
├── checklists/
│   └── requirements.md  # /speckit-specify 품질 체크리스트 (통과)
└── tasks.md             # Phase 2 output (/speckit-tasks — 이 명령이 만들지 않음)
```

### Source Code (repository root)

```text
src/
├── explorer/
│   ├── repo-tools.mjs   # [수정] symbolContext caller 수집: cap 40→budget(80),
│   │                    #   결정적 우선순위·다양성 정렬 후 slice(0,20) (R2)
│   ├── runtime.mjs      # [수정] compact tool loop에 args 기반 관측 기록
│   │                    #   (grepPatterns/referenceSymbols, :1655-1663 부근);
│   │                    #   buildResultStatus verified 확정 후 gate 강등 분기;
│   │                    #   runDeterministicCriticPass 호출부에 gate 입력 전달
│   ├── critic.mjs       # [수정] buildCriticWarnings에 usage_cross_check_missing
│   │                    #   (optional 인자, 구 시그니처 호환); finalConfidence
│   │                    #   medium cap (confidence_downgraded 자동 발화)
│   └── prompt.mjs       # [수정] symbol-first 전략 문구: cross-check 지시 +
│                        #   "If no result or truncated" (:4, :197-198, :291)
├── benchmark/
│   └── evaluator.mjs    # [수정] check type 'critic_warning_absent' 추가
benchmarks/
└── adoption.json        # [수정] 케이스 trace-symbol-cross-check 추가
                         #   (symbol=buildReportCritic, 기대 target runtime.mjs)
tests/
├── repo-tools.test.mjs            # [수정] caller 절단 결정성·다양성·우선순위 테스트
├── runtime.mock.test.mjs          # [수정] gate 양방향 + narrow-scope + 프롬프트 snapshot
├── critic.test.mjs                # [수정] 새 warning shape/예산 경쟁/구 시그니처 호환
└── benchmark-evaluator.test.mjs   # [수정] critic_warning_absent check type
README.md / DESIGN.md / CHANGELOG.md  # [수정] FR-010 문서 갱신
```

**Structure Decision**: 기존 단일 소스 루트 구조를 그대로 사용한다. 신규
프로덕션 파일은 없고, 변경은 위 4개 explorer 모듈 + evaluator + 벤치마크
선언 + 테스트 + 문서에 한정된다. 정확한 통합 지점·회귀 위험·삽입 순서는
[research.md](./research.md) R3~R9에 file:line 단위로 고정되어 있으며,
tasks.md(/speckit-tasks)가 이를 작업 단위로 분해한다.

## Complexity Tracking

> Constitution Check 위반 없음 — 해당 없음.
