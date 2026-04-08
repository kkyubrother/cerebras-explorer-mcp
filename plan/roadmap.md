# 구현 우선순위 & 로드맵

## 우선순위 매트릭스

| Priority | Phase | Feature | Impact | Effort | 상태 |
|----------|-------|---------|--------|--------|------|
| **P0** | 1.1 | Git 메타데이터 도구 | ★★★★★ | Medium | ✅ DONE |
| **P0** | 1.3 | ripgrep 네이티브 통합 | ★★★★ | Small | ✅ DONE |
| **P1** | 1.2 | 심볼 인덱스 (tree-sitter) | ★★★★★ | Large | TODO |
| **P1** | 2.1 | 탐색 전략 엔진 | ★★★★ | Medium | TODO |
| **P1** | 2.2 | 결과 캐싱 | ★★★ | Small | TODO |
| **P2** | 3.1 | 다층 출력 포맷 | ★★★ | Medium | TODO |
| **P2** | 3.2 | 신뢰도 개선 | ★★★ | Medium | TODO |
| **P2** | 3.3 | 실행 가능한 followups | ★★★ | Small | TODO |
| **P2** | 4.2 | 다중 MCP 도구 | ★★★★ | Medium | TODO |
| **P3** | 2.3 | 매크로 도구 체이닝 | ★★ | Medium | TODO |
| **P3** | 4.1 | 모델 라우팅 | ★★ | Medium | TODO |
| **P3** | 4.3 | 프로바이더 추상화 | ★★★ | Medium | TODO |
| **P3** | 5.1 | 인터랙티브 모드 | ★★★ | Large | TODO |
| **P3** | 5.2 | 진행 상황 리포팅 | ★★ | Small | TODO |
| **P3** | 5.3 | 프로젝트별 설정 파일 | ★★ | Small | TODO |

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

### Milestone 2: Intelligence (P1)
> **목표:** 스마트한 탐색으로 턴 효율성 극대화

- [ ] tree-sitter WASM 통합 (최소 JS/TS/Python)
- [ ] `repo_symbols`, `repo_references` 도구 추가
- [ ] 탐색 전략 엔진 (system prompt + hints 확장)
- [ ] LRU 캐시 계층 구현
- [ ] 프롬프트 업데이트: 전략 선택 가이드

**완료 시:** 함수/클래스 수준의 코드 이해 가능. 같은 budget으로 2-3배 더 깊은 탐색.

### Milestone 3: Polish (P2)
> **목표:** 출력 품질과 도구 다양성 향상

- [ ] 출력 스키마 확장 (`codeMap`, `diagram`, `recentActivity`)
- [ ] 신뢰도 점수 연속화 (0.0-1.0) + 근거 설명
- [ ] 실행 가능한 followups 포맷
- [ ] 특화 MCP 도구 추가 (`explain_symbol`, `trace_dependency`, `summarize_changes`)
- [ ] 출력 스키마 문서화

**완료 시:** parent model이 즉시 활용 가능한 풍부한 구조화 정보 제공.

### Milestone 4: Ecosystem (P3)
> **목표:** 유연성과 확장성 확보

- [ ] 프로바이더 추상화 + failover
- [ ] 모델 라우팅 (복잡도별)
- [ ] 인터랙티브 세션 모드
- [ ] MCP 진행 알림
- [ ] 프로젝트별 설정 파일 지원
- [ ] 매크로 도구

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
