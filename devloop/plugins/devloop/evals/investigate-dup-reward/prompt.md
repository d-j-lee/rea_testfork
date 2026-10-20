---
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---
라이브 이슈 조사 부탁해. CS 티켓 CS-88120(uid 1042, 미션 보상 골드가 두 번 들어옴)이 들어왔어.
`run/incident/`에 game-01·game-02 서버 로그(일부 gzip), CS 티켓 요약(`cs_tickets.md`), 사건 시점 DB 스냅샷(`incident.db`)이 있고,
devloop 워크스페이스 설정(`.devloop/config.toml`, env `incident`)도 되어 있어. 서버 코드는 여기 없어.
원인 후보와 근거, 영향 범위(몇 건, 얼마나), 확인한 것과 추정한 것을 구분해서 정리해줘.
