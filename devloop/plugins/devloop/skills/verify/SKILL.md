---
description: 기능을 요구사항(REQ) 기준으로 검증한다 — REQ×CHK 매트릭스 설계, 봇 시나리오 작성·실행(동시성·시간 경계 포함), 테스트·DB·로그 단언, 커버리지와 미검증 범위 보고. Use when verifying a feature, writing or running bot test scenarios, or building a QA test matrix.
argument-hint: "[기능·기획서·케이스 ID]"
---

# 기능검증 (verify)

목표: 모든 REQ에 실행 증거가 있는 결과(PASS/FAIL) 또는 이유 있는 SKIP/BLOCKED를 남긴다.

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` · 명령 요약 `${CLAUDE_PLUGIN_ROOT}/references/cli.md` · 증거 규칙 `${CLAUDE_PLUGIN_ROOT}/references/evidence.md`
- 검증 설계·시나리오 형식·어댑터 계약: `${CLAUDE_PLUGIN_ROOT}/references/test-design.md`

입력: $ARGUMENTS

## 진행
1. `case new verify "제목" --spec <기획서> [--ref <설계검토 케이스>]`. 설계검토 케이스가 있으면 그 REQ와 검증 시드를 이어받는다.
2. **매트릭스.** REQ마다 관점(정상·경계·상태 전이·실패·동시성/재시도·시간 경계·악용·호환·데이터)과 가장 싼 실행 수단을 정해 CHK 행으로.
3. **환경.** `config`로 대상 env와 티어를 확인한다. 봇은 local/dev/qa에서만 돈다(stage/live 거부). 환경이 없으면 `/devloop:setup`.
4. **시나리오.** `.devloop/scenarios/`의 기존 것을 먼저 재사용한다. 새로 쓰면 `bot validate`. 경합은 `parallel` + `repeat`.
5. **실행.** `bot run … --save CASE`, `ev run CASE -- <테스트>`, `db query … --save CASE`. 실패를 "불안정"으로 넘기지 않는다. 원인을 보고, 경합은 분포로 기록한다.
6. **기록.** CHK 결과와 근거 E#. FAIL은 `case new bug "…" --ref <이 케이스>`로 분리하고 재현 시나리오를 그대로 넘긴다.
7. **커버리지.** `case check`에서 uncovered-req·check-todo 경고를 없애거나 "미검증 범위와 이유"에 적는다.
8. **교차검증.** `adversary` → review 증거. `case close --reason done`(또는 blocked + 결정).

## 사용자에게
REQ별 결과 요약(통과/실패/제외 수) → 실패와 연결된 버그 케이스 → 미검증 범위와 이유 → 다음 단계. QA용 표는 `/devloop:report <케이스> QA`.
