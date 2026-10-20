# devloop 샌드박스: 일일 미션 보상 서버

devloop의 루프(설계검토·검증·조사·수정)를 **회사 환경 없이** 실측하는 축소판 라이브 서비스입니다.
도구 회귀 테스트, 온보딩 데모, `claude plugin eval` 픽스처를 겸합니다.

| 구성 | 내용 |
| --- | --- |
| `server/game.py` | SQLite 기반 미션·보상 서버. 결함 2개 내장(수령 경합, KST 기준 리셋) |
| `server/adapter.py` | devloop 봇 어댑터(`type = "python"`) — 팀 어댑터의 모양 |
| `server/bot_process.py` | JSON-lines 봇 호스트(`type = "process"`) — 다른 언어 봇을 감싸는 계약 |
| `spec/daily-mission-spec.md` | 설계검토 연습용 기획서(의도적 모호점 포함) |
| `spec/make_table.py` | 데이터 테이블 `mission_table.xlsx` 생성(의도적 데이터 오류 포함) |
| `incident/generate.py` | "라이브 사건" 로그(UTF-8/CP949/gzip, KST)·DB 스냅샷·CS 티켓 생성 |
| `.devloop/` | 샌드박스 워크스페이스 설정과 봇 시나리오 |

`SANDBOX_FIX=claim,reset` 환경변수는 수정된 동작을 켭니다(코드 수정 없이 red→green 데모용).
실제 연습에서는 Claude가 `server/game.py`를 직접 고치게 하세요.

## 준비

```bash
cd examples/sandbox
python3 incident/generate.py      # run/incident/ 생성
python3 spec/make_table.py        # spec/mission_table.xlsx 생성
DL=../../plugins/devloop/scripts/devloop   # 플러그인 설치 후에는 스킬이 경로를 알려준다
```

## 연습 과제 (Claude Code에서)

1. **이슈 조사**: "`run/incident/cs_tickets.md`의 CS-88120, CS-88140을 조사해줘." → `/devloop:investigate`
2. **설계검토**: "`spec/daily-mission-spec.md`와 `spec/mission_table.xlsx`를 서버 관점에서 검토해줘." → `/devloop:design-review`
3. **기능검증**: "기획서 REQ 기준으로 샌드박스 서버를 검증해줘." → `/devloop:verify`
4. **수정**: 조사 결과로 `server/game.py`를 고치고 red→green 회귀를 남긴 뒤 케이스를 닫는다. → `/devloop:fix`

## 사람이 직접 따라 하는 최소 흐름

```bash
$DL log scan 'run/incident/game-*'                                   # 템플릿 요약
$DL log diff 'run/incident/game-*' --base-window 2026-10-20T00:00Z..2026-10-20T06:00Z \
    --target-window 2026-10-20T06:00Z..2026-10-20T12:00Z            # 배포 전후 비교
$DL case new issue "보상 중복 지급" --slug dup-reward --ref CS-88120
$DL log timeline 'run/incident/game-*' --key 1042 --where mission=102 --save ISSUE-<날짜>-dup-reward
$DL db query --env incident "SELECT COUNT(*) AS n FROM reward_log" --save ISSUE-<날짜>-dup-reward
$DL bot run .devloop/scenarios/double-claim-race.json --save ISSUE-<날짜>-dup-reward          # FAIL (red)
SANDBOX_FIX=claim $DL bot run .devloop/scenarios/double-claim-race.json --save ISSUE-<날짜>-dup-reward  # PASS (green)
$DL case check ISSUE-<날짜>-dup-reward
```

전체 흐름(종료 게이트 포함)은 `tests/test_e2e.py`가 그대로 실행해 검증합니다.
