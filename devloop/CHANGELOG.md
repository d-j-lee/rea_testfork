# Changelog

## 0.1.0 (2026-10-20)

첫 버전.

- 플러그인: 스킬 7개(investigate, design-review, verify, fix, setup, report, retro), 에이전트 3개(adversary, log-analyst, code-tracer), PreToolUse 가드, SessionStart 요약.
- CLI (stdlib, Python 3.11+): case·ev(원장, 등급 상한, 린트, 종료 게이트), log(probe/scan/query/timeline/diff), sql check, db query, bot validate/run, doc text, hook.
- 샌드박스: 일일 미션 보상 서버(경합·리셋 결함), 사건 로그·DB·CS 티켓 생성기, 기획서, 데이터 테이블, 봇 시나리오 3개.
- 테스트 82개(Python 3.11, 3.12, 3.13에서 통과), eval 케이스 1개(채점기 4개).
- 독립 교차검증 2회 반영. 설계 단계에서 fail-open 가드, 등급 게이밍, 로그 원천 문제를 고쳤다. 구현 단계에서 재현된 High 6건과 Medium 7건을 고쳤다. 주요 수정은 다음과 같다.
  - `ev run` 인자 순서, review 첨부 누락
  - 게이트 우회(다른 명령의 red→green), 명령 원천의 stderr 교착, TSV 마스킹 누출
  - 봇 env 재지정, 원장 동시 저장 ID 중복, 비밀값 기록

### 측정 (Linux x64, Python 3.13, 이 버전에서 실행)
| 항목 | 결과 |
| --- | --- |
| `claude plugin validate --strict` (플러그인, 마켓플레이스) | 통과 |
| 상시 컨텍스트 비용 (`claude plugin details`) | ~1,200 토큰 |
| 로그 1,000,000줄(103MB) | scan 16.2초 · query `--where uid=` 10.6초 · timeline 10.0초, 최대 RSS 22MB (최적화 전 scan 30.3초) |
| PreToolUse 훅 지연 | 중앙값 66ms, p90 77ms (n=20, bash 런처 경유. 최적화 전 147ms) |
| 샌드박스 경합 시나리오 | 수정 전 10회 중 0회 통과(매번 2건 지급) → 수정 후 10회 모두 통과 (python·process 어댑터 둘 다) |
| 실제 Claude Code 통합 (2.1.304, haiku, `claude -p --plugin-dir`) | live 마커 DB에 대한 `sqlite3 … DELETE`를 PreToolUse 가드가 거부, 데이터 변경 없음(행 수 1 유지) |
| `claude plugin eval` investigate-dup-reward (2회 × 2 arm, $1.05) | 플러그인 있음 2/2, 없음 2/2 통과 → **점수 차이 0**. 플러그인 arm은 스킬이 자동 호출되고 `log`·`db query`를 사용했으며 live 결과 상한 거부 후 쿼리를 고쳐 재시도. 턴 수 14~15 대 10~13 |

### eval에서 배운 것
- 작은 자기완결형 과제(로그 8천 줄, DB 1개)에서는 기본 모델도 같은 결론에 도달한다. 플러그인의 이점은 이 eval로 측정되지 않았다. 차이를 측정하려면 더 어려운 케이스가 필요하다: 컨텍스트를 넘는 로그, live 쓰기 유혹(가드), 세션을 넘는 케이스 지속, 팀 지식 활용.
- 초기 실행에서 플러그인 arm이 중복 지급 초과분을 2배로 계산했다(37,600 vs 18,800, n=1). 조사 플레이북에 "초과분 = Σ(n−1)×금액, 두 경로로 교차 계산"을 추가한 뒤 3회 연속 정답이었다(인과는 n이 작아 미확인).
- 이 컨테이너의 eval 샌드박스(bwrap)는 작업공간과 TMPDIR을 읽기 전용으로 만들어 케이스 생성·`--save`가 실패했다. `tool_used` 채점기가 트레이스에 있는 실패한 Bash 호출을 0회로 집계해서(관찰), trace 정규식 채점기로 바꿨다. 일반 개발 PC에서의 전체 흐름(케이스 기록 포함) eval은 미측정이다.
