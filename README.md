# cerebras-explorer-mcp

환경 변수로 선택한 Cerebras 모델을 사용하는, 읽기 전용 자율 코드 탐색 MCP 서버입니다.

핵심 목적은 **Claude Code / Codex 같은 메인 모델이 직접 `Read`/`Grep`/`Glob`를 여러 번 돌리지 않게 하고**, 상위 모델은 `explore_repo(...)` 한 번만 위임한 뒤 구조화된 탐색 결과만 받도록 만드는 것입니다.

## 왜 이렇게 설계했나

이 구현은 두 가지 입력을 합쳐서 설계했습니다.

1. **Claude Code 소스 코드**
   - 내장 Explore agent는 “빠른 read-only 탐색기” 역할을 맡고 있습니다.
   - custom agent는 `mcpServers`, `disallowedTools` 같은 frontmatter를 가질 수 있습니다.
   - skill은 `context: fork`, `agent:`를 사용해 분리된 컨텍스트에서 sub-agent를 실행할 수 있습니다.

2. **기존 `cerebras-code-mcp` 저장소**
   - MCP 서버가 “고수준 도구 하나”를 외부 모델 호출로 감싼다는 점은 그대로 가져왔습니다.
   - 대신 기존 구현의 `write` 중심 구조를 버리고, `explore_repo`라는 **탐색 전용 도구 하나**로 바꿨습니다.
   - 모델은 기본값 `zai-glm-4.7`을 유지하되, 필요하면 **`CEREBRAS_EXPLORER_MODEL` 환경 변수로 바꿀 수 있게** 했습니다.

즉, 이 프로젝트는 “Claude/Codex의 탐색 비용을 줄이기 위한 외부 autonomous explorer”입니다.

## 설계 요약

```text
Parent model (Claude Code / Codex)
  -> MCP tool: explore_repo(task, scope, budget, hints)
    -> cerebras-explorer-mcp
      -> internal repo tools
         - repo_list_dir
         - repo_find_files
         - repo_grep
         - repo_read_file
      -> Cerebras model autonomous tool loop
      -> structured result
```

중요한 점은 상위 모델에 low-level 파일 도구를 노출하지 않는다는 점입니다.

- 상위 모델은 `explore_repo`만 호출합니다.
- 실제 파일 탐색 루프는 MCP 서버 안에서 선택된 Cerebras 모델이 자체적으로 수행합니다.
- 따라서 “메인은 위임 1회, explorer가 자율 탐색”이라는 목표를 만족합니다.

## 주요 특징

- **모델 선택 가능**: 기본값은 `zai-glm-4.7`, 필요하면 `CEREBRAS_EXPLORER_MODEL`로 override
- **읽기 전용**: 파일 수정, bash 실행, 네트워크 탐색 없음
- **자율 탐색 루프**: 모델이 내부 도구를 직접 호출하며 파일을 찾고 읽음
- **예산 기반 동작**: `quick | normal | deep`
- **근거 강제**: 최종 evidence는 실제로 읽거나 grep으로 확인한 라인 범위에만 남김
- **MCP 친화적 반환**: `answer`, `summary`, `confidence`, `evidence`, `candidatePaths`, `followups`, `stats`

## 공개 MCP 도구

### `explore_repo`

입력 스키마:

```json
{
  "task": "인증 미들웨어가 어느 라우트에 붙는지 추적해라",
  "repo_root": "/absolute/or/relative/path",
  "scope": ["src/**", "docs/**"],
  "budget": "quick",
  "hints": {
    "symbols": ["requireAuth"],
    "files": ["src/routes/user.js"],
    "regex": ["/users/me"]
  }
}
```

반환 예시:

```json
{
  "answer": "registerUserRoutes는 /users/me 라우트에 requireAuth 미들웨어를 직접 연결한다.",
  "summary": "auth.js에서 requireAuth를 정의하고, user.js에서 이를 import해 /users/me에 적용한다.",
  "confidence": "high",
  "evidence": [
    {
      "path": "src/routes/user.js",
      "startLine": 1,
      "endLine": 4,
      "why": "라우트가 requireAuth를 import하고 /users/me 핸들러에 연결한다."
    },
    {
      "path": "src/auth.js",
      "startLine": 1,
      "endLine": 4,
      "why": "requireAuth의 실제 동작이 여기 정의되어 있다."
    }
  ],
  "candidatePaths": ["src/routes/user.js", "src/auth.js"],
  "followups": [],
  "stats": {
    "model": "${CEREBRAS_EXPLORER_MODEL:-zai-glm-4.7}",
    "budget": "quick"
  }
}
```

## 프로젝트 구조

```text
cerebras-explorer-mcp/
  src/
    index.mjs
    mcp/
      jsonrpc-stdio.mjs
      server.mjs
    explorer/
      cerebras-client.mjs
      config.mjs
      prompt.mjs
      repo-tools.mjs
      runtime.mjs
      schemas.mjs
  tests/
  integrations/
    claude/
    codex/
  examples/
  fixtures/
  DESIGN.md
```

## 빠른 실행

### 1) 환경 변수

```bash
export CEREBRAS_API_KEY="..."
```

선택:

```bash
export CEREBRAS_API_BASE_URL="https://api.cerebras.ai/v1"
export CEREBRAS_EXPLORER_MODEL="zai-glm-4.7"
```

### 2) 서버 실행

```bash
cd cerebras-explorer-mcp
node ./src/index.mjs
```

### 3) 테스트

```bash
npm test
```

## Claude Code 연결 예시

```bash
claude mcp add --transport stdio cerebras-explorer \
  --env CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- node /absolute/path/to/cerebras-explorer-mcp/src/index.mjs
```

프로젝트에 포함한 예시는 `integrations/claude/` 아래에 있습니다.

## Codex 연결 예시

```bash
codex mcp add cerebras-explorer \
  --env CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- node /absolute/path/to/cerebras-explorer-mcp/src/index.mjs
```

프로젝트에 포함한 예시는 `integrations/codex/` 아래에 있습니다.

## 내부 동작 순서

1. 부모 모델이 `explore_repo`를 호출합니다.
2. MCP 서버가 read-only repo toolkit을 준비합니다.
3. 선택된 Cerebras 모델이 내부 도구를 사용해 탐색 루프를 수행합니다.
4. 충분한 근거가 모이면 최종 JSON을 생성합니다.
5. MCP 서버는 구조화된 결과만 부모 모델에 반환합니다.

## 예산 정책

- `quick`
  - 얕은 탐색
  - turn 수 제한이 작음
  - 가장 싼 비용
- `normal`
  - 일반적인 기본값
- `deep`
  - 더 넓게 탐색
  - 더 많은 turn / 파일 범위를 허용

## 안전 경계

이 구현은 의도적으로 다음을 하지 않습니다.

- 파일 쓰기 / 수정
- bash 명령 실행
- 웹 검색
- 외부 문서 검색
- scope 밖 경로 확장
- symlink 추적

즉, **코드 탐색 전용 explorer**입니다.

## 현재 제한 사항

- `.gitignore`는 루트 파일만 단순 반영합니다.
- 대용량 바이너리 / 압축 파일은 탐색 대상에서 제외합니다.
- 최종 품질은 저장소 구조와 질문 품질에 영향을 받습니다.
- 더 정교한 심볼 인덱싱(LSP/ctags/tree-sitter)은 아직 넣지 않았습니다.

## 다음 확장 포인트

- `trace_symbol`
- `map_impact`
- `find_entrypoints`
- repo-specific ignore 정책
- tree-sitter / ripgrep / git metadata 연결

상세 설계 근거는 [DESIGN.md](./DESIGN.md)에 정리해 두었습니다.
