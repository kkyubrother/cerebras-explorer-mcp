# cerebras-explorer-mcp

> **Unofficial.** Cerebras Systems, Inc.와 무관한 커뮤니티 프로젝트입니다. "Cerebras"는 이 서버가 Cerebras Inference API를 호출한다는 사실을 표기할 목적으로만 사용됩니다.

환경 변수로 선택한 Cerebras 모델을 사용하는, 읽기 전용 자율 코드 탐색 MCP 서버입니다.

Cerebras Explorer는 상위 AI가 정확한 판단을 내릴 수 있도록, 필요한 코드 근거를 빠르게 수집하고 압축해 전달하는 경량 MCP 탐색기입니다. 저장소를 직접 탐색해 파일·라인 근거를 확보하고, 상위 AI가 적은 컨텍스트로 코드 구조와 변경 영향을 이해할 수 있는 형태로 결과를 반환합니다.

핵심 목적은 **Claude Code / Codex 같은 상위 AI가 반복적인 파일 탐색에 컨텍스트를 쓰지 않고**, `find_relevant_code(...)`, `trace_symbol(...)`, `map_change_impact(...)`, `explore_repo(...)`, 또는 `explore(...)` 호출로 검증된 코드 근거와 요약 결과를 받도록 만드는 것입니다.

## 60초 Quickstart

요구사항은 Node.js 22 이상과 `CEREBRAS_API_KEY`입니다. npm publish 전까지는 GitHub tag를 직접 실행합니다.

```bash
export CEREBRAS_API_KEY="..."
npx -y github:kkyubrother/cerebras-explorer-mcp#v0.8.2
```

`npx`는 spec(URL + ref)을 캐시 키로 사용하므로 `#v0.8.2` 같은 tag를 권장합니다. 개발 브랜치를 추적해야 하면 `#master`, 특정 상태가 필요하면 `#<commit-sha>`를 명시하세요.

### Claude Code

```bash
claude mcp add -s user cerebras-explorer \
  -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- npx -y github:kkyubrother/cerebras-explorer-mcp#v0.8.2
```

### Codex CLI

```toml
[mcp_servers.cerebras-explorer]
command = "npx"
args = ["-y", "github:kkyubrother/cerebras-explorer-mcp#v0.8.2"]
enabled = true
startup_timeout_sec = 60
tool_timeout_sec = 180

# Auto-approval is intentional for trusted local coding sessions. Installing
# this explorer means accepting that selected repository evidence may be sent
# to the configured external model provider.
default_tools_approval_mode = "approve"

enabled_tools = [
  "explore_repo",
  "find_relevant_code",
  "trace_symbol",
  "map_change_impact",
  "explain_code_path",
  "collect_evidence",
  "review_change_context",
  "explore",
]

[mcp_servers.cerebras-explorer.env]
CEREBRAS_API_KEY = "${CEREBRAS_API_KEY}"
```

The 8-tool allowlist with auto-approval is the recommended full wrapper setup
for trusted local coding sessions where provider egress is already accepted.
For a stricter minimal trust boundary, remove `default_tools_approval_mode =
"approve"` and expose only `explore_repo`, `find_relevant_code`,
`trace_symbol`, and `map_change_impact`; that subset intentionally drops the
purpose-built evidence, path, review, and Markdown-report entry points.

### OpenCode (`opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cerebras-explorer": {
      "type": "local",
      "command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#v0.8.2"],
      "environment": { "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}" }
    }
  }
}
```

### Gemini CLI

```bash
gemini mcp add -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  cerebras-explorer npx -- \
  -y github:kkyubrother/cerebras-explorer-mcp#v0.8.2
```

Gemini CLI는 `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*AUTH*`, `*CREDENTIAL*` 패턴의 환경변수를 기본 차단합니다. `CEREBRAS_API_KEY`는 서버 설정의 `env` 블록 또는 위 `-e` 옵션으로 명시해야 전달됩니다.

## 클라이언트 설정

| Client | 설정 |
| --- | --- |
| Claude Code | [`integrations/claude/`](./integrations/claude/) |
| Codex CLI | [`integrations/codex/`](./integrations/codex/) |
| OpenCode | [`integrations/opencode/`](./integrations/opencode/) |
| Cursor | [`integrations/cursor/`](./integrations/cursor/) |
| Continue.dev | [`integrations/continue/`](./integrations/continue/) |
| Claude Desktop | [`integrations/claude-desktop/`](./integrations/claude-desktop/) |
| Gemini CLI | [`integrations/gemini/`](./integrations/gemini/) |

## 노출 도구 구성

도구 surface는 항상 정확히 **8개**(spec 011 이후 환경변수와 무관하게 고정).

| 도구 | 역할 |
| --- | --- |
| `explore_repo` | 구조화 JSON handoff. 자동화/편집 계획/follow-up 검증의 기본 표면. |
| `find_relevant_code` / `trace_symbol` / `map_change_impact` / `explain_code_path` / `collect_evidence` / `review_change_context` | 목적형 wrapper 6개. 모두 내부적으로 `explore_repo`에 위임. |
| `explore` | 사람용 Markdown 보고 도구. 단일 advanced backend 구현(spec 011). |

`explore_v2`라는 별도 도구 이름은 spec 011에서 제거되었으며, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2` / `CEREBRAS_EXPLORER_EXTRA_TOOLS` / `CEREBRAS_EXPLORER_ENABLE_EXPLORE` 환경변수도 모두 더 이상 인식되지 않습니다.

모든 공개 MCP 도구는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` annotations를 선언합니다. 이는 클라이언트 승인 UI와 위험도 표시를 돕는 hint이며, 보안 경계는 아래 read-only repo toolkit과 secret policy입니다.

## Security Model

서버는 저장소 파일을 수정하지 않는 read-only explorer입니다. 파일 접근은 allowed root 아래로 정규화하고 `realpath` 재검증과 symlink 거부를 적용합니다. `.env*`, `.ssh/**`, `.aws/credentials`, `.npmrc`, `*.pem`, `secrets/**`, `credentials.json` 같은 민감 경로는 기본 deny-list로 traversal/read/grep/symbol/snippet 경로에서 차단하고, API key/PAT/JWT/private key block은 응답 직전 `[REDACTED:<rule>]`로 치환합니다. snippet/report 문자열 안의 `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")` 같은 **환경변수 식별자는 public한 코드 인터페이스로 간주해 기본적으로 보존**합니다 — 식별자까지 마스킹해야 하는 조직 정책이 있다면 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`로 옵트인하세요. 외부 네트워크 egress는 첫 tool call 이후 lazy 초기화되는 Cerebras API 또는 명시적으로 설정한 OpenAI-compatible provider API로 제한됩니다.

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

- 상위 모델은 목적형 wrapper, `explore_repo`, 또는 `explore`를 호출합니다. 도구 surface는 항상 8개로 고정입니다.
- 실제 파일 탐색 루프는 MCP 서버 안에서 선택된 Cerebras 모델이 자체적으로 수행합니다.
- 따라서 “메인은 위임 1회, explorer가 자율 탐색”이라는 목표를 만족합니다.

## 주요 특징

- **모델 선택 가능**: 기본값은 `zai-glm-4.7`, 필요하면 `CEREBRAS_EXPLORER_MODEL`로 override
- **읽기 전용**: 파일 수정, bash 실행, 네트워크 탐색 없음
- **자율 탐색 루프**: 모델이 내부 도구를 직접 호출하며 파일을 찾고 읽음
- **단일 runtime config**: 모든 호출이 deep 한도(turn 30, 검색 80, 읽기 320 lines 등)로 실행됩니다. 사용자가 budget을 고를 필요가 없습니다.
- **전략 기반 탐색**: symbol-first, reference-chase, git-guided 등은 질문과 anchor에서 자동 유도
- **진행 상황 지원**: MCP progress notification 지원
- **프로젝트별 설정 파일 지원**: `.cerebras-explorer.json`으로 `defaultScope`, `entryPoints`, `keyFiles`, `extraIgnoreDirs`, `projectContext` 지정 가능
- **GLM 4.7 reasoning 정렬**: spec 011 단일 deep config에서는 `reasoning_effort`를 설정하지 않고 기본 reasoning을 유지하며 `clear_thinking=false`로 이전 turn의 reasoning을 보존
- **샘플링 기본값**: `temperature=1.0`, `top_p=0.95` (단일 deep config). direct client 경로에는 envvar fallback 지원
- **근거 강제**: 최종 evidence의 exact status는 실제 관측 라인이 전체 범위를 덮을 때만 부여
- **운영 디버깅 출력**: 모든 explore 호출 종료 시 stderr에 한 줄 요약을 출력하고, `CEREBRAS_EXPLORER_LOG_PATH` 설정 시 호출별 transcript JSONL을 기록
- **Read-only tool annotations**: 모든 공개 MCP 도구는 `readOnlyHint: true`를 선언합니다. 이는 클라이언트 UX hint이며 보안 경계는 아닙니다.
- **Compact 반환 계약**: MCP `structuredContent`는 `schemaVersion`(현재 `2`), `directAnswer`, `status`, `targets`, bounded `discoveredPaths`, snippet 포함 `evidence`, `uncertainties`, `nextAction`, `evidenceQuality`, `searchCoverage`, `critic`, nullable `failure` 중심의 compact 계약을 사용합니다. spec 017 이후 `_debug`, `sessionId`, `session`은 응답에서 모두 제거되었으며, 입력 `session` 파라미터와 `SessionStore`도 함께 사라졌습니다(breaking, v0.6.0). 운영 디버깅은 stderr 한 줄 요약과 `CEREBRAS_EXPLORER_LOG_PATH` transcript JSONL을 사용하세요.

## 공개 MCP 도구

도구 surface는 항상 정확히 **8개**(spec 011 이후 환경변수와 무관하게 고정).

- `explore_repo`: parent agent handoff의 정상 구조화 표면입니다. `directAnswer`, `status`, `targets`, `discoveredPaths`, `evidence`, `evidenceQuality`, `searchCoverage`, `critic.warnings` 같은 JSON 필드를 후속 자동화와 편집 전 검증에 사용합니다.
- 목적형 wrapper 6개(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`): 모두 내부적으로 `explore_repo`에 위임하며, 특정 작업 의도를 더 좁은 입력 스키마로 표현하는 표면입니다.
- `explore`: 사람에게 바로 보여줄 Markdown 보고 도구. spec 011에서 report backend가 단일 구현으로 정리되어 모든 프롬프트에서 동일한 신뢰 가이드라인(structuredContent.citations[]/targets[], critic.warnings, searchCoverage.warnings, tool-result truncation 라벨)을 적용합니다.

**Decision rule for parent agents:**

- 자동화 / 편집 계획 / follow-up 검증 → `explore_repo` (구조화 JSON)
- known symbol / 특정 경로 / 단일 변경 리뷰 → 6 wrappers 중 의도에 맞는 것
- 사람에게 보여줄 narrative → `explore` (Markdown)

Report 도구 `explore`는 Markdown 본문을 `text`로 반환하면서, 같은 MCP 응답의 `structuredContent`에 본문에서 파생한 `citations[]`, 인용 기반 `targets[]`, `searchCoverage`, `critic`, `failure`도 포함합니다. 운영용 `stats`, transcript path, compact tool trace는 기본 answer payload가 아니라 MCP `_meta.ops`에 분리됩니다. parent agent는 file:line 인용을 Markdown에서 regex로 다시 긁기보다 이 구조화 필드를 다음 읽기/검증 대상으로 사용해야 합니다.

`targets[]` vs `discoveredPaths[]` — `targets[]`에는 grounded evidence와 연결된 actionable 항목만 들어가며, `repo_list_dir`/`repo_find_files`/`repo_git_diff` 등으로 발견만 된 path는 별도 top-level `discoveredPaths[]`에 `{ path, kind, sourceTool, reason }` 형태로 최대 50개까지 노출됩니다. 후보가 더 있으면 `searchCoverage.omittedDiscoveredPaths`와 `searchCoverage.warnings`가 생략 수를 알려줍니다. 자동화는 `targets[]`를 다음 읽기/편집 대상으로 신뢰하고, 필요할 때만 `discoveredPaths[]`를 follow-up 후보로 참고하세요. (spec 011 이후 reference target 자동 승격 옵트인은 영구 종료.)

`explore_repo`는 더 이상 `budget` 입력을 받지 않습니다. 모든 호출은 단일 deep runtime config(turn limit 30, search/read 한도 등)로 실행되며, 사용자가 quick/normal/deep을 선택할 필요가 없습니다.

`status.complete`는 "충분한 grounded evidence가 모였는가"를 의미합니다. budget이 소진됐어도 evidence sufficiency가 충족되면 `complete:true`/`failure:null`로 반환되며 budget 사실은 `searchCoverage.stoppedByBudget=true`에 그대로 남습니다.

Heavy 호출이나 sub-agent 핸드오프에서는 `_meta.progressToken`을 함께 전달해 turn-by-turn 진행률을 받고, 결과를 다른 agent에 요약/전달할 때는 다음 control-plane 필드를 그대로 보존하세요: `status.verification`, `status.complete`, `evidenceQuality`, `searchCoverage`, `failure`, `critic.warnings`.

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

- `repo_root` (선택): 절대경로나 상대경로. Windows에서는 `C:\repo`, `C:/repo`뿐 아니라 Git Bash/MSYS 스타일 `/c/repo`도 받아 실제 filesystem 경로로 canonicalize한 뒤 도구 실행에 사용합니다.
- `language` (advanced/optional): 응답 언어를 명시적으로 고정해야 할 때만 사용합니다. 보통은 task 텍스트에서 자동 추론되므로 생략하세요.
- `hints.strategy` (advanced): 일반 agent 사용에서는 생략하세요. 자동 strategy 감지가 우선입니다. (spec 011 이후 `budget` 입력은 제거되었습니다 — 단일 deep runtime config가 적용됩니다. spec 017 이후 `session` 입력도 함께 제거되었습니다.)

반환 예시:

```json
{
  "schemaVersion": 2,
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
  "discoveredPaths": [
    {
      "path": "docs/auth.md",
      "kind": "file",
      "sourceTool": "repo_list_dir",
      "reason": "Listed during repository discovery."
    }
  ],
  "evidence": [
    {
      "id": "E1",
      "path": "src/routes/user.js",
      "startLine": 1,
      "endLine": 4,
      "why": "라우트가 requireAuth를 import하고 /users/me 핸들러에 연결한다.",
      "evidenceType": "file_range",
      "groundingStatus": "exact",
      "snippet": "1: import { requireAuth } from \"../auth.js\";\n2: \n3: export function registerUserRoutes(app) {\n4:   app.get(\"/users/me\", requireAuth, (req, res) => {"
    },
    {
      "id": "E2",
      "path": "src/auth.js",
      "startLine": 1,
      "endLine": 4,
      "why": "requireAuth의 실제 동작이 여기 정의되어 있다.",
      "evidenceType": "file_range",
      "groundingStatus": "exact",
      "snippet": "1: export function requireAuth(req, res, next) {\n2:   if (!req.user) throw new Error(\"unauthorized\");\n3:   next();\n4: }"
    }
  ],
  "uncertainties": [],
  "nextAction": {
    "type": "stop",
    "reason": "Explorer result is complete for the requested read-only investigation."
  },
  "evidenceQuality": {
    "level": "high",
    "exactCount": 2,
    "partialCount": 0,
    "droppedCount": 0,
    "fileCount": 2,
    "warnings": [],
    "summary": "Verified: 2 files read, 1 grep searches, 2/2 retained evidence items grounded, cross-verified across 2 files. All retained evidence grounded in inspected code."
  },
  "searchCoverage": {
    "scope": ["src/**", "docs/**"],
    "scopeLimited": true,
    "filesRead": 2,
    "grepCalls": 1,
    "listDirCalls": 1,
    "symbolCalls": 0,
    "toolResultsTruncated": 0,
    "stoppedByBudget": false,
    "omittedDiscoveredPaths": 0,
    "warnings": ["Result is limited to scope: src/**, docs/**"],
    "summary": "scope-limited search across src/**, docs/**; 2 file read(s), 1 grep search(es)."
  },
  "critic": {
    "status": "pass",
    "warnings": [],
    "droppedEvidence": 0,
    "partialEvidence": 0
  },
  "failure": null
}
```

`failure`는 실행/input/provider/internal failure event에만 사용합니다. 낮은 confidence는 failure가 아니라 `evidenceQuality`와 `status`의 품질 신호입니다. `failure`가 있으면 `failure.retry`를 `nextAction`보다 먼저 보고, `failure`가 `null`이면 기존처럼 `nextAction`을 따르세요. budget이 소진된 호출이라도 evidence sufficiency가 만족되면 `failure.reason='budget_exhausted'`는 더 이상 부여되지 않습니다 — budget 사실은 `searchCoverage.stoppedByBudget=true`에서만 확인할 수 있고, `status.warnings`에는 "budget exhausted after sufficient evidence was collected." 메모가 함께 남습니다.

`failure.retry.args`는 sanitized retry recipe이며 원본 도구 입력을 그대로 반영하지 않습니다. bounded text 필드, bounded string array, 알려진 hint 키만 포함합니다. budget-exhausted retry는 상위 agent가 더 좁은 task/anchor를 선택하더라도 기존 scope hard boundary를 넓히지 않도록 sanitized `scope`를 보존합니다.

`searchCoverage`는 explorer가 실제로 검색·읽은 범위를 요약합니다. 완전한 의미 분석 보증은 아닙니다. `scopeLimited`가 true면 evidence가 없다는 사실은 "이 scope 안에서는 없다"이지 "저장소에 없다"가 아닙니다. `omittedDiscoveredPaths`가 0보다 크면 `discoveredPaths[]`는 follow-up 후보 일부만 담고 있습니다.

spec 017 이후 응답에는 `_debug` 운영 디버그 객체가 포함되지 않습니다. parent agent가 사람에게 노출하지 않는 채널이라 사실상 운영 디버깅에 쓰이지 않았다는 판단에 따라 응답 표면에서 제거되었습니다. 운영 관찰성은 항상 출력되는 stderr 한 줄 요약과 `CEREBRAS_EXPLORER_LOG_PATH`로 옵트인하는 transcript JSONL을 사용하세요.

권장 사용처:

- `explore_repo`: 후속 자동화, 추가 도구 호출, 편집 전 검증처럼 **구조화된 JSON 필드**가 필요한 경우
- `explore`: 아키텍처 설명, 온보딩 요약, 사용자에게 바로 보여줄 답변처럼 **사람이 읽는 Markdown 보고서**가 필요한 경우
- `targets`: 상위 agent가 다음에 읽거나 검증할 action field입니다. `role=read|edit|test|config|context` 대상만 목적에 맞게 확인하고, `reference`는 필요할 때만 읽습니다.

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
- `scope`, `repo_root`, `language`, `context`: 필요할 때만 보고서 범위, 저장소 루트, 출력 언어, 상위 agent 컨텍스트를 지정합니다.

반환 특성:

- JSON 필드 묶음 대신 **Markdown 보고서 본문**이 중심입니다.
- 본문 안에 inline file:line citation이 들어갑니다.
- `structuredContent`에는 본문에서 파생한 `citations[]`, 인용 기반 `targets[]`, `searchCoverage`, `critic`, `failure`가 함께 들어갑니다.
- 운영용 `stats`, transcript path, compact tool trace는 기본 `structuredContent`가 아니라 `_meta.ops`에 분리됩니다.
- 사용자 설명, 아키텍처 브리핑, 조사 결과 공유에 적합합니다.
- 후속 자동화나 정형 후처리가 중요하면 `explore_repo`를 우선 사용하세요.

### `explore` 단일 백엔드 (spec 011)

이전 `explore_v2` 도구 이름과 분기 라우터는 spec 011에서 모두 제거되었습니다. 모든 `explore` 호출은 단일 advanced backend 구현으로 실행되며 세 가지 고급 기법이 항상 적용됩니다.

1. **LLM 기반 대화 요약**: 탐색이 진행되면서 이전 발견 내용을 지능적으로 요약해 유용한 컨텍스트를 최대화합니다.
2. **도구 결과 예산 관리**: 개별 도구 출력에 상한을 두어 컨텍스트 오버플로를 방지합니다.
3. **최대 출력 복구**: 보고서가 출력 토큰 한도로 잘렸을 때 자동으로 이어서 생성합니다.

### 특화 도구 (Specialized Tools)

목적형 wrapper 도구는 spec 011 이후 항상 노출됩니다 (총 6개). 모두 내부적으로 `explore_repo`에 위임하고 같은 `directAnswer/status/targets/discoveredPaths/evidence` 구조를 반환합니다.

| 도구 | 설명 | 전략 |
|------|------|------|
| `find_relevant_code` | 기능/버그/설정/라우트와 관련된 파일과 line target을 찾음 | auto |
| `trace_symbol` | 심볼의 정의와 사용처를 추적하는 목적형 alias | symbol-first |
| `map_change_impact` | 변경 *설명*과 이미 알려진 file/symbol anchor로 likely edit/read target과 blast radius를 수집 | reference-chase |
| `explain_code_path` | route/middleware/request/event/CLI 흐름을 파일 간 추적 | reference-chase |
| `collect_evidence` | claim/review point에 대한 citation bundle 수집 | auto |
| `review_change_context` | PR/recent-change review context 수집 | git-guided |

목적형 wrapper는 공통적으로 `repo_root`, `scope`와 이미 알고 있는 file/symbol/text anchor만 노출합니다 (spec 017 이후 `session` 입력은 모든 wrapper에서 제거). 응답 언어를 명시해야 하는 드문 경우에는 `explore_repo` 또는 `explore`의 `language`를 사용하세요.

## 프로젝트 구조

```text
cerebras-explorer-mcp/
  benchmarks/
  examples/
  fixtures/
  integrations/
    claude/
      .mcp.json.example
      .claude/
        agents/cerebras-explorer.md
        skills/cerebras-explore/SKILL.md
    claude-desktop/
      claude_desktop_config.json.example
      README.md
    codex/
      AGENTS.md.example
      config.toml.example
      .agents/skills/cerebras-explore/SKILL.md
      .codex/agents/cerebras_explorer.toml
    continue/
      config.yaml.example
      README.md
    cursor/
      mcp.json.example
      README.md
    gemini/
      settings.json.example
      README.md
    opencode/
      opencode.json.example
      README.md
  scripts/
  src/
    benchmark/
      evaluator.mjs
      report.mjs
      transcript-metrics.mjs
    explorer/
      cache.mjs
      cerebras-client.mjs
      config.mjs
      critic.mjs
      prompt.mjs
      providers/
        abstract.mjs
        failover.mjs
        index.mjs
        openai-compat.mjs
      redact.mjs
      repo-tools.mjs
      runtime.mjs
      schemas.mjs
      security.mjs
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
- secret deny-list는 `.env*`, `.ssh/**`, `.aws/credentials`, `.npmrc`, `*.pem`, `secrets/**`, `credentials.json` 같은 민감 파일을 traversal/read/grep/symbol/snippet 경로에서 기본 차단합니다. 로컬 디버깅에서만 `CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST=1`로 우회하세요.
- 주요 API key, PAT, JWT, private key block은 `[REDACTED:<rule>]` 형태로 치환합니다. evidence line reference는 유지되며, redacted evidence에는 `redacted`와 `redactions` metadata가 붙습니다.
- `explore_repo` 입출력 스키마는 기존 클라이언트를 깨지 않는 additive change 중심으로 확장합니다.

### 1) 환경 변수

```bash
export CEREBRAS_API_KEY="..."
```

선택 (모델 / API):

```bash
export CEREBRAS_API_BASE_URL="https://api.cerebras.ai/v1"
export CEREBRAS_EXPLORER_MODEL="zai-glm-4.7"           # 전역 모델. 기본값: zai-glm-4.7
export CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS="60000"        # HTTP 요청 timeout (ms). 기본값: 60000
```

> spec 011 이후 `CEREBRAS_MODEL` alias와 `CEREBRAS_EXPLORER_MODEL_QUICK` / `_NORMAL` / `_DEEP` budget별 모델 override는 모두 제거되었습니다. 모델은 항상 `CEREBRAS_EXPLORER_MODEL` 하나로만 결정됩니다. budget별 비용 분리가 필요하면 서버 인스턴스를 두 개 띄워 각각 다른 모델을 지정하세요.

내부 provider escape hatch (공개 계약 아님):

```bash
# 기본 공개 계약은 Cerebras explorer입니다. 아래 값은 개발/운영용 내부 escape hatch입니다.
export EXPLORER_PROVIDER="openai-compat"
export EXPLORER_OPENAI_API_KEY="..."
export EXPLORER_OPENAI_BASE_URL="https://api.openai.com/v1"
export EXPLORER_OPENAI_MODEL="gpt-4o-mini"
```

`EXPLORER_PROVIDER` / `EXPLORER_FAILOVER`는 내부 구현 경로이며 안정적인 사용자용 설정 표면으로 취급하지 않습니다.

선택 (샘플링 / reasoning):

```bash
export CEREBRAS_EXPLORER_CLEAR_THINKING="false"         # 기본값: false (agentic loop용)
export CEREBRAS_EXPLORER_TEMPERATURE="1"                # direct client 호출 시 fallback
export CEREBRAS_EXPLORER_TOP_P="0.95"                   # direct client 호출 시 fallback
export CEREBRAS_EXPLORER_REASONING_FORMAT="parsed"      # reasoning 출력 형식 override
```

> **sampling 동작 (spec 011)**: 모든 explore 호출이 단일 deep runtime config(`temperature=1.0`, `top_p=0.95`)로 실행됩니다. 별도 envvar fallback은 direct client 사용 경로에서만 의미가 있습니다.

선택 (보안 옵션):

```bash
# snippet 텍스트의 process.env.X / import.meta.env.X / Deno.env.get("X") 식별자까지
# [REDACTED:env-var-name]로 마스킹합니다. 기본은 식별자 보존(코드 인터페이스).
export CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES="1"

# snippet 텍스트의 32자 이상 연속 hex 문자열(일부 토큰/해시 형태)을
# [REDACTED:generic-hex-32]로 추가 마스킹합니다. false positive를 피하려고 기본은 off.
export CEREBRAS_EXPLORER_REDACT_GENERIC_HEX="1"
```

> spec 011에서 제거된 envvar: `CEREBRAS_MODEL`, `CEREBRAS_EXPLORER_MODEL_QUICK|NORMAL|DEEP`, `CEREBRAS_EXPLORER_EXTRA_TOOLS`, `CEREBRAS_EXPLORER_ENABLE_EXPLORE`, `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2`, `CEREBRAS_EXPLORER_AUTO_ROUTE`, `CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO`, `CEREBRAS_EXPLORER_LEGACY_DISCOVERED_TARGETS`. spec 023에서 `CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER`, `CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS`, `CEREBRAS_EXPLORER_V2_MAX_COMPACTIONS`도 non-V2 이름으로 교체되었습니다. 이전에 이들을 사용하던 운영 환경은 단일 모델 + 8-tool 고정 surface로 자동 전환됩니다. 도구 surface 축소가 필요하면 MCP gateway에서 도구 화이트리스트를 적용하세요.
>
> spec 017 (v0.6.0) 추가 변경: 응답에서 `_debug`, `sessionId`, `session` 필드를 모두 제거, 입력 `session` 파라미터 제거, `SessionStore` 모듈 삭제. multi-call 세션 연결 기능은 더 이상 지원되지 않습니다. `schemaVersion`은 1 → 2.

선택 (explore 튜닝):

```bash
export CEREBRAS_EXPLORER_TURN_MULTIPLIER="2"         # 기본값: 2, 1~4로 clamp
export CEREBRAS_EXPLORER_MAX_EXTRA_TURNS="30"        # 기본값: 30, 0~200으로 clamp
export CEREBRAS_EXPLORER_MAX_COMPACTIONS="3"         # 기본값: 3, 0~10으로 clamp
```

선택 (디버깅 / 관측):

```bash
export CEREBRAS_EXPLORER_LOG_PATH="./transcripts" # 설정하면 호출별 transcript JSONL을 이 디렉터리에 기록
export CEREBRAS_EXPLORER_LOG_RAW="true"           # 기본 redaction을 끄는 raw 디버깅 모드. 필요한 경우에만 사용
```

이전 transcript envvar 이름(v0.6.x의 hidden alias)은 v0.7.0에서 제거되었습니다. transcript은 `CEREBRAS_EXPLORER_LOG_PATH`로만 켜지며(경로 설정이 곧 opt-in), 마이그레이션 안내는 `CHANGELOG.md`의 v0.7.0 항목을 참고하세요.

transcript의 초기 `meta` record에는 서버/패키지 버전, compact schema version, git SHA(확인 가능할 때), 공개 tool registry hash와 tool 이름 목록을 담은 execution provenance가 포함됩니다. 이 metadata는 운영/평가 기록용이며 MCP `structuredContent` 응답 계약에는 포함되지 않습니다.

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
   - stdio JSON-RPC 채널 보호를 위해 일반 console 출력은 stderr로 보냅니다. 로컬 디버깅에서만 `MCP_STDIO_GUARD=0`으로 우회할 수 있습니다.
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
- `map_change_impact` before edits when a change description is available; add `knownFiles`/`knownSymbols` only as optional anchors
- `explain_code_path` for route, middleware, request, event, or CLI flows
- `collect_evidence` for claim or review-point verification
- `review_change_context` for PR or recent-change review context
- `explore_repo` for open-ended structured JSON findings
- `explore` for cited Markdown reports
Pass the parent request almost verbatim; add `scope` or known anchors only when justified by the task or prior results.
Do not set `hints.strategy` or `language` unless an advanced workflow explicitly requires it. (The `budget` input was removed in spec 011, `session` was removed in spec 017, and `explore.thoroughness` was removed in spec 023 — every call uses the single deep runtime config and starts a fresh exploration.)
For anchor-only file, symbol, or flow discovery, use `trace_symbol`, `find_relevant_code`, or `explain_code_path` instead of `map_change_impact`.
Use known symbols, files, or literal text anchors only when already known.
Use regex only in advanced `explore_repo.hints.regex` workflows.
Treat returned `targets` or `explore` citations as the primary map, then do only targeted native reads or one or two focused `rg` checks to verify critical claims.
If MCP findings and local evidence disagree, report the conflict instead of smoothing it over.
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

## Runtime 한도 (spec 011)

spec 011 이후 모든 explore 호출은 단일 deep runtime config로 실행됩니다. 사용자가 budget 라벨을 고를 필요가 없고, `budget` 입력 자체가 schema에서 제거되었습니다.

| 항목 | 값 |
| --- | --- |
| `maxTurns` | 30 |
| `maxSearchResults` | 80 |
| `maxReadLines` | 320 |
| `maxDirectoryEntries` | 300 |
| `maxWalkFiles` | 6000 |
| `maxCompletionTokens` | 32000 |
| `finalizeMaxCompletionTokens` | 3000 |
| `maxContextTokens` | 110000 |
| `temperature` | 1.0 |
| `top_p` | 0.95 |

> `maxContextTokens`(110000)는 Cerebras zai-glm-4.7 **paid 티어** 컨텍스트 윈도우(131k 토큰) 아래로 잡은 작업 예산입니다. ~21k는 출력/추론 여유분이고, 압축은 70%(≈77k)에서 선제 발동합니다(spec 024).

## 안전 경계

이 구현은 의도적으로 다음을 하지 않습니다.

- 파일 쓰기 / 수정
- bash 명령 실행
- 웹 검색
- 외부 문서 검색
- scope 밖 경로 확장
- symlink 추적

즉, **코드 탐색 전용 explorer**입니다.

scope는 모든 도구에서 hard boundary입니다. `repo_list_dir`/`repo_read_file`/`repo_grep`/`repo_symbols` 등은 base scope를 벗어나는 path를 거부하고, **git-guided 도구(`repo_git_diff`, `repo_git_show`, `repo_git_diff({stat:true})`)도 변경된 파일을 base scope 안으로 한정**합니다. scope 밖에서 제외된 파일 수는 응답 객체의 `omittedOutOfScopeFiles`(0보다 클 때만 포함)로 가시화되므로, 정보 손실을 인지하고 필요하면 scope를 넓혀 재호출해야 합니다.

## 벤치마크

반복 가능한 품질 측정을 위해 선언형 질의 세트와 점수 계산기를 포함합니다.
실제 MCP 탐색을 실행하므로 `CEREBRAS_API_KEY`가 설정되어 있어야 합니다.

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

저장된 JSON 리포트에는 run-level `provenance`가 top-level metadata로 포함됩니다. 개별 `cases[].result`는 parent-facing MCP 결과 payload 그대로 유지되며, provenance는 응답 본문에 복제되지 않습니다.

벤치마크는 exact-string 정답 대신 다음 요소를 가중치로 평가합니다.

- 답변/요약 키워드 그룹 일치율
- evidence / targets에 기대 파일이 포함되는지
- grounded evidence 개수
- evidence snippet, directAnswer, status, nextAction, budget stop 여부 같은 구조적 체크

즉, 모델이 문장을 조금 다르게 생성해도 핵심 사실과 근거가 맞으면 안정적으로 점수가 나옵니다.

## 새 버전 릴리즈

새 release를 끊을 때의 표준 절차입니다. tag 운영을 README와 `integrations/` 예시에 일관되게 반영해야, 다른 PC의 사용자가 자기 등록 spec의 tag 부분만 바꿔도 자동으로 새 버전이 받아집니다. `npx`가 URL + ref를 캐시 키로 쓰는 이유는 [60초 Quickstart](#60초-quickstart)의 tag 안내를 참고하세요.

1. 의미 있는 단위로 commit이 끝난 깨끗한 작업 트리에서 시작합니다.
2. 버전 값을 정하고 package/server/changelog를 함께 갱신합니다.
   ```bash
   OLD_TAG="v<previous-version>"
   NEW_TAG="v<new-version>"

   npm version "${NEW_TAG#v}" --no-git-tag-version
   # src/mcp/server.mjs SERVER_INFO.version도 같은 값으로 갱신
   # tests/mcp-server.test.mjs의 버전 단언(serverInfo.version, provenance serverVersion/packageVersion)도 같은 값으로 갱신
   # CHANGELOG.md에 새 release 날짜와 사용자 영향 항목 기록
   ```
3. 클라이언트 설치 예시와 테스트 pin에 박혀 있는 이전 tag를 한 번에 치환합니다.
   ```bash
   grep -rl "github:kkyubrother/cerebras-explorer-mcp#${OLD_TAG}" README.md integrations/ tests/ \
     | xargs sed -i "s|cerebras-explorer-mcp#${OLD_TAG}|cerebras-explorer-mcp#${NEW_TAG}|g"
   ```
4. 검증을 실행합니다.
   ```bash
   npm test
   npm pack --dry-run --json
   CEREBRAS_API_KEY="$CEREBRAS_API_KEY" node ./scripts/integration-test.mjs
   # 필요하면 CEREBRAS_API_KEY 설정 후 npm run benchmark
   ```
5. 변경 commit, tag, push:
   ```bash
   git add package.json src/mcp/server.mjs CHANGELOG.md README.md integrations/ tests/
   git commit -m "chore: release ${NEW_TAG}"
   git tag "$NEW_TAG"
   git push origin master
   git push origin "$NEW_TAG"
   ```
6. (선택) GitHub Releases에 release notes 작성 — `git log "$OLD_TAG..$NEW_TAG" --oneline` 출력을 기반으로 사용자 영향이 있는 변경 위주로 정리.

> **tag만 push하고 README/`integrations/` 안 바꾸면**, 새 사용자가 README를 보고 따라 등록할 때 여전히 이전 tag를 받게 됩니다. tag와 문서는 항상 같이 갱신해주세요. 위 sed 한 줄이 그 일을 자동화합니다.

> **이미 등록된 사용자에게 새 버전을 알리는 방법**: 자동 알림 로직(예: `stats.updateAvailable`)은 아직 구현되지 않았습니다. 당분간은 release notes나 README 안내로 사용자가 자기 등록 spec의 tag 부분을 새 tag로 직접 바꾸도록 유도하세요. ref가 바뀌면 npx가 자동으로 새 캐시 키를 만들어 받아옵니다.

## 현재 제한 사항

- `.gitignore`는 루트 파일과 traversal 도중 발견되는 nested `.gitignore`(서브디렉토리별)를 함께 반영합니다 (spec 014). nested 매처는 자기 디렉토리 prefix 안의 path에만 적용됩니다. `.gitignore`의 부정 규칙(`!keep`)은 지원하지 않으며 silently dropped됩니다. 더 좁히려면 `.cerebras-explorer.json`의 `extraIgnorePatterns`(저장소 루트 기준 path glob)로 추가 ignore 규칙을 지정할 수 있습니다. secret deny-list와 scope 경계는 이 ignore 정책 위에서 항상 우선합니다.
- 대용량 바이너리 / 압축 파일은 탐색 대상에서 제외합니다.
- 최종 품질은 저장소 구조와 질문 품질에 영향을 받습니다.
- 심볼 인덱싱은 외부 파서 없는 regex/syntax-lite 기반입니다. 언어 서버 수준의 semantic 분석은 제공하지 않지만, 설치 의존성을 늘리지 않는 방향을 우선합니다.
- `repo_symbol_context.depth > 1`은 현재 `effectiveDepth = 1`로 고정됩니다 (직접 호출자만 반환). 의도적 설계 결정이며, 반환값에 `effectiveDepth: 1` 필드가 포함되어 실제 동작을 명시합니다. 더 깊은 호출 체인이 필요하면 `explore_repo`의 `reference-chase` 전략을 사용하세요.
참고:
- 코드베이스 안에는 provider abstraction/failover 구현이 일부 존재하지만, 이 프로젝트의 문서화된 주요 공개 인터페이스는 Cerebras 기반 explorer에 맞춰져 있습니다. `EXPLORER_PROVIDER` / `EXPLORER_FAILOVER`는 내부 escape hatch이며 안정적인 사용자용 계약이 아닙니다.

## 다음 확장 포인트

현재 활성 확장 후보는 없습니다. 과거에 나열했던 후보 중 repo-specific ignore 정책과 외부 파서 없는 symbol engine 정밀도 패치는 완료되었습니다.

새 후보가 들어오면 [`plan/extension-backlog.md`](./plan/extension-backlog.md)에 추가하고 거기서 spec 진행 여부를 결정합니다.

상세 설계 근거는 [DESIGN.md](./DESIGN.md)에 정리해 두었습니다.
