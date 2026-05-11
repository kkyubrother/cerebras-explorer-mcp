# cerebras-explorer-mcp

> **Unofficial.** Cerebras Systems, Inc.와 무관한 커뮤니티 프로젝트입니다. "Cerebras"는 이 서버가 Cerebras Inference API를 호출한다는 사실을 표기할 목적으로만 사용됩니다.

환경 변수로 선택한 Cerebras 모델을 사용하는, 읽기 전용 자율 코드 탐색 MCP 서버입니다.

Cerebras Explorer는 상위 AI가 정확한 판단을 내릴 수 있도록, 필요한 코드 근거를 빠르게 수집하고 압축해 전달하는 경량 MCP 탐색기입니다. 저장소를 직접 탐색해 파일·라인 근거를 확보하고, 상위 AI가 적은 컨텍스트로 코드 구조와 변경 영향을 이해할 수 있는 형태로 결과를 반환합니다.

핵심 목적은 **Claude Code / Codex 같은 상위 AI가 반복적인 파일 탐색에 컨텍스트를 쓰지 않고**, `find_relevant_code(...)`, `trace_symbol(...)`, `map_change_impact(...)`, `explore_repo(...)`, 또는 `explore(...)` 호출로 검증된 코드 근거와 요약 결과를 받도록 만드는 것입니다.

## 설치 한 줄 (GitHub)

GitHub 저장소에서 바로 가져오는 방식이라 npm publish 없이도 어떤 PC에서든 절대경로 없이 등록할 수 있습니다. `npx`가 GitHub tarball을 받아 캐시한 뒤 패키지의 `bin`을 실행하므로, **공통 명령은 `npx -y github:kkyubrother/cerebras-explorer-mcp#v0.1.0`** 한 줄입니다.

> **왜 `#v0.1.0` 같은 tag가 기본인가**: `npx`는 spec(URL + ref)을 캐시 키로 사용합니다. ref 없이 등록하면 master에 새 commit이 push돼도 사용자 PC는 캐시된 첫 버전을 계속 씁니다. tag로 핀해두면 새 release가 나올 때 spec의 tag 부분만 `#v0.2.0`으로 바꾸면 자동으로 새 버전이 받아집니다.

### Claude Code

```bash
# 전역 등록 (모든 프로젝트)
claude mcp add -s user cerebras-explorer \
  -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- npx -y github:kkyubrother/cerebras-explorer-mcp#v0.1.0

# 현재 프로젝트만
claude mcp add cerebras-explorer \
  -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- npx -y github:kkyubrother/cerebras-explorer-mcp#v0.1.0
```

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.cerebras-explorer]
command = "npx"
args = ["-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"]

[mcp_servers.cerebras-explorer.env]
CEREBRAS_API_KEY = "${CEREBRAS_API_KEY}"
```

### OpenCode (`opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cerebras-explorer": {
      "type": "local",
      "command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"],
      "environment": { "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}" }
    }
  }
}
```

### 다른 ref로 등록

안정 tag 대신 master를 추적하거나 특정 commit으로 핀할 수도 있습니다. ref 없이 등록하면 npx 캐시 갱신이 어려워지므로 **항상 명시적인 ref 사용을 권장**합니다.

```bash
npx -y github:kkyubrother/cerebras-explorer-mcp#main          # master 추적 (개발 중)
npx -y github:kkyubrother/cerebras-explorer-mcp#<commit-sha>  # 특정 commit으로 핀
npx -y github:kkyubrother/cerebras-explorer-mcp               # ref 없음 — 캐시되면 갱신 어려움 (비권장)
```

### 다른 클라이언트

각 클라이언트별 설정 파일 형식과 등록 위치는 `integrations/` 폴더의 README와 `*.example` 파일을 그대로 복사해서 사용할 수 있습니다.

- [Claude Code](./integrations/claude/) — `.mcp.json` 또는 `claude mcp add`
- [Claude Desktop](./integrations/claude-desktop/) — `claude_desktop_config.json`
- [Codex CLI](./integrations/codex/) — `~/.codex/config.toml`
- [OpenCode](./integrations/opencode/) — `opencode.json`
- [Cursor](./integrations/cursor/) — `~/.cursor/mcp.json` 또는 `.cursor/mcp.json`
- [Continue.dev](./integrations/continue/) — `~/.continue/config.yaml`

소스 체크아웃에서 직접 실행하거나 더 자세한 옵션은 아래 [빠른 실행](#빠른-실행)·[Claude Code 연결 예시](#claude-code-연결-예시)·[Codex 연결 예시](#codex-연결-예시) 섹션을 참고하세요.

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
  -> MCP tool: explore_repo(task, scope, hints)
     or MCP tool: explore(prompt, scope)
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

- 상위 모델은 목적형 wrapper, `explore_repo`, 또는 `explore`를 호출합니다. `explore_v2`는 고급 opt-in 도구입니다.
- 실제 파일 탐색 루프는 MCP 서버 안에서 선택된 Cerebras 모델이 자체적으로 수행합니다.
- 따라서 “메인은 위임 1회, explorer가 자율 탐색”이라는 목표를 만족합니다.

## 주요 특징

- **모델 선택 가능**: 기본값은 `zai-glm-4.7`, 필요하면 `CEREBRAS_EXPLORER_MODEL`로 override
- **읽기 전용**: 파일 수정, bash 실행, 네트워크 탐색 없음
- **자율 탐색 루프**: 모델이 내부 도구를 직접 호출하며 파일을 찾고 읽음
- **예산 기반 동작**: 기본값은 서버가 정하고, advanced workflow에서만 `quick | normal | deep`을 직접 지정
- **전략 기반 탐색**: symbol-first, reference-chase, git-guided 등은 질문과 anchor에서 자동 유도
- **세션/진행 상황 지원**: 세션 ID 기반 후속 탐색과 MCP progress notification 지원
- **프로젝트별 설정 파일 지원**: `.cerebras-explorer.json`으로 `defaultBudget`, `defaultScope`, `entryPoints`, `keyFiles`, `extraIgnoreDirs`, `projectContext` 지정 가능
- **GLM 4.7 reasoning 정렬**: quick budget은 `reasoning_effort="none"`으로 reasoning을 끄고, normal/deep은 기본 reasoning을 유지하며 `clear_thinking=false`로 이전 turn의 reasoning을 보존
- **샘플링 기본값 정렬**: budget별 temperature(`quick`: 0.3, `normal`: 0.8, `deep`: 1.0)와 `top_p=0.95`를 사용하며, direct client 경로에는 fallback 환경 변수도 지원
- **근거 강제**: 최종 evidence는 실제로 읽거나 grep으로 확인한 라인 범위에만 남김
- **Read-only tool annotations**: 모든 공개 MCP 도구는 `readOnlyHint: true`를 선언합니다. 이는 클라이언트 UX hint이며 보안 경계는 아닙니다.
- **MCP 친화적 반환**: MCP `structuredContent`는 `directAnswer`, `status`, `targets`, snippet 포함 `evidence`, `uncertainties`, `nextAction`, `sessionId` 중심의 compact 계약만 노출합니다. runtime raw 필드인 `answer`, `summary`, `candidatePaths`, `followups`는 MCP 응답에 노출하지 않으며, 운영 디버그 정보만 `_debug.stats`, `_debug.toolTrace`, `_debug.recentActivity`에 남깁니다.

## 공개 MCP 도구

### `explore_repo`

입력 스키마:

```json
{
  "task": "인증 미들웨어가 어느 라우트에 붙는지 추적해라",
  "repo_root": "/absolute/or/relative/path",
  "scope": ["src/**", "docs/**"],
  "hints": {
    "symbols": ["requireAuth"],
    "files": ["src/routes/user.js"]
  }
}
```

- `repo_root` (선택): 절대경로나 상대경로. Windows에서는 `C:\repo`, `C:/repo`뿐 아니라 Git Bash/MSYS 스타일 `/c/repo`도 받아 실제 filesystem 경로로 canonicalize한 뒤 세션과 도구 실행에 사용합니다.
- `language` (advanced/optional): 응답 언어를 명시적으로 고정해야 할 때만 사용합니다. 보통은 task 텍스트에서 자동 추론되므로 생략하세요.
- `session` (선택): 이전 탐색의 `sessionId`를 넘기면 candidate paths와 요약을 다음 탐색에 재사용합니다.
- `budget`, `hints.strategy` (advanced): 일반 agent 사용에서는 생략하세요. 서버 기본값과 자동 strategy 감지가 우선입니다.

반환 예시:

```json
{
  "directAnswer": "registerUserRoutes는 /users/me 라우트에 requireAuth 미들웨어를 직접 연결한다.",
  "status": {
    "confidence": "high",
    "verification": "verified",
    "complete": true,
    "warnings": []
  },
  "targets": [
    {
      "path": "src/routes/user.js",
      "startLine": 1,
      "endLine": 4,
      "role": "read",
      "reason": "라우트가 requireAuth를 import하고 /users/me 핸들러에 연결한다.",
      "evidenceRefs": ["E1"]
    }
  ],
  "evidence": [
    {
      "id": "E1",
      "path": "src/routes/user.js",
      "startLine": 1,
      "endLine": 4,
      "why": "라우트가 requireAuth를 import하고 /users/me 핸들러에 연결한다.",
      "groundingStatus": "exact",
      "snippet": "1: import { requireAuth } from \"../auth.js\";\n2: \n3: export function registerUserRoutes(app) {\n4:   app.get(\"/users/me\", requireAuth, (req, res) => {"
    },
    {
      "id": "E2",
      "path": "src/auth.js",
      "startLine": 1,
      "endLine": 4,
      "why": "requireAuth의 실제 동작이 여기 정의되어 있다.",
      "groundingStatus": "exact",
      "snippet": "1: export function requireAuth(req, res, next) {\n2:   if (!req.user) throw new Error(\"unauthorized\");\n3:   next();\n4: }"
    }
  ],
  "uncertainties": [],
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "sessionId": "sess_abc123"
}
```

운영 디버그 정보는 실제 응답의 `_debug` 객체에 별도로 포함됩니다. 일반 agent handoff에서는 위의 top-level 계약을 먼저 읽고, explorer 동작 자체를 디버깅할 때만 `_debug.stats`, `_debug.toolTrace`, `_debug.recentActivity`를 확인하세요.

```json
{
  "_debug": {
    "confidenceScore": 0.91,
    "toolTrace": { "totalCalls": 3, "truncated": false },
    "stats": {
      "model": "${CEREBRAS_EXPLORER_MODEL:-zai-glm-4.7}",
      "sessionId": "sess_abc123"
    }
  }
}
```

권장 사용처:

- `explore_repo`: 후속 자동화, 추가 도구 호출, 편집 전 검증처럼 **구조화된 JSON 필드**가 필요한 경우
- `explore`: 아키텍처 설명, 온보딩 요약, 사용자에게 바로 보여줄 답변처럼 **사람이 읽는 Markdown 보고서**가 필요한 경우
- `targets`: `candidatePaths`보다 먼저 읽어야 하는 action field입니다. `role=read|edit|test|config|context` 대상만 목적에 맞게 확인하고, `reference`는 필요할 때만 읽습니다.

### `explore`

입력 스키마:

```json
{
  "prompt": "인증 서브시스템의 구조를 파일:라인 인용과 함께 설명해라",
  "repo_root": "/absolute/or/relative/path",
  "scope": ["src/auth/**", "src/routes/**"]
}
```

- `prompt`: 사람이 읽을 수 있는 설명형 보고서를 만들 질문 또는 요청
- `thoroughness` (advanced): 일반 agent 사용에서는 생략하세요. 서버가 질문과 scope를 보고 깊이를 고릅니다.
- `session`: 이전 탐색의 `sessionId`를 넘기면 후속 보고서에도 후보 경로와 요약을 재사용합니다.

반환 특성:

- JSON 필드 묶음 대신 **Markdown 보고서 본문**이 중심입니다.
- 본문 안에 inline file:line citation이 들어갑니다.
- 사용자 설명, 아키텍처 브리핑, 조사 결과 공유에 적합합니다.
- 후속 자동화나 정형 후처리가 중요하면 `explore_repo`를 우선 사용하세요.

### `explore_v2` (advanced opt-in)

`explore_v2`는 기본 tool list에 노출되지 않습니다. `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true`일 때만 공개되며, 일반 agent는 `explore`만 고르면 됩니다. 서버는 `explore` 요청이 deep/large report로 보이면 내부적으로 V2 런타임을 사용할 수 있습니다.

V2 런타임은 세 가지 고급 기법을 추가합니다.

1. **LLM 기반 대화 요약**: 탐색이 진행되면서 이전 발견 내용을 지능적으로 요약해 유용한 컨텍스트를 최대화합니다.
2. **도구 결과 예산 관리**: 개별 도구 출력에 상한을 두어 컨텍스트 오버플로를 방지합니다.
3. **최대 출력 복구**: 보고서가 출력 토큰 한도로 잘렸을 때 자동으로 이어서 생성합니다.

공개했을 때 입력 스키마는 `explore`와 동일합니다:

```json
{
  "prompt": "인증 서브시스템의 구조를 end-to-end로 설명해라",
  "repo_root": "/absolute/or/relative/path",
  "scope": ["src/auth/**", "src/routes/**"],
  "thoroughness": "deep"
}
```

권장 사용 경우:

- 다수의 파일에 걸친 깊고 광범위한 탐색
- 컨텍스트 초과가 우려되는 long-running 탐색
- 대규모 아키텍처 분석, 복잡한 버그 원인 분석 (end-to-end)

### 특화 도구 (Specialized Tools)

`CEREBRAS_EXPLORER_EXTRA_TOOLS=false`로 비활성화하지 않는 한, 목적형 wrapper 도구가 함께 노출됩니다. 모두 내부적으로 `explore_repo`에 위임하고 같은 `directAnswer/status/targets/evidence` 구조를 반환합니다.

| 도구 | 설명 | 전략 |
|------|------|------|
| `find_relevant_code` | 기능/버그/설정/라우트와 관련된 파일과 line target을 찾음 | auto |
| `trace_symbol` | 심볼의 정의와 사용처를 추적하는 목적형 alias | symbol-first |
| `map_change_impact` | 수정 전 likely edit/read target과 blast radius를 수집 | reference-chase |
| `explain_code_path` | route/middleware/request/event/CLI 흐름을 파일 간 추적 | reference-chase |
| `collect_evidence` | claim/review point에 대한 citation bundle 수집 | auto |
| `review_change_context` | PR/recent-change review context 수집 | git-guided |

목적형 wrapper는 공통적으로 `repo_root`, `scope`, `session`과 이미 알고 있는 file/symbol/text anchor만 노출합니다. 응답 언어를 명시해야 하는 드문 경우에는 `explore_repo` 또는 `explore`의 `language`를 사용하세요.

## 프로젝트 구조

```text
cerebras-explorer-mcp/
  benchmarks/
  examples/
  fixtures/
  integrations/
    claude/
      .mcp.json.example
    claude-desktop/
      claude_desktop_config.json.example
      README.md
    codex/
      AGENTS.md.example
      config.toml.example
    continue/
      config.yaml.example
      README.md
    cursor/
      mcp.json.example
      README.md
    opencode/
      opencode.json.example
      README.md
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

프로젝트 제약:

- zero dependencies 원칙을 유지합니다. 현재 npm runtime/dev dependencies 없이 Node 표준 라이브러리만 사용합니다.
- read-only 원칙을 유지합니다. 저장소 탐색 도구는 파일을 수정하지 않습니다.
- `explore_repo` 입출력 스키마는 기존 클라이언트를 깨지 않는 additive change 중심으로 확장합니다.

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

선택 (provider override):

```bash
# 기본 provider는 cerebras입니다. OpenAI-compatible endpoint를 쓰려면:
export EXPLORER_PROVIDER="openai-compat"
export EXPLORER_OPENAI_API_KEY="..."
export EXPLORER_OPENAI_BASE_URL="https://api.openai.com/v1"
export EXPLORER_OPENAI_MODEL="gpt-4o-mini"
```

선택 (샘플링 / reasoning):

```bash
export CEREBRAS_EXPLORER_CLEAR_THINKING="false"         # 기본값: false (agentic loop용)
export CEREBRAS_EXPLORER_TEMPERATURE="1"                # direct client / budget override 없는 경로의 fallback
export CEREBRAS_EXPLORER_TOP_P="0.95"                   # direct client / budget override 없는 경로의 fallback
export CEREBRAS_EXPLORER_REASONING_FORMAT="parsed"      # reasoning 출력 형식 override
```

> **sampling 동작**: `explore_repo`/`explore`와 내부 V2 런타임은 현재 budget별 내장값(`quick`: 0.3, `normal`: 0.8, `deep`: 1.0, `top_p`: 0.95)을 사용합니다. `CEREBRAS_EXPLORER_TEMPERATURE`와 `CEREBRAS_EXPLORER_TOP_P`는 direct client 사용이나 budget override가 없는 경로에서만 fallback으로 쓰입니다.

선택 (도구 노출):

```bash
export CEREBRAS_EXPLORER_EXTRA_TOOLS="true"             # false로 설정하면 목적형/특화 wrapper 비활성화. 기본값: true
export CEREBRAS_EXPLORER_ENABLE_EXPLORE="true"          # false로 설정하면 explore 비활성화. 기본값: true
export CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2="false"      # true로 설정하면 advanced explore_v2 공개. 기본값: false
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
- `find_relevant_code` for locating files and line targets before reads or edits
- `trace_symbol` for known symbols
- `map_change_impact` before edits when blast radius is unknown
- `explain_code_path` for route, middleware, request, event, or CLI flows
- `collect_evidence` for claim or review-point verification
- `review_change_context` for PR or recent-change review context
- `explore_repo` for open-ended structured JSON findings
- `explore` for cited Markdown reports
Pass the parent request almost verbatim; add `scope`, known anchors, or `session` only when justified by the task or prior results.
Do not set `budget`, `thoroughness`, `hints.strategy`, or `language` unless an advanced workflow explicitly requires it.
Use known symbols, files, or literal text anchors only when already known.
Use regex only in advanced `explore_repo.hints.regex` workflows.
Reuse `sessionId` as `session` for follow-up calls.
Treat returned `targets` or `explore` citations as the primary map, then do only targeted native reads to verify or prepare edits.
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

아래 budget은 runtime 내부 제어값입니다. 일반 Codex/Claude Code 사용자는 직접 고르지 말고 wrapper query와 known anchors만 전달하세요.

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

- 기본/adoption 벤치마크 파일: `benchmarks/adoption.json`
- 실행 스크립트: `scripts/run-benchmark.mjs`
- npm 스크립트: `npm run benchmark`

예:

```bash
npm run benchmark
```

`npm run benchmark`는 기본 tool list와 같은 wrapper-first `benchmarks/adoption.json`을 실행합니다.

특정 저장소 루트나 케이스만 실행하려면:

```bash
node ./scripts/run-benchmark.mjs \
  --suite ./benchmarks/adoption.json \
  --repo-root /absolute/path/to/repo \
  --case locate-relevant-code \
  --verbose
```

JSON 리포트 저장:

```bash
node ./scripts/run-benchmark.mjs \
  --suite ./benchmarks/adoption.json \
  --output ./benchmark-report.json
```

벤치마크는 exact-string 정답 대신 다음 요소를 가중치로 평가합니다.

- 답변/요약 키워드 그룹 일치율
- evidence / targets에 기대 파일이 포함되는지
- grounded evidence 개수
- evidence snippet, directAnswer, status, nextAction, sessionId, recentActivity, budget stop 여부 같은 구조적 체크

즉, 모델이 문장을 조금 다르게 생성해도 핵심 사실과 근거가 맞으면 안정적으로 점수가 나옵니다.

## 새 버전 릴리즈

새 release를 끊을 때의 표준 절차입니다. tag 운영을 README와 `integrations/` 예시에 일관되게 반영해야, 다른 PC의 사용자가 자기 등록 spec의 tag 부분만 바꿔도 자동으로 새 버전이 받아집니다 (이유는 [설치 한 줄 (GitHub)](#설치-한-줄-github) 섹션의 인용 박스를 참고).

1. 의미 있는 단위로 commit + push가 끝난 상태에서 시작합니다.
2. 새 tag를 끊고 push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. 모든 클라이언트 설치 예시에 박혀 있는 이전 tag를 한 번에 치환:
   ```bash
   OLD=v0.1.0 NEW=v0.2.0
   grep -rl "github:kkyubrother/cerebras-explorer-mcp#${OLD}" README.md integrations/ \
     | xargs sed -i "s|cerebras-explorer-mcp#${OLD}|cerebras-explorer-mcp#${NEW}|g"
   ```
4. 변경 commit + push:
   ```bash
   git add README.md integrations/
   git commit -m "docs: bump install spec to v0.2.0"
   git push origin master
   ```
5. (선택) GitHub Releases에 release notes 작성 — `git log v0.1.0..v0.2.0 --oneline` 출력을 기반으로 사용자 영향이 있는 변경 위주로 정리.

> **tag만 push하고 README/`integrations/` 안 바꾸면**, 새 사용자가 README를 보고 따라 등록할 때 여전히 이전 tag를 받게 됩니다. tag와 문서는 항상 같이 갱신해주세요. 위 sed 한 줄이 그 일을 자동화합니다.

> **이미 등록된 사용자에게 새 버전을 알리는 방법**: 자동 알림 로직(예: `stats.updateAvailable`)은 아직 구현되지 않았습니다. 당분간은 release notes나 README 안내로 사용자가 자기 등록 spec의 tag 부분(`#v0.1.0` → `#v0.2.0`)을 직접 바꾸도록 유도하세요. ref가 바뀌면 npx가 자동으로 새 캐시 키를 만들어 받아옵니다.

## 현재 제한 사항

- `.gitignore`는 루트 파일만 단순 반영합니다.
- 대용량 바이너리 / 압축 파일은 탐색 대상에서 제외합니다.
- 최종 품질은 저장소 구조와 질문 품질에 영향을 받습니다.
- 심볼 인덱싱은 외부 파서 없는 regex/syntax-lite 기반입니다. 언어 서버 수준의 semantic 분석은 제공하지 않지만, 설치 의존성을 늘리지 않는 방향을 우선합니다.
- `repo_symbol_context.depth > 1`은 현재 `effectiveDepth = 1`로 고정됩니다 (직접 호출자만 반환). 의도적 설계 결정이며, 반환값에 `effectiveDepth: 1` 필드가 포함되어 실제 동작을 명시합니다. 더 깊은 호출 체인이 필요하면 `explore_repo`의 `reference-chase` 전략을 사용하세요.
참고:
- 코드베이스 안에는 provider abstraction 관련 구현이 일부 존재하지만, 이 프로젝트의 문서화된 주요 공개 인터페이스는 Cerebras 기반 explorer에 맞춰져 있습니다. Provider override가 필요하면 `EXPLORER_PROVIDER`와 provider별 환경 변수를 사용하세요.

## 다음 확장 포인트

- `map_impact`
- `find_entrypoints`
- repo-specific ignore 정책
- 외부 파서 없는 symbol engine fixture 확대와 정밀도 향상

상세 설계 근거는 [DESIGN.md](./DESIGN.md)에 정리해 두었습니다.
