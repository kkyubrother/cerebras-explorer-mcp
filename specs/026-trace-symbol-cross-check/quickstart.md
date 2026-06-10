# Quickstart: spec 026 검증 절차

구현 후 이 순서로 빠르게 확인한다. 1~3은 로컬(키 불필요), 4~5는 실 API.

## 1. 인덱서 재현 (FR-001 — 결정성·다양성 확인)

```powershell
# $env:TEMP\repro-symbol-context.mjs — file:// import로 RepoToolkit 직접 호출
# new RepoToolkit({ repoRoot: <이 저장소>, budgetConfig: getBudgetConfig() })
# → tk.initialize([]) → tk.symbolContext({ symbol: 'buildReportCritic', depth: 1 }) x 5회
node $env:TEMP\repro-symbol-context.mjs
```

기대 (fix 후): 5회 모두 동일 결과(결정성), callers에 `src/explorer/runtime.mjs`
호출처(`call` relation) 포함, definition은 항상 critic.mjs:528 존재.
fix 전 baseline: 포함 3/11회, definition null 1~2회 (research R1).

## 2. 단위 테스트 (FR-002~FR-005)

```powershell
node --test tests/runtime.mock.test.mjs --test-name-pattern "spec 026"
node --test tests/critic.test.mjs
npm test   # 전체 0 fail
```

기대: gate 양방향 테스트(미관측→강등+경고 / 관측→무변경, narrow-scope 충족
포함) 통과, `critic.test.mjs:208` 구 시그니처 직접 호출 호환 유지.

## 3. 프롬프트 snapshot (FR-006)

```powershell
node --test tests/runtime.mock.test.mjs --test-name-pattern "symbol-first"
```

기대: symbol-first 전략 문구에 cross-check 지시와 "or truncated" fallback이
포함됨을 단언하는 신규 snapshot 테스트 통과.

## 4. 라이브 재현 5회 (SC-001)

```powershell
# trace_symbol(symbol='buildReportCritic')를 이 저장소에 5회 호출 (MCP 또는 direct runtime)
# 각 응답에서 기록: status.verification / status.confidence /
#   critic.warnings[].type / searchCoverage.grepCalls / targets[].path
```

기대: `verified`+`high`인데 grep/references 관측 0인 응답 **0건**.
cross-check 누락 run은 `targeted_read_needed` + `usage_cross_check_missing`.
(temperature 1.0 샘플링이므로 5회 반복 — SC-001.)

## 5. 벤치마크 (FR-008, SC-003/SC-004 — record-only)

```powershell
node ./scripts/run-benchmark.mjs --suite ./benchmarks/adoption.json --case trace-symbol-cross-check --verbose
node ./scripts/run-benchmark.mjs --suite ./benchmarks/adoption.json --verbose
```

기대: 새 케이스에서 `src/explorer/runtime.mjs`가 기대 target 그룹에 매치,
`critic_warning_absent` check pass. 전체 스위트에서 기존 trace-symbol 케이스
pass 비회귀(SC-003), 턴 +2 이내·내부 토큰 +25% 이내(SC-004 — spec 025
effect metrics로 관측).
