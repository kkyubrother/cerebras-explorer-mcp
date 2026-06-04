# Feature Specification: repo-specific ignore 정책 강화

**Feature Branch**: `014-repo-specific-ignore`

**Created**: 2026-05-24

**Status**: Implemented

**Input**: User description: "extension-backlog #3 — 현재 `loadGitignoreRules`가 저장소 루트의 `.gitignore` 한 파일만 처리한다. nested `.gitignore`(서브디렉토리별 ignore)를 추가로 처리하고, `.cerebras-explorer.json`의 ignore 표면도 `extraIgnoreDirs`(이미 존재) 옆에 `extraIgnorePatterns`를 신설해 path glob 단위로도 ignore할 수 있게 한다. secret deny-list와 scope 검증은 항상 더 강한 우선순위를 유지한다."

## Clarifications

### Session 2026-05-24

- **Q: 어디까지 ignore 표면을 확장할지** → **A: nested `.gitignore` + `.cerebras-explorer.json`의 `extraIgnorePatterns` 두 가지.** `.npmignore`/`.dockerignore` 같은 인접 ignore는 자동 처리하지 않으며, 필요하면 사용자가 `extraIgnorePatterns`에 명시한다. 환경변수 토글은 추가하지 않는다 (spec 011 정책: envvar 표면 최소화).
- **Q: nested `.gitignore`의 의미 정확도** → **A: git의 정확한 의미(`!negation`, line precedence, 디렉토리 boundary 등)를 모두 재현하지 않는다.** 가장 흔한 케이스인 "서브디렉토리에서 발견된 `.gitignore`의 패턴은 그 서브디렉토리 prefix 아래에서만 매치"를 지원하면 충분하다. `!negation`은 본 spec 범위 밖이며 후속 spec에서 다룰 수 있다.
- **Q: 정책 우선순위** → **A: secret deny-list > scope > root `.gitignore` > nested `.gitignore` > `extraIgnoreDirs`/`extraIgnorePatterns` > `DEFAULT_IGNORE_DIRS`.** secret deny-list와 scope 검증은 항상 다른 어떤 ignore 규칙보다 강하다 (보안 경계 유지).
- **Q: 회귀 안전성** → **A: `.cerebras-explorer.json`이 없는 저장소나 nested `.gitignore`가 없는 저장소에서는 본 spec의 변경이 결과를 바꾸지 않는다.** 기존 단위 테스트와 benchmark는 그대로 PASS해야 한다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nested `.gitignore`로 모노레포 서브디렉토리 ignore 처리 (Priority: P1)

Parent agent가 모노레포(`packages/foo/`, `packages/bar/` 등 각자 `.gitignore`를 가진 구조)를 탐색할 때, 현재는 서브디렉토리 안의 `.gitignore`를 무시하므로 `packages/foo/build/`, `packages/bar/dist/` 같은 결과물 디렉토리가 traversal에 들어와 noise가 된다. 본 user story는 traversal 도중 발견한 nested `.gitignore`를 그 디렉토리 prefix 아래에서만 적용해 자연스러운 ignore 결과를 만든다.

**Why this priority**: 모노레포는 가장 흔한 케이스이며 ignore noise가 직접 evidence 품질을 떨어뜨린다. P1.

**Independent Test**: `packages/foo/.gitignore`에 `build/` 한 줄이 있는 fixture에 대해 `repo_list_dir({ dirPath: 'packages/foo' })`이 `build/`를 결과에 포함하지 않는다. 같은 fixture에서 `packages/bar/build/`는 (별도 `.gitignore`가 없으므로) 그대로 노출된다.

**Acceptance Scenarios**:

1. **Given** `packages/foo/.gitignore`에 `build/` 한 줄, `packages/foo/build/output.txt` 파일이 존재, **When** `RepoToolkit`이 traversal로 `packages/foo` 아래를 listing, **Then** `packages/foo/build/output.txt`는 결과에 포함되지 않는다.
2. **Given** 동일 fixture에서 root `.gitignore`에는 `build/`가 없는 상태, **When** `packages/bar/build/output.txt` 같이 다른 서브디렉토리의 같은 이름 디렉토리는 listing, **Then** 그 파일은 결과에 포함된다 (nested ignore는 자기 디렉토리 boundary 안에서만 적용).
3. **Given** root `.gitignore`에 `*.log` 한 줄과 `packages/foo/.gitignore`에 `build/` 한 줄이 함께 존재, **When** traversal이 끝나면, **Then** root 규칙과 nested 규칙이 모두 동시에 적용되어 어떤 디렉토리의 `*.log`든, 그리고 `packages/foo/build/`만이 제외된다.
4. **Given** `.gitignore`의 부정 규칙(`!keep-this`)이 포함된 nested 파일, **When** traversal이 동작하면, **Then** 부정 규칙은 본 spec 범위 밖이므로 무시되고 그 라인은 ignore 패턴으로 처리되지 않는다 (silent skip; warning은 추가하지 않는다).

---

### User Story 2 - `.cerebras-explorer.json`의 `extraIgnorePatterns`로 path glob 단위 ignore (Priority: P2)

Parent agent가 같은 저장소에서 반복적으로 노이즈가 되는 디렉토리·파일 패턴(`tmp/**`, `dist/**`, `**/*.snapshot.json` 등)을 한 번 명시하면 모든 후속 호출에서 자동 제외되게 하고 싶다. 현재는 `extraIgnoreDirs`로 디렉토리 *이름*만 등록할 수 있고, glob 패턴은 미지원이다. 본 user story는 `.cerebras-explorer.json`에 `extraIgnorePatterns` 키를 추가해 path glob 단위 ignore를 지원한다.

**Why this priority**: `extraIgnoreDirs`만으로는 표현하기 어려운 경우(특정 확장자, 깊이가 다른 디렉토리, 와일드카드 등)가 자주 발생한다. P2.

**Independent Test**: `.cerebras-explorer.json`에 `{ "extraIgnorePatterns": ["tmp/**", "**/*.snapshot.json"] }` 설정된 fixture에 대해 `repo_find_files({ pattern: '**/*' })`이 `tmp/anything`과 `path/to/foo.snapshot.json`을 결과에 포함하지 않는다. `tmp` 이름의 *파일*(예: `tmp.txt`)이나 `snapshot.json` 단독은 영향받지 않는다.

**Acceptance Scenarios**:

1. **Given** `.cerebras-explorer.json`에 `"extraIgnorePatterns": ["tmp/**"]`가 있는 fixture, **When** traversal이 `tmp/anything.txt`를 만나면, **Then** 해당 파일은 결과에 포함되지 않는다.
2. **Given** 같은 fixture에서 `tmp.txt` (디렉토리가 아니라 일반 파일), **When** traversal이 그 파일을 만나면, **Then** 결과에 포함된다 (`tmp/**` 패턴은 디렉토리 prefix 매치).
3. **Given** `"extraIgnorePatterns": ["**/*.snapshot.json"]` 설정, **When** 깊이 다른 위치의 `.snapshot.json` 파일이 발견되면, **Then** 모두 제외된다.
4. **Given** `extraIgnorePatterns`가 비어 있거나 키 자체가 없는 저장소, **When** 본 spec 변경 이후 traversal 결과를 보면, **Then** spec 변경 전과 정확히 동일하다 (backwards-compatible 기본값).
5. **Given** `extraIgnorePatterns`에 잘못된 정규식이 들어 있거나 string이 아닌 값이 들어 있다면, **When** config 로딩이 실행되면, **Then** 잘못된 entry는 silently drop되고 나머지 valid한 패턴은 그대로 적용된다 (config 로더의 기존 normalization 정책 계승).

---

### User Story 3 - secret deny-list와 scope 검증 우선순위 유지 (Priority: P1)

본 spec의 변경이 secret 경계나 scope 경계를 약하게 만들지 않아야 한다. 사용자가 `extraIgnorePatterns: ["!secrets/**"]` 같은 부정 표현을 넣더라도 secret deny-list는 traversal에서 항상 우선해 secret 경로를 제외하고, scope 경계도 마찬가지로 항상 강하다.

**Why this priority**: 보안 경계는 어떤 우선순위 변화 아래에서도 깨지면 안 된다. P1.

**Independent Test**: secret deny-list가 cover하는 경로(`.env`, `.ssh/**`, 등)에 대해 `extraIgnorePatterns`에 어떤 표현을 넣어도 traversal 결과에 그 경로가 포함되지 않는다. scope를 벗어난 경로는 nested `.gitignore`/`extraIgnorePatterns`와 무관하게 항상 거부된다.

**Acceptance Scenarios**:

1. **Given** `.env` 파일이 저장소 루트에 존재하고, `extraIgnorePatterns`가 비어 있는 상태, **When** traversal이 동작하면, **Then** `.env` 파일은 결과에 포함되지 않는다 (secret deny-list로 이미 차단).
2. **Given** 사용자가 `.cerebras-explorer.json`에 `"extraIgnorePatterns": ["!.env"]` 같은 부정 표현을 시도, **When** 본 spec 변경 이후 traversal이 동작하면, **Then** `.env`는 여전히 결과에 포함되지 않는다 (secret deny-list가 ignore 정책 위에서 강제 적용).
3. **Given** scope가 `["src/**"]`로 좁혀진 호출에서 `packages/foo/.gitignore`가 nested로 매치, **When** traversal이 동작하면, **Then** `packages/foo/` 자체가 scope 밖이라 자동으로 제외되며 nested ignore 매처는 호출되지 않는다 (성능 최적화).

---

### Edge Cases

- 같은 디렉토리 안에 root `.gitignore`와 nested `.gitignore`가 동일 패턴을 가질 때 → 두 matcher가 모두 활성화되지만 결과는 동일 (idempotent).
- nested `.gitignore`가 빈 파일이거나 모두 주석/공백인 경우 → matcher 추가하지 않고 silent skip.
- 매우 깊은 디렉토리 트리에서 모든 레벨에 `.gitignore`가 있을 때 → matcher 수가 디렉토리 깊이에 비례. 본 spec은 traversal 1회당 발견된 모든 nested `.gitignore`를 캐시(처음 traversal 시 build, 같은 RepoToolkit 인스턴스에서 재사용). 메모리 한도(예: 1000개 nested 파일)는 본 spec 범위 밖.
- `extraIgnorePatterns`에 `**` 패턴이 들어가 거의 모든 파일을 제외하면 → traversal 결과가 비어 evidence가 부족할 수 있다. 본 spec은 이 부작용을 검증하지 않으며 호출자 책임으로 둔다 (단, secret deny-list와 scope는 영향받지 않음).
- `.gitignore` 안의 부정 규칙(`!keep-this`)은 본 spec에서 silently dropped. 향후 spec이 이를 지원하기로 결정하면 별도 작업.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `RepoToolkit.initialize()`(또는 동등 위치)는 traversal 도중 발견하는 모든 `.gitignore` 파일을 nested matcher로 인식한다. 각 nested matcher는 자기 디렉토리 prefix 안의 path에 대해서만 매치한다.
- **FR-002**: nested `.gitignore` rule 파싱은 기존 root `.gitignore` 파싱과 동일한 함수(`loadGitignoreRules` 또는 그 재사용 가능한 helper)를 사용한다. 본 spec은 파서 자체를 변경하지 않는다.
- **FR-003**: nested `.gitignore`의 매처는 path가 그 nested 디렉토리 안에 있을 때만 호출된다. 매처 평가는 path가 nested 디렉토리 prefix와 같은 prefix를 갖는지 먼저 확인한 뒤, prefix를 제거한 상대 경로에 root와 동일한 glob 매칭을 적용한다.
- **FR-004**: `.gitignore`의 부정 규칙(`!`로 시작하는 라인)은 silently drop된다 (matcher에 포함하지 않음). 본 spec은 부정 규칙을 지원하지 않으며 별도 warning도 추가하지 않는다.
- **FR-005**: `.cerebras-explorer.json`은 `extraIgnorePatterns` 키를 추가로 인식한다. 값은 string array, 각 string은 path glob(`tmp/**`, `**/*.snapshot.json` 등). `extraIgnoreDirs`는 기존 동작을 그대로 유지한다.
- **FR-006**: `extraIgnorePatterns`의 각 패턴은 root `.gitignore` 매처와 동일한 glob 시맨틱으로 평가된다. path는 저장소 루트 기준 상대 경로 (POSIX 형식).
- **FR-007**: `normalizeProjectConfig`는 `extraIgnorePatterns`가 string array가 아닐 때 silently drop하고, array 내부의 non-string entry는 filter한다 (기존 `extraIgnoreDirs` 정책 계승).
- **FR-008**: `shouldIgnorePath`의 평가 순서는 다음과 같다 (위에서부터 평가):
  1. symlink → 항상 ignore
  2. secret deny-list 매치 → 항상 ignore
  3. `ignoreDirs`(`DEFAULT_IGNORE_DIRS` + `extraIgnoreDirs`)의 이름 매치 → ignore
  4. `DEFAULT_IGNORE_FILE_SUFFIXES` 매치 → ignore
  5. root `.gitignore` 매처 → ignore
  6. nested `.gitignore` 매처(해당 prefix 아래일 때) → ignore
  7. `extraIgnorePatterns` 매처 → ignore
  8. 위 어느 것도 매치하지 않으면 → keep
- **FR-009**: scope 검증(`_enforceScopedPath`)은 ignore 평가보다 더 강하다. scope 밖 path는 본 spec의 어떤 ignore 정책 변화와도 무관하게 항상 거부된다 (기존 동작 유지).
- **FR-010**: 본 spec의 변경은 `.gitignore`나 `.cerebras-explorer.json`이 없는 저장소에서 traversal 결과를 변화시키지 않는다 (backwards-compatible 기본값).
- **FR-011**: `tests/repo-tools.test.mjs`(또는 동등 위치)에 다음 단위 테스트를 추가한다: (a) nested `.gitignore`의 prefix-bounded 매치, (b) root + nested 동시 적용, (c) `extraIgnorePatterns`의 glob 매치, (d) secret deny-list 우선순위 유지, (e) `extraIgnorePatterns`가 비어 있을 때 backwards-compatible 결과.
- **FR-012**: README는 "현재 제한 사항"의 "`.gitignore`는 루트 파일만 단순 반영합니다" 문구를 갱신해 nested `.gitignore`와 `extraIgnorePatterns`를 명시한다. DESIGN.md의 보안/탐색 단락에 정책 우선순위 도식(FR-008)을 한 곳에 명시한다.
- **FR-013**: `npm test` 전체가 0 failures로 종료한다. 기존 단위 테스트와 benchmark가 그대로 통과한다.
- **FR-014**: `plan/extension-backlog.md` §3 항목 옆에 "→ spec 014로 완료"를 명시한다.

### Key Entities

- **Nested gitignore matcher**: `{ prefix: string (POSIX, 끝에 '/' 포함), match: (relPath) => boolean }` 형태. 매칭 함수는 `relPath.startsWith(prefix)`를 먼저 확인.
- **`extraIgnorePatterns` 항목**: 저장소 루트 기준 상대 path glob 문자열. root `.gitignore` 매처와 동일 시맨틱.

## Success Criteria *(mandatory)*

- **SC-001**: `npm test` 0 failures.
- **SC-002**: nested `.gitignore` 단위 테스트(FR-011.a/b)와 `extraIgnorePatterns` 단위 테스트(FR-011.c)가 모두 PASS.
- **SC-003**: secret deny-list 우선순위 가드 테스트(FR-011.d)가 PASS — `extraIgnorePatterns`나 nested `.gitignore`로 secret을 우회할 수 없음을 확인.
- **SC-004**: README의 "`.gitignore`는 루트 파일만 단순 반영합니다" 문구가 더 이상 등장하지 않고, nested `.gitignore` + `extraIgnorePatterns` 안내가 한 곳에 명시.
- **SC-005**: DESIGN.md에 정책 우선순위 도식(FR-008)이 명시 — `grep`으로 확인 가능.

## Assumptions

- 본 spec은 backwards-compatible이다. `.gitignore`/`.cerebras-explorer.json`이 없거나 nested 파일이 없는 저장소에서는 결과가 변하지 않는다.
- nested `.gitignore`의 부정 규칙은 본 spec 범위 밖이다. 후속 spec에서 결정한다.
- 본 spec은 secret deny-list/scope 경계를 강화하지도 약화하지도 않는다. 본 변경의 어떤 옵션도 secret/scope를 우회할 수 없다.
- 본 spec은 P1/P0 작업을 차단하지 않는다 (사용성 개선이며 backwards-compatible).
- minor bump는 추가하지 않는다 (사용자가 `.cerebras-explorer.json`을 수정하지 않으면 동작 변화 없음). release notes는 다음 release에 묶어 처리한다.
