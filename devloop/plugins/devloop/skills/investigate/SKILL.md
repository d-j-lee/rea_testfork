---
description: 버그·라이브 이슈·CS 티켓·알람의 원인을 증거로 좁혀 영향 범위와 대응안까지 만든다(로그/DB/코드/배포 이력 대조, 가설 판별, 재현). Use when a bug, incident, CS report, crash or unexpected server behavior needs root-cause analysis.
argument-hint: "[증상·티켓·케이스 ID]"
---

# 조사 (investigate)

목표: 증상 → 재현으로 뒷받침된 원인(못 하면 추론임을 명시) → 영향 범위 → 대응안. 코드 수정은 `fix`로 넘긴다.

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` (Bash 호출마다 전체 경로). 명령 요약: `${CLAUDE_PLUGIN_ROOT}/references/cli.md`
- 증거 규칙(등급·인용·게이트): `${CLAUDE_PLUGIN_ROOT}/references/evidence.md` — 처음 한 번 읽는다.
- 가설 범주·함정: `${CLAUDE_PLUGIN_ROOT}/references/investigation-playbook.md`
- 팀 지식(있으면 먼저): `.devloop/knowledge/systems.md`, `pitfalls.md`. 없으면 지도 없이 진행함을 밝히고 `/devloop:setup`을 권한다.

입력: $ARGUMENTS

## 진행
0. **규모 판단.** 몇 번의 확인으로 끝나면 케이스 없이 답한다(근거는 문장 속 출처로). 세션을 넘기거나, 증거 보존·수정·데이터 대응이 필요하면 `case new issue|bug "제목" --ref <티켓>`. 진행 중 케이스가 있으면 이어서 한다(`case list`).
1. **증상 고정.** 누가·언제(UTC 변환, 원문 시각 병기)·어디·얼마나·빌드. 케이스 1장을 채우고, 사람만 아는 것은 `case ask`.
2. **사실 수집.** 변화 지점(git log, 배포·데이터 테이블·설정) → `log scan` → `log diff`(먼저 `--level WARN`) → `log timeline --where uid=<id>`(필드가 없으면 `--key`). 로그가 크거나 서버가 여럿이면 `log-analyst` 에이전트에 위임하고 결론과 근거 ID만 받는다. 결론에 쓸 결과는 `--save CASE`.
3. **가설표.** 범주별 후보마다 지지·반박 근거와 판별 방법. 결론을 가장 크게 가르는 가장 싼 확인부터. 코드 흐름은 `code-tracer` 에이전트.
4. **재현.** `ev run CASE --claim … -- <테스트>` 또는 `bot run <시나리오> --save CASE`. 경합은 `repeat`로 분포를 남긴다. 재현 실패도 기록한다.
5. **결론.** 등급 규칙대로 case.md에 쓰고 `case check` 오류 0.
6. **영향 범위.** `db query --env … --save CASE`(읽기전용, live는 결과 상한). 대상·기간·수량과 조회 범위를 함께.
7. **대응안.** 코드 / 설정 / 데이터 보정 / 보상 / 공지를 나누고 각각 되돌릴 수 있는지 적는다.
   데이터 보정·보상 정책·라이브 설정·배포는 **사람 결정**: `case ask --to 운영|기획` → 답을 받은 뒤 `case decide`. 보정은 스크립트와 dry-run 집계만 작성한다.
8. **교차검증.** `adversary` 에이전트에 케이스 경로를 주고 반박을 시도하게 한 뒤 결과를 `ev add CASE --kind review --ref adversary --attach <결과파일> --claim "…"`로 남긴다.
9. **넘김.** 수정은 `fix`, 사람용 글은 `/devloop:report`.

## 멈추는 곳
- 가드가 ask/deny를 내면 우회하지 말고 이유와 대안(`db query`, 사람 실행 스크립트)을 설명한다.
- 결론을 좌우하는 전제가 미확인이면, 확인하거나 미확인인 채 진행함을 사용자에게 먼저 밝힌다.

## 사용자에게 답하는 형식
결론 한 문단(확실성은 문장으로) → 핵심 근거 3~5개(E#·위치) → 영향 범위(조건 포함) → 다음 행동(누가·무엇을) → 미확인과 리스크.
