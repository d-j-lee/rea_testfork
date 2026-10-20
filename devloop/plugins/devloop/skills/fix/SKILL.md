---
description: 조사된 원인을 고치고 red→green 회귀 증거로 닫는다 — 수정 전 실패 재현, 생산 지점의 최소+관련 정리 수정, 같은 패턴 탐색, 회귀 실행, 데이터 보정 스크립트(사람 실행), 교차검증. Use when implementing a fix for a diagnosed bug or incident.
argument-hint: "[케이스 ID]"
---

# 수정 (fix)

목표: 원인을 생산 지점에서 고치고, 같은 재현이 수정 전 FAIL → 수정 후 PASS임을 실행 증거로 남긴다.

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` · 증거 규칙 `${CLAUDE_PLUGIN_ROOT}/references/evidence.md`

입력: $ARGUMENTS (원인 케이스가 없으면 먼저 짧게 `investigate`)

## 진행
1. **Red.** 수정 전에 재현을 실행 증거로 남긴다: `ev run CASE --claim "수정 전 재현" -- <테스트>` 또는 `bot run <시나리오> --save CASE`(outcome fail). 재현 수단이 없으면 테스트나 시나리오부터 만든다.
2. **수정 범위.** 문제를 만든 지점(생산 경계)을 고친다. 하위에서 덧대지 않는다. 같은 해석·패턴을 가진 다른 핸들러를 찾는다(Grep, `code-tracer`). 직접 관련된 정리는 같은 변경에 포함하고, 남는 정리는 이유와 함께 적는다.
3. **Green.** **같은 명령(같은 시나리오 파일)**을 다시 실행해 pass. 회귀 CHK 행(관점 "회귀")에 FAIL·PASS 증거를 모두 인용한다. 명령이 다르면 게이트가 red→green으로 인정하지 않는다.
4. **주변 회귀.** 관련 테스트·시나리오·빌드. 실패를 건너뛰거나 테스트를 끄지 않는다.
5. **데이터 보정**이 필요하면 보정 스크립트, dry-run 집계 쿼리, 백업·롤백 계획을 **작성만** 한다. 실행은 사람이 하고 `case decide`로 기록한다.
6. **교차검증.** `adversary`에 diff와 케이스를 주어 경합·롤백·호환·로그 누락을 반박하게 한다. 결과는 review 증거로 남긴다.
7. **커밋·PR**은 저장소 규칙을 따른다. 본문에 원인(근거), 수정 방식과 버린 대안, 회귀 결과, 남은 리스크를 적는다.
8. `case close CASE --reason fixed` — 게이트가 막으면 빠진 것을 채운다. `--force`는 사용자가 이유를 말할 때만 쓴다.
