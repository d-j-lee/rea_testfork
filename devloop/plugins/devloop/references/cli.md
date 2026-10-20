# devloop CLI 요약

아래 `devloop`은 스킬 본문에 적힌 실제 경로(`"<plugin>/scripts/devloop"`)로 바꿔 쓴다. Bash 호출 사이에 셸 변수가 유지되지 않으므로 매번 전체 경로를 쓴다.
공통: `--json`(구조화 출력, 명령 앞에 둔다: `devloop --json log scan …`). 종료코드 0 정상, 1 검사/실행 실패, 2 사용·설정 오류, 3 정책 거부(아무것도 실행 안 됨).

## 워크스페이스·설정
| 명령 | 용도 |
| --- | --- |
| `devloop init [--yes]` | `.devloop/` 생성 계획 출력(--yes로 적용, 기존 파일은 건드리지 않음) |
| `devloop init --user [--yes]` | `~/.devloop/config.toml`(라이브 마커 등 개인 공통 설정) |
| `devloop config` | 해석된 설정·환경·프로필·어댑터·경고 |

## 케이스·증거
| 명령 | 용도 |
| --- | --- |
| `case new <review\|verify\|bug\|issue> "제목" [--slug s] [--ref JIRA-1] [--spec 기획서]` | 케이스 생성(기획서는 해시로 고정) |
| `case list [--all]` · `case show ID` · `case check ID` | 목록·요약·린트 |
| `case status ID active\|waiting\|open [--note]` | 상태 변경(원장 기록) |
| `case ask ID "질문" --to 기획` · `case answer ID Q1 "답" --ref 출처 [--defer]` | 사람만 답할 수 있는 질문 |
| `case decide ID "결정" --by 이름` | 되돌리기 어려운 결정·합의 기록 |
| `case close ID --reason R [--of ID] [--force "이유"]` | 게이트 확인 후 종료 |
| `case stats` · `case purge --older-than 30 [--yes]` | 지표 · 종료 케이스 아티팩트 정리 |
| `ev add ID --kind K --claim "…" [--ref] [--grade] [--from E1,E2] [--attach f] [--supersedes E#] [--how]` | 증거 추가(상한 강제) |
| `ev run ID --claim "…" [--timeout s] -- <명령…>` | 명령 실행을 증거로(재현·테스트·빌드) |
| `ev list ID [--kind K]` | 증거 목록(인용 등급 표시) |

## 로그
입력: 파일·글롭·디렉터리·`-`(stdin) 또는 `--source 이름`(설정된 명령 원천, `--param k=v`).
필터: `--since/--until`(ISO, 오프셋 없으면 display_tz; `-2h` 같은 상대값), `--level WARN`, `--grep 정규식`,
`--where k=v|k!=v|k~re|k>n`(반복=AND), `--key 값`(단어 경계 일치, 반복=OR), `--template ID`.
| 명령 | 용도 |
| --- | --- |
| `log probe 파일…` | 인코딩·프로필 적합도·샘플 (프로필 작성용) |
| `log scan … [--top 20]` | 레벨 분포 + 메시지 템플릿 요약(가장 먼저) |
| `log query … [--limit 50 --offset 0 --context 2 --fields a,b]` | 레코드 조회(전체 건수 항상 표시) |
| `log timeline … --key <uid>` | 여러 소스를 UTC로 합친 순서 + 간격(Δms) + 편차 경고 |
| `log diff … --base-window A..B --target-window C..D` | 배포 전후 템플릿·레벨 변화(신규/소멸/증감) |
`--save CASE [--note 메모]`를 붙이면 결과가 아티팩트로 저장되고 확인 등급 증거가 된다.

## SQL·DB
| 명령 | 용도 |
| --- | --- |
| `sql check "SQL" [--dialect mssql\|mysql\|postgres\|sqlite]` | 읽기전용 분류(read/risky/write)와 사유 |
| `db query --env 이름 "SQL" [--param k=v] [--max-rows N] [--save CASE]` | 설정된 환경에 읽기전용 실행. `:name`은 리터럴로 바인딩 |
쓰기는 절대 실행하지 않는다. stage/live는 결과 행 상한(TOP/LIMIT/집계)이 필요하고, `--allow-unbounded`/`--allow-risky`는 가드가 사람에게 묻는다.

## 봇·문서·훅
| 명령 | 용도 |
| --- | --- |
| `bot validate 시나리오.json` | 형식 검사 |
| `bot run 시나리오.json [--env E] [--adapter A] [--var k=v] [--save CASE] [--verbose]` | 실행(티어 정책 적용, live 금지) |
| `doc text 파일 [--sheet 이름] [--max-rows N] [--notes]` | xlsx/docx/pptx/csv/txt 텍스트(위치 표기 포함) |
| `hook pretooluse\|sessionstart` | Claude Code 훅 진입점(직접 쓰지 않음) |
