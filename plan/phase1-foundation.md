# Phase 1: 핵심 도구 확장 (Foundation) — ✅ P0 완료 (2026-04-08)

## 1.1 Git 메타데이터 도구 추가 — ✅ 완료

**목표:** 코드의 "누가, 언제, 왜"를 파악하는 능력 확보

### 새로운 도구

```
repo_git_log     — 파일/디렉토리의 커밋 이력 조회 (최근 N개)
repo_git_blame   — 특정 파일의 라인별 작성자/커밋 추적
repo_git_diff    — 두 커밋/브랜치 간 변경사항 비교
repo_git_show    — 특정 커밋의 상세 내용 (메시지 + diff)
```

### 구현 방향

- `child_process.execFileSync('git', [...])` 사용, read-only 명령만 허용
- repo_root 내에서만 실행 가능하도록 경로 검증
- 출력 크기 제한 (`DEFAULT_GIT_OUTPUT_MAX_BYTES = 100KB`)
- ref injection 방지: `^[0-9a-zA-Z_./:^~\-]+$` 화이트리스트로 안전성 보장
- `_hasGit` 플래그로 git 미설치 환경 감지 (initialize() 시 자동 탐지)

### 실제 구현 위치

- 메서드: `src/explorer/repo-tools.mjs` — `_runGit()`, `_validateGitPath()`, `gitLog()`, `gitBlame()`, `_parseBlamePorcelain()`, `gitDiff()`, `gitShow()`
- 도구 정의: `buildToolDefinitions()` — 4개 추가 (strict: false, 파라미터 optional 많음)
- 디스패치: `callTool()` — 4개 case 추가
- 후보 경로: `collectCandidatePathsFromToolResult()` — diff/show는 변경 파일 경로 추출
- 통계: `src/explorer/runtime.mjs` — `gitLogCalls`, `gitBlameCalls`, `gitDiffCalls`, `gitShowCalls`
- 프롬프트: `src/explorer/prompt.mjs` — git 도구 사용 시점 가이드 추가

### 각 도구 상세

#### `repo_git_log`
```json
{
  "name": "repo_git_log",
  "parameters": {
    "path": "string (optional) — 특정 파일/디렉토리 필터",
    "maxCount": "number (default: 20) — 반환할 커밋 수",
    "since": "string (optional) — 시작 날짜 (e.g., '2 weeks ago')",
    "author": "string (optional) — 작성자 필터",
    "grep": "string (optional) — 커밋 메시지 검색"
  },
  "returns": {
    "commits": [
      {"hash": "abc123", "author": "name", "date": "ISO", "message": "..."}
    ]
  }
}
```

#### `repo_git_blame`
```json
{
  "name": "repo_git_blame",
  "parameters": {
    "path": "string (required)",
    "startLine": "number (optional)",
    "endLine": "number (optional)"
  },
  "returns": {
    "lines": [
      {"line": 1, "hash": "abc123", "author": "name", "date": "ISO", "content": "..."}
    ]
  }
}
```

#### `repo_git_diff`
```json
{
  "name": "repo_git_diff",
  "parameters": {
    "from": "string (default: 'HEAD~1') — 시작 커밋/브랜치",
    "to": "string (default: 'HEAD') — 끝 커밋/브랜치",
    "path": "string (optional) — 특정 파일 필터",
    "stat": "boolean (default: false) — diffstat만 반환"
  },
  "returns": {
    "files": [
      {"path": "...", "additions": 5, "deletions": 3, "patch": "..."}
    ]
  }
}
```

#### `repo_git_show`
```json
{
  "name": "repo_git_show",
  "parameters": {
    "ref": "string (required) — 커밋 해시 또는 참조"
  },
  "returns": {
    "hash": "...", "author": "...", "date": "...",
    "message": "...", "files": ["..."], "patch": "..."
  }
}
```

### 가치
- "이 함수가 왜 이렇게 바뀌었는지" → `git_blame` + `git_show`
- "최근 어떤 파일이 자주 변경되는지" → `git_log`
- "이번 PR에서 뭐가 바뀌었는지" → `git_diff`

---

## 1.2 심볼 인덱스 도구 (경량 AST) — P1 (미착수)

**목표:** 함수/클래스/타입 정의와 참조를 정확히 추적

### 새로운 도구

```
repo_symbols     — 파일에서 함수/클래스/변수 정의 목록 추출
repo_references  — 특정 심볼의 사용처 검색 (import 포함)
```

### 구현 방향

- tree-sitter WASM 바인딩 사용
- 지원 언어: JavaScript, TypeScript, Python, Go, Rust, Java
- 의존성: `web-tree-sitter` + 언어별 grammar `.wasm` 파일
- 정의(definition)와 참조(reference)를 구분하여 반환
- fallback: tree-sitter 미지원 언어는 regex 기반 heuristic

### `repo_symbols` 상세
```json
{
  "parameters": {
    "path": "string (required) — 파일 경로",
    "kind": "string (optional) — function|class|variable|type|all"
  },
  "returns": {
    "symbols": [
      {
        "name": "ExplorerRuntime",
        "kind": "class",
        "line": 15,
        "endLine": 302,
        "exported": true
      }
    ]
  }
}
```

### `repo_references` 상세
```json
{
  "parameters": {
    "symbol": "string (required) — 심볼 이름",
    "scope": ["string array (optional) — 검색 범위"]
  },
  "returns": {
    "definition": {"path": "...", "line": 15, "kind": "class"},
    "references": [
      {"path": "server.mjs", "line": 42, "context": "import { ExplorerRuntime } from ...", "type": "import"},
      {"path": "test.mjs", "line": 10, "context": "const rt = new ExplorerRuntime()", "type": "usage"}
    ]
  }
}
```

### 가치
- `grep`으로 "auth"를 검색하면 주석/문자열까지 나오지만, `repo_symbols`는 실제 `function auth()`만 반환
- 호출 그래프 추적이 가능해져 코드 이해도 대폭 향상

---

## 1.3 ripgrep 네이티브 통합 — ✅ 완료

**목표:** 대규모 레포에서의 검색 성능 10-100x 개선

### 구현 방향

- 이전: naive `fs.readFileSync` + `RegExp` 순차 스캔
- 개선: `child_process.execFileSync('rg', [...])` 호출
- ripgrep 미설치 시 기존 구현으로 graceful fallback

### 실제 구현 (`_grepWithRipgrep`)

```javascript
// repo-tools.mjs의 grep 메서드 — 실제 구현
async grep({ pattern, scope, caseSensitive, maxResults }) {
  if (this._hasRipgrep) {
    const result = this._grepWithRipgrep({ pattern, scope, caseSensitive, maxResults });
    if (result !== null) return result;  // null이면 fallback
  }
  // 기존 native 구현
}
```

### ripgrep 실제 호출 옵션
```bash
rg --json              # 구조화된 출력 (NDJSON)
   --no-binary         # 바이너리 제외
   --max-filesize 256K # 대형 파일 제외
   --glob '!.git'      # .git 디렉토리 제외
   --ignore-case       # caseSensitive=false 시
   --max-count 50      # 파일당 최대 매칭 수
   -- <pattern>
   <scope_paths | repoRoot>
```

### 구현 세부 사항

- `_hasRipgrep`: `initialize()` 시 `rg --version` 실행으로 자동 탐지
- `maxBuffer`: 200KB (DEFAULT_GIT_OUTPUT_MAX_BYTES × 2)
- ripgrep exit code 1 (no matches) = 정상, stderr 있을 때만 fallback
- scope 경로가 있으면 해당 경로만 검색, 없으면 repoRoot 전체

### 이점
- `.gitignore` 자동 존중 (nested 포함)
- 바이너리 파일 자동 제외
- 멀티코어 병렬 검색
- 유니코드 정규식 지원
- 수만 개 파일 레포에서도 ms 단위 응답
