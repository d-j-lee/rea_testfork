---
description: 종료된 케이스에서 교훈을 뽑아 팀 지식(체크리스트·함정·시스템 지도·시나리오)과 플러그인 개선안으로 반영한다(승인 후). devloop 작업공간의 자가 진화 루프.
argument-hint: "[케이스 ID | 최근 N개]"
disable-model-invocation: true
---

# 회고·진화 (retro)

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` · 기본 체크리스트 `${CLAUDE_PLUGIN_ROOT}/references/game-server-checklist.md`

입력: $ARGUMENTS (없으면 최근 종료 케이스: `case list --all`)

1. **지표.** `case stats`에서 강제 종료율과 종료 시간 중앙값을 본다. 나빠졌으면 이유부터 논의한다.
2. **케이스별 질문.** 시간이 가장 오래 걸린 지점은 어디였나? 늦게 안 사실, 틀린 가설, 게이트를 강제로 넘긴 이유, 도구가 못 해서 손으로 한 일은?
3. **분류**
   - 반복될 확인 질문 → `.devloop/knowledge/checklist.md`
   - 함정(증상 → 실제 원인 → 다음에 먼저 볼 것) → `pitfalls.md`
   - 시스템 사실 변경 → `systems.md`
   - 재현 시나리오 자산화 → `.devloop/scenarios/`
   - 도구·스킬 개선 → `.devloop/knowledge/plugin-feedback.md` (재현 절차, 기대 동작 포함)
4. **반영.** 변경안을 diff로 보여주고 승인받아 적용한다. 같은 내용이 이미 있으면 새로 덧붙이지 말고 합치거나 고친다. 항목마다 출처 케이스 ID를 남긴다.
5. 종료 케이스 아티팩트 보존 기한이 지났으면 `case purge --older-than <일>`을 제안한다(dry run 먼저).
