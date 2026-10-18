// CH14 · 1863~1881 · 양요와 개항 — 정족산성 대첩(양헌수), 광성보 생존자 구출(어재연),
// B3 박규수의 조기 교섭 대 척화, B4 강화도조약 세 조항 협상(관세·영사재판·해안 측량을
// 각각 지략 판정, 사전 플래그로 보정, 2조항 이상이면 성공). 침투도가 이 장에서 처음 움직인다.
// 사실 기준: E084~E092, 분기 B3·B4.
import type { ChapterDef, Cond, Effect } from "../schema.ts";

// ── B4 negotiation helpers ───────────────────────────────────────────────
// Preparation counts toward a tier 0..3 that raises every clause's base chance.
const PREP_B3: Cond = { k: "branch", id: "B3", ok: true };
const PREP_INTERPRETER: Cond = { k: "bond", npc: "hong_yeokgwan", min: 20 };
const PREP_ARMS: Cond = {
  k: "any",
  of: [
    { k: "flag", flag: "ch14_battery_plan", eq: true },
    { k: "flag", flag: "ch14_rifle_invest", eq: true },
  ],
};
const tier = (value: number): Effect => ({ k: "flag", flag: "ch14_b4_tier", value });
const B4_TIER: Effect = {
  k: "if",
  cond: { k: "all", of: [PREP_B3, PREP_INTERPRETER, PREP_ARMS] },
  then: [tier(3)],
  else: [
    {
      k: "if",
      cond: {
        k: "any",
        of: [
          { k: "all", of: [PREP_B3, PREP_INTERPRETER] },
          { k: "all", of: [PREP_B3, PREP_ARMS] },
          { k: "all", of: [PREP_INTERPRETER, PREP_ARMS] },
        ],
      },
      then: [tier(2)],
      else: [{ k: "if", cond: { k: "any", of: [PREP_B3, PREP_INTERPRETER, PREP_ARMS] }, then: [tier(1)], else: [tier(0)] }],
    },
  ],
};

/** One clause: a wit check whose base chance rises with the preparation tier. */
function clause(checkId: string, label: string, flag: string, reward: Effect, next: string): Effect[] {
  const check = (base: number): Effect => ({
    k: "check",
    id: checkId,
    label,
    stat: "wit",
    base,
    per: 1,
    success: [
      { k: "flag", flag, value: true },
      reward,
      { k: "toast", text: `${label} — 우리 안이 받아들여졌다.`, tone: "good" },
    ],
    failure: [
      { k: "flag", flag, value: false },
      { k: "toast", text: `${label} — 상대가 군함을 가리키며 거절했다.`, tone: "bad" },
    ],
  });
  const tierIs = (value: number): Cond => ({ k: "flag", flag: "ch14_b4_tier", eq: value });
  return [
    {
      k: "if",
      cond: tierIs(3),
      then: [check(56)],
      else: [
        {
          k: "if",
          cond: tierIs(2),
          then: [check(44)],
          else: [{ k: "if", cond: tierIs(1), then: [check(32)], else: [check(20)] }],
        },
      ],
    },
    { k: "prompt", prompt: next },
  ];
}

/** Conceding a clause records it as lost and moves on. */
function concede(flag: string, next: string): Effect[] {
  return [{ k: "flag", flag, value: false }, { k: "prompt", prompt: next }];
}

const WON = (flag: string): Cond => ({ k: "flag", flag, eq: true });
const TWO_OF_THREE: Cond = {
  k: "any",
  of: [
    { k: "all", of: [WON("ch14_b4_tariff"), WON("ch14_b4_consul")] },
    { k: "all", of: [WON("ch14_b4_tariff"), WON("ch14_b4_survey")] },
    { k: "all", of: [WON("ch14_b4_consul"), WON("ch14_b4_survey")] },
  ],
};

export const ch14: ChapterDef = {
  id: "ch14",
  order: 14,
  title: "양요와 개항",
  subtitle: "닫힌 문, 열린 바다",
  years: [1863, 1881],
  level: [36, 37],
  music: "turmoil",
  season: "autumn",
  weather: "fog",
  hour: 14,
  start: { site: "hanyang", offset: [0, 1] },
  briefing: [
    "1863년. 열두 살 임금 뒤에서 그의 아버지가 나라를 잡았다.",
    "바다 저편에서 쇠로 된 배가 온다. 그 배의 대포는 화통도감의 화포보다 열 배는 멀리 닿는다.",
    "당신은 오백 년 동안 칼과 활과 조총을 쥐었다. 이번에는 무엇을 쥐어야 하는가.",
    "이 장부터, 외세의 침투도가 보이기 시작한다.",
  ],
  history: [
    "1863년 고종이 즉위하자 흥선대원군이 실권을 잡고 서원 철폐·호포제·경복궁 중건을 추진했다. 당백전 발행으로 물가가 크게 올랐다.",
    "1866년 병인박해 뒤 프랑스 함대가 강화도를 침공했다(병인양요). 양헌수가 정족산성에서 이겼으나 프랑스군은 외규장각 의궤 등을 약탈해 갔다.",
    "1871년 미국 함대가 강화 해협에 들어왔다(신미양요). 광성보에서 어재연 부대가 결사전을 벌였고, 대원군은 전국에 척화비를 세웠다.",
    "1873년 고종이 친정을 시작했고, 1875년 운요호 사건이 일어났다. [해석] 측량을 명목으로 한 계획적 도발이었다는 평가가 일반적이다.",
    "1876년 강화도조약으로 부산 등 세 항구가 열렸고, 해안 측량권과 영사 재판권이 인정되었다. 부록·무역 규칙으로 무관세 무역 등이 허용되었다.",
    "1880년 『조선책략』이 들어왔고 1881년 별기군이 창설되었다. 영남 유생들은 만인소를 올려 개화 정책에 반대했다.",
  ],
  hist: { defense: 25, finance: 20, people: 30, diplomacy: 20, reform: 25 },
  factions: [
    { id: "daewongun", name: "흥선대원군 정권", power: 65, desc: "왕권을 세우고 문을 닫아건 섭정의 무리." },
    { id: "minssi", name: "민씨 척족 (고종 친정)", power: 30, desc: "1873년 고종 친정 뒤 왕비 집안을 중심으로 힘을 얻는 무리." },
    { id: "gaehwa", name: "통상 개화론", power: 15, desc: "박규수를 중심으로 문을 열되 조건을 정하자는 사람들." },
    { id: "cheoksa", name: "위정척사", power: 35, desc: "바른 것을 지키고 사악한 것을 물리치자는 유생들." },
  ],
  ruling: "daewongun",
  npcs: [
    {
      id: "daewongun_npc",
      name: "흥선대원군",
      title: "섭정",
      sprite: "official_red",
      site: "hanyang",
      offset: [0, -3],
      historical: true,
      talk: ["서원이 백성을 뜯어먹는다면 서원을 없앤다.", "양반도 군포를 내라."],
      untilStep: "s7",
    },
    {
      id: "park_gyusu_py",
      name: "박규수",
      title: "평안감사",
      sprite: "official_blue",
      site: "pyeongyang",
      offset: [1, -1],
      historical: true,
      talk: ["불탄 배의 쇠붙이를 보았소. 우리 대장간에서는 못 만드는 것이오."],
      fromStep: "s2",
      untilStep: "s2",
    },
    {
      id: "yang_heonsu",
      name: "양헌수",
      title: "천총",
      sprite: "general_joseon",
      site: "ganghwa",
      offset: [-2, 2],
      historical: true,
      fights: true,
      talk: ["밤에 손돌목을 건넌다.", "산포수들은 호랑이를 잡던 이들이오. 한 발이면 되오."],
      fromStep: "s3",
      untilStep: "s4",
    },
    {
      id: "sanposu",
      name: "산포수 범돌이",
      title: "호랑이 사냥꾼",
      sprite: "musketeer_joseon",
      site: "ganghwa",
      offset: [-3, 3],
      fights: true,
      talk: ["화승에 불만 붙으면 범도 서양 군사도 같소.", "숲에서는 우리가 주인이오."],
      fromStep: "s3",
      untilStep: "s4",
    },
    {
      id: "eo_jaeyeon",
      name: "어재연",
      title: "진무중군",
      sprite: "general_joseon",
      site: "ganghwa",
      offset: [3, -2],
      historical: true,
      talk: ["수자기는 내리지 않소.", "포탄이 비처럼 오오. 그래도 여기가 우리 자리요."],
      fromStep: "s5",
      untilStep: "s6",
    },
    {
      id: "park_gyusu",
      name: "박규수",
      title: "통상론의 원로",
      sprite: "official_blue",
      site: "hanyang",
      offset: [2, -2],
      historical: true,
      talk: ["문을 닫을 수 없다면, 열 조건을 우리가 정해야 하오.", "젊은이들이 내 사랑방에 드나드오. 그들이 다음 세상을 볼 것이오."],
      fromStep: "s7",
      untilStep: "s10",
    },
    {
      id: "seok_smith",
      name: "석칠복",
      title: "대장장이 석가의 후손",
      sprite: "innkeeper",
      site: "hanyang",
      offset: [-3, 2],
      talk: ["우리 집안이 칼을 벼린 지 오백 년이라오. 어르신 같은 손님 이야기가 족보에 있소.", "서양 총 한 자루를 뜯어 보았소."],
      fromStep: "s8",
      untilStep: "s12",
    },
    {
      id: "hong_yeokgwan",
      name: "홍역관",
      title: "사역원 역관 홍가",
      sprite: "merchant",
      site: "ganghwa",
      offset: [1, 2],
      talk: ["우리 집안은 왜관 일로 이백 년을 먹고살았소.", "이번엔 대마도가 아니라 도쿄의 군함이오."],
      fromStep: "s9",
      untilStep: "s11",
    },
    {
      id: "sin_heon",
      name: "신헌",
      title: "접견대관",
      sprite: "official_red",
      site: "ganghwa",
      offset: [0, -2],
      historical: true,
      talk: ["연무당에 자리를 폈소.", "저들은 군함 몇 척을 앞바다에 띄워 놓고 말하오."],
      fromStep: "s10",
      untilStep: "s11",
    },
    {
      id: "byeolgi_officer",
      name: "별기군 무관 장씨",
      title: "하도감 훈련장",
      sprite: "musketeer_joseon",
      site: "hanyang",
      offset: [-2, 3],
      talk: ["별기군은 녹봉을 제때 받소. 구식 군인들은 몇 달째 쌀 한 톨 못 받았소.", "새 총은 장전이 빠르오."],
      fromStep: "s12",
    },
  ],
  spawns: [
    { id: "sp_ganghwa_marine", enemy: "french_marine", site: "ganghwa", offset: [4, 4], radius: 4, count: 3, level: 36, respawnSec: 80, fromStep: "s3", untilStep: "s4" },
    { id: "sp_coast_us", enemy: "us_marine", site: "ganghwa", offset: [5, -4], radius: 4, count: 3, level: 37, respawnSec: 80, fromStep: "s5", untilStep: "s6" },
    { id: "sp_road_bandit", enemy: "bandit", site: "gongju", offset: [-3, 2], radius: 4, count: 3, level: 36, respawnSec: 90, fromStep: "s7", untilStep: "s12" },
  ],
  battles: [
    {
      id: "b_jeongjok",
      title: "정족산성 전투",
      subtitle: "1866.11 (음10.3) · 강화 정족산성",
      site: "ganghwa",
      offset: [-3, 4],
      radius: 8,
      kind: "waves",
      great: true,
      scaled: true,
      music: "war",
      weather: "fog",
      intro: [
        "프랑스군이 정족산성 동문과 남문으로 올라온다. 산포수들은 숲 속 바위 뒤에 엎드렸다.",
        "적의 소총은 멀리 닿는다. 엄폐물을 옮겨 가며 다가가라.",
        "양헌수의 깃발이 오르면 — 그때 일제히.",
      ],
      waves: [
        { from: "east", enemies: [{ enemy: "french_marine", count: 4, level: 36 }], line: "동문 쪽 오르막 — 아직 쏘지 마라." },
        { from: "south", enemies: [{ enemy: "french_marine", count: 5, level: 36 }], line: "깃발이 올랐다! 산포수, 쏘아라!" },
        { from: "east", enemies: [{ enemy: "french_marine", count: 4, level: 37 }], line: "적이 엄폐물 뒤에서 버틴다. 옆으로 돌아라." },
      ],
      boss: {
        enemy: "boss_western_officer",
        name: "프랑스군 분견대 지휘관",
        title: "(가상)",
        level: 37,
        hpScale: 1.1,
        phases: [
          { at: 1, mechanic: "volley", line: "일제 사격!" },
          { at: 0.5, mechanic: "summon", summon: { enemy: "french_marine", count: 3 }, line: "후속 분대, 앞으로!" },
          { at: 0.2, mechanic: "cannon", line: "퇴각 엄호 — 포격!" },
        ],
        finisher: "양헌수 부대의 함성 속에 프랑스군이 산을 내려간다.",
      },
      allies: [
        { sprite: "musketeer_joseon", name: "산포수", count: 8 },
        { sprite: "soldier_joseon", name: "경군", count: 4 },
      ],
      victory: [
        { k: "point", point: "merit", add: 120 },
        { k: "point", point: "honor", add: 10 },
        { k: "exp", add: 3200 },
        { k: "nation", key: "defense", add: 3 },
        { k: "bond", npc: "yang_heonsu", add: 20 },
        { k: "worldEvent", add: 35 },
        { k: "chronicle", text: "1866년 겨울 문턱, 정족산성. 산포수들과 함께 프랑스군을 물리쳤다." },
      ],
      defeat: [{ k: "toast", text: "숲 가장자리까지 밀렸다. 바위 뒤로 물러나 다시 깃발을 기다린다.", tone: "warn" }],
    },
    {
      id: "b_gwangseong",
      title: "광성보 — 수자기 아래",
      subtitle: "1871.6.11 (음4.24) · 강화 광성보",
      site: "ganghwa",
      offset: [3, -3],
      radius: 7,
      kind: "survive",
      timeLimit: 75,
      music: "siege",
      weather: "smoke",
      intro: [
        "함포가 돈대를 두드린다. 광성보는 오늘 무너진다.",
        "이길 수 없다. 쓰러진 사람들을 돈대 뒤로 끌어내라.",
      ],
      waves: [
        { at: 0, from: "south", enemies: [{ enemy: "us_marine", count: 4, level: 37 }], line: "미군 해병이 돈대 아래에 붙었다!" },
        { at: 25, from: "east", enemies: [{ enemy: "us_marine", count: 4, level: 37 }], line: "화승총은 한 번 쏘면 끝이다. 칼과 돌로 버틴다." },
        { at: 50, from: "around", enemies: [{ enemy: "us_marine", count: 5, level: 37 }], line: "수자기 아래로 — 부상병을 데리고 빠져라!" },
      ],
      allies: [{ sprite: "soldier_joseon", name: "광성보 수비병", count: 5 }],
      victory: [
        { k: "flag", flag: "ch14_gwangseong_rescued" },
        { k: "point", point: "virtue", add: 80 },
        { k: "exp", add: 2400 },
        { k: "nation", key: "people", add: 2 },
        { k: "toast", text: "부상병 몇을 데리고 돈대를 빠져나왔다.", tone: "good" },
      ],
      defeat: [{ k: "toast", text: "포연 속에 길을 잃었다. 다시 돈대 뒤로.", tone: "warn" }],
    },
  ],
  prompts: [
    {
      id: "p_daewon",
      title: "운현궁의 섭정",
      speaker: { name: "흥선대원군", sprite: "official_red" },
      body: [
        "세도가들이 육십 년 동안 나라를 갉아먹었다. 서원을 헐고 양반에게도 군포를 물리겠다.",
        "경복궁도 다시 지을 것이다. 임진년에 불탄 지 이백칠십 년이다.",
        "무관이라면 무엇을 바라는가?",
      ],
      options: [
        {
          id: "battery",
          text: "삼군부를 고쳐 강화와 해안에 포대를 쌓으십시오.",
          hint: "국방 ▲ · 재정 ▼ · B4 사전 준비",
          effects: [
            { k: "nation", key: "defense", add: 3 },
            { k: "nation", key: "finance", add: -2 },
            { k: "flag", flag: "ch14_battery_plan", value: true },
            { k: "favor", faction: "daewongun", add: 5 },
          ],
        },
        {
          id: "coin",
          text: "당백전만은 거두십시오. 장터가 먼저 무너집니다.",
          hint: "처세 판정 → 재정·민심 ▲",
          effects: [
            {
              k: "check",
              id: "ch14_dangbaek",
              label: "당백전 진언",
              stat: "tact",
              base: 30,
              per: 1.2,
              success: [
                { k: "nation", key: "finance", add: 3 },
                { k: "nation", key: "people", add: 2 },
                { k: "toast", text: "대원군은 한참 말이 없다가, 발행을 줄이라 일렀다.", tone: "good" },
              ],
              failure: [
                { k: "favor", faction: "daewongun", add: -10 },
                { k: "toast", text: "'무관이 돈 이야기를 하는가.'", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "palace",
          text: "경복궁 중건 공사를 돕겠습니다.",
          hint: "대원군 총애 ▲ · 민심 ▼",
          effects: [
            { k: "favor", faction: "daewongun", add: 15 },
            { k: "nation", key: "people", add: -2 },
            { k: "point", point: "merit", add: 30 },
          ],
        },
      ],
    },
    {
      id: "p_persecution",
      title: "1866년 봄",
      style: "history",
      body: [
        "러시아를 견제하려 프랑스 선교사를 통한 교섭이 논의되다 무산되었다. 대원군은 천주교 금압령을 내렸다.",
        "프랑스 선교사 9명과 많은 신자가 처형되었다(병인박해). 탈출한 리델 신부가 중국에 있던 프랑스 함대 사령관에게 이를 알렸다.",
        "그해 여름, 미국 상선 제너럴셔먼호가 대동강을 거슬러 평양까지 올라왔다가 충돌 끝에 불탔다.",
      ],
      options: [
        {
          id: "hide",
          text: "쫓기는 한 집안을 산골 옹기촌으로 피신시킨다.",
          hint: "공덕 ▲ · 의심도 ▲",
          effects: [
            { k: "point", point: "virtue", add: 40 },
            { k: "suspicion", add: 8 },
          ],
        },
        { id: "aside", text: "물러서 있는다.", effects: [] },
      ],
    },
    {
      id: "p_park_1866",
      title: "불탄 배의 쇠붙이",
      speaker: { name: "박규수", sprite: "official_blue" },
      body: [
        "배가 관리를 붙잡고 총을 쏘아 평양 사람들이 불을 놓았소. 승무원은 모두 죽었소.",
        "그러나 그 배의 쇠와 기계를 보시오. 언젠가 저런 배가 떼로 올 것이오.",
        "그때는 싸워서 이기는 것만으로는 부족할 것이오.",
      ],
      options: [
        {
          id: "agree",
          text: "문을 열 날을 미리 준비하자는 말씀이군요.",
          hint: "박규수 인연 ▲ · 개혁 ▲",
          effects: [
            { k: "bond", npc: "park_gyusu", add: 20 },
            { k: "nation", key: "reform", add: 1 },
          ],
        },
      ],
    },
    {
      id: "p_yang",
      title: "손돌목을 건너는 밤",
      speaker: { name: "양헌수", sprite: "general_joseon" },
      body: [
        "프랑스군이 강화부를 차지했소. 문수산성의 한성근도 밀렸소.",
        "나는 밤에 손돌목을 건너 정족산성에 들어가겠소. 산성 안에는 실록을 모신 사고가 있소.",
        "그대는 어디를 맡겠소?",
      ],
      options: [
        {
          id: "ambush",
          text: "동문 숲에 산포수들과 엎드리겠습니다.",
          hint: "공적 ▲",
          effects: [{ k: "point", point: "merit", add: 30 }],
        },
        {
          id: "archive",
          text: "사고의 실록궤부터 깊은 곳으로 옮기겠습니다.",
          hint: "명예 ▲ · 공덕 ▲",
          effects: [
            { k: "point", point: "honor", add: 10 },
            { k: "point", point: "virtue", add: 20 },
            { k: "flag", flag: "ch14_archive_saved" },
            { k: "toast", text: "실록궤를 전등사 뒤 바위굴로 옮겼다. 사백 년의 기록이 당신의 등에 실렸다.", tone: "info" },
          ],
        },
      ],
    },
    {
      id: "p_eo",
      title: "수자기",
      speaker: { name: "어재연", sprite: "general_joseon" },
      body: [
        "미군이 초지진과 덕진진을 차지했소. 다음은 여기요.",
        "저들의 대포는 멀리 닿고, 총은 빠르오. 우리 화승총은 비에 젖으면 끝이오.",
        "그래도 이 깃발은 내리지 않겠소. 그대는 부상병을 맡아 주시오.",
      ],
      options: [
        {
          id: "wounded",
          text: "한 사람이라도 더 데리고 나오겠습니다.",
          hint: "생존자 구출 75초",
          effects: [{ k: "point", point: "honor", add: 5 }],
        },
      ],
    },
    {
      id: "p_gwangseong_after",
      title: "광성보가 떨어지다",
      style: "history",
      body: [
        "광성보는 함락되었다. 어재연과 동생 어재순이 전사했고, 조선군의 피해가 컸다.",
        "조선이 교섭에 응하지 않자 미군은 물러갔다. 대원군은 전국에 척화비를 세웠다.",
        "미군이 가져간 수자기는 136년 뒤인 2007년 장기 대여 형식으로 돌아왔다.",
      ],
      options: [{ id: "go", text: "도성으로 간다.", effects: [{ k: "chronicle", text: "1871년, 광성보. 수자기 아래의 사람들을 기억한다." }] }],
    },
    {
      id: "p_b3",
      title: "문을 여는 방법",
      speaker: { name: "박규수", sprite: "official_blue" },
      body: [
        "두 번 이겼다고들 하오. 그러나 강화부는 불탔고 광성보는 떨어졌소.",
        "저들은 다시 올 것이오. 그때 군함에 떠밀려 문을 열면, 조건은 저들이 정하오.",
        "지금 우리가 먼저 교섭을 청해 조건을 정해야 하오. 대원군을 설득할 수 있겠소?",
      ],
      options: [
        {
          id: "negotiate",
          text: "조기 교섭을 지지하고 섭정을 설득하겠습니다.",
          hint: "B3 조건: 지략 30 또는 박규수 인연 20 또는 개혁 35",
          effects: [
            {
              k: "if",
              cond: {
                k: "any",
                of: [
                  { k: "stat", stat: "wit", min: 30 },
                  { k: "bond", npc: "park_gyusu", min: 20 },
                  { k: "nation", key: "reform", min: 35 },
                ],
              },
              then: [
                { k: "branch", id: "B3", ok: true },
                { k: "nation", key: "reform", add: 6 },
                { k: "nation", key: "diplomacy", add: 5 },
                { k: "favor", faction: "daewongun", add: -20 },
                { k: "favor", faction: "gaehwa", add: 20 },
                { k: "chronicle", text: "1871년, 문을 닫아걸던 조정에 교섭의 길을 냈다." },
                { k: "toast", text: "B3 성공 — 주체적 개항 교섭이 시작된다. 강화도 협상에 보정.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B3", ok: false },
                { k: "favor", faction: "daewongun", add: -10 },
                { k: "toast", text: "척화비가 서는 날, 교섭이라는 말은 아무도 듣지 않았다.", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "cheokhwa",
          text: "지금은 문을 더 굳게 닫고 포대를 늘려야 합니다.",
          hint: "B3 실패 · 국방 ▲ · 개혁 ▼",
          effects: [
            { k: "branch", id: "B3", ok: false },
            { k: "nation", key: "defense", add: 3 },
            { k: "nation", key: "reform", add: -3 },
            { k: "favor", faction: "daewongun", add: 10 },
            { k: "favor", faction: "cheoksa", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_seok",
      title: "대장간의 서양 총",
      speaker: { name: "석칠복", sprite: "innkeeper" },
      body: [
        "청에서 몰래 들여온 서양 총을 뜯어 보았소. 뒤로 탄을 넣는 총이오.",
        "강철과 기계만 있으면 비슷한 것을 만들 수 있소. 문제는 돈이오.",
        "우리 족보에 '나이 들지 않는 손님이 대대로 칼을 맡겼다'는 이야기가 있소. 어르신이오?",
      ],
      options: [
        {
          id: "invest",
          text: "재산과 줄을 대어 근대 화기를 들여오고 만들게 하겠소.",
          hint: "[대체역사] 재정 −5 · 국방 +6 · 개량 소총 조기 해금 · B4 사전 준비",
          effects: [
            { k: "nation", key: "finance", add: -5 },
            { k: "nation", key: "defense", add: 6 },
            { k: "point", point: "money", add: -300 },
            { k: "flag", flag: "ch14_rifle_invest", value: true },
            { k: "skill", skill: "rifle" },
            { k: "toast", text: "'개량 소총'을 익혔다. 활을 처음 쥔 지 오백 년 만이다.", tone: "epic" },
          ],
        },
        {
          id: "later",
          text: "아직은 때가 아니오.",
          hint: "변화 없음",
          effects: [{ k: "suspicion", add: -2 }],
        },
      ],
    },
    {
      id: "p_unyo",
      title: "운요호",
      style: "history",
      body: [
        "1873년 최익현의 상소를 계기로 대원군이 물러나고 고종이 직접 정치를 시작했다.",
        "1875년 9월 20일, 일본 군함 운요호가 강화도 초지진에 접근해 포격전을 벌였다. 이어 영종진을 공격해 점령했다.",
        "1876년 초, 일본 전권 구로다 기요타카가 군함을 이끌고 강화도에 왔다. 조약을 맺자는 것이었다.",
      ],
      options: [{ id: "go", text: "강화로 간다.", effects: [{ k: "goto", site: "ganghwa", offset: [0, 1] }] }],
    },
    {
      id: "p_hong",
      title: "역관 집안의 기억",
      speaker: { name: "홍역관", sprite: "merchant" },
      body: [
        "계해약조, 기유약조 — 우리 집안은 대마도와 조문을 다투던 기록을 대대로 갖고 있소.",
        "그때는 우리가 세견선 수를 정하고, 왜관 문을 여닫았소. 이번에는 거꾸로요.",
        "어르신은 그 옛 조약을 직접 본 사람처럼 말씀하시는구려.",
      ],
      options: [
        {
          id: "study",
          text: "옛 조문을 함께 찾아, 상대의 초안과 하나하나 맞대 보세.",
          hint: "역관 인연 ▲▲ · 의심도 ▲ · B4 사전 준비",
          effects: [
            { k: "bond", npc: "hong_yeokgwan", add: 25 },
            { k: "suspicion", add: 4 },
            { k: "stat", stat: "wit", add: 1 },
          ],
        },
        {
          id: "borrow",
          text: "자네 집안 기록을 빌려주게. 내가 밤새 읽겠네.",
          hint: "역관 인연 ▲ · B4 사전 준비",
          effects: [{ k: "bond", npc: "hong_yeokgwan", add: 20 }],
        },
        { id: "busy", text: "지금은 그럴 틈이 없네.", hint: "변화 없음", effects: [] },
      ],
    },
    {
      id: "p_b4_intro",
      title: "연무당의 협상",
      speaker: { name: "신헌", sprite: "official_red" },
      body: [
        "앞바다에 군함이 떠 있고, 연무당 밖에는 저들의 군사가 서 있소.",
        "조약을 맺지 않을 수는 없소. 다만 조항 하나하나가 백 년을 갈 것이오.",
        "관세, 영사 재판, 해안 측량 — 이 셋을 그대가 곁에서 짚어 주시오.",
      ],
      options: [
        {
          id: "begin",
          text: "조항마다 따지겠습니다.",
          hint: "협상 세 판 · 2조항 이상 확보하면 B4 성공",
          effects: [B4_TIER, { k: "prompt", prompt: "p_b4_tariff" }],
        },
      ],
    },
    {
      id: "p_b4_tariff",
      title: "제1조항 · 관세",
      style: "story",
      body: [
        "상대의 무역 규칙 초안에는 관세가 없다. 들어오는 물건에도, 나가는 쌀에도.",
        "관세를 우리가 정할 수 없으면, 장터와 곳간이 저들 손에 들어간다.",
      ],
      options: [
        {
          id: "press",
          text: "관세는 조선이 스스로 정한다는 조문을 넣읍시다.",
          hint: "지략 판정 (사전 준비에 따라 보정) · 성공 시 재정 ▲",
          effects: clause("ch14_b4_tariff", "관세 자주권", "ch14_b4_tariff", { k: "nation", key: "finance", add: 2 }, "p_b4_consul"),
        },
        {
          id: "concede",
          text: "이 조항은 내주고 다음 조항에 힘을 모읍시다.",
          hint: "관세 포기",
          effects: concede("ch14_b4_tariff", "p_b4_consul"),
        },
      ],
    },
    {
      id: "p_b4_consul",
      title: "제2조항 · 영사 재판",
      style: "story",
      body: [
        "개항장에서 일본인이 죄를 지으면 일본 관원이 재판한다는 조문이다.",
        "한쪽에만 그런 권리를 주면, 개항장은 우리 법이 닿지 않는 땅이 된다.",
      ],
      options: [
        {
          id: "press",
          text: "상호주의로 — 일본에 간 조선 사람도 같은 대우를 받게 합시다.",
          hint: "지략 판정 (사전 준비에 따라 보정) · 성공 시 외교 ▲",
          effects: clause("ch14_b4_consul", "영사 재판 상호주의", "ch14_b4_consul", { k: "nation", key: "diplomacy", add: 2 }, "p_b4_survey"),
        },
        {
          id: "concede",
          text: "이 조항은 내주고 다음 조항에 힘을 모읍시다.",
          hint: "영사 재판 포기",
          effects: concede("ch14_b4_consul", "p_b4_survey"),
        },
      ],
    },
    {
      id: "p_b4_survey",
      title: "제3조항 · 해안 측량",
      style: "story",
      body: [
        "조선의 바닷가를 일본이 자유롭게 측량한다는 조문이다.",
        "바닷길을 그린 지도는 장삿배에게도, 군함에게도 똑같이 쓰인다.",
      ],
      options: [
        {
          id: "press",
          text: "측량은 연 항구 둘레로 한정하고, 우리 관원이 함께하게 합시다.",
          hint: "지략 판정 (사전 준비에 따라 보정) · 성공 시 국방 ▲",
          effects: clause("ch14_b4_survey", "해안 측량 제한", "ch14_b4_survey", { k: "nation", key: "defense", add: 2 }, "p_b4_result"),
        },
        {
          id: "concede",
          text: "이 조항은 내줍시다.",
          hint: "해안 측량 포기",
          effects: concede("ch14_b4_survey", "p_b4_result"),
        },
      ],
    },
    {
      id: "p_b4_result",
      title: "조약문",
      style: "history",
      body: [
        "1876년 2월 27일(음2.3), 강화부 연무당에서 조일수호조규가 맺어졌다.",
        "제1관은 조선을 '자주국'이라 적었다. 청의 종주권을 부정하려는 뜻이 담긴 문장이었다.",
        "[사실] 실제 조약에서는 해안 측량권과 영사 재판권이 일본에 인정되었고, 무관세 무역이 허용되었다. 관세는 1883년에야 일부 바로잡혔다.",
      ],
      options: [
        {
          id: "seal",
          text: "확보한 조항을 확인한다.",
          hint: "2조항 이상 → B4 성공",
          effects: [
            {
              k: "if",
              cond: TWO_OF_THREE,
              then: [
                { k: "branch", id: "B4", ok: true },
                { k: "nation", key: "finance", add: 5 },
                { k: "nation", key: "infiltration", add: -5 },
                { k: "chronicle", text: "1876년, 강화도조약의 조항 둘 이상을 바로잡았다." },
                { k: "toast", text: "B4 성공 — 경제 침투의 통로가 좁아졌다. 재정 ▲ · 침투도 ▼", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B4", ok: false },
                { k: "nation", key: "infiltration", add: 15 },
                { k: "toast", text: "B4 실패 — 불평등한 조항이 그대로 남았다. 침투도 +15", tone: "bad" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p_byeolgi",
      title: "하도감의 새 군대",
      speaker: { name: "별기군 무관 장씨", sprite: "musketeer_joseon" },
      body: [
        "1880년 김홍집이 일본에서 『조선책략』을 가져온 뒤, 조정이 바삐 움직이오. 통리기무아문이 서고, 이 별기군이 생겼소.",
        "영남 유생 만 명이 상소를 올려 반대했소. 그런데 더 큰 걱정은 따로 있소.",
        "별기군은 녹봉이 제때 나오는데, 옛 군영 군사들은 몇 달째 쌀을 못 받았소.",
      ],
      options: [
        {
          id: "ledger",
          text: "구식 군영의 체불 장부를 따로 적어 두게. 언젠가 터질 일이네.",
          hint: "다음 장 B5 준비 · 재정 ▲",
          effects: [
            { k: "flag", flag: "ch14_pay_gap_noted" },
            { k: "nation", key: "finance", add: 1 },
          ],
        },
        {
          id: "train",
          text: "새 총의 교련을 함께 받겠네.",
          hint: "개혁 ▲",
          effects: [{ k: "nation", key: "reform", add: 2 }],
        },
      ],
    },
  ],
  steps: [
    {
      id: "s1",
      year: 1863,
      narration: ["1863년 겨울. 철종이 후사 없이 승하하고, 열두 살 고종이 즉위했다."],
      objectives: [
        { id: "o_daewon", text: "운현궁의 흥선대원군을 만난다", kind: "talk", target: "daewongun_npc", site: "hanyang", offset: [0, -3], prompt: "p_daewon" },
      ],
    },
    {
      id: "s2",
      year: 1866,
      onEnter: [{ k: "prompt", prompt: "p_persecution" }],
      objectives: [
        { id: "o_persecution", text: "1866년의 소식", kind: "prompt", target: "p_persecution" },
        { id: "o_park_py", text: "평양에서 박규수를 만난다", kind: "talk", target: "park_gyusu_py", site: "pyeongyang", offset: [1, -1], prompt: "p_park_1866", optional: true },
      ],
    },
    {
      id: "s3",
      year: 1866,
      narration: [
        "가을, 프랑스 함대가 강화 해협에 들어왔다. 강화부가 점령되었다.",
        "천총 양헌수가 밤에 바다를 건널 군사를 모은다.",
      ],
      objectives: [
        { id: "o_yang", text: "강화에서 양헌수와 합류한다", kind: "talk", target: "yang_heonsu", site: "ganghwa", offset: [-2, 2], prompt: "p_yang" },
        { id: "o_sanposu", text: "산포수와 인사를 나눈다", kind: "talk", target: "sanposu", site: "ganghwa", offset: [-3, 3], optional: true },
      ],
    },
    {
      id: "s4",
      year: 1866,
      objectives: [
        { id: "o_jeongjok", text: "정족산성에서 프랑스군을 물리친다", kind: "battle", target: "b_jeongjok", site: "ganghwa", offset: [-3, 4] },
      ],
    },
    {
      id: "s5",
      year: 1871,
      narration: [
        "1868년, 독일 상인 오페르트가 대원군의 아버지 남연군의 묘를 파헤치려다 실패했다. 문은 더 굳게 닫혔다.",
        "1871년 봄, 미국 함대가 강화 해협에 들어왔다. 초지진과 덕진진이 떨어졌다.",
      ],
      objectives: [
        { id: "o_eo", text: "광성보의 어재연을 만난다", kind: "talk", target: "eo_jaeyeon", site: "ganghwa", offset: [3, -2], prompt: "p_eo" },
      ],
    },
    {
      id: "s6",
      year: 1871,
      objectives: [
        { id: "o_gwangseong", text: "광성보에서 부상병을 구한다 (75초)", kind: "battle", target: "b_gwangseong", site: "ganghwa", offset: [3, -3] },
      ],
    },
    {
      id: "s7",
      year: 1871,
      onEnter: [{ k: "prompt", prompt: "p_gwangseong_after" }],
      objectives: [
        { id: "o_gwangseong_after", text: "광성보의 끝을 기억한다", kind: "prompt", target: "p_gwangseong_after" },
        { id: "o_b3", text: "도성에서 박규수를 만난다", kind: "talk", target: "park_gyusu", site: "hanyang", offset: [2, -2], prompt: "p_b3" },
      ],
    },
    {
      id: "s8",
      year: 1873,
      narration: ["척화비가 선 도성. 대장간 골목에 낯선 쇳소리가 난다."],
      objectives: [
        { id: "o_seok", text: "대장장이 석가의 후손을 만난다", kind: "talk", target: "seok_smith", site: "hanyang", offset: [-3, 2], prompt: "p_seok" },
      ],
    },
    {
      id: "s9",
      year: 1875,
      onEnter: [{ k: "prompt", prompt: "p_unyo" }],
      objectives: [
        { id: "o_unyo", text: "운요호의 소식", kind: "prompt", target: "p_unyo" },
        { id: "o_hong", text: "강화에서 역관 홍가를 만난다", kind: "talk", target: "hong_yeokgwan", site: "ganghwa", offset: [1, 2], prompt: "p_hong" },
      ],
    },
    {
      id: "s10",
      year: 1876,
      narration: ["1876년 2월, 강화부 연무당. 협상이 시작된다."],
      objectives: [
        { id: "o_b4", text: "접견대관 신헌 곁에 선다", kind: "talk", target: "sin_heon", site: "ganghwa", offset: [0, -2], prompt: "p_b4_intro" },
      ],
    },
    {
      id: "s11",
      year: 1876,
      objectives: [{ id: "o_b4_result", text: "세 조항을 다툰다", kind: "prompt", target: "p_b4_result" }],
    },
    {
      id: "s12",
      year: 1881,
      narration: ["1881년. 하도감에서 새 군대가 서양식 교련을 받는다."],
      onEnter: [
        {
          k: "if",
          cond: { k: "not", of: { k: "flag", flag: "ch14_rifle_invest", eq: true } },
          then: [
            { k: "skill", skill: "rifle" },
            { k: "toast", text: "별기군의 새 총을 손에 쥐었다. '개량 소총'을 익혔다.", tone: "good" },
          ],
        },
      ],
      objectives: [
        { id: "o_byeolgi", text: "별기군 무관을 만난다", kind: "talk", target: "byeolgi_officer", site: "hanyang", offset: [-2, 3], prompt: "p_byeolgi" },
      ],
    },
  ],
  worldEvent: {
    title: "해안 포대",
    desc: "강화와 바닷가에 포대를 쌓고 화약을 나른다. 양요에서 버틸수록 게이지가 찬다.",
    goal: 100,
  },
  companions: 10,
};
