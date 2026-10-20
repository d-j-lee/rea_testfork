# 검증 설계와 봇 시나리오

## REQ → CHK
1. REQ는 검증 가능한 문장으로 쪼갠다(하나의 REQ = 하나의 관찰 가능한 기대). 출처 위치를 붙인다.
2. REQ마다 관점을 고른다: 정상 / 경계값 / 상태 전이 / 실패·예외 / 동시성·재시도 / 시간 경계 / 권한·악용 / 호환(구 클라) / 데이터 테이블.
3. 관점마다 가장 싼 실행 수단을 고른다:
   | 수단 | 언제 | 증거 |
   | --- | --- | --- |
   | 단위·통합 테스트 | 서버 로직 단독 | `ev run CASE -- <테스트 명령>` |
   | 봇 시나리오 | 클라이언트 관점 흐름·동시성·시간 경계 | `bot run --save` |
   | GM + DB 조회 | 상태 확인, 대량 데이터 | `db query --save` |
   | 로그 단언 | 기록 요구사항, 부수효과 | `log query --save` |
   | 수동 | 연출·UI | `ev add --kind report`(QA 보고, 인용 시 추론) |
4. 실행 못 하는 CHK는 `SKIP`/`BLOCKED`와 이유를 남긴다. "미검증 범위"는 숨기지 않는다.

## 시나리오 형식 (JSON)

```json
{
  "name": "double-claim-race",
  "requirements": ["REQ-3"],
  "adapter": "mybot",
  "allowed_tiers": ["local", "dev", "qa"],
  "timeout": 10,
  "vars": {"mission": 102},
  "actors": {"a": {"account": "race_${run_id}"}, "b": {"account": "race_${run_id}"}},
  "steps": [
    {"actor": "a", "op": "login", "save": {"uid": "$.user_id"}},
    {"actor": "b", "op": "login"},
    {"repeat": 10, "steps": [
      {"actor": "a", "op": "gm", "args": {"cmd": "set_progress", "mission": "${mission}", "value": 5}},
      {"parallel": [{"actor": "a", "op": "claim", "args": {"mission": "${mission}"}},
                    {"actor": "b", "op": "claim", "args": {"mission": "${mission}"}}],
       "expect_all": [{"count": {"path": "$.ok", "op": "eq", "value": true}, "op": "eq", "value": 1}]}
    ]},
    {"probe": "db", "args": {"sql": "SELECT COUNT(*) AS n FROM reward_log WHERE uid = :uid", "params": {"uid": "${uid}"}},
     "expect": [{"path": "$.rows[0].n", "op": "eq", "value": 10}]}
  ]
}
```

| 요소 | 의미 |
| --- | --- |
| step `op` | 어댑터 `session.call(op, args)` 호출. `save`는 응답 경로→변수, `expect`는 단언 목록 |
| `parallel` | 가지들을 스레드로 실행. 배리어로 **클라이언트 송신 시점**만 맞춘다(서버 도착 동시성 보장 아님) → `repeat`와 함께 쓴다 |
| `expect_all` + `count` | 병렬 결과 중 조건을 만족하는 개수에 대한 단언 |
| `repeat: N` | 하위 단계 N회 반복, 변수 `iter`. 결과는 통과 분포로 보고 |
| `probe` | 내장 `db`(읽기전용, `:name` 바인딩)·`log`(`files`, `where`, `grep`, `keys`) 또는 어댑터 `probe(kind, args)` |
| `wait_event` | `{"actor","match":{경로:값},"timeout"}` 어댑터 `events()`에서 대기 |
| `sleep` | 초 단위 대기 |
| `allow_error` | 이 단계의 어댑터 예외로 시나리오를 멈추지 않음 |
| 변수 | `${name}`, `${name.path[0]}`. 문자열 전체가 변수면 타입 유지. 내장 `run_id`(실행별 고유) |
| 경로 | `$.a.b[0]`, `$.list.length` |
| 단언 op | eq ne gt ge lt le contains in matches exists not_exists |

시나리오는 `.devloop/scenarios/`에 커밋한다 = 회귀 자산. 버그 수정 때 재현 시나리오를 그대로 회귀 CHK로 쓴다.

## 어댑터 계약

**python** (`type = "python"`, `module`, `class`, `options`):
```python
class Adapter:
    def __init__(self, options: dict): ...
    def open(self, actor: str, spec: dict) -> "Session": ...      # 로그인 전 연결
    def probe(self, kind: str, args: dict) -> dict: ...           # 선택
    def close(self) -> None: ...
class Session:
    def call(self, op: str, args: dict, timeout: float) -> dict: ...  # 응답은 dict
    def events(self, timeout: float) -> list[dict]: ...              # 선택(푸시 알림)
    def close(self) -> None: ...
```

**process** (`type = "process"`, `command = [..]`, `{python}`은 현재 인터프리터): 기존 봇(C#·C++·Go·Node)을 그대로 감싼다.
stdin 한 줄 = 요청, stdout 한 줄 = 응답, 같은 `id`. **요청을 동시에 처리하고 순서와 무관하게 응답**해야 병렬 가지가 실제로 동시에 나간다.
```
→ {"id":1,"cmd":"open","actor":"a","spec":{...}}          ← {"id":1,"result":{"ok":true}}
→ {"id":2,"cmd":"call","actor":"a","op":"claim","args":{...},"timeout":10}   ← {"id":2,"result":{...}} | {"id":2,"error":"..."}
→ {"id":3,"cmd":"probe","kind":"state","args":{...}}
→ {"id":4,"cmd":"events","actor":"a","timeout":1}          ← {"id":4,"result":[...]}
→ {"id":5,"cmd":"close"}
```
어댑터 응답의 민감 필드는 `redact_fields`로 결과 기록에서 가린다. 실시간 UDP 게임플레이(이동·사격 동기화)는 범위 밖이다. 로비·상점·미션·우편 같은 요청/응답형 컨텐츠가 대상이다.
