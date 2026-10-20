---
description: devloop를 팀 환경에 맞춘다 — 워크스페이스 생성, 환경 티어·라이브 마커, 로그 프로필, 읽기전용 DB 명령, 봇 어댑터, 시스템 지도(knowledge/systems.md), 권한 설정.
argument-hint: "[저장소 또는 팀 환경 설명]"
disable-model-invocation: true
---

# 도입 (setup)

목표: devloop가 이 팀의 실제 환경(로그·DB·봇·기획서·시간 규칙)을 이해하게 만든다. 파일을 쓰기 전에 계획을 보여주고 승인을 받는다.

- CLI: `"${CLAUDE_PLUGIN_ROOT}/scripts/devloop"` · 명령 요약 `${CLAUDE_PLUGIN_ROOT}/references/cli.md`
- 설정 예시와 기본 티어 정책: `${CLAUDE_PLUGIN_ROOT}/lib/devloop/templates/config.toml`
- 어댑터 계약: `${CLAUDE_PLUGIN_ROOT}/references/test-design.md`

입력: $ARGUMENTS

## 진행
1. `config`로 현재 상태를 본다. 워크스페이스가 없으면 `init`(dry run)을 보여주고, 승인을 받은 뒤 `init --yes`.
2. **인터뷰** (사용자만 답할 수 있는 것을 한 번에 묻는다):
   환경 목록과 티어 / live·stage 호스트·DB 이름·IP 대역(마커) / DB 종류·읽기전용 계정 유무 / 로그 위치·수집 방식(파일·ELK·명령) / 봇 프레임워크 언어·실행 방식 / 기획서·데이터 테이블 위치와 포맷 / 리셋·로그 시간대 규칙.
3. **라이브 마커는 개인 설정에도** 둔다(`init --user` → `~/.devloop/config.toml`). 그러면 워크스페이스가 없는 저장소에서도 가드가 동작한다.
4. **로그 프로필.** 실제 샘플로 `log probe`를 돌리고 정규식 프로필(named group: ts, level, msg)과 tz를 쓴다. probe 매치율이 100%에 가까운지, `log scan` 템플릿이 말이 되는지 확인한다. 중앙 수집이면 `[log.sources.*]` 명령 원천을 쓴다.
5. **DB.** `[env.<이름>.db]` command 템플릿(비밀은 `${ENV}`, `output = "tsv"`, 한국어 Windows sqlcmd는 `-u` 또는 `output_encoding`), live는 `mask_columns`. `db query --env <이름> "SELECT 1"`로 확인한다.
6. **봇.** 팀 봇에 JSON-lines 진입점을 얇게 붙이거나 python 어댑터 스켈레톤을 쓴다. happy-path 시나리오 하나로 확인한다.
7. **시스템 지도.** 코드베이스 탐색(Explore 에이전트)과 인터뷰로 `.devloop/knowledge/systems.md`를 채운다. 서버 구성, 로그, 저장소, 리셋 규칙, 변경 이력 확인 방법이 들어간다. 확인한 사실만 쓴다.
8. **연결.** 저장소 `CLAUDE.md`에 3~5줄 포인터(증거 등급, 케이스 사용, 쓰기 금지 원칙)를 넣는 안을 제안한다. 권한 허용 `Bash(*/scripts/devloop *)`도 제안한다. 둘 다 승인 후 적용한다.
9. **가드 점검.** 위험 명령을 실제로 실행하지 않는다. 대신 `echo '{"tool_name":"Bash","tool_input":{"command":"<예시>"},"cwd":"<경로>"}' | <CLI> hook pretooluse`로 deny/ask를 확인한다.

끝에 설정 요약, 확인한 것과 못 한 것, 남은 입력(사람이 줘야 할 것)을 보고한다.
