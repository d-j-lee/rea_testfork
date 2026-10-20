# 도입 가이드

회사 환경에 devloop를 붙이는 절차다. 대부분은 `/devloop:setup`이 인터뷰하며 대신 해 주지만,
**사람만 줄 수 있는 입력**(환경·마커·계정·정책)과 **사람이 승인할 변경**(설정 파일, CLAUDE.md, 권한)이 있다.

## 1. 요구사항

| 항목 | 내용 |
| --- | --- |
| Claude Code | 플러그인을 지원하는 버전. 0.1.0은 2.1.304에서 `claude plugin validate --strict`로 검증 |
| Python | 3.11 이상 (설정 파일 TOML 파싱에 `tomllib` 사용). 외부 패키지 불필요 |
| bash | 런처와 훅이 bash로 동작. Windows는 Git for Windows의 Git Bash |
| 선택 | 팀 DB 클라이언트(sqlcmd/mysql/psql 등), 봇 프레임워크, IANA 시간대가 필요하면 Windows에서 `tzdata` 패키지 |

Python 실행 파일은 런처가 `DEVLOOP_PYTHON` → `python3` → `python` → `py -3` 순으로 찾는다. Windows의 Microsoft Store 별칭(`python3`)처럼 버전 확인에 실패하는 실행 파일은 건너뛴다.
찾지 못하면 PreToolUse 가드는 **모든 Bash 호출을 ask로 바꾼다**. 가드가 없는 상태로 조용히 통과시키지 않는다.

## 2. 설치

### 플러그인 (권장)
```text
/plugin marketplace add <devloop 저장소 git URL 또는 로컬 경로>
/plugin install devloop@devloop-tools
```
사내 git에 올려 팀이 같은 마켓플레이스를 추가하면 버전과 업데이트를 함께 관리할 수 있다.
조직 정책으로 마켓플레이스가 막혀 있으면 다음 둘 중 하나를 쓴다.
- 개인 PC: `plugins/devloop` 디렉터리를 `~/.claude/skills/devloop/`에 복사한다. 그 위치의 `.claude-plugin/`이 있는 플러그인은 `devloop@skills-dir`로 자동 로드된다(`claude plugin init` 동작).
- 일회성 확인: `claude --plugin-dir <경로>/plugins/devloop`

`.claude/`에 스킬 파일만 복사하는 방식은 `${CLAUDE_PLUGIN_ROOT}`가 풀리지 않으므로 권장하지 않는다.

### 워크스페이스
작업할 저장소(또는 여러 저장소를 묶는 상위 폴더) 루트에서 다음을 실행한다.
```bash
"<plugin>/scripts/devloop" init          # 계획만 출력
"<plugin>/scripts/devloop" init --yes    # 적용: .devloop/{config.toml,.gitignore,knowledge/,scenarios/,cases/}
"<plugin>/scripts/devloop" init --user --yes   # ~/.devloop/config.toml: 라이브 마커를 모든 저장소에 적용
```
`config.toml`, `knowledge/`, `scenarios/`는 커밋해서 팀이 공유한다. `cases/`는 기본으로 커밋하지 않는다(`.devloop/.gitignore`).

## 3. 설정 (`.devloop/config.toml`)

전체 예시와 주석은 `plugins/devloop/lib/devloop/templates/config.toml`에 있다. 핵심은 네 가지다.

1. **환경과 마커.** `[env.<이름>] tier = "live", markers = ["live-db", "10.9."]`. 데이터 플레인 명령(DB 클라이언트, redis-cli, 쓰기 HTTP, ssh/kubectl)에서 마커가 보이면 그 티어로 판정하고, 여러 개가 걸리면 가장 엄격한 티어를 쓴다.
2. **로그 프로필.** 이름 붙은 그룹(`ts`, `level`, `msg`)을 가진 정규식, `ts_format`, `tz`(로그 시간대). 지역 서버별 시간대는 `tz_map`으로 지정한다. 중앙 수집 로그는 `[log.sources.<이름>] command = [...]`로 표준출력 스트림을 받는다.
3. **읽기전용 DB.** `[env.<이름>.db]`에 `driver = "command"`, `command = [..., "{sql}"]`(argv 형식, 셸 없음)을 둔다. 비밀은 `${ENV}`로 넣는다. `output = "tsv"`이면 `mask_columns`로 컬럼을 가릴 수 있다.
4. **봇 어댑터.** `type = "process"`(기존 봇을 JSON-lines로 감쌈) 또는 `type = "python"`. 계약은 `plugins/devloop/references/test-design.md`에 있다.

### 기본 티어 정책 (가드와 CLI가 함께 적용)

| 티어 | DB 읽기 | DB 쓰기 | HTTP 쓰기 | 원격 실행 | `db query` | 결과 상한 필수 | 봇 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| local | – | – | – | – | – | 아니오 | 허용 |
| dev / qa | – | ask | – | – | – | 아니오 | 허용 |
| stage | ask | **deny** | ask | ask | – | 예 | 거부 |
| live | ask | **deny** | **deny** | ask | ask | 예 | 거부 |
| unknown(마커 없음) | – | ask | – | – | – | 아니오 | 거부 |

`–`는 가드가 아무 결정도 내리지 않는다는 뜻이고, 그러면 사용자의 평소 권한 설정이 그대로 적용된다. 가드는 **deny/ask만 내고 allow는 내지 않는다.**
`[tiers.<티어>]`로 덮어쓸 수 있고, `ask_patterns`/`deny_patterns`(예: GM 툴 지급 명령)도 추가할 수 있다.

## 4. 연결과 권한

- **CLAUDE.md 포인터 (제안).** 저장소 CLAUDE.md에 3~5줄을 넣는다.
  예: "조사·검증·설계검토는 devloop 스킬을 쓴다. 결론에는 확인/도출/추론/미확인 등급을 단다. 라이브 쓰기는 하지 않는다. 정식 DB 경로는 `devloop db query`다."
- **권한.** `.claude/settings.json`의 `permissions.allow`에 `"Bash(*/scripts/devloop *)"`를 넣으면 CLI 호출마다 묻지 않는다. 가드의 deny/ask는 이 설정과 상관없이 적용된다.
- **기존 MCP DB 도구**를 쓴다면 `[guard] mcp_sql_tools = [{ tool = "mcp__x__query", field = "sql", tier = "qa" }]`로 SQL 분류를 걸 수 있다.
- **설정 병합 규칙.**
  - `[guard]`의 목록은 기본값에 *추가*된다.
  - 개인 설정(`~/.devloop`)과 워크스페이스 설정이 함께 있을 때, 마커는 합집합이고 티어 결정은 더 엄격한 쪽을 쓴다. 저장소 설정으로 개인의 live 보호를 약하게 만들 수 없다.
- **비밀값.** 명령에 비밀번호·토큰이 들어갈 수 있으면 `[secrets] env = [...]`에 그 환경변수 이름을 적는다. 기록 전에 `${이름}`으로 가려진다.

## 5. 안전 모델의 한계 (반드시 읽기)

- 가드는 실수를 막는 장치이지 보안 경계가 아니다. 명령 문자열을 분석하므로 스크립트 파일 안의 명령, DSN 별칭, 마커 없는 호스트는 볼 수 없다.
  해석이 불확실한 경우는 ask로 처리한다: stage/live 마커가 붙었는데 분류할 수 없는 명령(예: `python fix.py --host live-db`, `bash -c`·`ssh`·`$(...)` 안의 명령).
  `kubectl get/logs/describe` 같은 읽기 동사는 묻지 않는다.
  **live/stage DB는 읽기전용 계정과 복제본을 쓴다.** 이것이 실제 경계다.
- SQL 분류기는 주석·문자열·다중 문장·T-SQL `GO`·MySQL 실행 주석을 다루고, 방언을 모르면 가장 엄격한 해석을 택한다.
  다만 사용자 정의 함수의 부수효과는 알 수 없다.
- 정책 설정 파일(`.devloop/config.toml`, `~/.devloop/config.toml`)을 바꾸면 가드를 약하게 만들 수 있다. 설정 변경은 코드 리뷰 대상으로 다룬다.
- 개인정보: 도구 출력은 Claude Code 대화 기록(`~/.claude/projects`)과 API로 전달된다. live 조회에는 `mask_columns`를 쓴다.
  케이스 아티팩트는 `case purge --older-than <일>`로 정리한다. SteamID·IP·HWID는 개인정보로 취급한다.

## 6. 단계적 도입 (권장)

| 단계 | 범위 | 성공 기준 |
| --- | --- | --- |
| 1주 | `setup` + 로그 프로필 + 라이브 마커. 조사만(`investigate`) | 실제 이슈 2~3건에서 scan/diff/timeline이 원인 범위를 줄였는가. 가드 오탐(불필요한 ask)이 적은가 |
| 2~3주 | 읽기전용 DB 경로 + 봇 어댑터 1개 + `verify` | 한 기능의 REQ×CHK를 끝까지 채웠는가. 시나리오가 회귀 자산으로 남았는가 |
| 4주~ | `design-review`, `fix` 게이트, `retro` 주기화 | 강제 종료율, 종료 시간, 재발(같은 함정) 감소 |

## 7. 문제 해결

| 증상 | 확인 |
| --- | --- |
| 모든 Bash 호출에서 "guard unavailable" ask가 뜬다 | Python 3.11+를 찾지 못했다. `DEVLOOP_PYTHON`을 지정한다 |
| 로그 시각이 9시간 어긋난다 | 프로필 `tz`. `log probe`의 시간대 가정과 출력의 `assumed_tz`를 본다 |
| 한글이 깨진다 | `log scan` 출력의 decoding(`cp949 xN`, `replaced xN`). 필요하면 프로필에 `encoding`을 명시한다 |
| sqlcmd 출력 한글 깨짐 | `-u`(유니코드 출력) 또는 env db `output_encoding` |
| 원하는 쓰기를 가드가 막는다 | 의도된 동작이다. 사람이 직접 실행하거나 해당 티어 정책을 팀이 합의해 바꾼다 |
| 개발용 sqlite·로컬 DB에서 ask가 뜬다 | 마커가 없는 DB 쓰기는 unknown 티어(ask)다. 로컬 env를 마커와 함께 등록한다 |
