---
description: 케이스를 독자(기획·QA·운영/CS·개발·포스트모템)에 맞는 사람용 글로 정리한다 — 결론 먼저, 확실성은 문장으로, 수치는 범위와 함께, 개인정보 최소화.
argument-hint: "<케이스 ID> <기획|QA|운영|개발|포스트모템>"
disable-model-invocation: true
---

# 보고 (report)

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` · 글 원칙과 독자별 틀: `${CLAUDE_PLUGIN_ROOT}/references/reporting.md`

입력: $ARGUMENTS

1. `case show`, case.md, `ev list`로 내용을 확인한다. `case check`에 오류가 있으면 먼저 알리고, 확실성을 낮춰 쓴다.
2. 독자별 틀로 쓴다. 근거는 독자가 열 수 있는 형태(티켓·로그 위치·쿼리 요지)로 바꾸고 내부 E# 나열은 하지 않는다.
3. 짧으면 바로 붙여넣을 텍스트로 준다. 길면 케이스 폴더 `reports/<독자>.md`에 저장하고 경로를 알린다.
4. Jira·Slack·Confluence 등 외부 게시는 사용자 확인 후 연결된 커넥터로 한다.
