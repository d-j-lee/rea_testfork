# Changelog

## 0.1.0 (2026-10-20)

첫 버전.

- 플러그인: 스킬 7개(investigate, design-review, verify, fix, setup, report, retro), 에이전트 3개(adversary, log-analyst, code-tracer), PreToolUse 가드, SessionStart 요약.
- CLI (stdlib, Python 3.11+): case·ev(원장, 등급 상한, 린트, 종료 게이트), log(probe/scan/query/timeline/diff), sql check, db query, bot validate/run, doc text, hook.
- 샌드박스: 일일 미션 보상 서버(경합·리셋 결함), 사건 로그·DB·CS 티켓 생성기, 기획서, 데이터 테이블, 봇 시나리오 3개.
- 테스트 63개(Python 3.11, 3.12, 3.13에서 통과), eval 케이스 1개.

### 측정 (Linux x64, Python 3.13, 이 버전에서 실행)
| 항목 | 결과 |
| --- | --- |
| `claude plugin validate --strict` (플러그인, 마켓플레이스) | 통과 |
| 상시 컨텍스트 비용 (`claude plugin details`) | ~1,200 토큰 |
| 로그 1,000,000줄(103MB) | scan 15.0초 · query 7.8초 · timeline 10.6초, 최대 RSS 22MB (최적화 전 30.3 / 15.6 / 19.3초) |
| PreToolUse 훅 지연 | 중앙값 67ms, p90 71ms (n=20, bash 런처 경유. 최적화 전 147ms) |
| 샌드박스 경합 시나리오 | 수정 전 10회 중 0회 통과(매번 2건 지급) → 수정 후 10회 모두 통과 (python·process 어댑터 둘 다) |
