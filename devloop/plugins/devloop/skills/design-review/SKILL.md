---
description: 기획서·데이터 테이블을 서버 관점에서 검토한다 — 요구사항(REQ) 추출, 게임 서버 리스크 체크리스트, 코드·DB·테이블 대조, 기획 확인 질문, 서버 설계 제안, 검증 시드. Use when reviewing a game design spec, feature proposal, data table or technical design before implementation.
argument-hint: "[기획서 경로·링크]"
---

# 설계검토 (design-review)

목표: 구현 전에 명세 공백·리스크·확인 질문을 드러내고, 서버 설계 제안과 검증 시드를 남긴다.

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` · 명령 요약 `${CLAUDE_PLUGIN_ROOT}/references/cli.md` · 증거 규칙 `${CLAUDE_PLUGIN_ROOT}/references/evidence.md`
- 관점 목록: `${CLAUDE_PLUGIN_ROOT}/references/game-server-checklist.md` + 팀 추가분 `.devloop/knowledge/checklist.md`

입력: $ARGUMENTS

## 진행
1. `case new review "제목" --spec <주 문서>` (기획서 해시가 spec_rev로 고정된다). 함께 보는 파일은 `ev add --kind file --ref <경로>`.
2. **텍스트화.** `doc text <파일> [--sheet …]`(xlsx/docx/pptx/csv; 위치 표기 유지). PDF·이미지는 Read 도구. 링크(Confluence 등)는 연결된 커넥터로 읽는다.
3. **REQ 추출.** 검증 가능한 한 문장씩 `- [REQ-n] … (출처: §/slide/시트!셀)`. 모호하면 해석해서 메우지 말고 질문으로 남긴다.
4. **체크리스트 순회.** 분류마다 "발견" 또는 "해당 없음(이유)". 동시성·멱등성, 시간·리셋, 데이터 테이블은 건너뛰지 않는다.
5. **코드·데이터 대조.** 영향 받는 기존 시스템과 상태 변경 지점(`code-tracer` 에이전트), 데이터 테이블 참조 무결성(`doc text`로 표를 읽어 키·참조·범위 확인), DB 스키마·인덱스.
6. **발견사항.** `- (추론|도출) [영향] [F#][높음|중간|낮음][분류] REQ-n: 실패 시나리오와 결과 [E#]`.
   높음 = 중복 지급·데이터 손상·서비스 중단·보안 / 중간 = 기능 오동작·운영 부담 / 낮음 = 개선.
7. **기획 질문.** `case ask CASE "질문(선택지 A/B와 각 결과)" --to 기획`. 답 전에는 그 부분을 결정된 것처럼 설계하지 않는다.
8. **서버 설계 제안.** 멱등 키·원자적 갱신·시간대·플래그/킬 스위치·로그 요구사항 등 — 대안과 트레이드오프를 함께.
9. **검증 시드.** CHK 표(결과 TODO) → `verify`가 이어받는다.
10. **교차검증.** `adversary` 에이전트 → `ev add --kind review --attach`.
11. 회신은 `/devloop:report <케이스> 기획`. 질문이 모두 답/보류되면 `case close --reason done`.

## 사용자에게
높음 발견 → 기획 질문(답이 필요한 순) → 서버 제안 요지 → 검증 시드 수 → 미검토 범위.
