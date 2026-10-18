// CH15 · 1882~1895 · 정변과 갑오년 — 분기 집중 구간.
// B5 군란 예방(재정 35), B6 온건 개혁 연합(개혁 45)과 톈진조약 경고, B7 중립화 외교(외교 48, 국방 40이면 42),
// B8 차병 반대·폐정 개혁(민심 43 + 톈진 경고) — 실패 시에만 경복궁 수비 서바이벌.
// 우금치·을미사변은 전투가 아닌 절제된 서사이며 보상과 잇지 않는다. 을미의병은 일본군 수비대와 싸운다.
// 사실 기준: E093~E100, E118, 분기 B5~B8.
import type { ChapterDef, Cond, Effect } from "../schema.ts";

const B5_OK: Cond = { k: "branch", id: "B5", ok: true };
const B6_OK: Cond = { k: "branch", id: "B6", ok: true };
const B8_OK: Cond = { k: "branch", id: "B8", ok: true };
const not = (of: Cond): Cond => ({ k: "not", of });

/** 선혜청 창고 대조: a wit check; last chapter's 체불 장부 raises the base chance. */
const seonhyeAudit = (base: number): Effect => ({
  k: "check",
  id: "ch15_seonhye",
  label: "창고 대조",
  stat: "wit",
  base,
  per: 1.2,
  success: [
    { k: "nation", key: "finance", add: 5 },
    { k: "flag", flag: "ch15_embezzle_found" },
    { k: "toast", text: "빼돌린 쌀 수백 섬이 나왔다. 재정 ▲", tone: "good" },
  ],
  failure: [
    { k: "suspicion", add: 3 },
    { k: "toast", text: "창고지기들이 장부를 불태웠다.", tone: "bad" },
  ],
});

export const ch15: ChapterDef = {
  id: "ch15",
  order: 15,
  title: "정변과 갑오년",
  subtitle: "외국 군대가 들어오는 문",
  years: [1882, 1895],
  level: [37, 39],
  music: "turmoil",
  season: "summer",
  weather: "clear",
  hour: 13,
  start: { site: "hanyang", offset: [0, 1] },
  briefing: [
    "1882년. 문은 열렸다. 이제 누가 그 문으로 들어오느냐가 문제다.",
    "청의 군대, 일본의 군대 — 한 번 들어온 군대는 쉽게 나가지 않는다.",
    "이 열세 해에는 갈림길이 넷 있다. 하나를 막으면 다음 갈림길이 조금 쉬워진다.",
    "그러나 하나를 막아도, 이 땅을 노리는 뜻은 사라지지 않는다.",
  ],
  history: [
    { kind: "fact", text: "1882년 조미수호통상조약에는 '거중조정' 조항이 들어갔다. 같은 해 임오군란이 일어나 청군이 주둔하고, 제물포조약으로 일본 공사관 경비병의 주둔이 허용되었다." },
    { kind: "fact", text: "1884년 급진 개화파가 갑신정변을 일으켰으나 청군 개입으로 사흘 만에 실패했다. 1885년 청·일은 톈진조약으로 파병 시 서로 미리 알리기로 했다." },
    { kind: "fact", text: "1885~1887년 영국이 거문도를 점령했다. 부들러와 유길준이 열강이 보장하는 조선 중립화를 제안했으나 실현되지 않았다." },
    { kind: "fact", text: "1894년 동학농민군이 전주성을 점령하자 정부가 청에 원병을 청했고, 일본군도 톈진조약을 근거로 들어왔다. 농민군은 전주화약을 맺고 해산했으나 일본군은 경복궁을 점령하고 청일전쟁을 일으켰다." },
    { kind: "fact", text: "1894년 겨울 농민군은 우금치에서 근대 화력에 크게 졌다. 1895년 10월 8일 일본 공사 미우라 고로의 주도로 왕비가 시해되었다(을미사변). 이에 분노한 유생들이 을미의병을 일으켰다." },
    { kind: "interp", text: "차병 요청만 없었다면 일본의 개입을 모두 막을 수 있었다고 보기는 어렵다. 일본은 공사관 보호를 명분으로 독자 출병할 수도 있었다." },
  ],
  hist: { defense: 22, finance: 20, people: 30, diplomacy: 25, reform: 35 },
  factions: [
    { id: "minssi", name: "민씨 정권", power: 55, lineage: "minssi", desc: "왕비 집안을 중심으로 한 집권 세력. 청에 기대는 일이 잦다." },
    { id: "onkon", name: "온건 개화 (김홍집·김윤식·어윤중)", power: 25, lineage: "gaehwa", desc: "옛 제도를 바탕으로 천천히 고쳐 가자는 관료들." },
    { id: "geupjin", name: "급진 개화 (김옥균·박영효)", power: 20, lineage: "gaehwa", desc: "일본의 근대화를 본받아 단번에 바꾸려는 젊은 관료들." },
    { id: "daewongun", name: "흥선대원군", power: 30, lineage: "daewongun", desc: "물러났으나 군란 때 다시 불려 나오는 섭정." },
    { id: "donghak", name: "동학 농민군", power: 20, desc: "보국안민과 폐정 개혁을 외치며 일어난 농민들." },
  ],
  ruling: "minssi",
  npcs: [
    {
      id: "kim_hongjip_jemulpo",
      name: "김홍집",
      title: "조약 부관",
      sprite: "official_blue",
      site: "jemulpo",
      offset: [1, -1],
      historical: true,
      talk: ["청이 주선한 조약이오. 그러나 서명은 우리가 하오.", "미국은 땅을 탐내지 않는다고들 하오. 정말 그럴지."],
      untilStep: "s1",
    },
    {
      id: "shufeldt",
      name: "슈펠트",
      title: "미국 전권",
      sprite: "western_envoy",
      site: "jemulpo",
      offset: [3, 0],
      historical: true,
      talk: ["Good offices — 서로 돕는다는 뜻이오.", "조선이 서양 나라와 맺는 첫 조약이오."],
      untilStep: "s1",
    },
    {
      id: "muwi_soldier",
      name: "무위영 군졸 돌쇠",
      title: "열세 달 녹봉 체불",
      sprite: "soldier_joseon",
      site: "hanyang",
      offset: [3, 3],
      talk: ["열세 달 만에 받은 쌀에 겨와 모래가 반이오.", "별기군 녀석들은 새 옷을 입고 다니는데."],
      fromStep: "s2",
      untilStep: "s4",
    },
    {
      id: "gojong",
      name: "고종",
      title: "국왕",
      sprite: "king_joseon",
      site: "hanyang",
      offset: [0, -3],
      historical: true,
      talk: ["청도 일본도 저마다 조선을 위한다 하오.", "이 나라를 지킬 군대가 없소."],
      fromStep: "s3",
      untilStep: "s13",
    },
    {
      id: "kim_hongjip",
      name: "김홍집",
      title: "온건 개화",
      sprite: "official_blue",
      site: "hanyang",
      offset: [-2, -2],
      historical: true,
      talk: ["제도는 하루아침에 바뀌지 않소.", "옛 것 위에 새 것을 얹어야 쓰러지지 않소."],
      fromStep: "s5",
      untilStep: "s6",
    },
    {
      id: "kim_okgyun",
      name: "김옥균",
      title: "급진 개화",
      sprite: "reformer",
      site: "hanyang",
      offset: [2, -2],
      historical: true,
      talk: ["일본은 삼십 년 만에 저렇게 바뀌었소.", "기다리다가는 나라가 먼저 없어지오."],
      fromStep: "s6",
      untilStep: "s6",
    },
    {
      id: "budler",
      name: "부들러",
      title: "독일 부영사",
      sprite: "western_envoy",
      site: "hanyang",
      offset: [4, -1],
      historical: true,
      talk: ["스위스나 벨기에처럼 — 열강이 함께 보장하는 중립이오.", "청과 일본이 서로 견제하는 지금이 기회요."],
      fromStep: "s8",
      untilStep: "s9",
    },
    {
      id: "yu_giljun",
      name: "유길준",
      title: "『중립론』의 저자",
      sprite: "reformer",
      site: "hanyang",
      offset: [-4, 0],
      historical: true,
      talk: ["중립은 약한 나라의 방패가 될 수 있소. 다만 스스로 지킬 힘이 있어야 하오.", "서양에서 본 것을 글로 남기고 있소."],
      fromStep: "s8",
      untilStep: "s9",
    },
    {
      id: "yuan_shikai",
      name: "위안스카이",
      title: "청 총리교섭통상사의",
      sprite: "qing_envoy",
      site: "hanyang",
      offset: [5, 2],
      historical: true,
      talk: ["조선은 대청의 속방이오.", "중립 따위는 쓸데없는 말이오."],
      fromStep: "s8",
      untilStep: "s9",
    },
    {
      id: "jo_byeongsik",
      name: "조병식",
      title: "함경도관찰사",
      sprite: "official_red",
      site: "hamheung",
      offset: [1, -1],
      historical: true,
      talk: ["원산 부두에서 콩이 배째로 빠져나가오.", "흉년에 곡식이 나가면 사람이 굶어 죽소."],
      fromStep: "s10",
      untilStep: "s10",
    },
    {
      id: "relief_widow",
      name: "갑오년 구휼소 아낙",
      sprite: "commoner_f",
      site: "gongju",
      offset: [2, 2],
      talk: ["쌀 한 됫박이면 아이 하나가 한 달을 사오.", "삼남이 다 굶소."],
      fromStep: "s11",
      untilStep: "s14",
    },
    {
      id: "jeon_bongjun",
      name: "전봉준",
      title: "동학농민군 대장",
      sprite: "donghak_peasant",
      site: "jeonju",
      offset: [2, 2],
      historical: true,
      talk: ["우리는 나라를 뒤엎자는 것이 아니오. 탐관오리를 없애자는 것이오.", "외국 군대가 들어오면 그때는 이야기가 달라지오."],
      fromStep: "s12",
      untilStep: "s12",
    },
    {
      id: "uibyeong_scholar",
      name: "제천 유생 의병장",
      title: "을미의병",
      sprite: "righteous_army",
      site: "wonju",
      offset: [-2, 1],
      fights: true,
      talk: ["국모의 원수를 갚지 않고 어찌 선비라 하겠소.", "상투를 자르라니 — 목을 자르는 것이 낫소."],
      fromStep: "s16",
    },
  ],
  spawns: [
    { id: "sp_road_bandit", enemy: "bandit", site: "gongju", offset: [-3, 3], radius: 4, count: 3, level: 37, respawnSec: 90, fromStep: "s8", untilStep: "s14" },
    { id: "sp_jp_patrol", enemy: "japanese_infantry", site: "jemulpo", offset: [2, 3], radius: 4, count: 3, level: 38, respawnSec: 90, fromStep: "s13", untilStep: "s17" },
    { id: "sp_winter_wolf", enemy: "wolf", site: "wonju", offset: [4, -3], radius: 4, count: 3, level: 38, respawnSec: 90, fromStep: "s16", untilStep: "s17" },
  ],
  battles: [
    {
      id: "b_imo_escape",
      title: "임오년 6월 — 장호원 가는 길",
      subtitle: "1882.7 · 도성 동쪽",
      site: "hanyang",
      offset: [5, 2],
      radius: 7,
      kind: "escape",
      timeLimit: 55,
      music: "turmoil",
      weather: "smoke",
      intro: [
        "군란이 궁궐로 번졌다. 궁녀 차림의 한 여인과 궁인들을 데리고 동쪽 문으로 빠져나가야 한다.",
        "저들도 열세 달을 굶은 군사다. 막되, 쫓아가 베지는 마라.",
      ],
      waves: [
        { at: 0, from: "west", enemies: [{ enemy: "pursuer", count: 3, level: 37 }], line: "궁문 쪽에서 군중이 쏟아진다!" },
        { at: 20, from: "north", enemies: [{ enemy: "pursuer", count: 4, level: 37 }], line: "골목을 막아라. 궁인들이 먼저 지나간다." },
        { at: 40, from: "west", enemies: [{ enemy: "pursuer", count: 3, level: 38 }], line: "동대문이 보인다!" },
      ],
      allies: [{ sprite: "soldier_joseon", name: "무예청 무사", count: 2 }],
      victory: [
        { k: "point", point: "virtue", add: 40 },
        { k: "exp", add: 2000 },
        { k: "prompt", prompt: "p_b5_fail" },
      ],
      defeat: [{ k: "toast", text: "골목이 막혔다. 다른 길로 돌아 다시 동쪽으로.", tone: "warn" }],
    },
    {
      id: "b_gyeongbok",
      title: "경복궁의 새벽",
      subtitle: "1894.7.23 · 경복궁",
      site: "hanyang",
      offset: [0, -4],
      radius: 7,
      kind: "survive",
      timeLimit: 70,
      music: "siege",
      weather: "smoke",
      intro: [
        "새벽, 일본군이 영추문을 부수고 들어온다. 궁궐 수비대는 적다.",
        "이길 수 없다. 궁인들이 건청궁 뒤로 피할 때까지만 버티고, 물러나라.",
      ],
      waves: [
        { at: 0, from: "west", enemies: [{ enemy: "japanese_infantry", count: 4, level: 38 }], line: "영추문이 뚫렸다!" },
        { at: 25, from: "south", enemies: [{ enemy: "japanese_vanguard", count: 3, level: 38 }, { enemy: "japanese_infantry", count: 2, level: 38 }], line: "광화문 쪽에서도 들어온다!" },
        { at: 50, from: "around", enemies: [{ enemy: "japanese_infantry", count: 4, level: 39 }], line: "궁인들이 빠져나갔다. 이제 물러나라!" },
      ],
      allies: [{ sprite: "soldier_joseon", name: "궁궐 수비병", count: 4 }],
      victory: [
        { k: "point", point: "virtue", add: 40 },
        { k: "point", point: "honor", add: 10 },
        { k: "exp", add: 2400 },
        { k: "prompt", prompt: "p_gyeongbok" },
      ],
      defeat: [{ k: "toast", text: "회랑이 막혔다. 다시 궁인들 곁으로.", tone: "warn" }],
    },
    {
      id: "b_eulmi",
      title: "을미의병 — 수비대 습격",
      subtitle: "을미년 겨울 · 원주·제천 일대",
      site: "wonju",
      offset: [3, 2],
      radius: 7,
      kind: "waves",
      music: "resistance",
      weather: "snow",
      intro: [
        "고갯길 아래 일본군 병참 수비대가 있다. 의병의 무기는 화승총과 칼이다.",
        "소총의 사거리 안에서 서 있지 마라. 눈 덮인 바위를 타고 다가가라.",
      ],
      waves: [
        { from: "east", enemies: [{ enemy: "japanese_infantry", count: 4, level: 38 }], line: "수비대 초소다. 바위 뒤로!" },
        { from: "north", enemies: [{ enemy: "japanese_infantry", count: 3, level: 39 }, { enemy: "japanese_vanguard", count: 2, level: 39 }], line: "돌격병이 내려온다. 고갯마루에서 맞아라." },
        { from: "east", enemies: [{ enemy: "japanese_infantry", count: 5, level: 39 }], line: "증원이다 — 의병장이 퇴각 신호를 기다린다." },
      ],
      allies: [{ sprite: "righteous_army", name: "을미 의병", count: 7 }],
      victory: [
        { k: "point", point: "merit", add: 80 },
        { k: "point", point: "honor", add: 15 },
        { k: "exp", add: 3000 },
        { k: "favor", faction: "uibyeong", add: 15 },
        { k: "nation", key: "people", add: 2 },
        { k: "chronicle", text: "을미년 겨울, 의병의 깃발 아래 다시 섰다. 삼백 년 전 임진년처럼." },
      ],
      defeat: [{ k: "toast", text: "눈밭에 흩어졌다. 고갯마루에서 다시 모인다.", tone: "warn" }],
    },
  ],
  prompts: [
    {
      id: "p_us_treaty",
      title: "제물포의 조약",
      speaker: { name: "김홍집", sprite: "official_blue" },
      body: [
        "1882년 5월. 청의 리훙장이 주선한 조약이오. 영사 재판과 최혜국 대우가 들어 있소. 불평등하오.",
        "다만 한 조항이 있소. 제3국이 한쪽을 부당하게 대하면 다른 한쪽이 사이에서 돕는다 — '거중조정'.",
        "이 문장을 얼마나 단단히 적느냐가 훗날 쓸모가 있을지 모르오.",
      ],
      options: [
        {
          id: "press",
          text: "거중조정이 실제로 작동하도록 문구를 다듬읍시다.",
          hint: "지략 판정 · 외교 ▲ · 훗날 B12a 보정",
          effects: [
            {
              k: "check",
              id: "ch15_geojung",
              label: "거중조정 문구",
              stat: "wit",
              base: 35,
              per: 1,
              success: [
                { k: "flag", flag: "ch15_geojung" },
                { k: "nation", key: "diplomacy", add: 3 },
                { k: "toast", text: "조문이 단단해졌다. 그러나 조문은 지키려는 쪽이 있어야 작동한다.", tone: "good" },
              ],
              failure: [
                { k: "nation", key: "diplomacy", add: 1 },
                { k: "toast", text: "문구는 그대로 남았다.", tone: "info" },
              ],
            },
          ],
        },
        {
          id: "watch",
          text: "조인식을 지켜본다.",
          effects: [{ k: "nation", key: "diplomacy", add: 1 }],
        },
      ],
    },
    {
      id: "p_seonhye",
      title: "선혜청의 쌀",
      speaker: { name: "무위영 군졸 돌쇠", sprite: "soldier_joseon" },
      body: [
        "열세 달 만에 한 달 치 쌀을 준다 해서 갔더니, 겨와 모래가 반이었소.",
        "선혜청 창고지기들이 빼돌렸다는 말이 파다하오. 높은 분들은 모른 척하고.",
        "나리, 이대로면 무슨 일이 날 것 같소.",
      ],
      options: [
        {
          id: "audit",
          text: "선혜청 장부와 창고를 맞대 보겠네.",
          hint: "지략 판정 → 재정 ▲ (지난 장 체불 장부가 있으면 유리)",
          effects: [
            {
              k: "if",
              cond: { k: "flag", flag: "ch14_pay_gap_noted" },
              then: [seonhyeAudit(50)],
              else: [seonhyeAudit(35)],
            },
          ],
        },
        {
          id: "listen",
          text: "자네들 사정을 위에 전하겠네.",
          hint: "민심 ▲",
          effects: [{ k: "nation", key: "people", add: 1 }],
        },
      ],
    },
    {
      id: "p_b5",
      title: "밀린 녹봉",
      speaker: { name: "고종", sprite: "king_joseon" },
      body: [
        "옛 군영 군사들의 녹봉이 열세 달 밀렸다 하오. 국고가 비었소.",
        "별기군을 기르느라 쓸 돈이 없다는 말도 들었소.",
        "그대는 어찌하면 좋겠소?",
      ],
      options: [
        {
          id: "pay",
          text: "국고를 열어 밀린 녹봉부터 주고, 군영의 처우를 고르게 하십시오.",
          hint: "B5 조건: 재정 35 · 재정 −4 · 국방 ▲ · 군란 예방",
          requires: { k: "nation", key: "finance", min: 35 },
          lockedText: "재정 35 이상이어야 지급할 수 있다",
          effects: [
            { k: "branch", id: "B5", ok: true },
            { k: "nation", key: "finance", add: -4 },
            { k: "nation", key: "people", add: 3 },
            { k: "nation", key: "defense", add: 2 },
            { k: "nation", key: "reform", add: 2 },
            { k: "nation", key: "diplomacy", add: 2 },
            { k: "chronicle", text: "1882년 6월, 밀린 녹봉이 지급되었다. 군란은 일어나지 않았다.", alt: true },
            { k: "toast", text: "B5 성공 — 외국 군대가 들어올 구실이 사라졌다.", tone: "epic" },
          ],
        },
        {
          id: "own",
          text: "제 재산으로 한 달 치라도 먼저 나누겠습니다.",
          hint: "B5 실패 · 전 −400 · 공덕 ▲",
          requires: { k: "point", point: "money", min: 400 },
          lockedText: "전 400이 필요하다",
          effects: [
            { k: "branch", id: "B5", ok: false },
            { k: "point", point: "money", add: -400 },
            { k: "point", point: "virtue", add: 40 },
            { k: "toast", text: "한 달 치로는 열세 달의 굶주림을 메울 수 없었다.", tone: "bad" },
          ],
        },
        {
          id: "wait",
          text: "조정의 처분을 기다리겠습니다.",
          hint: "B5 실패",
          effects: [
            { k: "branch", id: "B5", ok: false },
          ],
        },
      ],
    },
    {
      id: "p_b5_ok",
      title: "일어나지 않은 군란",
      style: "history",
      body: [
        "6월의 장마철, 군영은 조용했다. 도성에 청군도, 일본 공사관 경비병도 들어오지 않았다.",
        "실제 역사에서는 1882년 6월 9일 임오군란이 일어났다. 청은 대원군을 톈진으로 데려갔고, 일본은 제물포조약으로 공사관 경비병을 두었다.",
        "청과 일본의 눈은 여전히 이 땅에 있다. 다만 그 눈 앞에 칼은 없다.",
      ],
      options: [{ id: "go", text: "다음 해로.", effects: [{ k: "exp", add: 1000 }] }],
    },
    {
      id: "p_b5_fail",
      title: "임오군란",
      style: "history",
      body: [
        "1882년 6월 9일, 구식 군인들이 봉기했다. 선혜청 당상 민겸호가 죽고 일본 공사관과 궁궐이 습격당했다. 왕비는 궁녀 차림으로 장호원으로 피신했다.",
        "대원군이 다시 정권을 잡았으나, 청군이 들어와 대원군을 톈진으로 데려갔다. 청은 수천 명의 군대를 남겼다.",
        "일본은 제물포조약으로 배상금과 공사관 경비병의 주둔을 얻었다. 외국 군대 둘이 한 도성에 머물게 되었다.",
      ],
      options: [{ id: "go", text: "적어 둔다.", effects: [{ k: "chronicle", text: "1882년, 임오군란. 외국 군대가 도성에 들어왔다." }] }],
    },
    {
      id: "p_onkon",
      title: "옛 것 위에 새 것을",
      speaker: { name: "김홍집", sprite: "official_blue" },
      body: [
        "김옥균 등 젊은 이들이 서두르고 있소. 그들의 뜻은 옳으나 방법이 걱정이오.",
        "우리는 옛 제도를 바탕으로 천천히 고쳐 가려 하오. 무관이 한 사람이라도 곁에 있으면 힘이 되오.",
      ],
      options: [
        {
          id: "join",
          text: "온건 개화파와 함께 군제 개편안을 짜겠습니다.",
          hint: "개혁 ▲ · 온건 개화 총애 ▲",
          effects: [
            { k: "nation", key: "reform", add: 3 },
            { k: "favor", faction: "onkon", add: 15 },
          ],
        },
        {
          id: "listen",
          text: "양쪽 이야기를 다 들어 보겠습니다.",
          hint: "지략 ▲",
          effects: [{ k: "stat", stat: "wit", add: 1 }],
        },
      ],
    },
    {
      id: "p_gapsin",
      title: "우정총국의 밤을 앞두고",
      speaker: { name: "김옥균", sprite: "reformer" },
      body: [
        "1884년 겨울. 우정총국 개국 축하연에서 일을 벌이려 하오. 민씨 일파를 몰아내고 새 정부를 세울 것이오.",
        "일본 공사관이 군사를 빌려주기로 했소. 청군이 손쓰기 전에 끝낼 수 있소.",
        "그대처럼 칼을 아는 사람이 필요하오. 함께하겠소?",
      ],
      options: [
        {
          id: "join",
          text: "함께하겠소.",
          hint: "B6 실패 · 급진 개화 총애 ▲▲ · 숙청 판정",
          risk: { id: "ch15_gapsin", intensity: 40, winner: "minssi", loser: "geupjin" },
          effects: [
            { k: "branch", id: "B6", ok: false },
            { k: "favor", faction: "geupjin", add: 25 },
            { k: "align", faction: "geupjin" },
            { k: "purge", spec: { id: "ch15_gapsin", intensity: 40, winner: "minssi", loser: "geupjin" } },
          ],
        },
        {
          id: "dissuade",
          text: "남의 군대를 빌린 개혁은 남의 것이 되오. 온건파와 손잡고 함께 고칩시다.",
          hint: "B6 조건: 개혁 45 · 성공 시 개혁 ▲",
          effects: [
            {
              k: "if",
              cond: { k: "nation", key: "reform", min: 45 },
              then: [
                { k: "branch", id: "B6", ok: true },
                { k: "nation", key: "reform", add: 5 },
                { k: "nation", key: "diplomacy", add: 2 },
                { k: "favor", faction: "geupjin", add: 5 },
                { k: "favor", faction: "onkon", add: 10 },
                { k: "chronicle", text: "1884년 겨울, 우정총국의 연회는 연회로 끝났다. 개화파가 한자리에 앉았다.", alt: true },
                { k: "toast", text: "B6 성공 — 온건 개혁 연합이 섰다.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B6", ok: false },
                { k: "toast", text: "김옥균은 고개를 저었다. '그대의 연합에는 힘이 없소.'", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "inform",
          text: "자리를 뜬 뒤, 이 계획을 조정에 고한다.",
          hint: "B6 실패 · 민씨 정권 총애 ▲ · 명예 ▼▼ · 변절",
          effects: [
            { k: "branch", id: "B6", ok: false },
            { k: "favor", faction: "minssi", add: 20 },
            { k: "point", point: "honor", add: -20 },
            { k: "flag", flag: "turncoat", value: true },
            { k: "flag", flag: "ch15_informed_gapsin" },
          ],
        },
      ],
    },
    {
      id: "p_gapsin_ok",
      title: "연회로 끝난 연회",
      style: "history",
      body: [
        "우정총국의 불은 등불로만 켜졌다. 급진파와 온건파가 한 상에 앉아 개혁의 순서를 다투었다.",
        "실제 역사에서는 1884년 12월 4일 정변이 일어나 사흘 만에 실패했다. 홍영식이 죽고 김옥균·박영효·서재필 등은 일본으로 망명했다.",
        "1885년 4월, 청과 일본은 톈진에서 조약을 맺었다. 조선은 그 자리에 없었다.",
      ],
      options: [{ id: "go", text: "톈진의 조문을 읽어 본다.", effects: [{ k: "exp", add: 800 }] }],
    },
    {
      id: "p_gapsin_fail",
      title: "사흘",
      style: "history",
      body: [
        "1884년 12월 4일, 우정총국 개국 축하연에서 정변이 일어났다. 개화파는 새 정부를 세우고 정강을 발표했다.",
        "12월 6일 청군이 개입하자 일본군은 물러났다. 정변은 사흘 만에 끝났다. 홍영식이 죽고 김옥균 등은 일본으로 망명했다.",
        "1885년 4월, 청과 일본은 톈진조약을 맺어 두 나라 군대를 물리고, 앞으로 조선에 군대를 보낼 때는 서로 미리 알리기로 했다. 조선은 그 자리에 없었다.",
      ],
      options: [{ id: "go", text: "톈진의 조문을 읽어 본다.", effects: [{ k: "exp", add: 600 }] }],
    },
    {
      id: "p_tianjin",
      title: "서로 미리 알린다",
      speaker: { name: "고종", sprite: "king_joseon" },
      body: [
        "청과 일본이 군대를 물린다 하오. 다행한 일 아니오?",
        "다만 '앞으로 군대를 보낼 때는 서로 미리 알린다'는 조문이 있소.",
      ],
      options: [
        {
          id: "warn",
          text: "그 조문은 한쪽이 군대를 보내면 다른 쪽도 보낸다는 뜻입니다. 언젠가 우리가 청병을 부르는 날, 일본군도 옵니다.",
          hint: "지략 30 필요 · B8 조건 '톈진 경고' · 외교 ▲",
          requires: { k: "stat", stat: "wit", min: 30 },
          lockedText: "지략 30 이상 필요",
          effects: [
            { k: "flag", flag: "ch15_tianjin_warned" },
            { k: "nation", key: "diplomacy", add: 3 },
            { k: "toast", text: "고종의 얼굴이 굳었다. 그 말은 장부에 적혔다.", tone: "good" },
          ],
        },
        {
          id: "elders",
          text: "원로 대신들에게 이 조문의 위험을 차례로 설명하겠습니다.",
          hint: "처세 판정 → B8 조건 '톈진 경고'",
          effects: [
            {
              k: "check",
              id: "ch15_tianjin_elders",
              label: "원로 설득",
              stat: "tact",
              base: 40,
              per: 1.2,
              success: [
                { k: "flag", flag: "ch15_tianjin_warned" },
                { k: "nation", key: "diplomacy", add: 2 },
                { k: "toast", text: "원로 몇이 고개를 끄덕였다. 조정에 경계가 생겼다.", tone: "good" },
              ],
              failure: [{ k: "toast", text: "'청이 있는데 무슨 걱정인가.'", tone: "info" }],
            },
          ],
        },
        { id: "nod", text: "다행한 일입니다.", hint: "변화 없음", effects: [] },
      ],
    },
    {
      id: "p_budler",
      title: "열강이 보장하는 중립",
      speaker: { name: "부들러", sprite: "western_envoy" },
      body: [
        "1885년 봄, 영국이 러시아를 막는다며 거문도를 점령했소. 조선은 항의했지만 힘이 없소.",
        "청·일·러가 함께 조선의 중립을 보장하게 하면, 어느 한 나라도 조선을 삼키지 못하오.",
        "다만 각국 공사관을 하나하나 설득해야 하오.",
      ],
      options: [
        {
          id: "tour",
          text: "공사관을 돌며 중립안을 설명하겠습니다.",
          hint: "지략 판정 · 외교 ▲",
          effects: [
            {
              k: "check",
              id: "ch15_budler_tour",
              label: "공사관 순회",
              stat: "wit",
              base: 35,
              per: 1.2,
              success: [
                { k: "nation", key: "diplomacy", add: 4 },
                { k: "toast", text: "러시아와 미국 공사관이 관심을 보였다.", tone: "good" },
              ],
              failure: [
                { k: "nation", key: "diplomacy", add: 1 },
                { k: "toast", text: "대답은 모두 '본국에 묻겠다'였다.", tone: "info" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p_yugiljun",
      title: "중립론",
      speaker: { name: "유길준", sprite: "reformer" },
      body: [
        "중립은 약한 나라의 방패가 될 수 있소. 벨기에가 그렇소.",
        "그러나 스스로 지킬 군대가 없는 중립은 종이에 그린 성벽이오.",
        "글은 내가 쓰겠소. 무관인 그대는 그 성벽에 돌을 쌓아 주시오.",
      ],
      options: [
        {
          id: "draft",
          text: "중립안에 해안 방어 계획을 덧붙입시다.",
          hint: "외교 ▲ · 국방 ▲",
          effects: [
            { k: "nation", key: "diplomacy", add: 3 },
            { k: "nation", key: "defense", add: 2 },
          ],
        },
        {
          id: "reform",
          text: "먼저 나라 안의 제도부터 고쳐야 합니다.",
          hint: "개혁 ▲",
          effects: [{ k: "nation", key: "reform", add: 2 }],
        },
      ],
    },
    {
      id: "p_yuan",
      title: "청의 감독관",
      speaker: { name: "위안스카이", sprite: "qing_envoy" },
      body: [
        "조선은 대청의 속방이오. 중립이라니, 누구의 허락을 받았소?",
        "조선 왕이 러시아와 손잡으려 한다는 소문이 있소. 경거망동하지 마시오.",
      ],
      options: [
        {
          id: "calm",
          text: "중립은 청에도 이롭습니다. 일본과 러시아가 이 땅을 넘보지 못하게 되니까요.",
          hint: "처세 판정 · 외교 ▲",
          effects: [
            {
              k: "check",
              id: "ch15_yuan",
              label: "청 설득",
              stat: "tact",
              base: 25,
              per: 1.2,
              success: [
                { k: "nation", key: "diplomacy", add: 3 },
                { k: "toast", text: "위안스카이는 반대하지 않겠다고만 말했다.", tone: "good" },
              ],
              failure: [
                { k: "suspicion", add: 3 },
                { k: "toast", text: "'그대의 이름을 기억해 두겠소.'", tone: "bad" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p_b7",
      title: "중립화를 국책으로",
      speaker: { name: "고종", sprite: "king_joseon" },
      body: [
        "1887년 2월, 영국이 거문도에서 물러났소. 러시아가 조선 땅을 차지하지 않겠다고 약속했다 하오.",
        "부들러와 유길준의 중립안이 내 앞에 있소. 청은 반대하고, 대신들은 망설이오.",
        "그대는 이것을 나라의 길로 삼으라 하겠소?",
      ],
      options: [
        {
          id: "neutral",
          text: "열강의 보장을 받는 중립을 국책으로 삼으십시오.",
          hint: "B7 조건: 외교 48 (국방 40이면 외교 42) · 효과는 국방이 받쳐야 산다",
          effects: [
            {
              k: "if",
              cond: {
                k: "any",
                of: [
                  { k: "nation", key: "diplomacy", min: 48 },
                  { k: "all", of: [{ k: "nation", key: "diplomacy", min: 42 }, { k: "nation", key: "defense", min: 40 }] },
                ],
              },
              then: [
                { k: "branch", id: "B7", ok: true },
                { k: "nation", key: "diplomacy", add: 2 },
                { k: "longFlag", flag: "neutral_policy", key: "diplomacy", add: 3 },
                { k: "nation", key: "infiltration", add: -5 },
                { k: "chronicle", text: "1887년, 조선 중립화가 국책이 되었다. 각국 공사관에 공문이 돌았다.", alt: true },
                { k: "toast", text: "B7 성공 — 국제 승인의 기반이 생겼다. 국방이 받쳐 줘야 효과가 난다.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B7", ok: false },
                { k: "toast", text: "공사관들의 답은 끝내 오지 않았다. 중립안은 서랍에 들어갔다.", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "qing",
          text: "지금은 청에 기대는 것이 안전합니다.",
          hint: "B7 실패 · 민씨 정권 총애 ▲",
          effects: [
            { k: "branch", id: "B7", ok: false },
            { k: "favor", faction: "minssi", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_banggok",
      title: "원산 부두의 콩",
      speaker: { name: "조병식", sprite: "official_red" },
      body: [
        "1889년, 흉년이오. 그런데 원산 부두에서는 콩과 쌀이 배째로 일본으로 나가오.",
        "조약에는 한 달 전에 알리면 곡식 반출을 막을 수 있다 했소. 방곡령을 내리려 하오.",
      ],
      options: [
        {
          id: "procedure",
          text: "통고 절차부터 빈틈없이 지키십시오. 꼬투리를 주면 배상을 물게 됩니다.",
          hint: "민심 ▲ · 재정 ▲ · 침투도 ▼",
          effects: [
            { k: "nation", key: "people", add: 3 },
            { k: "nation", key: "finance", add: 2 },
            { k: "nation", key: "infiltration", add: -5 },
            { k: "worldEvent", add: 20 },
            { k: "toast", text: "통고문이 한 달 전에 일본 영사관에 닿았다. 배상의 꼬투리가 사라졌다.", tone: "good" },
          ],
        },
        {
          id: "now",
          text: "굶는 사람이 먼저입니다. 당장 내리십시오.",
          hint: "민심 ▲ · 훗날 배상 (재정 ▼)",
          effects: [
            { k: "nation", key: "people", add: 2 },
            { k: "nation", key: "finance", add: -2 },
            { k: "worldEvent", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_relief",
      title: "갑오년 구휼",
      speaker: { name: "갑오년 구휼소 아낙", sprite: "commoner_f" },
      body: [
        "고부에서 군수의 수탈을 참다못해 사람들이 일어났다 하오. 여기도 쌀이 없소.",
        "쌀을 나르는 수레가 도적에게 털리오.",
      ],
      options: [
        {
          id: "give",
          text: "곳간을 열고 수레를 지키겠소.",
          hint: "민심 ▲ · 공덕 ▲ · 공동 실록 ▲",
          effects: [
            { k: "nation", key: "people", add: 2 },
            { k: "point", point: "virtue", add: 40 },
            { k: "worldEvent", add: 25 },
          ],
        },
      ],
    },
    {
      id: "p_b8",
      title: "청병을 부를 것인가",
      speaker: { name: "고종", sprite: "king_joseon" },
      body: [
        "1894년 5월, 동학농민군이 황토현과 황룡촌에서 관군을 이기고 전주성을 차지했소.",
        "대신들은 청에 군대를 빌리자 하오. 그러면 일본도 군대를 보낼 것이라는 말도 있소.",
        "그대의 말을 듣겠소.",
      ],
      options: [
        {
          id: "refuse",
          text: "청병을 부르지 마십시오. 제가 전주로 내려가 폐정 개혁을 약속하고 화약을 맺겠습니다.",
          hint: "B8 조건: 민심 43 + 톈진 경고 · 성공 시 민심 ▲▲",
          effects: [
            {
              k: "if",
              cond: { k: "all", of: [{ k: "nation", key: "people", min: 43 }, { k: "flag", flag: "ch15_tianjin_warned" }] },
              then: [
                { k: "branch", id: "B8", ok: true },
                { k: "nation", key: "people", add: 8 },
                { k: "favor", faction: "donghak", add: 20 },
                { k: "chronicle", text: "1894년 5월, 청병을 부르지 않았다. 사절로 전주에 내려갔다.", alt: true },
                { k: "toast", text: "B8 성공 — 일본군이 들어올 명분이 약해졌다.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B8", ok: false },
                { k: "toast", text: "회의는 이미 청병 요청으로 기울어 있었다. 아산에 청군이, 인천에 일본군이 들어왔다.", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "call",
          text: "청군의 힘을 빌려 빨리 끝내야 합니다.",
          hint: "B8 실패 · 침투도 +20",
          effects: [
            { k: "branch", id: "B8", ok: false },
            { k: "favor", faction: "minssi", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_jeonju_alt",
      title: "전주의 약속",
      speaker: { name: "전봉준", sprite: "donghak_peasant" },
      body: [
        "청병을 부르지 않았다고요? 그렇다면 우리도 성을 내어 줄 수 있소.",
        "탐관오리를 벌하고, 묵은 빚을 없애고, 고을마다 우리 집강소를 두게 해 주시오.",
        "약속이 지켜지는지, 우리는 고향에서 지켜보겠소.",
      ],
      options: [
        {
          id: "promise",
          text: "조정에 그 약속을 지키게 하겠소.",
          hint: "민심 ▲ · 공동 실록 ▲",
          effects: [
            { k: "nation", key: "people", add: 3 },
            { k: "nation", key: "reform", add: 2 },
            { k: "worldEvent", add: 20 },
          ],
        },
      ],
    },
    {
      id: "p_jeonju",
      title: "전주화약",
      speaker: { name: "전봉준", sprite: "donghak_peasant" },
      body: [
        "청군이 아산에, 일본군이 인천에 들어왔소. 우리가 싸우는 사이에 남의 군대가 이 땅에 섰소.",
        "폐정 개혁을 약속하면 성을 내주고 해산하겠소. 외국 군대가 머물 구실을 없애야 하오.",
      ],
      options: [
        {
          id: "promise",
          text: "그 약속이 지켜지도록 힘쓰겠소.",
          hint: "민심 ▲",
          effects: [
            { k: "nation", key: "people", add: 2 },
            { k: "worldEvent", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_b8_ok",
      title: "점령되지 않은 궁궐",
      style: "history",
      body: [
        "일본군은 들어올 명분을 얻지 못했다. 공사관 경비를 내세운 소수 병력만이 제물포에 남았다.",
        "실제 역사에서는 1894년 7월 23일 일본군이 경복궁을 점령했고, 청일전쟁이 이어졌다. 군국기무처가 갑오개혁을 추진했다.",
        "그러나 청과 일본은 여전히 이 땅을 두고 서로를 노려본다. 막은 것은 한 번의 문일 뿐이다.",
      ],
      options: [{ id: "go", text: "다음 계절로.", effects: [{ k: "exp", add: 1000 }] }],
    },
    {
      id: "p_gyeongbok",
      title: "점령된 궁궐",
      style: "history",
      body: [
        "1894년 7월 23일, 일본군이 경복궁을 점령하고 친일 내각을 세웠다. 이틀 뒤 풍도 앞바다에서 청일전쟁이 시작되었다.",
        "군국기무처는 과거제와 신분제를 없애는 갑오개혁을 밀어붙였다. 근대적 개혁이었으나 일본군의 압력 아래에서 시작되었다는 한계가 지적된다.",
        "9월 평양 전투와 황해 해전에서 일본이 이겼다.",
      ],
      options: [{ id: "go", text: "적어 둔다.", effects: [{ k: "chronicle", text: "1894년 7월 23일, 경복궁이 점령되었다." }] }],
    },
    {
      id: "p_ugeumchi",
      title: "우금치",
      style: "history",
      body: [
        "가을, 일본의 궁궐 점령에 맞서 농민군이 다시 일어났다. 남접과 북접이 함께 북으로 올라왔다.",
        "음력 11월 8일부터 11일까지, 공주 우금치에서 농민군은 일본군과 관군의 근대 소총 앞에 크게 졌다.",
        "전봉준은 12월 순창에서 붙잡혀 이듬해 봄 처형되었다. 희생자의 수는 아직도 정확히 알지 못한다.",
        "당신은 그 고개에서 칼을 들지 않았다. 고개 아래에서 할 수 있는 일을 했다.",
      ],
      options: [
        {
          id: "escape",
          text: "흩어지는 농민군에게 산길과 숨을 집을 알려 준다.",
          hint: "공덕 ▲ · 의심도 ▲",
          effects: [
            { k: "point", point: "virtue", add: 50 },
            { k: "suspicion", add: 6 },
            { k: "chronicle", text: "1894년 겨울, 우금치 아래에서 몇 사람을 산으로 보냈다." },
          ],
        },
        {
          id: "wounded",
          text: "부상자를 거두어 의원에게 데려간다.",
          hint: "공덕 ▲",
          effects: [{ k: "point", point: "virtue", add: 40 }],
        },
      ],
    },
    {
      id: "p_jipgangso",
      title: "집강소의 가을",
      style: "history",
      body: [
        "전주화약 뒤 전라도 고을마다 농민들의 집강소가 서서 폐정 개혁을 살폈다.",
        "궁궐이 점령되지 않았으니, 가을의 두 번째 봉기도 일어나지 않았다. 우금치 고개는 그냥 고개로 남았다.",
        "실제 역사에서는 그해 가을 농민군이 다시 일어났고, 공주 우금치에서 일본군과 관군에 크게 졌다.",
        "다만 개혁의 약속은 아직 반도 지켜지지 않았다. 사람들은 지켜보고 있다.",
      ],
      options: [{ id: "go", text: "다음 해로.", effects: [{ k: "nation", key: "people", add: 2 }] }],
    },
    {
      id: "p_eulmi",
      title: "1895년 10월 8일",
      style: "history",
      body: [
        "청일전쟁 뒤 러시아·독일·프랑스가 일본을 압박했다(삼국간섭). 조정은 러시아와 가까워졌다.",
        "10월 8일 새벽, 일본 공사 미우라 고로의 주도로 일본 군경과 낭인들이 경복궁에 침입해 왕비를 시해했다.",
        "당신은 그날 궁궐 밖 먼 곳에 있었다. 소식은 아침 늦게 닿았다.",
        "오백 년 동안 많은 죽음을 보았다. 그러나 남의 나라 공사가 남의 나라 궁궐에 칼을 들인 날은 처음이었다.",
      ],
      options: [
        {
          id: "record",
          text: "그날을 적는다.",
          effects: [{ k: "chronicle", text: "1895년 10월 8일. 을미사변. 그날을 적었다." }],
        },
      ],
    },
    {
      id: "p_uibyeong_1895",
      title: "단발령",
      speaker: { name: "제천 유생 의병장", sprite: "righteous_army" },
      body: [
        "국모가 시해되었는데 내각은 상투를 자르라 하오. 유인석 같은 선비들이 고을마다 일어나고 있소.",
        "고갯길 아래 일본군 수비대를 치려 하오. 그대의 칼 솜씨를 들었소.",
        "그대는 이 단발령을 어찌 보오?",
      ],
      options: [
        {
          id: "keep",
          text: "오백 년 묵은 상투요. 오늘은 칼을 들겠소.",
          hint: "의병 합류 · 명예 ▲",
          requires: { k: "variant", eq: "m" },
          effects: [
            { k: "flag", flag: "righteous" },
            { k: "point", point: "honor", add: 8 },
            { k: "favor", faction: "uibyeong", add: 10 },
          ],
        },
        {
          id: "cut",
          text: "머리는 잘라도 뜻은 자르지 않소. 함께 갑시다.",
          hint: "의병 합류 · 개혁 ▲",
          requires: { k: "variant", eq: "m" },
          effects: [
            { k: "flag", flag: "righteous" },
            { k: "nation", key: "reform", add: 1 },
            { k: "favor", faction: "uibyeong", add: 10 },
            { k: "toast", text: "오백 년 만에 처음으로 상투를 잘랐다. 거울 속 모습이 낯설다.", tone: "info" },
          ],
        },
        {
          id: "keep_f",
          text: "자를 상투는 없소만, 오늘은 칼을 들겠소.",
          hint: "의병 합류 · 명예 ▲",
          requires: { k: "variant", eq: "f" },
          effects: [
            { k: "flag", flag: "righteous" },
            { k: "point", point: "honor", add: 8 },
            { k: "favor", faction: "uibyeong", add: 10 },
          ],
        },
        {
          id: "reform_f",
          text: "머리 모양보다 나라가 먼저요. 함께 갑시다.",
          hint: "의병 합류 · 개혁 ▲",
          requires: { k: "variant", eq: "f" },
          effects: [
            { k: "flag", flag: "righteous" },
            { k: "nation", key: "reform", add: 1 },
            { k: "favor", faction: "uibyeong", add: 10 },
          ],
        },
      ],
    },
  ],
  steps: [
    {
      id: "s1",
      year: 1882,
      narration: ["1882년 5월, 제물포. 바닷바람에 낯선 나라의 깃발이 펄럭인다."],
      objectives: [
        { id: "o_us_treaty", text: "제물포에서 김홍집을 만난다", kind: "talk", target: "kim_hongjip_jemulpo", site: "jemulpo", offset: [1, -1], prompt: "p_us_treaty" },
        { id: "o_shufeldt", text: "미국 전권 슈펠트와 인사한다", kind: "talk", target: "shufeldt", site: "jemulpo", offset: [3, 0], optional: true },
      ],
    },
    {
      id: "s2",
      year: 1882,
      narration: ["6월 초, 도성. 옛 군영 군사들이 선혜청 앞에 모여 웅성거린다."],
      objectives: [
        { id: "o_seonhye", text: "무위영 군졸의 말을 듣는다", kind: "talk", target: "muwi_soldier", site: "hanyang", offset: [3, 3], prompt: "p_seonhye" },
      ],
    },
    {
      id: "s3",
      year: 1882,
      objectives: [
        { id: "o_b5", text: "고종에게 밀린 녹봉을 아뢴다", kind: "talk", target: "gojong", site: "hanyang", offset: [0, -3], prompt: "p_b5" },
      ],
    },
    {
      id: "s4",
      year: 1882,
      objectives: [
        { id: "o_b5_ok", solemn: true, text: "조용한 장마철", kind: "prompt", target: "p_b5_ok", requires: B5_OK },
        { id: "o_imo_escape", text: "궁인들을 데리고 동쪽 문으로 빠져나간다", kind: "battle", target: "b_imo_escape", requires: not(B5_OK) },
      ],
    },
    {
      id: "s5",
      year: 1884,
      narration: ["1884년. 개화를 말하는 사람들이 두 갈래로 나뉘었다."],
      objectives: [
        { id: "o_onkon", text: "온건 개화파 김홍집을 만난다", kind: "talk", target: "kim_hongjip", site: "hanyang", offset: [-2, -2], prompt: "p_onkon" },
      ],
    },
    {
      id: "s6",
      year: 1884,
      narration: ["겨울. 우정총국 개국 축하연을 며칠 앞둔 밤."],
      objectives: [
        { id: "o_gapsin", text: "김옥균을 만난다", kind: "talk", target: "kim_okgyun", site: "hanyang", offset: [2, -2], prompt: "p_gapsin" },
      ],
    },
    {
      id: "s7",
      year: 1885,
      objectives: [
        { id: "o_gapsin_ok", solemn: true, text: "연회의 뒤", kind: "prompt", target: "p_gapsin_ok", requires: B6_OK },
        { id: "o_gapsin_fail", solemn: true, text: "사흘의 뒤", kind: "prompt", target: "p_gapsin_fail", requires: not(B6_OK) },
        { id: "o_tianjin", text: "톈진조약의 조문을 고종에게 아뢴다", kind: "talk", target: "gojong", site: "hanyang", offset: [0, -3], prompt: "p_tianjin" },
      ],
    },
    {
      id: "s8",
      year: 1886,
      narration: [
        "1885년 4월, 영국 함대가 거문도를 점령하고 포대를 쌓았다.",
        "도성의 공사관 거리에서 '중립'이라는 낯선 말이 오간다.",
      ],
      objectives: [
        { id: "o_budler", text: "독일 부영사 부들러를 만난다", kind: "talk", target: "budler", site: "hanyang", offset: [4, -1], prompt: "p_budler" },
        { id: "o_yugiljun", text: "유길준을 만난다", kind: "talk", target: "yu_giljun", site: "hanyang", offset: [-4, 0], prompt: "p_yugiljun" },
        { id: "o_yuan", text: "청의 위안스카이를 상대한다", kind: "talk", target: "yuan_shikai", site: "hanyang", offset: [5, 2], prompt: "p_yuan", optional: true },
      ],
    },
    {
      id: "s9",
      year: 1887,
      objectives: [
        { id: "o_b7", text: "고종에게 중립화를 아뢴다", kind: "talk", target: "gojong", site: "hanyang", offset: [0, -3], prompt: "p_b7" },
      ],
    },
    {
      id: "s10",
      year: 1889,
      narration: ["1889년 가을, 함경도. 흉년의 부두에 곡식 섬이 쌓인다."],
      objectives: [
        { id: "o_banggok", text: "함경도관찰사 조병식을 돕는다", kind: "talk", target: "jo_byeongsik", site: "hamheung", offset: [1, -1], prompt: "p_banggok" },
      ],
    },
    {
      id: "s11",
      year: 1894,
      narration: [
        "1894년 정월, 고부 농민이 군수 조병갑의 수탈에 맞서 일어났다. 3월, 전봉준 등이 무장에서 전면 봉기했다.",
        "공동 실록 '갑오 구휼' — 굶는 고을에 곡식을 나른다.",
      ],
      objectives: [
        { id: "o_relief", text: "공주 구휼소를 돕는다", kind: "talk", target: "relief_widow", site: "gongju", offset: [2, 2], prompt: "p_relief", optional: true },
        { id: "o_b8", text: "청병 논의에서 고종에게 아뢴다", kind: "talk", target: "gojong", site: "hanyang", offset: [0, -3], prompt: "p_b8" },
      ],
    },
    {
      id: "s12",
      year: 1894,
      narration: ["전주성. 성문 위에 농민군의 깃발이 걸려 있다."],
      objectives: [
        { id: "o_jeonju_alt", text: "전주에서 전봉준과 약속한다", kind: "talk", target: "jeon_bongjun", site: "jeonju", offset: [2, 2], prompt: "p_jeonju_alt", requires: B8_OK },
        { id: "o_jeonju", text: "전주화약 자리에 선다", kind: "talk", target: "jeon_bongjun", site: "jeonju", offset: [2, 2], prompt: "p_jeonju", requires: not(B8_OK) },
      ],
    },
    {
      id: "s13",
      year: 1894,
      objectives: [
        { id: "o_b8_ok", solemn: true, text: "고요한 7월", kind: "prompt", target: "p_b8_ok", requires: B8_OK },
        { id: "o_gyeongbok", text: "경복궁에서 궁인들이 피할 시간을 번다 (70초)", kind: "battle", target: "b_gyeongbok", requires: not(B8_OK) },
      ],
    },
    {
      id: "s14",
      year: 1894,
      objectives: [
        { id: "o_jipgangso", solemn: true, text: "집강소의 가을", kind: "prompt", target: "p_jipgangso", requires: B8_OK },
        { id: "o_ugeumchi", solemn: true, text: "우금치", kind: "prompt", target: "p_ugeumchi", requires: not(B8_OK) },
      ],
    },
    {
      id: "s15",
      year: 1895,
      objectives: [{ id: "o_eulmi", solemn: true, text: "1895년 10월 8일", kind: "prompt", target: "p_eulmi" }],
    },
    {
      id: "s16",
      year: 1895,
      narration: ["을미년 겨울. 단발령이 내려졌다. 제천과 춘천에서 의병이 일어났다."],
      objectives: [
        { id: "o_uibyeong", text: "원주 고갯길의 의병장을 만난다", kind: "talk", target: "uibyeong_scholar", site: "wonju", offset: [-2, 1], prompt: "p_uibyeong_1895" },
      ],
    },
    {
      id: "s17",
      year: 1895,
      objectives: [
        { id: "o_eulmi_battle", text: "일본군 수비대를 친다", kind: "battle", target: "b_eulmi" },
      ],
    },
  ],
  worldEvent: {
    title: "갑오 구휼",
    desc: "흉년과 난리의 고을에 곡식을 나르고 피란민을 돌본다.",
    goal: 100,
  },
  companions: 10,
};
