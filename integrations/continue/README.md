# Continue.dev 연결

VS Code / JetBrains의 [Continue](https://continue.dev) 확장에서 `cerebras-explorer-mcp`를 사용하는 방법입니다.

## 설정 파일 위치

- 메인 설정: `~/.continue/config.yaml` 의 `mcpServers` 섹션에 항목 추가
- 또는 독립 파일: `~/.continue/mcpServers/cerebras-explorer.yaml`

> Continue는 **MCP 도구를 Agent 모드에서만** 노출합니다. Chat 모드에서는 도구가 보이지 않으니 모드를 확인하세요.

## 설정 추가

[`config.yaml.example`](./config.yaml.example) 의 `mcpServers` 블록을 본인 `~/.continue/config.yaml` 의 `mcpServers` 리스트에 병합합니다.

```yaml
mcpServers:
  - name: cerebras-explorer
    type: stdio
    command: npx
    args:
      - "-y"
      - "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"
    env:
      CEREBRAS_API_KEY: ${{ secrets.CEREBRAS_API_KEY }}
```

`${{ secrets.CEREBRAS_API_KEY }}` 는 Continue의 **Secrets** 기능에서 동일한 이름의 시크릿을 정의해두는 방식을 가정합니다. 단순히 평문 값을 쓰려면 `CEREBRAS_API_KEY: "..."` 로 적어도 됩니다.

## 버전 핀

```yaml
args:
  - "-y"
  - "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"
```

## 검증

Continue를 재시작 후 Agent 모드로 전환하고, 기본 도구 목록(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore_repo`, `explore`)이 보이는지 확인합니다.

공식 문서: <https://docs.continue.dev/customize/deep-dives/mcp>
