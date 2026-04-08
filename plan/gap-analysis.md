# 현재 상태 요약 및 격차 분석

## 현재 상태

cerebras-explorer는 단일 `explore_repo` 도구로, Cerebras의 저비용 모델(`zai-glm-4.7`)을 활용해 자율적 레포 탐색 루프를 수행합니다.

### 보유 도구 (11개, 읽기 전용) — 2026-04-08 기준

| 도구 | 기능 |
|------|------|
| `repo_list_dir` | 디렉토리 구조 탐색 (depth 1-4) |
| `repo_find_files` | 글로브 패턴으로 파일 검색 |
| `repo_grep` | 정규식으로 파일 내용 검색 (ripgrep 우선, fallback 포함) |
| `repo_symbols` | 파일 내 함수/클래스/변수/타입 정의 추출 |
| `repo_references` | 특정 심볼의 definition/import/usage 검색 |
| `repo_symbol_context` | 심볼 정의 본문 + 호출자 정보를 한 번에 반환 |
| `repo_read_file` | 특정 파일의 라인 범위 읽기 |
| `repo_git_log` | 커밋 이력 조회 (파일/날짜/작성자/메시지 필터) |
| `repo_git_blame` | 라인별 작성자·커밋 추적 |
| `repo_git_diff` | 두 ref 간 변경사항 비교 (stat 또는 full patch) |
| `repo_git_show` | 특정 커밋의 메시지 + 변경 파일 + patch |

### 주요 특성

- Evidence grounding: 실제 읽은 라인 범위만 증거로 인정
- Budget 제어: quick/normal/deep 3단계
- 안전 경계: scope 제한, symlink 차단, 바이너리 필터링, .gitignore 존중
- 구조화된 JSON 출력 (`answer`, `summary`, `confidence`, `confidenceScore`, `evidence`, `followups`, `stats`, `codeMap`, `diagram`, `recentActivity`)
- MCP stdio 전송: NDJSON + Content-Length 자동 감지
- **탐색 전략 자동 감지** (2.1): task 텍스트에서 6종 전략(symbol-first, reference-chase, git-guided, breadth-first, blame-guided, pattern-scan) 자동 선택, hints.strategy로 명시 가능
- **LRU 캐시** (2.2): 세션 내 도구 결과 재사용 (50MB 상한, git ops TTL 60초), stats에 cacheHits/cacheMisses/cacheHitRate 포함
- **세션 기반 후속 탐색** (5.1): `stats.sessionId` 반환, 후속 호출에서 `session`으로 재사용 가능
- **진행 상황 리포팅** (5.2): `_meta.progressToken` 기반 `notifications/progress` 지원

## Claude Code/Codex 내장 탐색 대비 격차

| 영역 | Claude Code 내장 | cerebras-explorer | 격차 수준 |
|------|-----------------|-------------------|-----------|
| 코드 의미 분석 | LSP, tree-sitter | regex 기반 심볼/참조 추적 | **High** |
| Git 이력 추적 | git log/blame/diff | ✅ repo_git_log/blame/diff/show | ~~Critical~~ → 해소 |
| 심볼 탐색 | Go to definition, references | ✅ repo_symbols/references/symbol_context | ~~High~~ → 일부 해소 |
| 캐싱/인덱싱 | 세션 내 컨텍스트 유지 | ✅ LRU 캐시 (50MB, TTL 60s for git) | ~~High~~ → 해소 |
| 다중 도구 조합 | 자유로운 도구 체이닝 | 11개 도구 + 매크로 1개 | **Medium** |
| 웹 검색 | WebSearch/WebFetch | 없음 | **Medium** |
| 대규모 레포 | ripgrep 기반 | ✅ ripgrep 통합 (fallback 포함) | ~~High~~ → 해소 |
| 출력 품질 | 대화형, 맥락적 | 구조화된 JSON + codeMap/diagram/recentActivity | **Medium** |

## 핵심 강점 (유지 및 강화 대상)

1. **비용 효율성**: Cerebras의 빠르고 저렴한 추론으로 parent model 토큰 절감
2. **단일 위임**: 한 번 호출로 완결된 답변 — 내장 도구의 "여러 턴 왔다갔다"보다 효율적
3. **Evidence grounding**: 읽지 않은 코드를 증거로 제시하지 않는 신뢰성
4. **결정적 탐색**: temperature 0.1로 재현 가능한 결과
