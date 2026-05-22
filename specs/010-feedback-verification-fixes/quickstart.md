# Quickstart: 피드백 검증 기반 5종 신뢰성 수정 검증

본 문서는 spec.md의 5개 user story acceptance scenario를 코드 변경 후 수동으로 빠르게 확인하기 위한 절차다. CI 게이트는 `npm test` 전체 통과로 충족되며, 본 quickstart는 추가 확신을 위한 옵션이다.

---

## 사전 조건

```pwsh
# Node ≥22
node --version

# 의존성 설치 (저장소 루트)
npm install
```

---

## Q1. 상태 계약 (Spec-1, User Story 1)

신규 단위 테스트가 evidence sufficiency를 검증한다.

```pwsh
node --test tests/runtime.mock.test.mjs
```

기대:
- `locate task + exact 1 + budget exhausted → complete:true, failure:null` 케이스 PASS
- `path_explanation + exact 1 + budget exhausted → complete:false, failure.reason='budget_exhausted'` 케이스 PASS
- `follow_up_needed + read target → nextAction.type='explore_followup'` 케이스 PASS
- `critic fail → broad_search_needed` 케이스 PASS

수동 확인:
```pwsh
node -e "
import('./src/explorer/runtime.mjs').then(async ({ exploreRepository }) => {
  // mock provider 환경에서 단일 locate task 실행 결과의 _debug.evidenceSufficiency 확인
  // (실제로는 tests/runtime.mock.test.mjs의 helper로 검증)
});
"
```

---

## Q2. `discoveredPaths[]` 분리 (Spec-2, User Story 2)

```pwsh
node --test tests/runtime.mock.test.mjs tests/repo-tools.test.mjs tests/mcp-server.test.mjs
```

기대:
- `listDir에 .github + evidence는 src/auth.js → targets에 src/auth.js만, discoveredPaths에 .github` PASS
- `collectDiscoveredPathsFromToolResult('repo_list_dir', ...)` 단위 PASS
- `structuredContent.discoveredPaths` redaction 후 보존 PASS
- Report dedupe: 동일 파일 3 citation → 1 target, range 병합 PASS

Legacy 호환:
```pwsh
$env:CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS = "1"
node --test tests/runtime.mock.test.mjs
# 기존 reference target 승격 동작 확인 후
Remove-Item Env:CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS
```

---

## Q3. Redaction 환경변수 이름 보존 (Spec-3, User Story 3)

```pwsh
node --test tests/security/redact.test.mjs
```

기대:
- `process.env.CEREBRAS_API_KEY` 그대로 보존 PASS
- `\`.env.production:L1-L3\`` → `[REDACTED:secret-path]` PASS
- `process.env.OPENAI_API_KEY = "sk-proj-..."` → 이름 보존 + 값만 `[REDACTED:openai-api-key]` PASS

옵트인 검증:
```pwsh
$env:CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES = "1"
node --test tests/security/redact.test.mjs
# env var 이름까지 마스킹되는 케이스 PASS 확인 후
Remove-Item Env:CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES
```

---

## Q4. `gitDiff` scope hard boundary (Spec-4, User Story 4)

```pwsh
node --test tests/repo-tools.test.mjs
```

기대:
- scope `['docs/**']`에서 `gitDiff` 결과 `files`가 `docs/*`만 포함하고 `omittedOutOfScopeFiles > 0` PASS
- `gitDiff({stat:true})` scope 필터링 PASS
- 기존 `gitShow` scope test (`tests/repo-tools.test.mjs:L622-L642`) 회귀 무결 PASS

수동 확인(git 가용 환경):
```pwsh
git init demo
cd demo
"x" | Out-File hello.js
New-Item -ItemType Directory docs | Out-Null
"y" | Out-File docs/README.md
git add . ; git commit -m "init"
"z" | Out-File hello.js
"w" | Out-File docs/README.md
git add . ; git commit -m "change both"
# 실제 호출은 tests/repo-tools.test.mjs의 fixture 헬퍼 사용
```

---

## Q5. Session / Progress / Sub-agent (Spec-5, User Story 5)

```pwsh
node --test tests/session.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs
```

기대:
- `findReusableForRepo()` reusable / expired / exhausted 3개 케이스 PASS
- `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO=1` 환경에서 두 번째 호출이 `session.status=reused`, `_debug.stats.sessionSource=auto_repo` PASS
- 기본 환경에서 매번 `created` 회귀 무결 PASS
- MCP initialize instructions에 progressToken/sessionId 안내 문구 유지 PASS

문서 검증:
```pwsh
# README/AGENTS/DESIGN 5개 필수 문구 grep (SC-009)
$patterns = @(
  "progressToken",
  "control-plane fields",
  "Decision rule",
  "discoveredPaths",
  "env var",
  "scope"
)
foreach ($p in $patterns) {
  Write-Host "=== '$p' ===" ; Select-String -Path README.md, DESIGN.md, AGENTS.md -Pattern $p | Select-Object -First 3
}
```

---

## 전체 회귀

```pwsh
npm test
```

기대: 종료 코드 0, failure 수 0. skip 수는 환경(Windows/git 가용성) 의존이며 게이트가 아니다.

---

## Smoke: stdio MCP 서버 boot

```pwsh
node src/index.mjs
```

기대: 표준 입력을 기다리는 상태로 진입(Ctrl+C로 종료). `initialize` 호출이 들어오면 instructions에 progressToken/sessionId 안내가 포함되어 있다.

---

## CHANGELOG 묶음 확인

```pwsh
Select-String -Path CHANGELOG.md -Pattern "010-feedback-verification-fixes" -Context 0,10
```

기대: 본 plan의 5개 Spec과 3개 신규 envvar, additive schema가 단일 변경 묶음으로 기록되어 있다.
