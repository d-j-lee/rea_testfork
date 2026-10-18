# 장생 아키텍처

한 벌의 시뮬레이션 코어가 Node 서버(온라인)와 브라우저(오프라인)에서 똑같이 돈다. 클라이언트는 언제나 같은 프로토콜로 호스트와 대화하고, 그 호스트가 원격인지(WebSocket) 같은 페이지 안인지(루프백)는 모른다. 코드 위치는 `src/shared/` 기준 `파일#심볼`로 달고, 그 밖은 `src/client/…`·`src/server/…`로 적는다. 게임 수치와 규칙은 [GDD.md](GDD.md)에 있다.

```
┌──────────────── client (DOM) ────────────────┐      ┌──────── server (Node) ────────┐
│ ui/      제목·HUD·선택지·세월·메뉴·엔딩 (DOM)   │      │ main.ts  http 정적 + /ws       │
│ game/    프레임 루프·보간·카메라·장면 합성       │      │ rate.ts  소켓별 메시지 관문    │
│ render/  지형·건물·캐릭터·이펙트 (Canvas2D)     │      │ store.ts JSON 프로필(원자적 저장) │
│ audio/   절차적 국악 음악·효과음 (WebAudio)     │      └──────────────┬────────────────┘
│ net/     WebSocket ─┐  루프백 ─┐ (offline.ts)   │                     │
└─────────────────────┼─────────┼────────────────┘                     │
                      │         │  protocol.ts (ClientMsg / ServerMsg)  │
┌─────────────────────▼─────────▼──────── shared (순수, DOM·Node 없음) ──▼──────────┐
│ host/    GameHost · Session(개인 서사) · Channel(시대 채널) · Bot(◇ 동료) · parse  │
│ sim/     World: 이동·충돌·전투·적 AI·전투 이벤트·스냅샷 (타일·초 단위, 결정론)      │
│ rules/   PlayerSave 위의 순수 함수: 성장·효과 대수·정치·수명·의심·세월·엔딩         │
│ content/ 데이터: 16개 챕터·적·기술·아이템·출신·품계·동료·엔딩 (schema.ts가 계약)    │
│ map/     위경도 기반 한반도 생성기 (시드 결정론, 시대별 구조물·충돌)               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 계층과 의존 방향

의존은 안쪽으로만 흐른다: `content/map` → `rules`/`sim` → `host` → `server`/`client`.

- `tsconfig.shared.json`은 `lib: ES2023`, `types: []`로 `src/shared`를 검사한다. 공용 코드가 DOM이나 Node API를 쓰면 컴파일이 실패한다.
- `tsconfig.client.json`(DOM), `tsconfig.server.json`(Node, 테스트 포함), `tsconfig.tools.json`(`tools/preview`)이 각각 바깥 계층을 검사한다.
- `rules/index.ts`가 rules 계층의 공개 면이다. host·client·server·tests는 rules를 이 파일로만 가져오고, 이 파일은 실제로 쓰는 것만 내보낸다.
- host는 sim을 `sim/world.ts`의 `World`로만 다룬다. ◇동료(`host/bots.ts`)는 월드를 `WorldQuery`(가까운 적, 자기나 따르는 사람을 노리는 적, 쓰러진 아군, 플레이어, 전투 중심, 방어 목표, 전장에 선 적장 `battleBoss`, 보행 가능 여부)로만 읽고, 명령은 입력(`World.setInput`)·자력 소생·순간이동뿐이다.
- TypeScript는 지울 수 있는 문법만 쓴다(`erasableSyntaxOnly`). 그래서 Node 22.18+가 빌드 없이 `.ts`를 바로 실행한다(서버, 테스트).

## 시간 모델: 개인의 시간, 시대의 공간

- **개인 시간**: 연도·챕터·단계는 `PlayerSave`에만 있다. 이야기 목표를 끝내거나 세월을 보낼 때만 앞으로 간다. 접속하지 않은 시간은 수명을 쓰지 않는다.
- **시대 채널**: 같은 챕터에 있는 사람끼리 `Channel` 하나(정원 40, 넘치면 새 샤드)를 공유한다. 채널마다 `World`가 하나다. 샤드 키는 실제 세이브가 `ch04#2`, 시연 인물이 `ch04#demo1` 꼴이라(`host/channel.ts#channelKey`, `host/host.ts` `#channelFor`) 시연의 건너뛰기와 프리셋이 실제 플레이어의 세계에 닿지 않는다.
- **NPC와 스폰 창**: 채널에 있는 모든 사람의 단계를 따른다(`host/channel.ts#Channel.updateStep` → `sim/world.ts#World.setStep`). NPC나 스폰 무리는 누구 한 사람의 단계라도 그 창 안에 있으면 남는다. 지도 연도(시대별 구조물과 충돌)는 가장 이른 사람의 단계 연도라서 함께 쓰는 세계가 누구의 이야기보다도 앞서지 않는다. 목표 표식(!)은 사람마다 따로 계산한다(`WorldHooks.npcMarker`).
- **공동 실록**: 채널의 협동 게이지다(`host/channel.ts#Channel.addWorldEvent`가 채운다). 다 차면 채널에 있던 사람마다 `rules/nation.ts#completeWorldEvent`가 시대정신 +1(장마다 한 번, 상한 5)과 공덕 +40(장마다 두 번)을 주고, 실제로 준 만큼을 돌려준다. 세션(`host/session.ts#Session.onWorldEventComplete`)은 알리기만 한다. 시대정신은 엔딩 점수에 최대 +5까지 더해진다.

## 전투의 소유

전투에 관한 판단은 하나씩 한 곳이 맡는다. 주인은 대부분 `sim/battle.ts`이고, 이야기 상태가 있어야 하는 판단(누가 아직 그 전투를 치러야 하는가, 진 전투를 다시 여는가)만 호스트가 맡는다. 호스트(`Channel`, `Session`)는 링 거리나 순간이동 지점을 직접 계산하지 않는다.

| 질문 | 주인 | 호스트가 읽는 곳 |
|---|---|---|
| 어디서 싸우는가 | `sim/battle.ts#arenaOf`: 진행 중인 전투의 전장, 아니면 `sim/arena.ts#battleArena`가 그해 지도에서 정한 전장(충돌 격자·전투 정의별 캐시) | `World.arenaOf`(목표 표식), `WorldQuery.battleCentre` |
| 거기 있는가 | `#atBattle`: 링 반경 + `#BATTLE_REACH`(6) 안 | `World.atBattle`(시작 트리거, 시연 이동) |
| 옮겨진 사람은 어디 서는가 | `#arrival` → `sim/arena.ts#arrivalSpot` | `World.arrivalSpot`(이야기 시작, 시연 건너뛰기) |
| 시작할 수 있는가 | `#startRefusal`: `unknown`·`downed`·`busy` | `World.battleRefusal` |
| 누가 싸우는가 | `#muster`(시작할 때와 매 틱), 결투는 시작한 사람만 | `World.battleParticipants`, `WorldHooks.onBattleEnd`의 참가자 목록 |
| 누구를 노리고 무엇으로 지는가 | `#onGround`: 전장 땅 위의 참가자 | — |
| 적장은 어디 있는가 | `sim/world.ts#WorldQuery` `battleBoss`: 진행 중인 전투의 이름 있는 적장이 서 있는 동안(결투 제외) | `WorldQuery.battleBoss`(◇동료의 절반이 노린다) |
| 진 뒤 쓰러진 사람은 어디서 일어나는가 | `#withdraw`: 링 가장자리의 자기 쪽, 남은 적대 무리에서 떨어진 각자의 타일(`sim/arena.ts#rimSpot`), 체력 25%, 4초 무적. `sim/combat.ts#standUp`이라 소생 훅이 없다 | `WorldHooks.onBattleEnd`(패배로만 알림) |
| 진 전투를 다시 여는가 | 호스트(이야기 상태): `host/session.ts` `#withdrawnFrom`. 그 전투는 `Session.needsBattle`이 거짓이고 `#checkPlaces`가 시작하지 않는다. `World.atBattle`이 거짓이 되면(범위 밖으로 나가면) 지운다 | `World.atBattle` |

- 사람이 그 전투를 아직 치러야 하는지는 sim이 모르는 이야기 상태라서, 인라인 질의 훅 `WorldHooks.fights`로 호스트에 묻는다(`host/channel.ts` `#fights` → `host/session.ts#Session.needsBattle`: 그 전투가 지금 단계의 열린 목표이고, 방금 그 전투에서 물러나지 않았는가). ◇동료는 늘 싸운다. 이 한 목록이 다인 보정, 패배 판정, 결과 처리(`host/channel.ts` `#onBattleEnd`)에 모두 쓰인다.
- 플레이어는 `sim/entities.ts#placePlayer`로만 옮겨진다. 구르기·시전·당기기·휘두르기·넉백을 취소하고, 순간이동·전장 진입·자력 소생·패배 철수가 모두 이것을 쓴다. `sim/battle.ts`와 `sim/player.ts` 사이에 import 순환은 없다.
- 자리 고르기: 순간이동(`World.teleport`)과 인물 생성은 `sim/population.ts#safeSpot`으로 NPC와 다른 모든 플레이어에게서 한 타일 떨어진, 같은 보행 영역(`sim/physics.ts#components`)의 자리를 고른다. 전장 진입은 옮겨지는 참가자마다 다른 땅 타일을 준다(`sim/arena.ts#arenaSpot` `taken`). ◇동료가 사람 곁 어느 쪽에 서는지는 `host/bots.ts` `Bot.spotNear`가 정한다.
- 결과 보상은 `rules/effects.ts#battleResult`가 맡는다. 첫 승리 보상은 전투마다 한 번, 패배 효과는 매번이고, 세션은 그 결과를 그대로 처리한다.

## 권위와 신뢰 경계

- **해석 경계**: 클라이언트 메시지는 `unknown`으로 들어온다. 메시지 모양의 주인은 `host/parse.ts#parseClientMsg` 하나다. 모양·범위·길이를 검사하고 숫자는 범위로 자르며, 잘못된 메시지는 `null`이 되어 `bad_message` 오류로 답한다(`host/host.ts`). 이름은 한글·영문·숫자 2~12자로(`#sanitizeName`), 채팅은 제어 문자를 지우고 120자로(`#sanitizeChat`) 정규화한다. 서버는 속도 관문 때문에 같은 함수로 한 번 먼저 해석하고 호스트가 다시 해석한다. 두 번째 해석이 결과를 바꾸지 않는다는 것은 `tests/unit/server-rate.test.ts`가 표본으로 확인한다(ROADMAP.md 3장).
- 입력은 의도(이동 벡터·버튼·조준)만 담는다. 위치·피해·보상은 호스트가 정한다.
- 선택지는 현재 열린 카드 id와 활성 선택지만 받는다. 조건은 호스트에서 다시 평가한다. 세월 계획(활동·세탁·이름·봉헌·마지막 은혜)도 규칙이 그대로 받아 막힌 활동의 대체, 세탁 가능 여부, 이름의 대체를 스스로 정한다(`rules/years.ts#advanceYears`). 계획표가 보이는 예상 천수도 규칙의 `rules/years.ts#projectYears`가 계획 뷰(`YearsPlanView`)만 읽고 계산한다. 클라이언트는 그것을 `rules/index.ts`에서 가져와 보일 뿐이고, 보내는 것은 선택뿐이며 `advanceYears`가 다시 정한다. 활동이 바꾸는 천수·공덕·전은 활동의 효과가 한 주인이다(`rules/years.ts#ACTIVITIES` `effects`).
- 숙청·판정 굴림은 `hashRoll(save.seed, 사건id)`다. 같은 사건은 다시 불러와도 결과가 같다(세이브 스커밍 방지).
- 정산된 런(`save.ending`)은 어떤 입력이나 월드 이벤트로도 바뀌지 않는다. 세션의 관문 하나(`host/session.ts` `#settled`)가 채팅·핑을 뺀 모든 메시지와 채널이 넘기는 모든 월드 훅을 막는다.
- 채팅과 감정 표현(`action: emote`)은 세션마다 하나의 예산을 쓴다. 3줄이고 1.5초마다 1줄씩 찬다. 넘치면 '채팅이 너무 빠르다.'를 알린다(`host/session.ts` `#say`).
- **서버 측 제한**: WebSocket 메시지는 8KB다(`src/server/main.ts` `MAX_MESSAGE_BYTES`). 바이너리 프레임은 1008, 잘못된 JSON은 1007로 연결을 끊는다. 해석한 메시지는 소켓마다 `src/server/rate.ts#RateGate`가 1초 창으로 센다. 한 창에 40개(`MESSAGES_PER_SECOND`)를 넘으면, 마지막으로 통과시킨 입력과 버튼 상태가 같고(공격·활·구르기) 기술·상호작용 누름이 없으며 정지로의 해제도 아닌 입력 하트비트만 버린다. 누름과 해제, 선택, 세월 계획, 행동, 채팅, 핑, 잘못된 메시지(호스트가 답한다)는 언제나 통과한다. 그래서 버튼 변화는 잃지 않지만, 예산을 넘긴 창에서는 스틱과 조준 변화가 그 창이 끝날 때까지(최대 1초) 늦을 수 있다. 종류와 관계없이 한 창에 120개(`ABUSE_FACTOR` 3 × 40)를 넘으면 1008 "rate limit"으로 끊는다. 정적 파일 경로 탈출을 막고, 프로필 토큰 형식(16진수 32자)을 검사한다.

## 결정론

- 맵: `generateMap(seed)`. 서버·오프라인 호스트·클라이언트가 각자 같은 타일을 만들기 때문에 맵은 전송하지 않는다.
- 월드: 고정 스텝(50ms) + 시드 RNG를 쓴다. 공용 시뮬레이션은 `Math.random`/`Date`를 쓰지 않는다. 예외는 접속 토큰 생성(`crypto.getRandomValues`, 없을 때만 `Math.random`)뿐이다.
- 세이브 시드: 실제 세이브는 토큰에서, 시연 세이브는 장과 경로에서 나온다(`host/host.ts#saveSeed`). 그래서 같은 장·경로의 시연은 판정·숙청·풍향계·소사건·이름이 매번 같다(`tests/unit/host.test.ts` "a demo's seed comes from its chapter and path…").
- 스냅숏은 오프라인 20 Hz, 온라인 10 Hz다(`host/channel.ts` `SNAP_EVERY`).

## 데이터 주도 콘텐츠

챕터는 `ChapterDef` 데이터다.

- **흐름**: `steps[]`(연도·내레이션·목표) → 목표 종류(`talk`/`reach`/`defeat`/`battle`/`prompt`/`collect`/`auto`) → 선택지(`PromptDef`) → 효과 대수(`Effect`)와 조건 대수(`Cond`, 몸 변형 `variant` 포함).
- **효과 처리**: 순수 효과(능력치·국운·총애·수명·의심·분기 플래그 …)는 `rules/effects.ts#applyEffects`가 세이브에 적용한다. 런타임 효과(다음 카드·전투 시작·이동·목표 완료·공동 실록)는 `EffectOutcome`으로 돌려주고, `Session`이 실행한다(`host/session.ts` `#process`).
- **밀린 이야기의 영속**: 효과가 띄운 카드, 사사 위기 카드, 카드 뒤에서 기다리는 이야기 전투는 `save.pending`(`types.ts#PendingStory`, 순서 있는 목록)에 남아 다시 접속해도 같은 순서로 이어진다. 사사 위기 카드는 늘 맨 앞이다. 나머지 카드는 단계에서 다시 만든다. `rules/migrate.ts#migrateSave`는 그 목록을 세이브의 장과 대조해 모르는 항목과 중복을 버리고, 예전 형식(`pending:*` 플래그로 밀린 카드를 적던 세이브)을 한 번 `save.pending`으로 옮긴 뒤 그 플래그를 지운다. 이름이 바뀐 열쇠 물건(`letter` → `song_fan`)은 새 id로 합치되 개수를 더하지 않는다.
- **예약된 플래그 이름**: `pending:`·`completed:`·`reviveVirtue:`·`worldEventVirtue:`·`infiltration:`·`check:`로 시작하는 플래그는 호스트와 규칙이 쓴다. 콘텐츠는 이 접두사를 쓰지 않는다(`tests/unit/content.test.ts`).
- **규칙과 콘텐츠의 계약**: 콘텐츠는 rules를 가져올 수 없으므로, 규칙이 읽고 콘텐츠가 쓰는 플래그 이름은 `content/schema.ts`에 둔다(`#SCHOOL_FLAG`, `#DISCIPLE_XP_FLAG`). 실제 역사 노트는 종류가 달린 `#HistoryNote`, 보스의 기록·가상 구분은 필수 필드 `BossDef.historical`, 대체역사 표시는 `BattleDef.alt`·`PromptDef.alt`·`ChronicleEntry.alt`다([HISTORY.md](HISTORY.md) 1장).
- **조사**: 이름이나 지명 뒤의 조사는 `rules/util.ts#josa` 하나가 끝소리로 고른다(은/는, 이/가, 을/를, 과/와, 으로/로. ㄹ 받침은 '로', 숫자와 라틴 글자는 읽는 소리로, 」·) 같은 닫는 표시는 건너뛴다). 소리를 모르면 두 꼴을 함께 둔다('이(가)', '(으)로'). 세탁·유배·계승·시연 이력의 실록 줄, 아이템·공동 실록 토스트(`host/session.ts`, `host/channel.ts`), 침투도 설명, 지도의 이동 문구(`src/client/ui/menus/map.ts`)가 이것을 쓰고, 코드에 '(으)로'·'이(가)' 자리표시를 직접 쓰지 않는다(`tests/unit/rules-josa.test.ts`).
- **무결성 검사**: 새 챕터를 추가할 때 다음 테스트가 1차 관문이다.
  - `tests/unit/content.test.ts`: 모든 참조(지명·스프라이트·적·선택지·전투·NPC·기술·아이템·파벌), `demoStart`, 전투 목표의 자리, 보스 표시, `solemn`, 비극 카드의 보상, 대체역사 표시, 규칙이 읽는 플래그를 누가 쓰는지, 공동 실록 이름, 예약된 플래그 이름, 그리고 장·적·동료·엔딩·아이템·기술·출신·관직 전체의 금칙어.
  - `content-text.test.ts`: 문체('당신', 큰따옴표 없음), 괄호 표시 금지, 대체역사 카드의 '실제 역사에서 …', 노트 종류, 부제에 연도 없음, 기기 중립 목표 문구.
  - `content-contracts.test.ts`: `variant` 조건, 유파와 P3, 의병 차림, 세이브를 거친 대체역사 표시.
  - `content-host.test.ts`: `solemn` 목표에 토스트·효과음이 없음, 역사 카드 결과 카드 제목 '기록', 대체역사 전투 표시.

## 오프라인 모드(시연용 웹 빌드)

- `dist/jangsaeng.html` 한 파일에 모든 코드가 들어 있다. 페이지 안에서 `createGameHost({mode: "offline"})`가 돌고, 클라이언트는 루프백으로 붙는다(`src/client/net/offline.ts`).
- ◇동료는 채널당 `host/api.ts#DEFAULT_COMPANIONS`(8)명이다. 서버도 같은 값을 기본으로 쓰고 `BOTS`로만 바꾼다. UI와 채팅에 시뮬레이션임을 항상 표시한다.
- 브라우저 저장의 주인은 `src/client/storage.ts` 하나다. 키는 `jangsaeng:v1:` 접두사를 쓰고, 프로필은 `localStorage`에 둔다. 저장소를 읽을 수만 있으면(용량이 가득 찬 경우 포함) 저장된 프로필과 설정을 그대로 읽고, 쓰기에 실패한 키만 메모리에 둔다. 접근 자체가 막히면 모두 메모리로 대체한다. 접두사 이전의 설정 키 `jangsaeng.settings.v1`은 `carryLegacyKey`가 새 키에 실제로 저장된 뒤에만 지운다(`src/client/ui/settings.ts`).
- **세계 멈춤**: 한 사람의 오프라인 세계는 메뉴 책·휴대폰 서랍·채팅 입력·오류 화면이 열려 있는 동안 멈춘다(`Ui.holdsWorld`, `src/client/net/host-time.ts#HostTime`, `src/client/net/offline.ts#startOffline`). 호스트 시계가 멈춘 동안 보낸 메시지(입력·핑을 뺀 장착·기술 칸 등)마다 호스트 시간 0.3초(`HELD_BEAT_MS`)가 흘러 답이 오고, 풀려도 멈춘 시간을 되돌려 돌리지 않는다. 장 카드·이야기 카드·세월 계획은 세계를 멈추지 않는다(호스트가 카드 뒤의 이야기 전투를 붙잡는다, `host/session.ts` `#heldBattles`). 온라인 세계는 무엇이 열려도 멈추지 않는다.

## 클라이언트 표시

- **토스트**: 모달 UI 위에 그리지 않는다. 장 카드·이야기·결과 카드·세월 계획·메뉴 책·사경 화면(카운트다운 동안)·오류 화면·엔딩이 열려 있는 동안 보류하고, 닫히면 최근 4개를 보인다(`src/client/ui/index.ts` `sync`, `src/client/ui/toasts.ts#Toasts.hold`). 오류(`bad` 토스트)만 곧바로 독에 보인다. 독은 평소 화면 아래쪽 바닥 버튼 위에 있고(휴대폰 배치에서는 터치 기술 버튼을 가리지 않게 위쪽 상태 줄 아래), 카드·계획표·메뉴·서랍이 열려 있으면 위쪽 줄로 옮겨 시트의 선택지를 가리지 않는다(`src/client/styles.css` `.toast-dock`).
- **카드 교대**: 장 카드가 열리면 남아 있던 이야기·결과 카드와 세월 계획표를 먼저 닫는다(`src/client/ui/index.ts` `showCard`). 세월 계획표의 새 이름 칸은 고른 세탁 카드 바로 아래에 붙어 다른 세탁을 가리지 않는다(`src/client/ui/years.ts` `renderWashes`).
- **사경 화면**은 호스트의 사경 시간과 `SelfView.downed.help`만 따른다. 도와줄 수 있는 동안 카운트다운을 크게 보이고(0초는 보이지 않는다), 호스트의 시간이 0이 되거나 도와줄 사람이 없으면 스킬 막대 위의 작은 자력 소생 패로 닫혀 토스트 줄을 가리지 않는다(`src/client/ui/battle.ts#DownedOverlay`, GDD.md 3.7).
- **가림**: 사람·아군·적·보스 위를 덮는 지붕·성문·성벽 조각은 그 조각만 30%로 옅어진다(`src/client/game/scene.ts` `#fadeCovers`, `COVER_ALPHA`, `StructureDrawable.cover`). 치명타 낙관은 작게, 이름표 아래에 그리고(`src/client/game/flourish.ts`), 직선 경고(조총 일제 사격·돌진)는 4px 띠다(`src/client/game/fx.ts`).
- **이름표**: 자리 정책은 `src/client/game/plate-layout.ts` 하나다. 나·다른 사람·보스·이야기 NPC가 먼저 자리를 잡고, 겹치는 이름표는 두 번까지 위로 밀며, 그래도 겹치는 ◇동료·아군·NPC·적 이름표는 숨는다(체력 막대는 남는다). 적 이름표는 10타일 밖이거나 화면의 적이 8명을 넘으면 숨는다(`src/client/game/plates.ts`).
- **안개와 연기**: 색조·구름·비네트를 화면의 1/8 크기 층에 합성해 한 번에 늘여 그린다(`src/client/render/lighting.ts` `cloudLayerFor`, `CLOUD_DOWN`).
- **지도 이름**: 지도 탭의 지명은 겹치지 않는 자리를 찾고, 자리가 없으면 숨는다(`src/client/ui/menus/map.ts` `declutterNames`).

## 검증

| 명령 | 내용 |
|---|---|
| `npm run typecheck` | shared / client / server / tools 네 설정 |
| `npm test` | 단위·통합(`tests/unit/`): 맵·물리(명량 함대 11×4와 그 링에 해안이 없음 포함), 모든 장의 NPC·전장·이동 지점의 도보 도달성(`placement.test.ts`), 규칙(효과·엔딩·신분·수명·정치·성장·세이브·세월, 세월 계획의 예상 천수가 실제 세월 흐르기와 같음 `rules-years-projection.test.ts`, 조사 `rules-josa.test.ts`, 침투도 설명이 엔딩 규칙의 수치를 씀 `rules-infiltration-note.test.ts`), 월드(전투·패배 철수·채널 멤버의 단계·스냅숏·기술), ◇동료와 함께하는 전투 템포(`world-pacing.test.ts`: 개경 북문·명량·남한산성의 적장 시각과 끝나는 시각), 콘텐츠 넷(위 목록), 호스트 전체 아크(1361→1910 자동 진행)와 시연 경로·시연 시드·시연 계획표의 마지막 은혜, 호스트 전투(`host-battle.test.ts`: 이야기 시작과 해결된 전장, 링 가장자리 자력 소생, 진 전투의 무료 철수와 범위를 벗어났다 돌아올 때의 재시작, 건너뛰기, 전투에서 빠지기, 온라인 두 사람의 결과 처리와 재도전, 레벨업 토스트 하나, ◇동료의 도착 분산과 채팅 제한, ch16 s8 콜드 오픈, 모든 장·단계·경로를 시연 진입점으로), 서버 속도 관문, 클라이언트 이름표·문구·저장(예전 설정 키 이전 `client-storage.test.ts`)·세계 멈춤 시계와 천수 경고 단계(`client-hold.test.ts`) |
| `npm run build` | 서빙용 클라이언트 + 단일 파일 빌드 |
| `npm run test:e2e` | 헤드리스 Chromium으로 빌드를 띄워 제목→플레이 스모크(`--device=laptop|phone`, `--target=single|served|both`) |
| `node tools/preview/ui-check.mjs` | UI 상호작용: 선택지 키 고르기, 세월 계획 전송, 설정 저장과 실패한 쓰기, 토스트 보류와 독(세월 계획·결과 카드·메뉴 책·이야기 시트·사경 화면 아래), 메뉴 책의 세계 멈춤과 이야기 카드의 세계 진행, 긴 결과 카드에서 '계속'이 화면에 남음(노트북·휴대폰), 대체역사 리본, 사경 화면의 카운트다운(0초 없음)과 자력 소생 패(도와줄 이가 없으면 곧바로), 천수 경고 단계, 세월 계획표의 봉헌 스위치와 새 이름 칸이 첫 화면에 보임(새 이름 칸은 고른 세탁 바로 아래), 시연 격자 16장이 1280×720 한 화면에 보임과 휴대폰의 두 줄 문구, 지도 이름 겹침 없음, 휴대폰 메뉴 일곱 탭, 제목·도움말 문구, 엔딩 |
