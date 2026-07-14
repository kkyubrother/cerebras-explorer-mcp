# cerebras-explorer-mcp

> **Unofficial.** Cerebras Systems, Inc.와 무관한 커뮤니티 프로젝트입니다. "Cerebras"는 이 서버가 Cerebras Inference API를 호출한다는 사실을 표기할 목적으로만 사용됩니다.

Cerebras 모델이 저장소를 읽기 전용으로 탐색하고, Claude Code·Codex 같은 parent agent에 검증된 근거만 간결하게 넘기는 MCP 서버입니다. Parent는 파일 검색을 반복하는 대신 목적에 맞는 고수준 도구를 한 번 호출하고, `schemaVersion: 3` handoff의 `state`에 따라 바로 답을 사용하거나 필요한 위치만 확인합니다.

## 60초 Quickstart

요구사항은 Node.js 22 이상과 `CEREBRAS_API_KEY`입니다. npm publish 전까지는 GitHub tag를 직접 실행합니다.

```bash
export CEREBRAS_API_KEY="..."
npx -y github:kkyubrother/cerebras-explorer-mcp#v0.8.9
```

`npx`는 spec(URL + ref)을 캐시 키로 사용하므로 `#v0.8.9` 같은 tag를 권장합니다. 개발 브랜치를 추적해야 하면 `#master`, 특정 상태가 필요하면 `#<commit-sha>`를 명시하세요.

### Claude Code

```bash
claude mcp add -s user cerebras-explorer \
  -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  -- npx -y github:kkyubrother/cerebras-explorer-mcp#v0.8.9
```

### Codex CLI

```toml
[mcp_servers.cerebras-explorer]
command = "npx"
args = ["-y", "github:kkyubrother/cerebras-explorer-mcp#v0.8.9"]
enabled = true
startup_timeout_sec = 60
tool_timeout_sec = 180

# Auto-approval is intentional for trusted local coding sessions. Installing
# this explorer means accepting that selected repository evidence may be sent
# to the configured external model provider.
default_tools_approval_mode = "approve"

enabled_tools = [
  "find_relevant_code",
  "trace_symbol",
  "map_change_impact",
  "explain_code_path",
  "collect_evidence",
  "explore_repo",
]

[mcp_servers.cerebras-explorer.env]
CEREBRAS_API_KEY = "${CEREBRAS_API_KEY}"
```

Auto-approval은 provider egress를 이미 수용한 trusted local coding sessions에 적합합니다. 더 엄격한 환경에서는 `default_tools_approval_mode = "approve"`를 제거하고 매 호출을 승인하세요.

### OpenCode (`opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cerebras-explorer": {
      "type": "local",
      "command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#v0.8.9"],
      "environment": { "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}" }
    }
  }
}
```

### Gemini CLI

```bash
gemini mcp add -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  cerebras-explorer npx -- \
  -y github:kkyubrother/cerebras-explorer-mcp#v0.8.9
```

Gemini CLI는 `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*AUTH*`, `*CREDENTIAL*` 패턴의 환경변수를 기본 차단합니다. `CEREBRAS_API_KEY`는 서버 설정의 `env` 블록 또는 위 `-e` 옵션으로 명시해야 전달됩니다.

전체 client 예시는 다음 디렉터리에 있습니다.

| Client | 설정 |
| --- | --- |
| Claude Code | [`integrations/claude/`](./integrations/claude/) |
| Codex CLI | [`integrations/codex/`](./integrations/codex/) |
| OpenCode | [`integrations/opencode/`](./integrations/opencode/) |
| Cursor | [`integrations/cursor/`](./integrations/cursor/) |
| Continue.dev | [`integrations/continue/`](./integrations/continue/) |
| Claude Desktop | [`integrations/claude-desktop/`](./integrations/claude-desktop/) |
| Gemini CLI | [`integrations/gemini/`](./integrations/gemini/) |

## 공개 MCP 도구

공개 surface는 환경변수와 무관하게 아래 순서로 고정됩니다.

1. `find_relevant_code`
2. `trace_symbol`
3. `map_change_impact`
4. `explain_code_path`
5. `collect_evidence`
6. `explore_repo`

Parent의 선택 규칙은 짧습니다.

- 위치를 찾아야 함 → `find_relevant_code`
- 알고 있는 symbol의 정의와 사용처가 필요함 → `trace_symbol`
- 변경 전 영향 범위를 파악해야 함 → `map_change_impact`
- request/event/job/CLI/data 흐름을 따라가야 함 → `explain_code_path`
- 기존 주장이나 가설을 지지·반박해야 함 → `collect_evidence`
- 어느 경우에도 명확히 해당하지 않음 → `explore_repo`

각 wrapper는 단순 별칭이 아니라 서로 다른 완료 조건을 seed합니다. 예를 들어 symbol 추적은 정의와 사용처 cross-check가 모두 필요하고, 실행 경로 설명은 entry point부터 terminal effect까지 각 handoff가 근거로 이어져야 합니다.

모든 공개 도구는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true` annotations를 선언합니다. 이는 client UI hint이며 실제 보안 경계는 아래 scope·path·secret 정책입니다.

### 입력

`explore_repo` 예시:

```json
{
  "task": "인증 미들웨어가 어느 라우트에 연결되는지 추적해라",
  "repo_root": "C:/work/example",
  "scope": ["src/**", "tests/**"],
  "hints": {
    "symbols": ["requireAuth"],
    "files": ["src/routes/user.js"],
    "regex": ["requireAuth\\s*\\("]
  },
  "language": "ko"
}
```

- `task`만 필수입니다.
- `repo_root`는 생략하면 MCP 서버 process의 현재 작업 디렉터리입니다. Windows drive path와 Git Bash/MSYS 형식을 canonical path로 변환합니다.
- `scope`는 모든 내부 file/git 도구에 적용되는 hard boundary입니다.
- `hints`에는 이미 알고 있는 symbol, file, regex anchor만 넣습니다.
- `language`는 응답 언어를 반드시 고정해야 할 때만 사용합니다. 보통 task 언어에서 자동 추론됩니다.
- Parent가 탐색 방식, 반복 횟수, 추론 강도, 내부 sub-goal 또는 repair 동작을 정하는 입력은 없습니다.

Wrapper 입력은 의도에 맞게 더 좁습니다.

| 도구 | 필수 입력 | 선택 anchor |
| --- | --- | --- |
| `find_relevant_code` | `query` | `scope`, `knownFiles`, `knownSymbols`, `knownText` |
| `trace_symbol` | `symbol` | `scope` |
| `map_change_impact` | `change` | `scope`, `knownFiles`, `knownSymbols` |
| `explain_code_path` | `pathQuery` | `scope`, `entryPoint`, `knownFiles`, `knownSymbols` |
| `collect_evidence` | `claim` | `scope`, `knownFiles`, `knownSymbols`, `knownText` |
| `explore_repo` | `task` | `scope`, `hints`, `language` |

모든 도구에서 `repo_root`는 선택 입력입니다. 알려진 anchor를 전달하면 broad discovery를 줄일 수 있지만 scope를 넓히지는 못합니다.

## Parent handoff v3

MCP `structuredContent`는 parent가 다음 행동을 고르는 데 필요한 최소 필드만 포함합니다.

```json
{
  "schemaVersion": 3,
  "directAnswer": "registerUserRoutes는 /users/me 라우트에 requireAuth를 연결한다.",
  "state": "complete",
  "evidence": [
    {
      "kind": "source",
      "path": "src/routes/user.js",
      "startLine": 1,
      "endLine": 5,
      "supports": "registerUserRoutes가 /users/me 라우트에 requireAuth를 연결한다.",
      "snippet": "1: import { requireAuth } from \"../auth.js\";"
    }
  ]
}
```

`state`는 유일한 routing signal입니다.

| `state` | 의미 | Parent 행동 |
| --- | --- | --- |
| `complete` | 모든 유효한 필수 sub-goal이 검증됨 | `directAnswer`를 사용 |
| `verify_targets` | 근거는 닫혔지만 편집 의도 때문에 명시된 source range 확인이 필요함 | `targets`만 읽고 진행 |
| `incomplete` | 하나 이상의 필수 질문이 막혔거나 근거가 부족함 | 검증된 부분만 사용하고 `gaps`와 선택적 `followUp` 확인 |
| `failed` | input, cancellation, provider, tool, verifier 또는 internal fault로 정상 결과를 만들 수 없음 | `failure.retry`가 있을 때만 재시도 |

조건부 필드는 필요한 경우에만 나타납니다.

- `targets`: parent가 읽거나 수정해야 할 위치만 포함합니다.
- `evidence`: `source`, `git`, `absence` 중 검증된 직접 근거만 포함합니다.
- `gaps`: `incomplete`에서 해결되지 않은 원래 질문을 빠짐없이 보존합니다.
- `followUp`: 실제로 결과를 개선할 수 있는 한 가지 좁은 행동만 제시합니다.
- `failure`: `failed`에서만 나타나며 기계 판독 가능한 이유와 선택적 retry를 담습니다.

내부 sub-goal id/history, rejected goal, search counter, token/timing, 성공한 check 목록, provider/model, tool trace는 정상 parent payload에 포함하지 않습니다. 자세한 정보는 local transcript와 direct-runtime 평가 경로에만 남습니다.

`content[0].text`만 표시하는 client를 위해 text도 같은 결론을 간단히 반영합니다. Structured handoff보다 더 많은 진단이나 별도 결론을 추가하지 않습니다.

## 신뢰 모델

Explorer는 근거 수만으로 완료를 선언하지 않습니다.

1. 원래 요청의 각 부분을 독립 검증 가능한 sub-goal로 나눕니다.
2. 요청에서 추적되지 않는 목표는 내부에서 버리고, scope·read-only capability·external state·missing input 때문에 달성할 수 없는 사용자 요구는 required gap으로 유지합니다.
3. 각 goal의 claim type에 맞는 고정 proof policy로 source/git/absence evidence를 수집합니다.
4. Runtime이 path, line range, snippet, scope, truncation을 저장소에서 다시 확인합니다.
5. 탐색 prose와 분리된 semantic verifier가 각 atomic claim이 인용 근거로 실제 지지되는지 판정합니다.
6. 좁은 근거 부족은 내부 repair 한 번으로 보완하고, 남은 gap은 숨기지 않고 `incomplete`로 반환합니다.

Planner가 잘못 만든 목표는 parent에게 노출되지 않으며 완료를 막지 않습니다. 반대로 사용자가 요구한 불가능한 목표나 끝내 입증되지 않은 목표는 임의로 성공 처리하지 않습니다.

## 고정 안전 한계

Provider, context, process, repository traversal을 보호하는 한계는 runtime 내부 상수입니다. Public tool, project config, operator environment에서 선택하거나 배수로 늘릴 수 없습니다.

| 보호 대상 | 고정값 |
| --- | ---: |
| exploration turns | 30 |
| search results per call | 80 |
| lines per file read | 320 |
| directory entries | 300 |
| walked files | 6000 |
| generation output tokens | 16384 |
| final projection tokens | 3000 |
| working context tokens | 110000 |

내부 관측 이름은 정확히 `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, `tool_result_limit`입니다. 한계 도달 자체는 완료 근거가 아니며, 실제로 방해받은 goal만 내부적으로 `safety_limit_reached`로 분류됩니다. Parent에는 미해결 질문과 간결한 이유만 전달합니다. 필수 control response가 bounded recovery 뒤에도 유효하지 않으면 해당 provider/verifier/internal fault로 `failed`가 됩니다. 사용량과 한계 세부값은 parent payload가 아니라 운영 기록에 남습니다.

## Security Model

- 저장소 접근은 읽기 전용입니다. file write/delete와 shell 실행 경로를 제공하지 않습니다.
- 모든 path는 repository root 아래로 정규화하고 `realpath`로 다시 검사합니다. Symlink를 통한 root 탈출을 거부합니다.
- `scope`는 list/read/grep/symbol 도구뿐 아니라 git diff/show/stat에도 적용되는 hard boundary입니다. Scope 밖 file은 결과에서 제외됩니다.
- `.env*`, `.ssh/**`, `.aws/credentials`, `.npmrc`, `*.pem`, `secrets/**`, `credentials.json` 같은 민감 경로는 deny-list로 차단합니다.
- API key, PAT, JWT, private key block 등 secret 값은 응답과 기본 transcript에서 `[REDACTED:<rule>]`로 치환합니다.
- Snippet의 `process.env.X`, `import.meta.env.X`, `Deno.env.get("X")` 같은 환경변수 식별자는 코드 interface이므로 기본적으로 보존합니다. 식별자도 감춰야 하면 `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`을 사용합니다.
- 선택된 repository evidence는 Cerebras API로 전송될 수 있습니다. 민감 저장소에서는 조직의 egress 정책을 먼저 확인하세요.

## 설정

기본 실행에 필요한 값은 API key 하나입니다.

```bash
export CEREBRAS_API_KEY="..."
export CEREBRAS_EXPLORER_MODEL="zai-glm-4.7"        # optional
export CEREBRAS_EXPLORER_LOG_PATH="./.explorer-logs" # optional JSONL directory
```

추가 운영 설정:

- `CEREBRAS_API_BASE_URL`: Cerebras API endpoint override
- `CEREBRAS_EXPLORER_TEMPERATURE`, `CEREBRAS_EXPLORER_TOP_P`: direct client sampling override
- `CEREBRAS_EXPLORER_REASONING_FORMAT`, `CEREBRAS_EXPLORER_CLEAR_THINKING`: provider-compatible reasoning format
- `CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS`: HTTP timeout
- `CEREBRAS_EXPLORER_LOG_RAW=true`: 일반 transcript record의 raw 보존. Planning/trust record의 redaction은 계속 강제됩니다.
- `CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES=1`: snippet 안의 환경변수 식별자도 redaction

`CEREBRAS_EXPLORER_LOG_PATH`를 설정하면 호출별 redacted JSONL을 남깁니다. Parent payload에는 transcript path, stats, usage, timing을 추가하지 않습니다.

프로젝트 root의 `.cerebras-explorer.json`에는 다음 search facts만 둘 수 있습니다.

```json
{
  "defaultScope": ["src/**", "tests/**"],
  "extraIgnoreDirs": ["generated"],
  "extraIgnorePatterns": ["fixtures/large/**"],
  "projectContext": "Node.js ESM service",
  "entryPoints": ["src/index.mjs"],
  "keyFiles": ["src/router.mjs"]
}
```

Unknown field는 버립니다. 이 파일로 runtime safety 값이나 proof policy를 바꿀 수 없습니다.

## Direct runtime API

MCP 없이 Node에서 직접 평가하거나 test double을 주입해야 하는 caller는 `exploreRepository` 또는 `ExplorerRuntime.explore`를 사용합니다.

```js
import {
  ExplorerRuntime,
  exploreRepository,
} from './src/explorer/runtime.mjs';

const controller = new AbortController();
const result = await exploreRepository(
  {
    task: 'Trace requireAuth definition and usages.',
    repo_root: process.cwd(),
    scope: ['src/**', 'tests/**'],
    hints: { symbols: ['requireAuth'] },
  },
  {
    abortSignal: controller.signal,
    onProgress: ({ progress, total, message }) => {
      console.error(`${progress}/${total} ${message}`);
    },
  },
);

const runtime = new ExplorerRuntime({ logger: console.error });
const second = await runtime.explore(
  { task: 'Find the route registration.', repo_root: process.cwd() },
  { abortSignal: controller.signal },
);
```

Direct 결과에는 평가·운영 진단이 포함될 수 있습니다. Parent에게 전달할 정상 계약은 MCP server가 projection한 schema v3이며, direct 진단 객체를 그대로 parent context에 복사하지 마세요.

## 내부 구조

```text
Parent agent
  -> one of six public MCP tools
    -> ExplorerRuntime
      -> planner + goal audit
      -> read-only RepoToolkit
      -> deterministic grounding checks
      -> isolated semantic verifier
      -> optional one-round evidence repair
      -> schema-v3 parent projection
```

Parent에는 low-level file 도구를 노출하지 않습니다. Explorer model만 `repo_list_dir`, `repo_find_files`, `repo_grep`, symbol/reference/read 도구와 scope-filtered read-only git 도구를 사용합니다.

자세한 구조는 [`DESIGN.md`](./DESIGN.md), 검증 절차는 [`TESTING.md`](./TESTING.md)를 참고하세요.

## 실행과 테스트

```bash
npm start
npm test
```

실제 Cerebras API smoke:

```bash
CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
```

Benchmark:

```bash
npm run benchmark
node scripts/run-benchmark.mjs \
  --suite ./benchmarks/adoption.json \
  --output ./benchmark-results.json
```

단위 test의 성공 기준은 `0 fail`입니다. Runtime/prompt 변경은 API key가 있으면 integration script까지 확인합니다.

## 제한 사항

- Symbol/reference 분류는 zero-dependency regex/syntax-lite 방식입니다. LSP나 tree-sitter 수준의 완전한 type·scope 분석을 주장하지 않습니다.
- 동적 dispatch, reflection, generated code, runtime plugin registration은 repository source만으로 완전히 입증하지 못할 수 있습니다.
- 배포 상태, 다른 computer의 process, cloud resource처럼 mutable external state는 repository explorer가 확인할 수 없습니다. 이런 요구는 `incomplete`와 최소 external verification으로 반환합니다.
- 대형 repository에서 고정 safety limit가 실제 증명 경로를 끊으면 관련 goal은 완료 처리하지 않습니다.

## 릴리즈

Version을 변경할 때는 `package.json`, `CHANGELOG.md`, README install ref, 모든 `integrations/*` install ref를 같은 change set에서 갱신하고 `npm test`를 통과시킵니다.
