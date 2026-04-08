# Phase 2: 지능형 탐색 전략 (Intelligence)

> **구현 상태:** 2026-04-08
> - ✅ 2.1 탐색 전략 엔진 — 완료
> - ✅ 2.2 탐색 결과 캐싱 — 완료
> - ⏭ 2.3 다중 도구 체이닝 — 미구현 (P3 우선순위, Milestone 4로 이관)

---

## 2.1 탐색 전략 엔진 (Strategy Planner) — P1 ✅

**목표:** 질문 유형에 따라 최적의 탐색 경로를 선택하여 턴 수 절약

### 현재 문제

모델이 매 턴마다 자유롭게 도구를 선택하므로, 비효율적인 탐색 경로를 택할 수 있음.
예: "함수 정의 찾기"에 `list_dir` → `grep` → `read_file`로 3턴 소모 (→ `repo_symbols` 1턴이면 충분)

### 전략 매핑

| 질문 유형 | 전략 이름 | 도구 체인 | 예시 질문 |
|-----------|-----------|-----------|-----------|
| 위치 찾기 | symbol-first | `repo_symbols` → `repo_read_file` | "X는 어디에 정의?" |
| 호출 추적 | reference-chase | `repo_references` → 각 파일 read | "X를 호출하는 곳?" |
| 변경 이력 | git-guided | `repo_git_log` → `repo_git_diff` → read | "최근 변경된 인증 코드" |
| 아키텍처 | breadth-first | `repo_list_dir(depth:2)` → 주요 파일 read | "프로젝트 구조" |
| 버그 추적 | blame-guided | `repo_grep` → `repo_git_blame` → `repo_git_show` | "이 버그의 원인" |
| 패턴 분석 | pattern-scan | `repo_grep` → 다수 파일 read → 비교 | "에러 핸들링 패턴" |

### 구현 방향

1. **system prompt 확장**: 전략 선택 가이드를 프롬프트에 포함
2. **hints 필드 확장**: `strategy` 힌트 추가
   ```json
   {
     "hints": {
       "strategy": "git-guided",
       "symbols": ["handleAuth"],
       "files": ["src/auth.js"]
     }
   }
   ```
3. **자동 전략 감지**: task 텍스트에서 키워드 기반 전략 추천
   - "누가", "언제", "변경", "커밋" → git-guided
   - "정의", "어디", "위치" → symbol-first
   - "호출", "사용", "참조" → reference-chase
   - "구조", "아키텍처", "개요" → breadth-first

### 구현 결과 (2026-04-08)

- `src/explorer/schemas.mjs`: hints에 `strategy` 필드 추가 (enum 검증 포함)
- `src/explorer/prompt.mjs`: `detectStrategy(task)` 함수 구현 (6개 전략 키워드 감지), `buildExplorerSystemPrompt`에 전략 선택 가이드 6줄 추가, `buildExplorerUserPrompt`에 전략 라인 삽입
- `STRATEGY_DESCRIPTIONS` 상수로 각 전략의 시작점 설명 제공

---

## 2.2 탐색 결과 캐싱 — P1 ✅

**목표:** 동일 세션 내 반복 탐색 비용 절감

### 캐시 계층

```
LRU 캐시 (메모리 기반, Map)
├── 파일 목록 캐시 (repo_list_dir, repo_find_files)
│   └── TTL: 세션 전체 (read-only 전제)
├── 파일 내용 캐시 (repo_read_file)
│   └── TTL: 세션 전체
├── grep 결과 캐시 (repo_grep)
│   └── TTL: 세션 전체
└── git 결과 캐시 (repo_git_*)
    └── TTL: 60초 (working tree 변경 가능)
```

### 캐시 키 설계

```javascript
// 예시: repo_read_file 캐시 키
const key = `read:${path}:${startLine}:${endLine}`;

// 예시: repo_grep 캐시 키  
const key = `grep:${pattern}:${caseSensitive}:${scope.sort().join(',')}`;
```

### 캐시 통계

stats에 캐시 히트율 포함:
```json
{
  "stats": {
    "cacheHits": 5,
    "cacheMisses": 12,
    "cacheHitRate": 0.29
  }
}
```

### 구현 노트

- MCP 서버는 Claude Code 세션 동안 프로세스로 살아있으므로 세션 간 캐시 유효
- 메모리 제한: 총 캐시 크기 50MB 상한
- `explore_repo` 호출 간에도 캐시 공유 (같은 프로세스)

### 구현 결과 (2026-04-08)

- `src/explorer/cache.mjs` (신규): `LruCache` 클래스 + `globalRepoCache` 싱글턴 + 캐시 키 빌더 8개
- `src/explorer/repo-tools.mjs`: `RepoToolkit` 생성자에 `cache` 옵션 추가, `callTool` 전체에 캐시 read/write 레이어 적용
- `src/explorer/runtime.mjs`: `globalRepoCache`를 `RepoToolkit`에 전달, `stats`에 `cacheHits/cacheMisses/cacheHitRate/cacheEntries/cacheSizeBytes` 포함

---

## 2.3 다중 도구 체이닝 최적화 — P3 ⏭ (미구현)

**목표:** 모델 턴 수를 줄이는 매크로 도구

### 매크로 도구

#### `repo_symbol_context`
한 번의 호출로 심볼의 전체 컨텍스트를 반환:

```json
{
  "name": "repo_symbol_context",
  "parameters": {
    "symbol": "string (required)",
    "depth": "number (default: 1) — 호출 체인 깊이"
  },
  "returns": {
    "definition": {
      "path": "src/auth.js",
      "startLine": 15,
      "endLine": 45,
      "content": "function handleAuth(req, res) { ... }"
    },
    "callers": [
      {"path": "src/routes/user.js", "line": 23, "context": "..."}
    ],
    "callees": [
      {"symbol": "verifyToken", "path": "src/jwt.js", "line": 8}
    ],
    "imports": [
      {"path": "src/routes/user.js", "line": 1, "statement": "import { handleAuth } from '../auth'"}
    ]
  }
}
```

#### `repo_grep` 컨텍스트 옵션 확장

```json
{
  "contextLines": 3,  // 매칭 라인 전후 3줄 포함
  "includeSymbol": true  // 매칭이 속한 함수/클래스 이름 포함
}
```

### 가치
- `quick` budget (6턴)에서도 충분한 정보 획득 가능
- 모델이 3번 호출할 것을 1번으로 축소
