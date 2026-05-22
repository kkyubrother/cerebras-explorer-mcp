# Quickstart: 011 도구 표면 단순화 검증

본 문서는 spec.md의 3개 user story acceptance scenario를 코드 변경 후 빠르게 확인하기 위한 절차다.

---

## 사전 조건

```pwsh
node --version   # Node ≥22
npm install
npm test         # baseline 0 failure 확인
```

---

## Q1. `explore`/`explore_v2` 단일화 (US1)

### 자동
```pwsh
node --test tests/mcp-server.test.mjs tests/runtime.mock.test.mjs
```

기대:
- 8개 도구가 `tools/list`에 노출되는 케이스 PASS
- `explore_v2`라는 도구 이름이 어떤 환경에서도 나타나지 않음 PASS
- V1 freeExplore 시나리오가 V2 동작으로 통과(citations/targets/critic/searchCoverage 동일) PASS

### 수동
```pwsh
# MCP server boot
$env:CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2 = 'true'   # 무시되어야 함
node src/index.mjs
# 다른 터미널에서 tools/list 호출 (or smoke 스크립트). 도구가 8개여야 하고 explore_v2가 없어야 함.
```

---

## Q2. `budget` 입력 제거 (US2)

### 자동
```pwsh
node --test tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

기대:
- `explore_repo({ budget: 'quick' })` 호출이 unknown property error로 거부 PASS
- `explore_repo({ task: '...' })` 호출이 정상 처리, 내부 turn limit이 deep 값(maxTurns=30 등)과 일치 PASS
- `failure.reason='budget_exhausted'` retry hint에 budget label 권유 문구 0건 PASS

### 수동
```pwsh
# 잘못된 입력 거부 확인
node -e "
import('./src/explorer/schemas.mjs').then(({ validateExploreRepoArgs }) => {
  try {
    validateExploreRepoArgs({ task: 'x', budget: 'quick' });
    console.log('FAIL: budget should be rejected');
  } catch (e) {
    console.log('OK:', e.message);
  }
});
"
```

---

## Q3. 환경변수 10개 제거 (US3)

### grep 확인
```pwsh
$removed = @(
  'CEREBRAS_MODEL',
  'CEREBRAS_EXPLORER_MODEL_QUICK',
  'CEREBRAS_EXPLORER_MODEL_NORMAL',
  'CEREBRAS_EXPLORER_MODEL_DEEP',
  'CEREBRAS_EXPLORER_EXTRA_TOOLS',
  'CEREBRAS_EXPLORER_ENABLE_EXPLORE',
  'CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2',
  'CEREBRAS_EXPLORER_AUTO_ROUTE',
  'CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO',
  'CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS'
)
foreach ($name in $removed) {
  # CHANGELOG 회상은 예외
  $hits = Select-String -Path 'src/**/*.mjs','tests/**/*.mjs','README.md','DESIGN.md','AGENTS.md','integrations/**/*' -Pattern $name -ErrorAction SilentlyContinue
  if ($hits) { Write-Host "FAIL: $name still appears in:`n$($hits | ForEach-Object { $_.Path } | Sort-Object -Unique)" }
  else { Write-Host "OK: $name" }
}
```

기대: 모든 항목 OK.

### 동작 확인
```pwsh
# 모든 envvar를 설정해도 동작이 동일해야 함
$env:CEREBRAS_MODEL = 'should-be-ignored'
$env:CEREBRAS_EXPLORER_EXTRA_TOOLS = 'false'
$env:CEREBRAS_EXPLORER_ENABLE_EXPLORE = 'false'
$env:CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO = '1'
$env:CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS = '1'

node src/index.mjs
# 다른 터미널에서 tools/list 호출 → 8개 도구 그대로 노출.
# explore_repo 호출 → discoveredPaths[] 정상 분리(legacy 동작 없음).
# 같은 repoRoot로 두 번 호출 → 매번 새 session(auto reuse 없음).
```

---

## 통합 회귀

```pwsh
npm test
```

기대: 종료 코드 0, failure 수 0.

---

## Smoke

```pwsh
node src/index.mjs
# server가 stdio handshake 대기 상태로 진입하고, instructions에 explore_v2 / budget / 제거된 envvar 언급이 없는지 확인.
```

---

## CHANGELOG 묶음 확인

```pwsh
Select-String -Path CHANGELOG.md -Pattern '011|consolidate' -Context 0,15
```

기대: 본 plan의 3개 user story와 두 breaking change(`budget` 입력 제거, `explore_v2` 이름 제거)가 단일 변경 묶음으로 기록되어 있다.
