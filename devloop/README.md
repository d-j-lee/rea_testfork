# devloop

게임 서버 컨텐츠 개발의 **설계검토 · 기능검증 · 버그/라이브 이슈 조사 · 수정**을 Claude Code와 함께 끝까지 굴리는 플러그인입니다.
판단은 스킬과 에이전트가 맡고, 결정적인 작업(로그 포렌식·읽기전용 DB·봇 시나리오·증거 원장·위험 명령 가드)은 표준 라이브러리 Python CLI가 맡습니다.

```
요청 ─▶ /devloop:investigate · design-review · verify · fix ─▶ 케이스(case.md + 증거 원장) ─▶ 게이트 통과 후 종료 ─▶ retro로 팀 지식 반영
                 │                                     ▲
                 └── devloop CLI: log · db · bot · doc · ev ──┘   PreToolUse 가드: live/stage 쓰기 차단·확인
```

## 무엇이 달라지나

| 기존 | devloop |
| --- | --- |
| 로그 수십만 줄을 눈으로 훑는다 | `log scan`이 템플릿 몇십 개로 요약하고, `diff`로 배포 전후 변화를, `timeline`으로 사용자별 Δms 순서를 본다 (UTF-8·CP949·UTF-16·gzip·KST 혼재 처리) |
| AI 결론이 사실인지 추정인지 모른다 | 확인/도출/추론/미확인 등급을 매기고, 출처가 등급 상한을 정한다. 등급을 부풀리면 `case check`가 오류로 잡는다 |
| 원인은 "아마 이것"으로 끝난다 | 원인·효과는 재현 실행 증거가 있어야 *도출*이 되고, 버그 종료는 같은 재현의 red→green이 필요하다 |
| 봇 테스트는 작성 비용이 크다 | 선언형 JSON 시나리오(병렬·반복 분포·DB/로그 단언)와 기존 봇을 감싸는 JSON-lines 어댑터 |
| AI가 운영 DB에 위험한 명령을 낼 수 있다 | 환경 티어 마커와 SQL/Redis/HTTP 분류로 live 쓰기를 거부하고, 읽기는 사람에게 묻는다. 정식 경로는 `db query`(읽기전용·결과 상한·마스킹) |
| 세션이 끊기면 조사 맥락이 사라진다 | 케이스 파일과 원장이 남고, 다음 세션 시작 때 열린 케이스를 요약해 주입한다 |

## 시작하기

```bash
# 1) 플러그인 설치 (이 저장소를 마켓플레이스로 추가)
/plugin marketplace add <이 저장소 경로 또는 git URL>
/plugin install devloop@devloop-tools

# 2) 팀 환경 연결 (Claude Code에서)
/devloop:setup
```

요구사항: Python 3.11+, bash(Windows는 Git for Windows의 Git Bash). 외부 패키지는 필요 없습니다.
자세한 도입 절차·설정·권한·Windows 주의점은 [docs/adoption.md](docs/adoption.md)에 있습니다.

## 바로 체험: 샌드박스

회사 환경 없이 전체 루프를 체험할 수 있는 축소판 라이브 서비스가 [examples/sandbox](examples/sandbox/README.md)에 있습니다.
일일 미션 보상 서버에 결함 두 개(수령 경합, KST 기준 리셋)를 심었고, 사건 로그·DB 스냅샷·CS 티켓·기획서·데이터 테이블을 함께 제공합니다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `plugins/devloop/skills/` | `investigate` `design-review` `verify` `fix` (자동 호출) · `setup` `report` `retro` (직접 호출) |
| `plugins/devloop/agents/` | `adversary`(적대적 교차검증) · `log-analyst`(로그 분석 격리) · `code-tracer`(코드 흐름 추적) |
| `plugins/devloop/references/` | 증거 규칙, CLI 요약, 게임 서버 리스크 체크리스트, 조사 플레이북, 검증·시나리오 설계, 보고 원칙 |
| `plugins/devloop/hooks/` | PreToolUse 가드, SessionStart 케이스 요약 |
| `plugins/devloop/lib/devloop/` | CLI 구현 (stdlib only) |
| `plugins/devloop/evals/` | `claude plugin eval` 회귀 케이스 |
| `docs/` | [방법론](docs/methodology.md) · [도입](docs/adoption.md) · [아키텍처](docs/architecture.md) · [결정 기록](docs/decisions.md) |
| `tests/` | 단위·통합·E2E 테스트 (`python3 -m unittest discover -s tests -t tests`) |

## 검증 현황

변경 이력과 측정 기록은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.
