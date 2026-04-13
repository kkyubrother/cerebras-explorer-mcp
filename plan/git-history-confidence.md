# Git History Confidence Fix Plan

Last updated: 2026-04-08

## Problem

git 히스토리 관련 탐색에서 `confidence` / `confidenceLevel`이 구조적으로 낮아지는 경향이 있다.
현재 구현은 git 도구를 실제로 호출해도, 그 결과가 evidence grounding 체계에 제대로 편입되지 못한다.

대표 증상:

- `git-guided`, `blame-guided` 질문에서 모델 답변은 타당해도 `confidence`가 `low`로 내려가기 쉽다.
- `recentActivity`는 생성되지만, confidence를 지지하는 grounded evidence는 부족하거나 비어 있게 된다.
- 일부 경우 모델이 git evidence를 제출해도 런타임에서 드롭되어 `evidenceDropped > 0` 패널티가 적용된다.

## Root Cause Summary

### 1. Observed range 수집이 file-read 중심으로만 설계됨

현재 `observedRanges`에는 아래 결과만 기록된다.

- `repo_read_file`
- `repo_grep`

반면 아래 git 도구 결과는 confidence grounding에 직접 연결되지 않는다.

- `repo_git_log`
- `repo_git_blame`
- `repo_git_diff`
- `repo_git_show`

결과적으로 git 도구를 통해 확인한 사실이 있어도, evidence filtering 단계에서 "inspect된 라인 범위와 불일치"로 드롭될 수 있다.

### 2. Evidence schema가 git 근거 표현에 부적합함

현재 evidence는 사실상 다음 형태만 표현할 수 있다.

```json
{
  "path": "relative/path",
  "startLine": 1,
  "endLine": 10,
  "why": "reason"
}
```

이 구조는 file-range evidence에는 적합하지만 아래 타입에는 맞지 않는다.

- commit 자체가 근거인 경우
- diff hunk 자체가 근거인 경우
- blame line / author metadata가 근거인 경우

즉, git evidence를 모델이 정직하게 내려고 해도 schema가 file-range로 강제하고 있어 표현력이 부족하다.

### 3. Confidence penalty가 unsupported evidence와 hallucinated evidence를 구분하지 않음

현재 로직은 evidence가 grounding 단계에서 탈락하면 일괄적으로 불이익을 준다.

- `evidenceDropped > 0`이면 `-0.30`
- grounded evidence가 0개면 score를 `0.1`로 강제
- evidence drop이 발생하면 최종 `confidence`를 `low`로 내림

하지만 git 질문에서는 "근거가 나빴다"기보다 "근거 타입이 현재 grounding 체계에서 지원되지 않는다"가 더 정확하다.

### 4. Prompt와 runtime 계약이 어긋남

프롬프트는 `git-guided`, `blame-guided` 전략을 적극 권장하지만, final answer에서는 "이미 inspected 된 파일/라인 범위에 grounding하라"고 요구한다.
이 계약은 git metadata 중심 질문에 불리하게 작동한다.

### 5. 테스트 공백

현재 git 관련 테스트는 주로 아래만 확인한다.

- `repo_git_log` 호출 시 `recentActivity`가 생성되는가
- crash 없이 결과가 반환되는가

아래 케이스는 아직 회귀 테스트로 보호되지 않는다.

- git evidence가 유지되는가
- git-guided 결과가 불필요하게 `low`로 떨어지지 않는가
- blame/diff/show 기반 evidence가 grounding되는가

## Goals

### Primary

- git 기반 탐색의 신뢰도 판정이 실제 근거 품질을 반영하도록 수정
- git evidence가 구조적으로 드롭되지 않도록 grounding 체계를 확장
- unsupported evidence type 때문에 발생하는 인위적 low confidence를 제거

### Secondary

- prompt, schema, runtime 간 계약을 일관되게 정리
- git-guided / blame-guided 회귀 테스트를 추가

## Proposed Plan

## Phase 1. Fast-path stabilization ✅ 완료 (2026-04-13)

목표: 큰 schema 변경 없이도 현재의 과도한 low confidence를 먼저 완화한다.

작업:

- [x] `repo_git_blame` 결과의 line 범위를 `observedRanges`에 기록 (`source='blame'`)
- [x] `repo_git_diff` / `repo_git_show` 결과에서 diff hunk를 파싱해 changed line range를 `observedRanges`에 기록 (`source='diff_hunk'`)
- [x] `checkEvidenceGrounding`에서 `diff_hunk` sourced range를 exact로 승격 (evidence가 hunk 내에 완전히 포함될 때)
- [x] `checkEvidenceGrounding`에서 `blame` sourced range를 exact로 승격 (≤ 3줄 evidence)
- [x] `repo_git_log`만 사용된 경우 evidence drop 패널티를 절반으로 완화 (0.08 → 0.04/item)
- [x] `repo_git_blame`/`repo_git_diff`/`repo_git_show` 사용 시 `+0.05` 보너스 추가

기대 효과:

- blame/diff/show 질문에서 file-range evidence가 더 자주 grounded 됨
- 모델이 이미 충분히 읽은 patch를 근거로 제시했을 때 low confidence 강등이 줄어듦

한계:

- commit-level evidence는 여전히 file-range 중심 schema에 억지로 맞춰야 함
- `repo_git_log` 단독 질문에는 근본 해결이 아님

## Phase 2. Evidence schema 확장

목표: git evidence를 first-class 타입으로 지원한다.

제안 스키마:

```json
{
  "kind": "file_range | git_commit | git_diff_hunk | git_blame_line",
  "path": "optional relative path",
  "startLine": 10,
  "endLine": 18,
  "commit": "abc1234",
  "author": "optional",
  "why": "reason"
}
```

작업:

- `EXPLORE_RESULT_JSON_SCHEMA` 확장
- `normalizeExploreResult()`가 legacy file-range evidence와 신규 git evidence를 모두 수용하도록 수정
- runtime에 `observedCommits`, `observedGitHunks`, `observedBlameLines` 같은 관측 구조 추가
- evidence grounding을 kind별로 분기

원칙:

- 기존 `path/startLine/endLine/why` 포맷은 additive하게 유지
- 기존 클라이언트가 깨지지 않도록 backward compatibility 유지

## Phase 3. Confidence scoring 분리

목표: unsupported evidence type와 실제 부정확한 evidence를 구분한다.

작업:

- `evidenceDropped`를 하나의 숫자로만 다루지 말고 사유를 분리
- 예시:
  - `droppedUnsupported`
  - `droppedUngrounded`
  - `droppedMalformed`
- 패널티를 차등 적용
  - unsupported evidence type: 낮은 패널티 또는 패널티 없음
  - malformed / fabricated evidence: 현재 수준 또는 더 강한 패널티
- git metadata 기반 질문에서는 `recentActivity`, `gitLogCalls`, `gitDiffCalls`, `gitShowCalls`, `gitBlameCalls`를 confidence factor에 반영

기대 효과:

- "근거 체계 한계"와 "실제 신뢰도 부족"이 분리됨
- low confidence가 더 설명 가능해짐

## Phase 4. Prompt contract 정리

목표: 모델이 runtime이 받아들일 수 있는 evidence를 내도록 유도한다.

작업:

- `git-guided`, `blame-guided` 전략 안내에 git evidence 타입을 명시
- finalization prompt를 아래 방향으로 조정
  - file-range evidence는 inspected line range에 grounding
  - git evidence는 inspected git result 또는 observed commit/hunk/blame metadata에 grounding
- 필요 시 모델에게 "git result만으로 불충분하면 해당 파일을 추가로 읽어 file-range evidence를 보강하라"고 지시

## Phase 5. Tests and benchmark coverage

목표: 같은 문제가 다시 생겨도 바로 잡히도록 회귀 보호를 추가한다.

추가 테스트:

- `repo_git_blame` 기반 evidence가 retained 되는지 확인
- `repo_git_diff` / `repo_git_show` 기반 evidence가 grounded 되는지 확인
- `repo_git_log` 중심 질문에서 evidence가 비어 있어도 부당하게 `low`로 강등되지 않는지 확인
- 신규 git evidence kind가 normalize / validate / score 단계에서 올바르게 처리되는지 확인

벤치마크 추가:

- `summarize_changes` 결과에서 `recent_commit_messages`와 confidence level을 함께 평가
- blame-guided 질문에 대해 grounded evidence count와 confidence level을 확인

## Implementation Order

1. Phase 1 fast-path stabilization
2. Phase 5 테스트 추가
3. Phase 2 schema 확장
4. Phase 3 confidence scoring 분리
5. Phase 4 prompt 정리
6. benchmark 보강

이 순서를 택하는 이유:

- 먼저 false low confidence를 줄이는 완화책이 필요하다.
- 그 다음 테스트를 깔아야 이후 schema/score 변경이 안전하다.
- schema와 scoring 변경은 영향 범위가 크므로 테스트 기반 위에서 진행하는 편이 낫다.

## File Touch Targets

- `src/explorer/runtime.mjs`
- `src/explorer/schemas.mjs`
- `src/explorer/repo-tools.mjs`
- `src/explorer/prompt.mjs`
- `tests/runtime.mock.test.mjs`
- `tests/benchmark-evaluator.test.mjs`
- `benchmarks/core.json`
- 필요 시 `README.md`

## Risks

- evidence schema 확장 시 기존 consumer가 새 필드를 예상하지 못할 수 있음
- diff hunk line parsing은 rename/binary patch/combined diff 같은 edge case를 신중히 다뤄야 함
- confidence 규칙을 너무 완화하면 실제로 근거가 약한 답변이 과대평가될 수 있음

## Success Criteria

- git-guided / blame-guided 질문이 구조적 이유만으로 `low`에 고정되지 않는다
- git evidence가 drop되는 이유가 결과에 설명 가능하게 나타난다
- 새로운 테스트가 현재 버그를 재현하고, 수정 후 통과한다
- 기존 file-range 중심 탐색의 confidence 동작은 유지된다

## Out of Scope

- tree-sitter 기반 semantic diff / blame 해석
- PR 단위 외부 플랫폼 연동
- 장기적으로 완전한 provenance graph 구축
