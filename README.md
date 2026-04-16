# cerebras-explorer-mcp

환경 변수로 선택한 Cerebras 모델을 사용하는, 읽기 전용 자율 코드 탐색 MCP 서버입니다.

핵심 목적은 **Claude Code / Codex 같은 메인 모델이 직접 `Read`/`Grep`/`Glob`를 여러 번 돌리지 않게 하고**, 상위 모델은 `explore_repo(...)`, `explore(...)`, 또는 `explore_v2(...)` 한 번만 위임한 뒤 구조화된 결과나 사람이 읽기 좋은 보고서만 받도록 만드는 것입니다.

## 왜 이렇게 설계했나

이 구현은 두 가지 입력을 합쳐서 설계했습니다.

1. **Claude Code 소스 코드**
   - 내장 Explore agent는 “빠른 read-only 탐색기” 역할을 맡고 있습니다.
   - custom agent는 `mcpServers`, `disallowedTools` 같은 frontmatter를 가질 수 있습니다.
   - skill은 `context: fork`, `agent:`를 사용해 분리된 컨텍스트에서 sub-agent를 실행할 수 있습니다.

2. **기존 `cerebras-code-mcp` 저장소**
   - MCP 서버가 “고수준 도구 하나”를 외부 모델 호출로 감싼다는 점은 그대로 가져왔습니다.
   - 대신 기존 구현의 `write` 중심 구조를 버리고, `explore_repo`와 `explore`라는 **탐색 전용 도구들**로 바꿨습니다.
   - 모델은 기본값 `zai-glm-4.7`을 유지하되, 필요하면 **`CEREBRAS_EXPLORER_MODEL` 환경 변수로 바꿀 수 있게** 했습니다.

즉, 이 프로젝트는 “Claude/Codex의 탐색 비용을 줄이기 위한 외부 autonomous explorer”입니다.

## 설계 요약

```text
Parent model (Claude Code / Codex)
  -> MCP tool: explore_repo(task, scope, budget, hints)
     or MCP tool: explore(prompt, scope, thoroughness)
     or MCP tool: explore_v2(prompt, scope, thoroughness)
    -> cerebras-explorer-mcp
      -> internal repo tools
         - repo_list_dir
         - repo_find_files
         - repo_grep
         - repo_symbols / repo_references / repo_symbol_context
         - repo_read_file
         - repo_git_log / repo_git_blame / repo_git_diff / repo_git_show
      -> Cerebras model autonomous tool loop
      -> structured result
```

중요한 점은 상위 모델에 low-level 파일 도구를 노출하지 않는다는 점입니다.

- 상위 모델은 필요에 따라 `explore_repo`, `explore`, 또는 `explore_v2`를 호출합니다.
- 실제 파일 탐색 루프는 MCP 서버 안에서 선택된 Cerebras 모델이 자체적으로 수행합니다.
- 따라서 “메인은 위임 1회, explorer가 자율 탐색”이라는 목표를 만족합니다.

## 주요 특징

- **모델 선택 가능**: 기본값은 `zai-glm-4.7`, 필요하면 `CEREBRAS_EXPLORER_MODEL`로 override
- **읽기 전용**: 파일 수정, bash 실행, 네트워크 탐색 없음
- **자율 탐색 루프**: 모델이 내부 도구를 직접 호출하며 파일을 찾고 읽음
- **예산 기반 동작**: `quick | normal | deep`
- **전략 기반 탐색**: symbol-first, reference-chase, git-guided 등 질문 유형별 전략 유도
- **세션/진행 상황 지원**: 세션 ID 기반 후속 탐색과 MCP progress notification 지원
- **프로젝트별 설정 파일 지원**: `.cerebras-explorer.json`으로 `defaultBudget`, `defaultScope`, `entryPoints`, `keyFiles`, `extraIgnoreDirs`, `projectContext` 지정 가능
- **GLM 4.7 reasoning 정렬**: quick budget은 `reasoning_effort="none"`으로 reasoning을 끄고, normal/deep은 기본 reasoning을 유지하며 `clear_thinking=false`로 이전 turn의 reasoning을 보존
- **샘플링 기본값 정렬**: budget별 temperature(`quick`: 0.3, `normal`: 0.8, `deep`: 1.0)와 `top_p=0.95`를 사용하며, direct client 경로에는 fallback 환경 변수도 지원
- **근거 강제**: 최종 evidence는 실제로 읽거나 grep으로 확인한 라인 범위에만 남김
- **MCP 친화적 반환**: `answer`, `summary`, `confidence`, `evidence`, `candidatePaths`, `followups`, `stats`에 더해 `confidenceScore`, `confidenceFactors`, `codeMap`, `diagram`, `recentActivity` 지원

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
  },
  "language": "ko"
}
```

- `repo_root` (선택): 절대경로나 상대경로. Windows에서는 `C:\repo`, `C:/repo`뿐 아니라 Git Bash/MSYS 스타일 `/c/repo`도 받아 실제 filesystem 경로로 canonicalize한 뒤 세션과 도구 실행에 사용합니다.
- `language` (선택): BCP-47 언어 태그(예: `"ko"`, `"en"`, `"ja"`). 생략 시 task 텍스트에서 자동 추론합니다.
- `session` (선택): 이전 탐색의 `stats.sessionId`를 넘기면 candidate paths와 요약을 다음 탐색에 재사용합니다.

반환 예시:

```json
{
  "answer": "registerUserRoutes는 /users/me 라우트에 requireAuth 미들웨어를 직접 연결한다.",
  "summary": "auth.js에서 requireAuth를 정의하고, user.js에서 이를 import해 /users/me에 적용한다.",
  "confidence": "high",
  "confidenceScore": 0.91,
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
  "followups": [
    {
      "description": "인증 미들웨어의 다른 사용처를 추적",
      "priority": "recommended",
      "suggestedCall": {
        "task": "Trace other routes that use requireAuth",
        "scope": ["src/**"],
        "budget": "normal",
        "hints": {
          "symbols": ["requireAuth"],
          "strategy": "reference-chase"
        }
      }
    }
  ],
  "codeMap": {
    "entryPoints": ["src/index.mjs"],
    "keyModules": [
      {
        "path": "src/routes/user.js",
        "role": "route module",
        "linesRead": 12
      }
    ]
  },
  "diagram": "flowchart TD\n  A[[src/index.mjs]] --> B[src/routes/user.js]",
  "stats": {
    "model": "${CEREBRAS_EXPLORER_MODEL:-zai-glm-4.7}",
    "budget": "quick",
    "sessionId": "sess_abc123"
  }
}
```

`repo_git_log`를 활용한 탐색에서는 `recentActivity`가 함께 반환될 수 있습니다.

권장 사용처:

- `explore_repo`: 후속 자동화, 추가 도구 호출, 편집 전 검증처럼 **구조화된 JSON 필드**가 필요한 경우
- `explore`: 아키텍처 설명, 온보딩 요약, 사용자에게 바로 보여줄 답변처럼 **사람이 읽는 Markdown 보고서**가 필요한 경우
- `explore_v2`: `explore`와 동일한 상황이지만, 탐색 범위가 넓거나 컨텍스트 오버플로 위험이 있을 때

### `explore`

입력 스키마:

```json
{
  "prompt": "인증 서브시스템의 구조를 파일:라인 인용과 함께 설명해라",
  "repo_root": "/absolute/or/relative/path",
  "scope": ["src/auth/**", "src/routes/**"],
  "thoroughness": "deep",
  "language": "ko"
}
```

- `prompt`: 사람이 읽을 수 있는 설명형 보고서를 만들 질문 또는 요청
- `thoroughness`: `quick`, `normal`, `deep` 중 하나. 내부적으로 `explore_repo`의 budget 계층과 같은 깊이 정책을 사용합니다.
- `session`: 이전 탐색의 `stats.sessionId`를 넘기면 후속 보고서에도 후보 경로와 요약을 재사용합니다.

반환 특성:

- JSON 필드 묶음 대신 **Markdown 보고서 본문**이 중심입니다.
- 본문 안에 inline file:line citation이 들어갑니다.
- 사용자 설명, 아키텍처 브리핑, 조사 결과 공유에 적합합니다.
- 후속 자동화나 정형 후처리가 중요하면 `explore_repo`를 우선 사용하세요.

### `explore_v2`

`explore`의 강화 버전으로, 세 가지 고급 기법을 추가합니다.

1. **LLM 기반 대화 요약**: 탐색이 진행되면서 이전 발견 내용을 지능적으로 요약해 유용한 컨텍스트를 최대화합니다.
2. **도구 결과 예산 관리**: 개별 도구 출력에 상한을 두어 컨텍스트 오버플로를 방지합니다.
3. **최대 출력 복구**: 보고서가 출력 토큰 한도로 잘렸을 때 자동으로 이어서 생성합니다.

입력 스키마는 `explore`와 동일합니다:

```json
{
  "prompt": "인증 서브시스템의 구조를 end-to-end로 설명해라",
  "repo_root": "/absolute/or/relative/path",
  "scope": ["src/auth/**", "src/routes/**"],
  "thoroughness": "deep",
  "language": "ko"
}
```

권장 사용 경우:

- 다수의 파일에 걸친 깊고 광범위한 탐색
- 컨텍스트 초과가 우려되는 long-running 탐색
- 대규모 아키텍처 분석, 복잡한 버그 원인 분석 (end-to-end)

### 특화 도구 (Specialized Tools)

`CEREBRAS_EXPLORER_EXTRA_TOOLS=false`로 비활성화하지 않는 한, 다음 4개 특화 도구가 함께 노출됩니다. 내부적으로 `explore_repo`에 위임하는 편의 도구입니다.

| 도구 | 설명 | 전략 |
|------|------|------|
| `explain_symbol` | 심볼의 정의 위치, 역할, 사용처를 설명 | symbol-first |
| `trace_dependency` | 파일의 import/dependency 체인을 추적 | reference-chase |
| `summarize_changes` | 기간/경로별 git 변경 사항을 요약 | git-guided |
| `find_similar_code` | 참조 파일/코드와 유사한 패턴을 탐색 | pattern-scan |

모든 특화 도구는 다음 공통 선택 파라미터를 지원합니다:

- `language`: BCP-47 언어 태그 — 응답 언어를 명시적으로 지정
- `context`: 상위 에이전트가 탐색 의도를 전달하는 추가 컨텍스트

## 프로젝트 구조

```text
cerebras-explorer-mcp/
  benchmarks/
  examples/
  fixtures/
  integrations/
    claude/
      .mcp.json.example
    codex/
      AGENTS.md.example
      config.toml.example
  scripts/
  src/
    benchmark/
      evaluator.mjs
      report.mjs
    explorer/
      cache.mjs
      cerebras-client.mjs
      config.mjs
      prompt.mjs
      providers/
        abstract.mjs
        failover.mjs
        index.mjs
        ollama.mjs
        openai-compat.mjs
      repo-tools.mjs
      runtime.mjs
      schemas.mjs
      session.mjs
      symbols.mjs
      transcript.mjs
      utils/
        http-client.mjs
    index.mjs
    mcp/
      jsonrpc-stdio.mjs
      server.mjs
  tests/
    *.test.mjs
  DESIGN.md
  TESTING.md
```

## 빠른 실행

**요구사항**: Node.js 22 이상

### 1) 환경 변수

```bash
export CEREBRAS_API_KEY="..."
```

선택 (모델 / API):

```bash
export CEREBRAS_API_BASE_URL="https://api.cerebras.ai/v1"
export CEREBRAS_EXPLORER_MODEL="zai-glm-4.7"           # 전역 모델. 기본값: zai-glm-4.7
export CEREBRAS_MODEL="zai-glm-4.7"                    # 호환용 alias. EXPLORER_MODEL이 없을 때 fallback
export CEREBRAS_EXPLORER_MODEL_QUICK="zai-glm-4.7"     # quick budget 전용 모델 override
export CEREBRAS_EXPLORER_MODEL_NORMAL="zai-glm-4.7"    # normal budget 전용 모델 override
export CEREBRAS_EXPLORER_MODEL_DEEP="zai-glm-4.7"      # deep budget 전용 모델 override
export CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS="60000"        # HTTP 요청 timeout (ms). 기본값: 60000
```

선택 (샘플링 / reasoning):

```bash
export CEREBRAS_EXPLORER_CLEAR_THINKING="false"         # 기본값: false (agentic loop용)
export CEREBRAS_EXPLORER_TEMPERATURE="1"                # direct client / budget override 없는 경로의 fallback
export CEREBRAS_EXPLORER_TOP_P="0.95"                   # direct client / budget override 없는 경로의 fallback
export CEREBRAS_EXPLORER_REASONING_FORMAT="parsed"      # reasoning 출력 형식 override
```

> **sampling 동작**: `explore_repo`/`explore`/`explore_v2`는 현재 budget별 내장값(`quick`: 0.3, `normal`: 0.8, `deep`: 1.0, `top_p`: 0.95)을 사용합니다. `CEREBRAS_EXPLORER_TEMPERATURE`와 `CEREBRAS_EXPLORER_TOP_P`는 direct client 사용이나 budget override가 없는 경로에서만 fallback으로 쓰입니다.

선택 (도구 노출):

```bash
export CEREBRAS_EXPLORER_EXTRA_TOOLS="true"             # false로 설정하면 특화 도구 4개 비활성화. 기본값: true
export CEREBRAS_EXPLORER_ENABLE_EXPLORE="true"          # false로 설정하면 explore/explore_v2 비활성화. 기본값: true
export CEREBRAS_EXPLORER_AUTO_ROUTE="false"             # true이면 task 복잡도에 따라 budget별 모델 자동 선택
```

선택 (V2 튜닝):

```bash
export CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER="2"         # 기본값: 2, 1~4로 clamp
export CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS="30"        # 기본값: 30, 0~200으로 clamp
export CEREBRAS_EXPLORER_V2_MAX_COMPACTIONS="3"         # 기본값: 3, 0~10으로 clamp
```

선택 (디버깅 / 관측):

```bash
export CEREBRAS_EXPLORER_TRANSCRIPT="true"              # true이면 탐색 내역을 JSONL 파일로 기록
export CEREBRAS_EXPLORER_TRANSCRIPT_DIR="./transcripts" # transcript 저장 디렉터리. 기본값: 현재 작업 디렉터리
```

### 2) 서버 실행

```bash
cd cerebras-explorer-mcp
/absolute/path/to/node ./src/index.mjs
```

### 3) 테스트

```bash
npm test
CEREBRAS_API_KEY="$CEREBRAS_API_KEY" node ./scripts/integration-test.mjs
```

최근 실행 결과와 추가 수동 검증 메모는 [TESTING.md](./TESTING.md)에 정리되어 있습니다.

## Claude Code 연결 예시

전역(모든 프로젝트에서 사용)으로 등록:

```bash
claude mcp add -s user cerebras-explorer \
  -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- node /absolute/path/to/cerebras-explorer-mcp/src/index.mjs
```

현재 프로젝트에만 등록:

```bash
claude mcp add cerebras-explorer \
  -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- node /absolute/path/to/cerebras-explorer-mcp/src/index.mjs
```

프로젝트에 포함한 예시는 `integrations/claude/` 아래에 있습니다.

### Claude Code "Failed to connect" 트러블슈팅

`/mcp` 패널에서 `cerebras-explorer`가 `failed` 상태로 표시되면:

1. **이 저장소를 최신 버전으로 업데이트합니다.**
   - Claude Code v2.1.94+(프로토콜 `2025-06-18`)부터 MCP stdio 전송 방식이 변경됐습니다.
   - 구형 stdio 파서는 `Content-Length: N\r\n\r\n{...}` 헤더 방식만 처리했지만, 신형 Claude Code는 NDJSON 방식(`{...}\n`)으로 보냅니다.
   - 파서가 헤더를 찾지 못해 응답 없이 대기 → Claude Code 타임아웃 → "Failed to connect"가 됩니다.
   - 현재 버전은 두 방식을 자동 감지하므로 업데이트 후 재등록하면 해결됩니다.
2. **등록 명령을 확인합니다.**
   - `node` 명령이 PATH에 있는지, 경로가 절대 경로인지 확인합니다.
   - `claude mcp list`로 등록된 command/args를 재확인합니다.

## Codex 연결 예시

### 1) MCP 서버 등록

```bash
codex mcp add cerebras-explorer \
  --env CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- /absolute/path/to/node /absolute/path/to/cerebras-explorer-mcp/src/index.mjs
```

### 2) 에이전트 역할 파일 등록 (선택)

`~/.codex/agents/cerebras_explorer.toml`을 만들면 Codex가 해당 역할을 자동으로 로드합니다.

```toml
name = "cerebras_explorer"
description = "Read-only repository explorer that delegates search/read loops to the external Cerebras MCP explorer."
sandbox_mode = "read-only"

developer_instructions = """
Use the `cerebras-explorer` MCP tools as the default first move for broad read-only discovery.
Prefer the narrowest exposed explorer tool that matches the request:
- `explain_symbol` for known symbols
- `trace_dependency` for known entry files
- `summarize_changes` for git-history questions
- `find_similar_code` for pattern or duplication hunting
- `explore_repo` for open-ended questions when structured JSON findings are useful
- `explore` for open-ended questions when a cited Markdown report is the better final artifact
Pass the parent request almost verbatim; add `scope`, `budget`, `thoroughness`, `hints`, or `session` only when justified by the task or prior results.
For `explore_repo`, use `deep` for the initial broad pass, `normal` for scoped follow-up exploration, and `quick` for file-level or narrow lookups.
For `explore`, use `thoroughness: deep` for the initial broad overview, `normal` for scoped follow-up reporting, and `quick` for narrow cited explanations.
The specialized tools do not expose `budget` and currently behave like an internal `normal` pass; use `explore_repo` when budget choice matters.
Treat `explore_repo` evidence or `explore` citations as the primary map, then do only targeted native reads to verify or prepare edits.
Do not modify files.
"""
```

> **주의:** `mcp_servers`를 역할 파일에 배열(`mcp_servers = ["cerebras-explorer"]`)로 넣으면
> `invalid type: sequence, expected a map` 에러가 발생합니다.
> MCP 서버는 `~/.codex/config.toml`의 `[mcp_servers.cerebras-explorer]`에서만 정의하세요.

프로젝트에 포함한 예시는 `integrations/codex/` 아래에 있습니다.

`nvm` 같은 셸 초기화 의존 환경에서는 `node` 대신 **Node 절대 경로**를 넣는 편이 안전합니다.

예:

```bash
which node
# /home/you/.nvm/versions/node/v24.14.1/bin/node
```

### Codex startup timeout 트러블슈팅

Codex에서 아래처럼 보이면:

```text
MCP client for `cerebras-explorer` timed out after 30 seconds.
```

다음 순서로 확인하는 것이 맞습니다.

1. 먼저 이 저장소를 최신 버전으로 업데이트합니다.
   - 구버전 stdio 파서는 `Content-Length` 헤더 방식만 지원했습니다. LF-only 헤더(`\n\n`)나 NDJSON(`{...}\n`) 방식을 보내는 클라이언트에서는 timeout처럼 보일 수 있었습니다.
   - 현재 버전은 Content-Length 방식과 NDJSON 방식을 자동 감지합니다.
2. Codex 등록 명령에서 `node` 대신 Node 절대 경로를 사용합니다.
   - 특히 `nvm` 환경에서는 Codex가 셸 PATH를 그대로 재현하지 못하면 `node`를 못 찾을 수 있습니다.
3. 그래도 느리면 그때 `startup_timeout_sec`를 늘립니다.
   - 이 서버는 정상이라면 시작 직후 `initialize`에 응답하므로, timeout 증상은 보통 부팅 지연보다 프로세스 실행/stdio 호환 문제일 가능성이 큽니다.

## 내부 동작 순서

1. 부모 모델이 `explore_repo` 또는 `explore`를 호출합니다.
2. MCP 서버가 read-only repo toolkit을 준비합니다.
3. 선택된 Cerebras 모델이 내부 도구를 사용해 탐색 루프를 수행합니다.
4. 충분한 근거가 모이면 최종 JSON 또는 Markdown 보고서를 생성합니다.
5. MCP 서버는 그 결과만 부모 모델에 반환합니다.

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

## 벤치마크

반복 가능한 품질 측정을 위해 선언형 질의 세트와 점수 계산기를 포함합니다.

- 기본 벤치마크 파일: `benchmarks/core.json`
- 실행 스크립트: `scripts/run-benchmark.mjs`
- npm 스크립트: `npm run benchmark`

예:

```bash
npm run benchmark
```

특정 저장소 루트나 케이스만 실행하려면:

```bash
node ./scripts/run-benchmark.mjs \
  --suite ./benchmarks/core.json \
  --repo-root /absolute/path/to/repo \
  --case explain-request-handler \
  --verbose
```

JSON 리포트 저장:

```bash
node ./scripts/run-benchmark.mjs \
  --suite ./benchmarks/core.json \
  --output ./benchmark-report.json
```

벤치마크는 exact-string 정답 대신 다음 요소를 가중치로 평가합니다.

- 답변/요약 키워드 그룹 일치율
- evidence / candidatePaths에 기대 파일이 포함되는지
- grounded evidence 개수
- sessionId, recentActivity, budget stop 여부 같은 구조적 체크

즉, 모델이 문장을 조금 다르게 생성해도 핵심 사실과 근거가 맞으면 안정적으로 점수가 나옵니다.

## 현재 제한 사항

- `.gitignore`는 루트 파일만 단순 반영합니다.
- 대용량 바이너리 / 압축 파일은 탐색 대상에서 제외합니다.
- 최종 품질은 저장소 구조와 질문 품질에 영향을 받습니다.
- 심볼 인덱싱은 regex 기반이며, LSP/tree-sitter 수준의 정밀한 semantic 분석은 아직 없습니다.
- `repo_symbol_context.depth > 1`은 현재 `effectiveDepth = 1`로 고정됩니다 (직접 호출자만 반환). 의도적 설계 결정이며, 반환값에 `effectiveDepth: 1` 필드가 포함되어 실제 동작을 명시합니다. 더 깊은 호출 체인이 필요하면 `explore_repo`의 `reference-chase` 전략을 사용하세요.
- `repo_grep.includeSymbol`, `find_similar_code.similarity` 같은 정밀 기능은 Phase 2/3에서 구현 예정입니다.

참고:
- 코드베이스 안에는 provider abstraction 관련 구현이 일부 존재하지만, 이 프로젝트의 문서화된 목표와 공개 인터페이스는 Cerebras 기반 explorer에 맞춰져 있습니다.

## 다음 확장 포인트

- `map_impact`
- `find_entrypoints`
- repo-specific ignore 정책
- tree-sitter 기반 심볼 정밀도 향상
- `find_similar_code` 구조화 유사도 점수

상세 설계 근거는 [DESIGN.md](./DESIGN.md)에 정리해 두었습니다.
