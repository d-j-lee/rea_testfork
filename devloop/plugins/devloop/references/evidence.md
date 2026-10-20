# 증거 규칙 (devloop)

이 문서가 증거 등급·인용·종료 게이트의 단일 기준이다. 스킬과 에이전트는 이 규칙을 반복하지 않고 여기를 따른다.

## 등급

| 등급 | 뜻 | 쓰는 곳 |
| --- | --- | --- |
| 확인 | 이번 작업에서 직접 실행·열람·측정. 출처(명령·파일:라인·아티팩트)를 짚을 수 있다 | 관찰 |
| 도출 | 확인된 사실에서 계산·추적으로 따라 나옴. 같은 근거로 누구나 같은 결론 | 집계, 순서, 재현된 원인 |
| 추론 | 판단·가정·일반화가 들어감 | 재현 전 원인, 설계 리스크 |
| 미확인 | 확인 못 함. 결론을 좌우하면 확인 방법을 붙인다 | 남은 공백 |

- 결론 등급은 **인용한 증거 중 가장 약한 등급**을 넘지 못한다. 요약·전달하며 올리지 않는다.
- **원인·효과 판정은 재현(run/bot 실행) 또는 전후 대조가 있어야 도출**, 없으면 추론이다. 원인·효과는 관찰이 아니므로 확인이 될 수 없다.
- 문서·티켓·사람·다른 에이전트의 말은 "그렇게 적혀 있다"까지만 확인이다(인용 시 추론으로 계산).
- 여러 서버 로그를 시각으로 합친 순서는 시계 편차·비동기 기록 때문에 **추론**이다. 공통 요청/트랜잭션 ID로 이어질 때만 도출.
- 모든 확인에는 범위가 있다: 환경·빌드·시간창·표본. "없음/통과"는 본 범위 안에서만 성립한다.

## 증거 종류와 등급 상한 (CLI가 강제)

| kind | 만드는 방법 | 상한 | 인용 시 |
| --- | --- | --- | --- |
| tool | `log … --save`, `db query --save`, `doc text --save` (출력·명령·해시 보존) | 확인 | 확인 |
| run | `ev run CASE --claim … -- <명령>` (출력·종료코드 보존, outcome pass/fail) | 확인 | 확인 |
| bot | `bot run … --save` (outcome pass/fail) | 확인 | 확인 |
| file | `ev add --kind file --ref path:시작-끝` (해시·라인 스냅샷) | 확인 | 확인 |
| artifact | `ev add --kind artifact --attach 파일` | 확인 | 확인 |
| derived | `ev add --kind derived --from E1,E2` | min(전제, 도출) | 같음 |
| report | 티켓·문서·사람·에이전트 진술 (`--ref` 필수) | 확인 | **추론** |
| review | 독립 교차검증 결과 (`--attach` 필수) | 확인 | **추론** |
| manual | 재확인 불가한 메모 (`--ref` 필수) | 추론 | 추론 |
| unknown | 알려진 공백 (`--how` 필수) | 미확인 | 미확인 |

정정은 지우지 않고 `--supersedes E#`로 새 항목을 추가한다. `ledger.jsonl`은 CLI 전용이다. Edit/Write 도구로 편집하면 가드가 거부하고, 다른 경로로 편집해도 줄마다 들어 있는 이전 줄 해시(`prev`)가 끊겨 `case check`가 오류로 잡는다. 첨부 아티팩트도 해시를 다시 확인한다.
`[secrets] env = ["QA_DB_PASSWORD"]`처럼 명시한 환경변수의 값은 원장과 아티팩트에 기록되기 전에 `${이름}`으로 가린다.

## case.md 문법 (파서가 읽는 것만)

- 등급 주장: 목록 항목 맨 앞에 등급, 선택적으로 라벨.
  `- (도출) [원인] 수령 처리가 원자적이지 않다 [E8][E3]` — 라벨: `[원인]` `[효과]` `[영향]`
- 요구사항: `- [REQ-1] 내용 (출처: 기획서 §3 / slide 7 / missions!B5)`
- 검증 표: 첫 열 헤더가 `CHK`인 표. 열 이름 `REQ` `관점` `결과` `근거`를 읽는다. 결과는 PASS/FAIL/SKIP/BLOCKED/TODO.
  회귀 행은 `관점`에 "회귀"를 넣고, 수정 전 FAIL과 수정 후 PASS 실행 증거를 모두 인용한다.
- HTML 주석(`<!-- -->`) 안은 읽지 않는다. 형식 밖 등급 태그는 경고로 보고된다.
- 상태(front matter `status`)·질문·결정은 CLI가 원장에 기록한다: `case status|ask|answer|decide|close`.

## 린트 (`case check`) 주요 코드

| 코드 | 수준 | 뜻 |
| --- | --- | --- |
| grade-inflation | 오류 | 주장 등급 > 인용 증거 최약 등급 |
| unsupported-claim | 오류 | 확인/도출 주장에 근거 없음 |
| causal-observed / causal-without-repro | 오류 | 원인·효과를 확인으로 표기 / 재현 없이 도출 |
| dangling-ref | 오류 | 원장에 없는 E# 인용 |
| check-without-run | 오류 | PASS/FAIL인데 실행 증거(run/bot/tool) 없음 |
| status-mismatch | 오류 | front matter 상태를 손으로 바꿈 |
| ledger-chain / artifact-modified / artifact-missing | 오류 | 원장이나 아티팩트가 CLI 밖에서 바뀜 |
| uncited-inference, unparsed-grade, unparsed-check, uncovered-req, check-todo, superseded-ref | 경고 | |

## 종료 게이트 (`case close --reason`)

| 유형 | 사유 | 요구 |
| --- | --- | --- |
| 모든 사유 | – | 린트 오류 0 |
| 모든 사유 | duplicate·dropped 제외 | 미답 질문 0(답하거나 `--defer`) |
| review | done / dropped | done: review 증거(첨부). dropped: 사람 결정 |
| verify | done / blocked / dropped | done: REQ 1개 이상·CHK 1개 이상, 모든 REQ에 실행 또는 명시적 SKIP CHK, TODO 0, review 증거. blocked·dropped: 사람 결정 |
| bug / issue | fixed | review 증거, 회귀 CHK에서 **같은 재현**(같은 명령 또는 같은 시나리오 파일)의 FAIL 뒤 PASS(원장 순서), `[원인]` 주장 |
| bug / issue | data-fix | review 증거, 사람 결정(`case decide`), 영향 조회(`db query --save`) |
| bug / issue | external | report 증거 |
| bug / issue | not-reproducible | 재현 시도 실행 증거 |
| bug / issue | duplicate | `--of CASE` |
| bug / issue | wont-fix / dropped | 사람 결정 |

게이트를 못 넘으면 고치거나 `--force "이유"`로 넘긴다(원장에 기록되고 `case stats`의 강제 종료율에 잡힌다).
