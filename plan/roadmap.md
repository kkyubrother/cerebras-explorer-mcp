# 구현 우선순위 & 로드맵

## 우선순위 매트릭스

| Priority | Phase | Feature | Impact | Effort | 상태 |
|----------|-------|---------|--------|--------|------|
| **P0** | 1.1 | Git 메타데이터 도구 | ★★★★★ | Medium | ✅ DONE |
| **P0** | 1.3 | ripgrep 네이티브 통합 | ★★★★ | Small | ✅ DONE |
| **P1** | 1.2 | 심볼 인덱스 (tree-sitter) | ★★★★★ | Large | ✅ DONE |
| **P1** | 2.1 | 탐색 전략 엔진 | ★★★★ | Medium | ✅ DONE |
| **P1** | 2.2 | 결과 캐싱 | ★★★ | Small | ✅ DONE |
| **P2** | 3.1 | 다층 출력 포맷 | ★★★ | Medium | ✅ DONE |
| **P2** | 3.2 | 신뢰도 개선 | ★★★ | Medium | ✅ DONE |
| **P2** | 3.3 | 실행 가능한 followups | ★★★ | Small | ✅ DONE |
| **P2** | 4.2 | 다중 MCP 도구 | ★★★★ | Medium | ✅ DONE |
| **P3** | 2.3 | 매크로 도구 체이닝 | ★★ | Medium | ✅ DONE |
| **P3** | 4.1 | 모델 라우팅 | ★★ | Medium | ✅ DONE |
| **P3** | 4.3 | 프로바이더 추상화 | ★★★ | Medium | ✅ DONE |
| **P3** | 5.1 | 인터랙티브 모드 | ★★★ | Large | ✅ DONE |
| **P3** | 5.2 | 진행 상황 리포팅 | ★★ | Small | ✅ DONE |
| **P3** | 5.3 | 프로젝트별 설정 파일 | ★★ | Small | ✅ DONE |

## 단계별 마일스톤

### Milestone 1: Foundation (P0) — ✅ 완료 (2026-04-08)
> **목표:** 내장 탐색기와의 핵심 격차 해소

- [x] Git 메타데이터 도구 4종 (`repo_git_log`, `repo_git_blame`, `repo_git_diff`, `repo_git_show`) — `src/explorer/repo-tools.mjs`
- [x] ripgrep 통합 (fallback 포함) — `_grepWithRipgrep()` + `_hasRipgrep` 자동 감지
- [x] 프롬프트 업데이트: 새 도구 사용법 안내 — `src/explorer/prompt.mjs`
- [x] runtime stats에 git 도구 호출 카운터 추가 — `src/explorer/runtime.mjs`
- [x] 테스트 추가 — `tests/repo-tools.test.mjs` (git 6종 + ripgrep 1종 + candidatePaths 1종)

**구현 결과:**
- `repo_git_log`: 파일/디렉토리별 커밋 이력, since/author/grep 필터 지원
- `repo_git_blame`: --porcelain 파싱으로 라인별 작성자/커밋 추적
- `repo_git_diff`: stat 요약 또는 full patch 선택, ref 입력 검증
- `repo_git_show`: 커밋 메시지 + patch (8KB 이상 자동 truncate)
- ripgrep: `--json` 출력 파싱, maxBuffer 200KB, ripgrep 없으면 자동 fallback
- git ref injection 방지: `^[0-9a-zA-Z_./:^~\-]+$` 화이트리스트 검증

**완료 효과:** "코드의 역사"를 아는 탐색기로 진화. 대규모 레포에서도 빠른 검색.

### Milestone 2: Intelligence (P1) — ✅ 완료 (2026-04-08)
> **목표:** 스마트한 탐색으로 턴 효율성 극대화

- [x] 심볼 인덱스 (`repo_symbols`, `repo_references`, `repo_symbol_context`) — `src/explorer/symbols.mjs` + `repo-tools.mjs`
- [x] 매크로 도구 체이닝 (`repo_symbol_context`, `repo_grep` contextLines) — `repo-tools.mjs`
- [x] 탐색 전략 엔진 (system prompt + hints 확장) — `detectStrategy()` + system prompt 전략 가이드
- [x] LRU 캐시 계층 구현 — `cache.mjs` `LruCache` + `globalRepoCache` 싱글턴
- [x] 프롬프트 업데이트: 전략 선택 가이드 — `buildExplorerSystemPrompt`에 6개 전략 가이드 추가

**구현 결과 (신규, 2026-04-08):**
- **1.2 심볼 인덱스** (`src/explorer/symbols.mjs`):
  - `extractSymbols(content, filePath, kind)`: JS/TS/Python/Go/Rust/Java/Ruby regex 기반 추출
  - `{name, kind, line, endLine, exported}[]` 반환 (endLine: brace-counting 또는 indentation 기반)
  - `detectLanguage(filePath)`: 확장자 기반 언어 감지
  - `categorizeReference(line, symbol, filePath)`: import/definition/usage 분류
  - tree-sitter 대신 regex 구현 (zero-dependency 유지)
- **`repo_symbols`**: 파일 심볼 목록 추출, kind 필터, LRU 캐시 지원
- **`repo_references`**: 심볼 grep + categorize → definition + references 반환
- **`repo_symbol_context` (매크로)**: grep + symbols + readFile 1회 호출로 definition body + callers 반환. 2–4턴 절약.
- **`repo_grep` contextLines**: contextLines=0–5 파라미터 추가. 매칭 전후 N줄 포함. ripgrep/native 양쪽 지원.
- `stats.symbolCalls` 추가
- 프롬프트: symbol-first/reference-chase 전략 설명 업데이트, 심볼 도구 사용 가이드 추가

**기존 구현 결과:**
- `detectStrategy(task)`: 6가지 전략(symbol-first, reference-chase, git-guided, breadth-first, blame-guided, pattern-scan)을 한/영 키워드로 자동 감지
- hints.strategy 필드: 직접 전략 지정 가능, enum 검증
- LRU 캐시: 50MB 상한, 파일/grep/git 결과 캐싱, git ops TTL 60초
- stats에 cacheHits/cacheMisses/cacheHitRate 포함

### Milestone 3: Polish (P2) — ✅ 완료 (2026-04-08)
> **목표:** 출력 품질과 도구 다양성 향상

- [x] 출력 스키마 확장 (`codeMap`, `diagram`, `recentActivity`) — `src/explorer/runtime.mjs`
- [x] 신뢰도 점수 연속화 (0.0-1.0) + 근거 설명 — `computeConfidenceScore()` in `src/explorer/schemas.mjs`
- [x] 실행 가능한 followups 포맷 — `EXPLORE_RESULT_JSON_SCHEMA` 구조화된 객체 배열
- [ ] 특화 MCP 도구 추가 (`explain_symbol`, `trace_dependency`, `summarize_changes`)
- [ ] 출력 스키마 문서화

**구현 결과:**
- `confidenceScore` (0.0–1.0): evidence grounding, cross-verification, grep 사용, budget 소진 여부에 따라 계산
- `confidenceLevel`: score 기반으로 low/medium/high 재계산 (모델 보고값이 높으면 하향 조정)
- `confidenceFactors`: evidenceCount, evidenceDropped, crossVerified, symbolSearchUsed, stoppedByBudget 및 adjustments 목록
- evidence 부분 일치 허용: ±2줄 tolerance, `groundingStatus: "exact"|"partial"` 플래그
- `followups` 구조화: `{description, priority: "recommended"|"optional", suggestedCall: {task, scope, budget, hints}}` — legacy string도 자동 정규화
- `codeMap`: 탐색된 파일 목록으로 자동 빌드 — `entryPoints` (index/main/app/server 패턴), `keyModules` (path, role, linesRead)
- `diagram`: breadth-first 전략 또는 미지정 시 Mermaid flowchart 자동 생성 (2–12 모듈 범위)
- `recentActivity`: `repo_git_log` 호출 결과 캡처 → `hotFiles`, `recentAuthors`, `lastModified`, `recentCommits`
- 테스트 4종 추가: 기본 필드, legacy followup 정규화, git recentActivity, partial match evidence

**완료 효과:** parent model이 즉시 활용 가능한 풍부한 구조화 정보 제공.

### Milestone 5: DX (P3) — ✅ 완료 (2026-04-08)
> **목표:** 개발자 경험 향상으로 탐색 품질과 편의성 극대화

- [x] 인터랙티브 세션 모드 — `src/explorer/session.mjs` (`SessionStore`, `globalSessionStore`)
- [x] MCP 진행 알림 — `notifications/progress` via `jsonrpc-stdio.mjs` + `server.mjs`
- [x] 프로젝트별 설정 파일 — `.cerebras-explorer.json` 로딩 + 적용

**구현 결과:**

**5.1 인터랙티브 세션 모드:**
- `SessionStore`: TTL(기본 30분)/maxCalls(기본 5회) 기반 인메모리 세션 관리
- 세션 누적 데이터: `candidatePaths`(50개), `evidencePaths`(30개), `summaries`(최근 3개), `followups`
- `stats.sessionId` 반환 → 다음 호출 시 `session: "sess_..."` 파라미터로 전달
- 후속 호출 시 자동 컨텍스트 주입: 이전 `candidatePaths` → user prompt hint, 이전 `summaries` → system prompt "Previous findings"

**5.2 진행 상황 리포팅:**
- `StdioJsonRpcServer.sendNotification(method, params)` 메서드 추가
- `_meta.progressToken` 감지 → `notifications/progress` 자동 전송
- 턴별 메시지: "Starting exploration..." → "Turn N/M: repo_grep, repo_read_file..." → "Synthesizing findings..."
- `startMcpServer`의 lazy closure 패턴으로 transport 참조 문제 해결

**5.3 프로젝트별 설정 파일:**
- `loadProjectConfig(repoRoot)`: `.cerebras-explorer.json` 자동 로딩
- `normalizeProjectConfig(raw)`: 타입 검증 및 정규화
- 적용 우선순위: 함수 인자 > 설정 파일 > 기본값
- 지원 필드: `defaultBudget`, `defaultScope`, `extraIgnoreDirs`, `projectContext`, `keyFiles`, `entryPoints`
- `extraIgnoreDirs`: `RepoToolkit.ignoreDirs` 확장 세트로 적용
- `projectContext`: system prompt에 "Project context:" 섹션으로 주입
- `keyFiles`: system prompt에 "Key files" 힌트로 주입

**테스트 추가:** 25종 (session.test.mjs + project-config.test.mjs) + runtime 3종 (onProgress, sessionId, session context injection)

### Milestone 4: Ecosystem (P3) — 부분 완료 (2026-04-08)
> **목표:** 유연성과 확장성 확보

- [x] 프로바이더 추상화 + failover — `src/explorer/providers/`
- [x] 모델 라우팅 (복잡도별 + budget별) — `config.mjs` + `runtime.mjs`
- [x] 다중 MCP 도구 (explain_symbol, trace_dependency, summarize_changes, find_similar_code) — `src/mcp/server.mjs`
- [x] 인터랙티브 세션 모드 — `src/explorer/session.mjs` (Phase 5에서 구현)
- [x] MCP 진행 알림 — `notifications/progress` via `src/mcp/server.mjs` + `jsonrpc-stdio.mjs` (Phase 5에서 구현)
- [x] 프로젝트별 설정 파일 지원 — `.cerebras-explorer.json` via `src/explorer/config.mjs` (Phase 5에서 구현)
- [ ] 매크로 도구

**구현 결과:**

**4.1 모델 라우팅:**
- `getModelForBudget(budget)`: `CEREBRAS_EXPLORER_MODEL_QUICK/NORMAL/DEEP` 환경변수 지원
- `classifyTaskComplexity(task)`: 한/영 키워드로 simple/moderate/complex 분류
- `CEREBRAS_EXPLORER_AUTO_ROUTE=true`: 작업 복잡도 기반 모델 자동 선택 (탐색 budget 독립)
- `ExplorerRuntime`: lazy chatClient 생성 — 명시적 `chatClient` 전달 시 그대로 사용, 없으면 `createChatClient({ budget })`

**4.2 다중 MCP 도구:**
- `explain_symbol(symbol, repo_root?, scope?)` — symbol-first 전략으로 explore_repo 호출
- `trace_dependency(entryPoint, direction?, maxDepth?, repo_root?)` — reference-chase 전략
- `summarize_changes(since?, until?, path?, repo_root?)` — git-guided 전략
- `find_similar_code(reference, startLine?, endLine?, scope?, repo_root?)` — pattern-scan 전략
- `CEREBRAS_EXPLORER_EXTRA_TOOLS=false`로 비활성화 가능 (기본: 활성화)

**4.3 프로바이더 추상화:**
- `AbstractChatClient`: createChatCompletion 인터페이스 계약
- `OpenAICompatChatClient`: Groq, Together, Fireworks 등 OpenAI-compat API 지원 (`EXPLORER_OPENAI_*`)
- `OllamaChatClient`: Ollama 로컬 모델 (`http://localhost:11434/v1`, `EXPLORER_OLLAMA_*`)
- `FailoverChatClient`: 순차 fallover + 타임아웃 (`EXPLORER_FAILOVER`, `EXPLORER_FAILOVER_TIMEOUT_MS`)
- `createChatClient({ budget })`: `EXPLORER_PROVIDER` 환경변수로 provider 선택

**테스트 추가:** 23종 (providers.test.mjs) + mcp-server 도구 목록 검증

**완료 시:** 다양한 환경/프로바이더에서 유연하게 동작하는 완성된 탐색 플랫폼.

---

## 핵심 차별화 포인트

cerebras-explorer가 내장 탐색기를 **넘어서는** 가치:

### 1. 비용 효율성 (Cost Efficiency)
Cerebras의 빠르고 저렴한 추론으로 parent model의 토큰 소비를 대폭 절감.
이것이 존재 이유이며, 모든 기능이 이 장점을 강화해야 함.

### 2. 구조화된 코드 이해 (Structured Understanding)
단순 텍스트 검색을 넘어 AST 기반 심볼 추적 + git 이력 = "코드의 의미와 역사를 아는 탐색기".
내장 도구의 Glob/Grep/Read는 원시 도구이지만, cerebras-explorer는 **분석 결과**를 반환.

### 3. 재현 가능한 탐색 (Reproducible Exploration)
동일 질문에 동일 결과를 반환하는 결정적 탐색.
temperature 0.1 + evidence grounding + 구조화된 출력.

### 4. 위임 최적화 (Delegation Efficiency)
parent model이 한 번 위임하면 완결된 답을 받는 구조.
내장 도구의 "여러 턴 Glob → Grep → Read 왔다갔다"보다 효율적.
특히 복잡한 질문일수록 이 장점이 극대화됨.

### 5. 특화된 분석 도구 (Specialized Analysis)
`trace_dependency`, `find_similar_code`, `summarize_changes` 같은 고수준 분석은
내장 도구 조합으로는 여러 턴이 필요하지만, 단일 호출로 해결.

---

## 기술적 제약 사항

- **zero dependencies 원칙 유지**: tree-sitter는 `.wasm` 파일로 번들 (npm 의존성 아님)
- **Node 18.17+ 유지**: `globalThis.fetch` 사용
- **read-only 원칙 유지**: git 명령도 read-only만 허용
- **하위 호환성**: 기존 `explore_repo` 입출력 스키마는 확장만, 변경 없음
