// CH16 · 1896~1910 · 제국의 마지막 14년 — 최종 정산.
// B9 만민공동회(연설 카드 셋 중 둘 성공), B10 재정 일원화(재정 42), B11 중립 실효(B7 + 국방 55),
// B12a 열강 사전 외교(외교 52, 거중조정 시 47 + B7/B11), B12b 중명전 수호(국방 60일 때만 열리는 대체역사 방어전),
// B12c 군대 해산 저지(B12b + 승리 + 민심 55), 13도 창의군 서울 진공(국운에 따라 아군 규모 3단계).
// 마지막 단계가 끝나면 엔진이 엔딩을 계산한다. 사실 기준: E101~E113, E117, 분기 B9~B12.
import type { BattleDef, ChapterDef, Cond, Effect } from "../schema.ts";

const ok = (id: "B7" | "B9" | "B10" | "B11" | "B12b" | "B12c"): Cond => ({ k: "branch", id, ok: true });
const not = (of: Cond): Cond => ({ k: "not", of });
const minNation = (key: "defense" | "people" | "diplomacy" | "finance", min: number): Cond => ({ k: "nation", key, min });

// ── B9: three speeches, two successes wanted ─────────────────────────────
const SPOKE = (n: 1 | 2 | 3): Cond => ({ k: "flag", flag: `ch16_b9_speech${n}`, eq: true });
const B9_TWO_OF_THREE: Cond = {
  k: "any",
  of: [
    { k: "all", of: [SPOKE(1), SPOKE(2)] },
    { k: "all", of: [SPOKE(1), SPOKE(3)] },
    { k: "all", of: [SPOKE(2), SPOKE(3)] },
  ],
};
function speech(
  n: 1 | 2 | 3,
  id: string,
  stat: "wit" | "tact" | "spirit",
  base: number,
  cheer: string,
): Effect[] {
  const flag = `ch16_b9_speech${n}`;
  return [
    {
      k: "check",
      id,
      label: "연설",
      stat,
      base,
      per: 1.2,
      success: [
        { k: "flag", flag, value: true },
        { k: "worldEvent", add: 20 },
        { k: "toast", text: cheer, tone: "good" },
      ],
      failure: [
        { k: "flag", flag, value: false },
        { k: "toast", text: "군중이 웅성거린다. 말이 가슴에 닿지 않았다.", tone: "info" },
      ],
    },
  ];
}
/** A wrong speech: it costs the crowd and records the speech as failed. */
function misstep(n: 1 | 2 | 3, text: string): Effect[] {
  return [
    { k: "flag", flag: `ch16_b9_speech${n}`, value: false },
    { k: "nation", key: "people", add: -2 },
    { k: "toast", text, tone: "bad" },
  ];
}

// ── Final battle tiers: allies grow with what the nation built ───────────
const SEOUL_TIER2: Cond = { k: "all", of: [ok("B12c"), minNation("defense", 55), minNation("people", 55)] };
const SEOUL_TIER1: Cond = { k: "any", of: [ok("B12b"), ok("B12c"), ok("B9"), ok("B10"), minNation("people", 45)] };
const SEOUL_TIER: Effect = {
  k: "if",
  cond: SEOUL_TIER2,
  then: [{ k: "flag", flag: "ch16_seoul_tier", value: 2 }],
  else: [
    {
      k: "if",
      cond: SEOUL_TIER1,
      then: [{ k: "flag", flag: "ch16_seoul_tier", value: 1 }],
      else: [{ k: "flag", flag: "ch16_seoul_tier", value: 0 }],
    },
  ],
};
const tierIs = (value: number): Cond => ({ k: "flag", flag: "ch16_seoul_tier", eq: value });

const SEOUL_BOSS: BattleDef["boss"] = {
  enemy: "boss_japanese_commander",
  name: "일본군 수비대 지휘관",
  title: "(가상)",
  level: 40,
  hpScale: 1.3,
  phases: [
    { at: 1, mechanic: "volley", line: "기관총 진지, 사격 개시!" },
    { at: 0.6, mechanic: "summon", summon: { enemy: "japanese_infantry", count: 4 }, line: "용산의 증원 부대를 불러라!" },
    { at: 0.3, mechanic: "cannon", line: "산포, 동대문 밖을 쳐라!" },
  ],
  finisher: "13도의 깃발이 한꺼번에 오른다. 함성은 해산된 군인과 농민과 포수의 것이었다.",
};

export const ch16: ChapterDef = {
  id: "ch16",
  order: 16,
  title: "제국의 마지막 14년",
  subtitle: "오백 년의 끝에서",
  years: [1896, 1910],
  level: [39, 40],
  music: "modern",
  season: "autumn",
  weather: "clear",
  hour: 10,
  start: { site: "hanyang", offset: [0, 1] },
  briefing: [
    "1896년. 임금이 남의 나라 공사관에서 겨울을 났다.",
    "이 열네 해가 오백 년의 끝이다. 쌓아 온 모든 것이 여기서 셈해진다.",
    "당신의 무기는 칼이 아니다. 오백 년 동안 본 것을 기억하는 일이다.",
    "1910년 여름에 무엇이 남을지는, 이제부터의 걸음에 달렸다.",
  ],
  history: [
    "1896년 2월 고종이 러시아 공사관으로 옮겼다(아관파천). 1897년 10월 환구단에서 황제에 즉위하고 국호를 대한제국으로 정했다.",
    "독립협회는 1898년 만민공동회와 관민공동회로 이권 양여에 반대하고 의회 설립을 추진했으나 그해 12월 해산되었다.",
    "1904년 1월 국외 중립을 선언했으나 일본은 러일전쟁을 일으키고 서울을 점령한 채 한일의정서와 제1차 한일협약을 강요했다.",
    "1905년 11월 일본은 군대로 궁궐을 에워싼 채 외교권을 빼앗는 을사늑약을 강제했다. 고종은 비준하지 않았고 참정대신 한규설은 끝까지 반대했다. [해석] 한국 학계와 정부는 이 조약을 무효로 본다.",
    "1907년 고종이 강제로 물러나고 군대가 해산되었다. 해산 군인이 합류한 의병은 13도 창의군을 이루어 1908년 1월 서울 진공을 꾀했으나 실패했다.",
    "1910년 8월 22일 병합 조약이 조인되고 29일 공포되었다. 이 게임의 대체역사 결말은 이 사실 위에 세운 가정이다.",
  ],
  hist: { defense: 20, finance: 20, people: 35, diplomacy: 25, reform: 35 },
  factions: [
    { id: "hwangsil", name: "황실 (광무 정권)", power: 55, lineage: "minssi", desc: "황제권을 중심으로 나라를 지키려는 세력. 재정을 황실에 모은다." },
    { id: "dongnip", name: "독립협회", power: 25, lineage: "geupjin", desc: "신문과 집회로 자주와 민권을 외치는 사람들." },
    { id: "chinro", name: "친러 세력", power: 30, desc: "아관파천 뒤 힘을 얻은 무리." },
    { id: "chinil", name: "친일 세력", power: 20, desc: "일본의 힘을 빌려 권세를 잡으려는 무리." },
    { id: "uibyeong", name: "의병·해산 군인", power: 25, desc: "고을마다 다시 일어난 의병과 해산된 군인." },
  ],
  ruling: "hwangsil",
  npcs: [
    {
      id: "gojong_1896",
      name: "고종",
      title: "국왕 · 러시아 공사관",
      sprite: "king_joseon",
      site: "hanyang",
      offset: [3, -2],
      historical: true,
      talk: ["이 공사관 담장이 지금은 궁궐 담장이오.", "궁으로 돌아갈 날을 세고 있소."],
      untilStep: "s1",
    },
    {
      id: "gwangmu",
      name: "고종 (광무제)",
      title: "대한제국 황제",
      sprite: "emperor_korea",
      site: "hanyang",
      offset: [0, -3],
      historical: true,
      talk: ["황제가 되었으나, 황제를 지킬 군대는 아직 작소.", "열강의 공사들이 날마다 무엇인가를 달라 하오."],
      fromStep: "s2",
      untilStep: "s14",
    },
    {
      id: "seo_jaepil",
      name: "서재필",
      title: "『독립신문』",
      sprite: "reformer",
      site: "hanyang",
      offset: [-3, 2],
      historical: true,
      talk: ["신문은 백성이 서로 말하게 하는 장터요.", "독립문은 청에서 독립한다는 뜻만이 아니오."],
      fromStep: "s3",
      untilStep: "s3",
    },
    {
      id: "yi_sangjae",
      name: "이상재",
      title: "독립협회",
      sprite: "scholar",
      site: "hanyang",
      offset: [-1, 3],
      historical: true,
      talk: ["종로 네거리가 오늘은 의정부요.", "황제를 몰아내자는 것이 아니오. 황제와 백성이 함께하자는 것이오."],
      fromStep: "s3",
      untilStep: "s3",
    },
    {
      id: "surveyor",
      name: "양지아문 측량 기사 문씨",
      title: "광무 양전",
      sprite: "official_green",
      site: "gongju",
      offset: [2, 1],
      talk: ["땅마다 주인 이름을 적은 지계를 내주오.", "이 문서가 있으면 훗날 누가 땅을 빼앗으려 해도 버틸 수 있소."],
      fromStep: "s6",
      untilStep: "s6",
    },
    {
      id: "yi_yongik",
      name: "이용익",
      title: "내장원경",
      sprite: "official_red",
      site: "hanyang",
      offset: [3, 1],
      historical: true,
      talk: ["황실의 곳간이 차야 황제가 버티오.", "인삼과 광산과 역둔토 — 모두 내장원의 일이오."],
      fromStep: "s7",
      untilStep: "s7",
    },
    {
      id: "jp_agent",
      name: "공사관 통역 (가상)",
      title: "회유",
      sprite: "japanese_envoy",
      site: "hanyang",
      offset: [5, 3],
      talk: ["시대의 흐름을 보시지요.", "현명한 분들은 이미 줄을 섰습니다."],
      fromStep: "s10",
      untilStep: "s10",
    },
    {
      id: "hulbert",
      name: "헐버트",
      title: "황제의 미국인 벗",
      sprite: "western_envoy",
      site: "hanyang",
      offset: [4, 0],
      historical: true,
      talk: ["조미조약에는 '거중조정'이 있소. 나는 그 문장을 믿고 싶소.", "황제의 친서를 품고 워싱턴에 가겠소."],
      fromStep: "s10",
      untilStep: "s10",
    },
    {
      id: "han_gyuseol",
      name: "한규설",
      title: "참정대신",
      sprite: "official_red",
      site: "hanyang",
      offset: [1, -4],
      historical: true,
      talk: ["나는 찬성할 수 없소.", "이 문을 지켜 주시오. 안에서 무슨 말이 오가든."],
      fromStep: "s11",
      untilStep: "s12",
    },
    {
      id: "sin_dolseok",
      name: "신돌석",
      title: "평민 의병장",
      sprite: "righteous_army",
      site: "andong",
      offset: [2, 1],
      historical: true,
      fights: true,
      talk: ["양반이 아니어도 나라는 지킬 수 있소.", "태백산 골짜기는 우리 집 마당이오."],
      fromStep: "s13",
      untilStep: "s13b",
    },
    {
      id: "seo_sangdon",
      name: "서상돈",
      title: "국채보상운동",
      sprite: "merchant",
      site: "daegu",
      offset: [1, 1],
      historical: true,
      talk: ["담배를 끊고 그 돈을 모읍시다.", "나랏빚을 백성이 갚으면, 그 나라는 백성의 것이오."],
      fromStep: "s14",
      untilStep: "s14",
    },
    {
      id: "guard_officer",
      name: "시위대 정위 김씨 (가상)",
      title: "시위대",
      sprite: "soldier_empire",
      site: "hanyang",
      offset: [-1, 4],
      talk: ["무기고 열쇠는 내 허리에 있소.", "해산식에 맨손으로 나오라 하오."],
      fromStep: "s15",
      untilStep: "s15b",
    },
    {
      id: "heo_wi",
      name: "허위",
      title: "13도 창의군 군사장",
      sprite: "righteous_army",
      site: "hanyang",
      offset: [6, 0],
      historical: true,
      fights: true,
      talk: ["양주에 모여 동대문으로 간다.", "각 도의 의진이 같은 날 닿아야 하오."],
      fromStep: "s16",
      untilStep: "s17",
    },
  ],
  spawns: [
    { id: "sp_road_bandit", enemy: "bandit", site: "gongju", offset: [-3, 2], radius: 4, count: 3, level: 39, respawnSec: 90, fromStep: "s6", untilStep: "s7" },
    { id: "sp_jp_jemulpo", enemy: "japanese_infantry", site: "jemulpo", offset: [2, 3], radius: 4, count: 3, level: 39, respawnSec: 80, fromStep: "s9", untilStep: "s17" },
    { id: "sp_jp_andong", enemy: "japanese_infantry", site: "andong", offset: [-3, 3], radius: 4, count: 3, level: 40, respawnSec: 80, fromStep: "s13", untilStep: "s17" },
    { id: "sp_mountain_tiger", enemy: "tiger", site: "gangneung", offset: [-4, 2], radius: 4, count: 1, level: 40, respawnSec: 240, fromStep: "s13", untilStep: "s18" },
  ],
  battles: [
    {
      id: "b_wonsubu",
      title: "원수부 교련",
      subtitle: "1899 · 시위대 연병장",
      site: "hanyang",
      offset: [-4, -2],
      radius: 5,
      kind: "duel",
      music: "modern",
      weather: "clear",
      intro: [
        "황제가 원수부를 두고 군 통수권을 쥐었다. 시위대가 늘어난다.",
        "교련관이 묻는다. '고려의 칼로 대한의 총을 이길 수 있소?'",
      ],
      waves: [],
      boss: {
        enemy: "boss_duelist",
        name: "원수부 시위대 교련관",
        title: "(가상)",
        level: 39,
        hpScale: 0.9,
        phases: [
          { at: 1, mechanic: "guard_front", line: "총검술은 정면이 단단하오." },
          { at: 0.5, mechanic: "charge", line: "돌격 — 앞으로!" },
        ],
      },
      victory: [
        { k: "nation", key: "defense", add: 4 },
        { k: "exp", add: 2000 },
        { k: "toast", text: "교련관이 웃었다. '그 칼, 시위대에 가르쳐 주시오.' 시위대 교련이 단단해졌다.", tone: "good" },
      ],
      defeat: [{ k: "toast", text: "교련관이 손을 내밀었다. '한 판 더.'", tone: "info" }],
    },
    {
      id: "b_seoul_1904",
      title: "도성 문을 닫다",
      subtitle: "1904.2 · [대체역사] 중립의 실력",
      site: "hanyang",
      offset: [-5, 1],
      radius: 7,
      kind: "defend",
      timeLimit: 70,
      music: "war",
      weather: "snow",
      defend: { name: "돈의문", sprite: "banner", hp: 800 },
      intro: [
        "제물포에 상륙한 일본군 선발대가 도성으로 다가온다. 열강 공사관은 대한제국의 중립을 확인했다.",
        "문을 닫고 버티면, 저들은 남의 나라 수도를 무력으로 점령한다는 오명을 써야 한다.",
      ],
      waves: [
        { at: 0, from: "west", enemies: [{ enemy: "japanese_infantry", count: 4, level: 39 }], line: "선발대가 문 앞에서 길을 열라 한다." },
        { at: 25, from: "west", enemies: [{ enemy: "japanese_vanguard", count: 3, level: 39 }, { enemy: "japanese_infantry", count: 2, level: 39 }], line: "문을 밀어붙인다 — 시위대, 버텨라!" },
        { at: 50, from: "south", enemies: [{ enemy: "japanese_infantry", count: 4, level: 40 }], line: "남쪽 성벽 쪽! 공사관 무관들이 지켜보고 있다." },
      ],
      allies: [{ sprite: "soldier_empire", name: "시위대", count: 6 }],
      victory: [
        { k: "nation", key: "defense", add: 4 },
        { k: "nation", key: "diplomacy", add: 2 },
        { k: "point", point: "honor", add: 10 },
        { k: "exp", add: 2800 },
        { k: "prompt", prompt: "p_neutral_ok" },
      ],
      defeat: [{ k: "toast", text: "문빗장이 휘었다. 시위대가 다시 문을 받친다.", tone: "warn" }],
    },
    {
      id: "b_jungmyeong",
      title: "중명전 수호",
      subtitle: "1905.11.17 · [대체역사] 경운궁",
      site: "hanyang",
      offset: [1, -4],
      radius: 6,
      kind: "defend",
      timeLimit: 80,
      great: true,
      music: "resistance",
      weather: "fog",
      defend: { name: "중명전 회의실의 대신들", sprite: "official_red", hp: 900 },
      intro: [
        "일본군이 경운궁을 에워쌌다. 회의실 안에서는 조약에 도장을 찍으라는 협박이 이어진다.",
        "칼과 총으로 대신들을 몰아세우려는 이들을 문 앞에서 막아라. 회의는 회의실 안의 사람들이 끝낸다.",
      ],
      waves: [
        { at: 0, from: "south", enemies: [{ enemy: "japanese_infantry", count: 4, level: 40 }], line: "궁문 쪽 — 병사들이 밀고 들어온다!" },
        { at: 25, from: "east", enemies: [{ enemy: "japanese_vanguard", count: 4, level: 40 }], line: "회랑을 막아라. 대신들을 끌어내려 한다!" },
        { at: 55, from: "around", enemies: [{ enemy: "japanese_infantry", count: 4, level: 40 }, { enemy: "japanese_vanguard", count: 2, level: 40 }], line: "새벽이 온다. 한규설이 끝까지 고개를 젓는다!" },
      ],
      allies: [
        { sprite: "soldier_empire", name: "시위대", count: 6 },
        { sprite: "righteous_army", name: "궁 밖에 모인 백성", count: 3 },
      ],
      victory: [
        { k: "branch", id: "B12b", ok: true },
        { k: "point", point: "honor", add: 20 },
        { k: "exp", add: 3600 },
        { k: "nation", key: "diplomacy", add: 3 },
        { k: "chronicle", text: "1905년 11월 17일, 중명전. 새벽까지 문을 지켰다. 도장은 찍히지 않았다." },
        { k: "prompt", prompt: "p_jungmyeong_ok" },
      ],
      defeat: [{ k: "toast", text: "회랑을 내주었다. 다시 문 앞으로 — 아직 새벽은 오지 않았다.", tone: "warn" }],
    },
    {
      id: "b_eulsa_uibyeong",
      title: "을사의병 — 태백산 골짜기",
      subtitle: "1906 · 영해·평해 일대",
      site: "andong",
      offset: [3, 3],
      radius: 7,
      kind: "waves",
      music: "resistance",
      weather: "fog",
      intro: [
        "평민 의병장 신돌석의 부대가 골짜기에 숨었다. 일본군 수비대가 산길을 오른다.",
        "치고 흩어지고, 다시 모인다. 산이 의병의 편이다.",
      ],
      waves: [
        { from: "south", enemies: [{ enemy: "japanese_infantry", count: 4, level: 39 }], line: "수비대가 계곡으로 들어왔다 — 지금!" },
        { from: "east", enemies: [{ enemy: "japanese_vanguard", count: 3, level: 40 }, { enemy: "japanese_infantry", count: 2, level: 40 }], line: "돌격병이 능선을 탄다. 바위 뒤로!" },
        { from: "south", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "증원이다. 흩어져 다음 골짜기에서 만나자!" },
      ],
      allies: [{ sprite: "righteous_army", name: "신돌석 의진", count: 7 }],
      victory: [
        { k: "point", point: "merit", add: 80 },
        { k: "point", point: "honor", add: 15 },
        { k: "exp", add: 3000 },
        { k: "nation", key: "people", add: 3 },
        { k: "favor", faction: "uibyeong", add: 15 },
        { k: "bond", npc: "sin_dolseok", add: 20 },
        { k: "chronicle", text: "1906년, 태백산 골짜기에서 평민 의병장과 함께 싸웠다." },
      ],
      defeat: [{ k: "toast", text: "흩어졌다. 약속한 골짜기에서 다시 모인다.", tone: "warn" }],
    },
    {
      id: "b_disband_alt",
      title: "훈련원의 무기고",
      subtitle: "1907.8.1 · [대체역사] 군대 해산 저지",
      site: "hanyang",
      offset: [-1, 4],
      radius: 7,
      kind: "defend",
      timeLimit: 80,
      great: true,
      music: "resistance",
      weather: "clear",
      defend: { name: "시위대 무기고", sprite: "cannon", hp: 900 },
      intro: [
        "일본군이 '해산식'에 맨손으로 모이라 한다. 무기고를 넘기면 이 나라의 마지막 군대가 사라진다.",
        "무기고를 지켜라. 시위대가 총을 든 채 흩어지지 않게.",
      ],
      waves: [
        { at: 0, from: "south", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "무기고 접수 부대다!" },
        { at: 30, from: "west", enemies: [{ enemy: "japanese_vanguard", count: 4, level: 40 }], line: "서소문 쪽에서 돌격병이 온다!" },
        { at: 55, from: "around", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "시민들이 골목마다 길을 막는다!" },
      ],
      allies: [{ sprite: "soldier_empire", name: "시위대", count: 8 }],
      victory: [
        { k: "point", point: "honor", add: 15 },
        { k: "exp", add: 3600 },
        {
          k: "if",
          cond: minNation("people", 55),
          then: [
            { k: "branch", id: "B12c", ok: true },
            { k: "nation", key: "defense", add: 4 },
            { k: "chronicle", text: "1907년 8월 1일, 군대는 흩어지지 않았다. 백성이 무기고 둘레를 메웠다." },
            { k: "toast", text: "B12c 성공 — 장기 항전 체제가 섰다.", tone: "epic" },
          ],
          else: [
            { k: "branch", id: "B12c", ok: false },
            { k: "toast", text: "무기고는 지켰다. 그러나 함께 버틸 백성의 힘이 모자랐다. 군대는 끝내 흩어졌다.", tone: "bad" },
          ],
        },
      ],
      defeat: [{ k: "toast", text: "무기고 문이 열릴 뻔했다. 다시 문 앞으로.", tone: "warn" }],
    },
    {
      id: "b_disband_hist",
      title: "남대문 시가전",
      subtitle: "1907.8.1 · 서소문과 남대문 일대",
      site: "hanyang",
      offset: [0, 5],
      radius: 7,
      kind: "survive",
      timeLimit: 75,
      music: "resistance",
      weather: "smoke",
      intro: [
        "대대장 박승환이 해산에 항거해 자결했다는 소식에 시위대 병사들이 무기고를 열고 일어났다.",
        "이길 수 없다. 골목의 사람들이 피할 시간을 벌고, 병사들이 성 밖으로 빠져나가게 하라.",
      ],
      waves: [
        { at: 0, from: "south", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "남대문 쪽에서 기관총 소리!" },
        { at: 25, from: "west", enemies: [{ enemy: "japanese_vanguard", count: 3, level: 40 }, { enemy: "japanese_infantry", count: 2, level: 40 }], line: "서소문이 막힌다 — 골목으로!" },
        { at: 50, from: "around", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "병사들이 성 밖으로 빠져나간다. 조금만 더!" },
      ],
      allies: [{ sprite: "soldier_empire", name: "시위대", count: 6 }],
      victory: [
        { k: "point", point: "virtue", add: 60 },
        { k: "point", point: "honor", add: 10 },
        { k: "exp", add: 3200 },
        { k: "favor", faction: "uibyeong", add: 10 },
        { k: "toast", text: "빠져나간 병사들이 원주와 강화의 진위대와 함께 의병에 합류했다.", tone: "good" },
      ],
      defeat: [{ k: "toast", text: "골목이 막혔다. 다른 길로 사람들을 이끈다.", tone: "warn" }],
    },
    {
      id: "b_seoul_full",
      title: "13도 창의군 서울 진공",
      subtitle: "1908.1 · [대체역사] 동대문을 넘다",
      site: "hanyang",
      offset: [6, 1],
      radius: 9,
      kind: "boss",
      great: true,
      scaled: true,
      music: "resistance",
      weather: "snow",
      intro: [
        "해산되지 않은 시위대와 13도의 의진이 같은 새벽에 동대문 밖에 닿았다.",
        "오백 년 동안 본 모든 전장이 이 아침에 겹쳐 보인다.",
      ],
      waves: [
        { from: "west", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "동대문 밖 수비대 진지다!" },
        { from: "south", enemies: [{ enemy: "japanese_vanguard", count: 4, level: 40 }, { enemy: "japanese_infantry", count: 2, level: 40 }], line: "용산 쪽 증원 — 시위대가 막는다!" },
        { from: "west", enemies: [{ enemy: "japanese_infantry", count: 6, level: 40 }], line: "성문이 열린다! 강원·경기 의진이 함께 밀고 들어간다!" },
        { from: "around", enemies: [{ enemy: "japanese_vanguard", count: 4, level: 40 }], line: "지휘관이 직접 나왔다!" },
      ],
      boss: SEOUL_BOSS,
      allies: [
        { sprite: "soldier_empire", name: "시위대", count: 8 },
        { sprite: "righteous_army", name: "13도 의진", count: 10 },
        { sprite: "musketeer_joseon", name: "산포수", count: 4 },
      ],
      victory: [
        { k: "point", point: "honor", add: 25 },
        { k: "exp", add: 5000 },
        { k: "nation", key: "defense", add: 4 },
        { k: "nation", key: "people", add: 4 },
        { k: "chronicle", text: "1908년 1월, 13도의 깃발이 동대문을 넘었다." },
        { k: "prompt", prompt: "p_seoul_full" },
      ],
      defeat: [{ k: "toast", text: "진지 앞에서 밀렸다. 깃발 아래 다시 모인다.", tone: "warn" }],
    },
    {
      id: "b_seoul_mid",
      title: "13도 창의군 서울 진공",
      subtitle: "1908.1 · 동대문 밖 삼십 리",
      site: "hanyang",
      offset: [6, 1],
      radius: 9,
      kind: "boss",
      great: true,
      scaled: true,
      music: "resistance",
      weather: "snow",
      intro: [
        "선발대와 몇 도의 의진이 동대문 밖 삼십 리에 닿았다. 다른 의진은 아직 고개 너머에 있다.",
        "닿은 사람만으로 싸운다. 이번에는 조금 더 많이 닿았다.",
      ],
      waves: [
        { from: "west", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "수비대 진지다 — 엎드려 다가가라!" },
        { from: "south", enemies: [{ enemy: "japanese_vanguard", count: 3, level: 40 }, { enemy: "japanese_infantry", count: 3, level: 40 }], line: "옆에서 돌격병이 온다!" },
        { from: "west", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "진지 하나를 깨뜨렸다! 지휘관이 나온다!" },
      ],
      boss: SEOUL_BOSS,
      allies: [
        { sprite: "righteous_army", name: "13도 의진", count: 8 },
        { sprite: "soldier_empire", name: "해산 군인", count: 4 },
      ],
      victory: [
        { k: "point", point: "honor", add: 20 },
        { k: "exp", add: 4200 },
        { k: "nation", key: "people", add: 3 },
        { k: "chronicle", text: "1908년 1월, 동대문 밖에서 수비대를 깨뜨렸다. 그러나 성문까지는 닿지 못했다." },
        { k: "prompt", prompt: "p_seoul_mid" },
      ],
      defeat: [{ k: "toast", text: "진지 앞에서 밀렸다. 깃발 아래 다시 모인다.", tone: "warn" }],
    },
    {
      id: "b_seoul_low",
      title: "13도 창의군 서울 진공",
      subtitle: "1908.1 · 선발대의 후퇴",
      site: "hanyang",
      offset: [6, 1],
      radius: 8,
      kind: "survive",
      timeLimit: 80,
      music: "resistance",
      weather: "snow",
      intro: [
        "허위의 선발대가 동대문 밖 삼십 리에 닿았다. 본대는 오지 않았다.",
        "일본군이 몰려온다. 선발대가 고개 너머로 물러날 시간을 벌어라.",
      ],
      waves: [
        { at: 0, from: "west", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "수비대가 진지에서 나온다!" },
        { at: 30, from: "south", enemies: [{ enemy: "japanese_vanguard", count: 4, level: 40 }], line: "옆길이 막힌다 — 산길로!" },
        { at: 55, from: "around", enemies: [{ enemy: "japanese_infantry", count: 5, level: 40 }], line: "선발대가 고개를 넘는다. 조금만 더!" },
      ],
      allies: [{ sprite: "righteous_army", name: "선발대", count: 5 }],
      victory: [
        { k: "point", point: "honor", add: 15 },
        { k: "point", point: "virtue", add: 50 },
        { k: "exp", add: 3600 },
        { k: "prompt", prompt: "p_seoul_low" },
      ],
      defeat: [{ k: "toast", text: "눈밭에 쓰러졌다. 의병들이 당신을 끌고 고개를 넘는다 — 다시.", tone: "warn" }],
    },
  ],
  prompts: [
    {
      id: "p_agwan",
      title: "아관파천",
      style: "history",
      body: [
        "1896년 2월 11일 새벽, 고종은 궁녀의 가마를 타고 러시아 공사관으로 옮겼다.",
        "김홍집 내각이 무너지고 김홍집은 군중에게 살해되었다. 친러 내각이 들어섰다.",
        "그 사이 열강은 광산·철도·삼림 이권을 차례로 가져갔다.",
      ],
      options: [
        { id: "guard", text: "공사관 담장 밖에서 가마 길을 지킨다.", hint: "명예 ▲", effects: [{ k: "point", point: "honor", add: 5 }] },
        { id: "list", text: "넘어간 이권의 목록을 적는다.", hint: "지략 ▲", effects: [{ k: "stat", stat: "wit", add: 1 }] },
      ],
    },
    {
      id: "p_empire",
      title: "대한제국",
      speaker: { name: "고종 (광무제)", sprite: "emperor_korea" },
      body: [
        "1897년 10월, 환구단에서 황제의 자리에 올랐소. 나라 이름은 대한이오.",
        "그러나 황제를 지킬 군대도, 군대를 먹일 곳간도 아직 작소.",
        "그대는 오백 년 전 개국의 날에도 그 자리에 있었던 사람처럼 말하더군.",
      ],
      options: [
        {
          id: "army",
          text: "원수부의 군제를 맡겠습니다.",
          hint: "국방 ▲ · 황실 총애 ▲ · 품계 +1",
          effects: [
            { k: "nation", key: "defense", add: 4 },
            { k: "favor", faction: "hwangsil", add: 10 },
            { k: "rank", add: 1 },
          ],
        },
        {
          id: "people",
          text: "독립협회의 말을 들어 주십시오. 백성이 황제의 군대입니다.",
          hint: "개혁 ▲ · 독립협회 총애 ▲",
          effects: [
            { k: "nation", key: "reform", add: 2 },
            { k: "favor", faction: "dongnip", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_b9_intro",
      title: "종로의 만민공동회",
      speaker: { name: "서재필", sprite: "reformer" },
      body: [
        "1898년 3월, 종로 네거리에 만 명이 모였소. 러시아가 부산 앞 절영도를 빌려 달라 하고, 재정 고문과 군사 교관을 보내왔소.",
        "단상에 오를 사람이 필요하오. 오늘 하루의 연설이 아니라, 올해 내내 세 번.",
        "군중이 함께 외치면 정부도 황제도 들을 수밖에 없소.",
      ],
      options: [
        {
          id: "up",
          text: "단상에 오르겠소.",
          hint: "연설 세 번 · 둘 이상 성공하면 B9 조건",
          effects: [{ k: "point", point: "fame", add: 2 }],
        },
      ],
    },
    {
      id: "p_b9_speech1",
      title: "첫 연설 · 절영도",
      style: "story",
      body: [
        "1898년 3월 10일, 종로. 군중의 눈이 당신에게 쏠린다.",
        "무엇을 말하겠는가?",
      ],
      options: [
        {
          id: "gate",
          text: "\"절영도는 부산의 문입니다. 땅 한 뼘을 빌려주면 문을 통째로 내주는 것입니다.\"",
          hint: "지략 판정",
          effects: speech(1, "ch16_b9_s1_wit", "wit", 40, "\"옳소!\" 함성이 종로를 덮었다."),
        },
        {
          id: "fair",
          text: "\"러시아만이 아닙니다. 어느 나라에도 이 땅을 빌려주지 맙시다.\"",
          hint: "처세 판정",
          effects: speech(1, "ch16_b9_s1_tact", "tact", 45, "어깨를 맞댄 사람들이 고개를 끄덕였다."),
        },
        {
          id: "burn",
          text: "\"공사관으로 몰려갑시다!\"",
          hint: "위험",
          effects: misstep(1, "군중이 흩어지고 순검이 몰려왔다. 폭력은 반대파에게 구실을 주었다."),
        },
      ],
    },
    {
      id: "p_b9_speech2",
      title: "둘째 연설 · 이권",
      style: "story",
      body: [
        "봄이 지나며 러시아의 고문과 교관이 물러갔다. 이제 남은 것은 이미 넘어간 이권이다.",
        "광산, 철도, 삼림. 군중은 숫자보다 이야기를 원한다.",
      ],
      options: [
        {
          id: "list",
          text: "넘어간 광산과 철도의 이름을 하나하나 읽어 내려간다.",
          hint: "지략 판정",
          effects: speech(2, "ch16_b9_s2_wit", "wit", 40, "이름 하나가 불릴 때마다 탄식이 터졌다."),
        },
        {
          id: "story",
          text: "\"임진년에 의병은 제 땅의 길을 알아서 이겼습니다. 이제 그 길을 남이 놓고 있습니다.\"",
          hint: "기백 판정",
          effects: speech(2, "ch16_b9_s2_spirit", "spirit", 45, "늙은이들이 눈시울을 붉혔다."),
        },
        {
          id: "throne",
          text: "\"이권 따위는 상관없습니다. 황제만 지키면 됩니다.\"",
          hint: "위험",
          effects: misstep(2, "군중이 등을 돌렸다. '그러면 우리는 무엇이오?'"),
        },
      ],
    },
    {
      id: "p_b9_speech3",
      title: "셋째 연설 · 관민공동회",
      style: "story",
      body: [
        "1898년 10월, 대신들까지 나온 관민공동회. 헌의 6조를 결의하고 중추원을 의회처럼 고치자는 자리다.",
        "백정 출신 박성춘이 '관민이 합심하자'고 외친 뒤, 당신 차례가 왔다.",
      ],
      options: [
        {
          id: "council",
          text: "\"중추원의 절반을 백성이 뽑게 합시다. 황제의 권한과 다투자는 것이 아닙니다.\"",
          hint: "지략 판정",
          effects: speech(3, "ch16_b9_s3_wit", "wit", 40, "대신석에서도 고개를 끄덕이는 이가 있었다."),
        },
        {
          id: "together",
          text: "\"오백 년 동안 이 나라를 지킨 것은 이름 없는 사람들이었습니다.\"",
          hint: "기백 판정",
          effects: speech(3, "ch16_b9_s3_spirit", "spirit", 45, "긴 침묵 뒤에 박수가 쏟아졌다."),
        },
        {
          id: "republic",
          text: "\"황제가 없는 나라를 만듭시다.\"",
          hint: "위험",
          effects: misstep(3, "그 말은 그대로 반대파의 무기가 되었다. '공화정을 꾀한다'는 익명서가 돌았다."),
        },
      ],
    },
    {
      id: "p_b9_result",
      title: "12월의 갈림길",
      style: "story",
      body: [
        "1898년 12월. 독립협회가 공화정을 꾀한다는 익명서가 돌고, 황국협회의 보부상들이 집회장을 습격했다.",
        "황제는 해산을 명하려 한다. 마지막으로 중추원 개편의 타협안을 올릴 수 있다.",
      ],
      options: [
        {
          id: "compromise",
          text: "황제권을 인정하는 중추원 개편안과 이권 회수안을 함께 올린다.",
          hint: "B9 조건: 연설 둘 이상 성공",
          effects: [
            {
              k: "if",
              cond: B9_TWO_OF_THREE,
              then: [
                { k: "branch", id: "B9", ok: true },
                { k: "nation", key: "people", add: 8 },
                { k: "nation", key: "diplomacy", add: 4 },
                { k: "nation", key: "finance", add: 5 },
                { k: "nation", key: "infiltration", add: -5 },
                { k: "favor", faction: "hwangsil", add: -15 },
                { k: "favor", faction: "dongnip", add: 20 },
                { k: "chronicle", text: "1898년 겨울, 중추원에 백성이 뽑은 의원이 들어섰다. 넘어간 이권 몇이 돌아왔다." },
                { k: "toast", text: "B9 성공 — 민심과 국제 여론이 오르고 위기 때 동원력이 커진다.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B9", ok: false },
                { k: "toast", text: "B9 실패 — 협회는 해산되었다. 종로의 함성은 끊겼다.", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "side",
          text: "황국협회 편에 서서 집회 해산을 돕는다.",
          hint: "B9 실패 · 황실 총애 ▲ · 명예 ▼",
          effects: [
            { k: "branch", id: "B9", ok: false },
            { k: "favor", faction: "hwangsil", add: 15 },
            { k: "point", point: "honor", add: -10 },
          ],
        },
      ],
    },
    {
      id: "p_yangjeon",
      title: "땅의 이름",
      speaker: { name: "양지아문 측량 기사 문씨", sprite: "official_green" },
      body: [
        "광무 양전이오. 땅을 재고, 주인 이름을 적은 지계를 내주오.",
        "외국 회사 중개인들이 이 장부를 비싸게 사겠다고 기웃거리오.",
        "길에는 도적도 나오오. 측량대를 지켜 주시겠소?",
      ],
      options: [
        {
          id: "escort",
          text: "측량대를 지키겠소.",
          hint: "재정 ▲ · 민심 ▲",
          effects: [
            { k: "nation", key: "finance", add: 5 },
            { k: "nation", key: "people", add: 1 },
            { k: "flag", flag: "ch16_yangjeon" },
          ],
        },
        {
          id: "sell",
          text: "장부 사본을 중개인에게 넘기고 값을 받는다.",
          hint: "전 +1500 · 명예 ▼▼ · 변절",
          effects: [
            { k: "point", point: "money", add: 1500 },
            { k: "point", point: "honor", add: -20 },
            { k: "nation", key: "infiltration", add: 3 },
            { k: "flag", flag: "turncoat", value: true },
            { k: "flag", flag: "ch16_sold_ledger" },
          ],
        },
      ],
    },
    {
      id: "p_b10",
      title: "두 개의 곳간",
      speaker: { name: "이용익", sprite: "official_red" },
      body: [
        "황실의 곳간 내장원과 나라의 곳간 탁지부가 따로 있소. 인삼·광산·역둔토의 수입은 내장원으로 오오.",
        "그대는 이 둘을 합쳐 군대와 포대에 쓰자 하는구려. 황제께서 기뻐하시지 않을 것이오.",
        "그러나 군대가 없으면 곳간도 지킬 수 없다는 말은… 틀리지 않소.",
      ],
      options: [
        {
          id: "unify",
          text: "두 곳간을 하나로 합쳐 상비군과 해안 포대에 쓰십시오.",
          hint: "B10 조건: 재정 42 · 국방 +10 · 황실 총애 ▼",
          requires: minNation("finance", 42),
          lockedText: "재정 42 이상이어야 합칠 곳간이 있다",
          effects: [
            { k: "branch", id: "B10", ok: true },
            { k: "nation", key: "defense", add: 10 },
            { k: "favor", faction: "hwangsil", add: -20 },
            { k: "chronicle", text: "1903년, 두 곳간이 하나가 되었다. 상비군과 포대에 예산이 섰다." },
            { k: "toast", text: "B10 성공 — 국방 +10. 중립을 지킬 실력의 기반.", tone: "epic" },
          ],
        },
        {
          id: "budget",
          text: "곳간은 그대로 두되 군비만이라도 늘려 주십시오.",
          hint: "B10 실패 · 국방 ▲ · 재정 ▼",
          effects: [
            { k: "branch", id: "B10", ok: false },
            { k: "nation", key: "defense", add: 3 },
            { k: "nation", key: "finance", add: -3 },
          ],
        },
        {
          id: "obey",
          text: "황실의 뜻을 따르겠습니다.",
          hint: "B10 실패 · 황실 총애 ▲",
          effects: [
            { k: "branch", id: "B10", ok: false },
            { k: "favor", faction: "hwangsil", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_b11",
      title: "국외 중립",
      speaker: { name: "고종 (광무제)", sprite: "emperor_korea" },
      body: [
        "1904년 1월 21일, 대한제국은 러시아와 일본 사이에서 중립을 선언했소.",
        "그러나 중립은 선언만으로 지켜지지 않소. 열강이 인정하고, 우리가 지킬 힘이 있어야 하오.",
        "일본 군함이 제물포에 모여 있다 하오.",
      ],
      options: [
        {
          id: "hold",
          text: "도성 문을 닫고, 각국 공사관에 중립을 확인받겠습니다.",
          hint: "B11 조건: B7 성공 + 국방 55",
          effects: [
            {
              k: "if",
              cond: { k: "all", of: [ok("B7"), minNation("defense", 55)] },
              then: [
                { k: "branch", id: "B11", ok: true },
                { k: "nation", key: "diplomacy", add: 3 },
                { k: "nation", key: "defense", add: 2 },
                { k: "toast", text: "B11 성공 — 열강 공사관이 중립을 확인했다. 시위대가 도성 문으로 간다.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B11", ok: false },
                { k: "toast", text: "B11 실패 — 지킬 힘도 보장도 없는 중립이었다. 일본군이 서울에 들어왔다.", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "strong",
          text: "러시아든 일본이든 강한 쪽에 붙어야 합니다.",
          hint: "B11 실패 · 명예 ▼",
          effects: [
            { k: "branch", id: "B11", ok: false },
            { k: "point", point: "honor", add: -10 },
          ],
        },
      ],
    },
    {
      id: "p_neutral_ok",
      title: "문 앞에 멈춘 군대",
      style: "history",
      body: [
        "[게임 속 대체역사] 일본군 선발대는 도성 밖에서 멈춰 섰다. 한일의정서는 맺어지지 않았다.",
        "[사실] 실제 역사에서 일본군은 1904년 2월 서울을 점령하고 2월 23일 한일의정서를, 8월에 제1차 한일협약을 강요했다.",
        "전쟁은 만주에서 계속된다. 일본은 다른 길을 찾을 것이다.",
      ],
      options: [{ id: "go", text: "다음 해로.", effects: [{ k: "exp", add: 1000 }] }],
    },
    {
      id: "p_uijeongseo",
      title: "점령된 서울",
      style: "history",
      body: [
        "1904년 2월, 일본은 뤼순과 제물포의 러시아 함대를 기습하고 선전포고했다. 일본군이 서울을 점령했다.",
        "2월 23일 한일의정서로 일본은 군사 요지를 쓸 권리를 얻었다. 8월 제1차 한일협약으로 재정과 외교에 일본이 추천한 고문이 들어왔다.",
        "이듬해 재정 고문 메가타가 화폐정리사업을 벌여 백동화를 헐값에 바꾸게 했다. 상인들이 쓰러졌다.",
      ],
      options: [{ id: "go", text: "적어 둔다.", effects: [{ k: "chronicle", text: "1904년, 중립은 지켜지지 않았다." }] }],
    },
    {
      id: "p_lure",
      title: "공사관 통역의 회유",
      speaker: { name: "공사관 통역 (가상)", sprite: "japanese_envoy" },
      body: [
        "대세는 정해졌습니다. 현명한 분들은 이미 조약에 찬성하는 대신들 곁에 섰습니다.",
        "어르신 같은 분이 한마디만 거들어 주시면, 작위와 땅이 따라올 것입니다.",
      ],
      options: [
        { id: "refuse", text: "돌아가시오.", hint: "명예 ▲", effects: [{ k: "point", point: "honor", add: 10 }] },
        {
          id: "accept",
          text: "…이야기를 더 들어 보지.",
          hint: "전 +2000 · 명예 ▼▼▼ · 변절",
          effects: [
            { k: "point", point: "money", add: 2000 },
            { k: "point", point: "honor", add: -40 },
            { k: "favor", faction: "chinil", add: 30 },
            { k: "flag", flag: "turncoat", value: true },
            { k: "flag", flag: "ch16_took_bribe" },
          ],
        },
      ],
    },
    {
      id: "p_b12a",
      title: "워싱턴으로 가는 친서",
      speaker: { name: "헐버트", sprite: "western_envoy" },
      body: [
        "1905년 여름이오. 일본과 미국, 일본과 영국 사이에 무언가 오가고 있다는 소문이오.",
        "황제의 친서를 품고 워싱턴에 가겠소. 조미조약의 거중조정을 요청할 것이오.",
        "그대가 러시아·영국 공사관과 줄을 대어 준다면, 늦기 전에 닿을지도 모르오.",
      ],
      options: [
        {
          id: "go",
          text: "공사관마다 줄을 대고, 밀약의 정보를 맞바꾸겠소.",
          hint: "B12a 조건: 외교 52 (거중조정 문구 확보 시 47) + B7 또는 B11",
          effects: [
            {
              k: "if",
              cond: {
                k: "all",
                of: [
                  { k: "any", of: [ok("B7"), ok("B11")] },
                  {
                    k: "any",
                    of: [
                      minNation("diplomacy", 52),
                      { k: "all", of: [minNation("diplomacy", 47), { k: "flag", flag: "ch15_geojung" }] },
                    ],
                  },
                ],
              },
              then: [
                { k: "branch", id: "B12a", ok: true },
                { k: "nation", key: "diplomacy", add: 4 },
                { k: "bond", npc: "hulbert", add: 20 },
                { k: "chronicle", text: "1905년, 몇몇 열강이 일본의 '보호'를 승인하기를 미뤘다." },
                { k: "toast", text: "B12a 성공 — 열강의 승인이 갈라졌다.", tone: "epic" },
              ],
              else: [
                { k: "branch", id: "B12a", ok: false },
                { k: "bond", npc: "hulbert", add: 10 },
                { k: "toast", text: "B12a 실패 — 친서가 닿기 전에 열강은 이미 저들끼리 정했다.", tone: "bad" },
              ],
            },
          ],
        },
        {
          id: "fate",
          text: "열강은 이미 저들끼리 정했을 것이오.",
          hint: "B12a 실패",
          effects: [
            { k: "branch", id: "B12a", ok: false },
          ],
        },
      ],
    },
    {
      id: "p_hangyuseol",
      title: "중명전의 밤",
      speaker: { name: "한규설", sprite: "official_red" },
      body: [
        "이토가 군대를 끌고 와 회의를 열라 하오. 나는 찬성하지 않을 것이오.",
        "그러나 저들이 대신들을 하나씩 끌어내 도장을 받으려 하오.",
        "그대의 군사가 이 회랑을 지켜 준다면, 회의는 회의답게 끝날 수 있소.",
      ],
      options: [
        {
          id: "guard",
          text: "새벽까지 이 문을 지키겠습니다.",
          hint: "[대체역사] 중명전 수호 방어전 · 승리 시 B12b",
          effects: [
            { k: "point", point: "honor", add: 5 },
            { k: "flag", flag: "ch16_jungmyeong_open" },
          ],
        },
      ],
    },
    {
      id: "p_eulsa",
      title: "1905년 11월 17일",
      style: "history",
      body: [
        "일본군이 경운궁을 에워싼 가운데, 이토 히로부미는 대신들을 위협해 18일 새벽 외교권을 빼앗는 조약을 강제로 성립시켰다.",
        "고종은 비준하지 않았다. 참정대신 한규설은 끝까지 반대했다.",
        "장지연은 『황성신문』에 「시일야방성대곡」을 실었다. 민영환은 자결로 항거했다.",
        "당신의 군사는 궁궐 근처에도 가지 못했다. 그것이 지킬 힘이 없는 나라의 밤이었다.",
      ],
      options: [
        {
          id: "record",
          text: "그 밤을 적고, 의병의 소식을 찾아 나선다.",
          hint: "B12b 실패",
          effects: [
            { k: "branch", id: "B12b", ok: false },
            { k: "chronicle", text: "1905년 11월 17일, 을사늑약. 지킬 힘이 없었다." },
          ],
        },
      ],
    },
    {
      id: "p_jungmyeong_ok",
      title: "도장이 찍히지 않은 새벽",
      style: "history",
      body: [
        "[게임 속 대체역사] 대신들은 끝내 끌려 나오지 않았다. 조약은 성립하지 않았다.",
        "[사실] 실제 역사에서는 11월 18일 새벽 을사늑약이 강제로 성립했고, 1906년 2월 통감부가 설치되었다.",
        "막은 것은 하룻밤이다. 일본의 압박은 차관과 고문과 군대의 모습으로 다시 올 것이다.",
      ],
      options: [{ id: "go", text: "다음 해를 준비한다.", effects: [{ k: "exp", add: 1200 }] }],
    },
    {
      id: "p_sindolseok",
      title: "평민 의병장",
      speaker: { name: "신돌석", sprite: "righteous_army" },
      body: [
        "양반 의병장들이 일어나는데, 우리 같은 사람이 못 할 것이 무어요.",
        "영해와 평해의 골짜기를 우리는 눈 감고도 다니오. 일본군 수비대가 산을 오르면 산이 그들을 먹을 것이오.",
      ],
      options: [
        { id: "join", text: "함께 싸우겠소.", hint: "의병 총애 ▲", effects: [{ k: "favor", faction: "uibyeong", add: 10 }] },
      ],
    },
    {
      id: "p_after_jungmyeong",
      title: "1906년의 압박",
      style: "history",
      body: [
        "[게임 속 대체역사] 늑약이 없는 대한제국에 일본은 차관을 들이밀고, 군대를 국경 너머에 세워 두었다.",
        "의병들은 해산하지 않았다. 고을마다 훈련하는 장정이 늘었다.",
        "[사실] 실제 역사에서는 이 무렵 을사의병이 일어나 민종식·최익현·신돌석 등이 싸웠다.",
      ],
      options: [{ id: "go", text: "다음 해로.", effects: [{ k: "nation", key: "people", add: 2 }] }],
    },
    {
      id: "p_gukchae",
      title: "나랏빚을 갚자",
      speaker: { name: "서상돈", sprite: "merchant" },
      body: [
        "1907년 정월, 대구 광문사에서 시작했소. 나라가 진 빚 1,300만 원을 백성이 모아 갚자는 것이오.",
        "사내들은 담배를 끊고, 아낙들은 가락지를 내놓소.",
        "[사실] 실제 역사에서 이 빚은 통감부 시기 일본에서 들여온 차관이었다. 운동은 통감부의 방해로 좌절되었다.",
      ],
      options: [
        {
          id: "large",
          text: "전 600을 내놓는다.",
          hint: "재정 +3 · 공덕 ▲▲ · 공동 실록 ▲",
          requires: { k: "point", point: "money", min: 600 },
          lockedText: "전 600이 필요하다",
          effects: [
            { k: "point", point: "money", add: -600 },
            { k: "nation", key: "finance", add: 3 },
            { k: "point", point: "virtue", add: 60 },
            { k: "worldEvent", add: 30 },
          ],
        },
        {
          id: "small",
          text: "전 200을 내놓는다.",
          hint: "재정 +1 · 공덕 ▲",
          requires: { k: "point", point: "money", min: 200 },
          lockedText: "전 200이 필요하다",
          effects: [
            { k: "point", point: "money", add: -200 },
            { k: "nation", key: "finance", add: 1 },
            { k: "point", point: "virtue", add: 20 },
            { k: "worldEvent", add: 15 },
          ],
        },
        {
          id: "speak",
          text: "모금함을 들고 장터를 돈다.",
          hint: "민심 ▲ · 공동 실록 ▲",
          effects: [
            { k: "nation", key: "people", add: 1 },
            { k: "worldEvent", add: 10 },
          ],
        },
      ],
    },
    {
      id: "p_disband_alt",
      title: "두 번째 강요",
      speaker: { name: "시위대 정위 김씨 (가상)", sprite: "soldier_empire" },
      body: [
        "황제께서 헤이그에 특사를 보내셨다는 이유로, 일본이 황제의 퇴위와 군대 해산을 요구하고 있소.",
        "8월 1일 훈련원에 맨손으로 모이라 하오. 무기고를 넘기면 끝이오.",
        "백성들이 골목마다 모여 있소. 그들이 함께 버텨 준다면…",
      ],
      options: [
        {
          id: "hold",
          text: "무기고를 지킵시다. 군대는 흩어지지 않습니다.",
          hint: "[대체역사] 방어전 · 승리 + 민심 55 → B12c",
          effects: [{ k: "point", point: "honor", add: 5 }],
        },
      ],
    },
    {
      id: "p_disband_hist",
      title: "1907년 7월과 8월",
      style: "history",
      body: [
        "헤이그 특사를 구실로 일본과 친일 내각은 고종을 압박했다. 7월 19일 양위 조칙이 내려지고 이튿날 대리 양위식이 치러졌다.",
        "7월 24일 정미7조약으로 각 부에 일본인 차관이 들어왔다. 비밀 각서에 따라 8월 1일 군대 해산이 강행되었다.",
        "시위대 제1연대 제1대대장 박승환이 자결로 항거했다. 병사들이 무기고를 열고 일어났다.",
      ],
      options: [
        {
          id: "go",
          text: "남대문으로 달린다.",
          hint: "B12c 실패 · 시가전",
          effects: [{ k: "branch", id: "B12c", ok: false }],
        },
      ],
    },
    {
      id: "p_heowi",
      title: "양주의 겨울",
      speaker: { name: "허위", sprite: "righteous_army" },
      body: [
        "1907년 겨울, 전국의 의진이 양주에 모였소. 총대장은 이인영, 나는 군사장이오. 13도 창의군이라 이름했소.",
        "동대문 밖 삼십 리에서 각 도의 의진이 한날한시에 만나야 하오. 연락이 끊기면 따로따로 싸우다 무너지오.",
        "그대가 이어 온 사람들 — 옛 군인, 포수, 고을의 장정 — 그들이 얼마나 올지가 승패를 가르오.",
      ],
      options: [
        {
          id: "march",
          text: "가겠소. 닿을 수 있는 사람은 모두 데리고.",
          hint: "국운·분기에 따라 아군 규모가 3단계로 달라진다",
          effects: [SEOUL_TIER],
        },
      ],
    },
    {
      id: "p_seoul_full",
      title: "동대문의 아침",
      style: "history",
      body: [
        "[게임 속 대체역사] 해산되지 않은 군대와 13도의 의진이 같은 아침에 닿았다. 수비대는 용산으로 물러났다.",
        "[사실] 실제 역사에서는 1908년 1월 허위의 선발대가 동대문 밖 30리까지 나아갔으나 본대가 제때 닿지 못해 밀려났다.",
        "오늘의 함성은 시작일 뿐이다. 이 나라를 노리는 뜻은 사라지지 않았다.",
      ],
      options: [{ id: "go", text: "깃발을 내려다본다.", effects: [{ k: "worldEvent", add: 40 }] }],
    },
    {
      id: "p_seoul_mid",
      title: "삼십 리",
      style: "history",
      body: [
        "동대문 밖에서 수비대를 깨뜨렸다. 그러나 다른 도의 의진은 끝내 고개를 넘지 못했다.",
        "[사실] 실제 역사에서도 13도 창의군은 연락과 집결이 어긋나 서울에 닿지 못했다. 총대장 이인영은 부친상으로 고향에 돌아갔다.",
        "당신이 이어 온 사람들만큼, 조금 더 멀리 갔다.",
      ],
      options: [{ id: "go", text: "물러나 다음 싸움을 준비한다.", effects: [{ k: "worldEvent", add: 25 }] }],
    },
    {
      id: "p_seoul_low",
      title: "닿지 않은 본대",
      style: "history",
      body: [
        "1908년 1월, 허위의 선발대가 동대문 밖 30리까지 나아갔다. 본대는 제때 닿지 못했고, 선발대는 일본군에 밀려났다.",
        "총대장 이인영은 부친상으로 고향에 돌아갔다. 북쪽에서는 산포수 출신 홍범도가 유격전을 이어 갔다.",
        "당신은 선발대를 고개 너머로 데려왔다. 살아남은 사람들이 다음 싸움을 잇는다.",
      ],
      options: [{ id: "go", text: "살아남은 이들과 산으로 간다.", effects: [{ k: "worldEvent", add: 15 }] }],
    },
    {
      id: "p_1909",
      title: "1909년",
      style: "history",
      body: [
        "7월 기유각서로 대한제국의 사법권과 감옥 사무가 일본에 넘어갔다.",
        "9월 4일 일본은 청과 간도협약을 맺어 두만강을 경계로 하고 간도를 청의 영토로 인정했다. 대한제국은 이 협상의 당사자가 아니었다.",
        "9~10월 일본군은 전라도 의병을 겨냥한 대규모 진압 작전을 벌였다. 많은 의병이 희생되거나 붙잡혔고, 살아남은 이들은 만주와 연해주로 건너갔다.",
        "10월 26일, 하얼빈역에서 안중근이 이토 히로부미를 저격했다. 그는 법정에서 대한의군 참모중장으로서의 전쟁 행위라고 밝혔다.",
      ],
      options: [
        {
          id: "record",
          text: "장생록에 적는다.",
          effects: [{ k: "chronicle", text: "1909년, 국권이 하나씩 넘어갔다. 하얼빈의 총성이 들렸다." }],
        },
        {
          id: "jeonggye",
          text: "이백 년 전 백두산에서 적은 물줄기 기록을 꺼내 본다.",
          hint: "장생의 기억",
          requires: { k: "flag", flag: "ch12_jeonggye_record" },
          effects: [
            { k: "chronicle", text: "1909년, 1712년의 백두산 기록을 다시 펼쳤다. 그 협상의 자리에 대한제국은 없었다." },
          ],
        },
      ],
    },
    {
      id: "p_1909_alt",
      title: "1909년",
      style: "history",
      body: [
        "[게임 속 대체역사] 통감부가 서지 않은 대한제국은 여전히 제 법정과 제 군대를 가졌다.",
        "열강은 저울질을 계속한다. 국경 너머의 군대도 물러가지 않았다.",
        "해산되지 않은 군인과 옛 의병들이 새 군대의 뼈대가 되었다. 그러나 이 나라를 노리는 뜻은 사라지지 않았다.",
      ],
      options: [{ id: "go", text: "장생록에 적는다.", effects: [{ k: "chronicle", text: "1909년, 아직 나라가 있었다." }] }],
    },
    {
      id: "p_finale",
      title: "1910년 여름",
      style: "story",
      body: [
        "1361년 겨울, 노인성 아래에서 열여섯 살의 당신이 눈을 떴다.",
        "그 뒤로 홍건적의 개경을, 황산의 비탈을, 개국의 아침을 보았다. 세종의 바다와 북방의 눈을, 계유년의 밤을 보았다.",
        "동래의 남문, 울돌목의 물, 남한산성의 화톳불, 존현각의 지붕, 광성보의 깃발을 지났다.",
        "함께 싸운 사람들은 모두 먼저 갔다. 장생록에는 그들의 이름이 오백 년 치 쌓였다.",
        "1910년 8월. 이제 이 나라가 어떤 아침을 맞을지, 당신이 걸어온 길이 답한다.",
      ],
      options: [
        {
          id: "close",
          text: "장생록의 마지막 장을 편다.",
          effects: [{ k: "chronicle", text: "1910년 8월, 장생록의 마지막 장을 폈다." }],
        },
      ],
    },
  ],
  steps: [
    {
      id: "s1",
      year: 1896,
      objectives: [
        { id: "o_gojong_1896", text: "정동 러시아 공사관의 고종을 찾아간다", kind: "talk", target: "gojong_1896", site: "hanyang", offset: [3, -2], prompt: "p_agwan" },
      ],
    },
    {
      id: "s2",
      year: 1897,
      narration: ["1897년 10월, 환구단. 하늘에 제사를 올리는 연기가 오른다."],
      objectives: [
        { id: "o_empire", text: "황제를 알현한다", kind: "talk", target: "gwangmu", site: "hanyang", offset: [0, -3], prompt: "p_empire" },
      ],
    },
    {
      id: "s3",
      year: 1898,
      narration: ["1898년 3월, 종로 네거리. 공동 실록 '만민공동회' — 모인 사람과 연설이 지지를 쌓는다."],
      objectives: [
        { id: "o_b9_intro", text: "서재필을 만난다", kind: "talk", target: "seo_jaepil", site: "hanyang", offset: [-3, 2], prompt: "p_b9_intro" },
        { id: "o_yisangjae", text: "이상재와 이야기한다", kind: "talk", target: "yi_sangjae", site: "hanyang", offset: [-1, 3], optional: true, onComplete: [{ k: "worldEvent", add: 10 }] },
      ],
    },
    { id: "s3b", year: 1898, objectives: [{ id: "o_b9_speech1", text: "첫 연설 · 절영도", kind: "prompt", target: "p_b9_speech1" }] },
    { id: "s3c", year: 1898, objectives: [{ id: "o_b9_speech2", text: "둘째 연설 · 이권", kind: "prompt", target: "p_b9_speech2" }] },
    { id: "s3d", year: 1898, objectives: [{ id: "o_b9_speech3", text: "셋째 연설 · 관민공동회", kind: "prompt", target: "p_b9_speech3" }] },
    {
      id: "s4",
      year: 1898,
      objectives: [{ id: "o_b9_result", text: "12월의 갈림길", kind: "prompt", target: "p_b9_result" }],
    },
    {
      id: "s5",
      year: 1899,
      narration: ["1899년. 황제가 원수부를 두고 군 통수권을 쥐었다. 시위대와 진위대가 늘어난다."],
      objectives: [
        { id: "o_wonsubu", text: "원수부 교련관과 겨룬다", kind: "battle", target: "b_wonsubu", site: "hanyang", offset: [-4, -2] },
      ],
    },
    {
      id: "s6",
      year: 1901,
      narration: ["1901년. 땅을 다시 재는 광무 양전이 고을마다 이어진다."],
      objectives: [
        { id: "o_yangjeon", text: "공주에서 양전 측량대를 만난다", kind: "talk", target: "surveyor", site: "gongju", offset: [2, 1], prompt: "p_yangjeon" },
        { id: "o_bandit", text: "측량대를 노리는 도적을 쫓는다", kind: "defeat", target: "bandit", count: 3, site: "gongju", offset: [-3, 2], optional: true, onComplete: [{ k: "nation", key: "finance", add: 1 }, { k: "point", point: "virtue", add: 20 }] },
      ],
    },
    {
      id: "s7",
      year: 1903,
      objectives: [
        { id: "o_b10", text: "내장원경 이용익과 곳간을 논한다", kind: "talk", target: "yi_yongik", site: "hanyang", offset: [3, 1], prompt: "p_b10" },
      ],
    },
    {
      id: "s8",
      year: 1904,
      narration: ["1904년 정월. 러시아와 일본의 전쟁이 코앞이다."],
      objectives: [
        { id: "o_b11", text: "황제에게 중립의 방도를 아뢴다", kind: "talk", target: "gwangmu", site: "hanyang", offset: [0, -3], prompt: "p_b11" },
      ],
    },
    {
      id: "s9",
      year: 1904,
      objectives: [
        { id: "o_seoul_1904", text: "[대체역사] 도성 문을 지킨다 (70초)", kind: "battle", target: "b_seoul_1904", site: "hanyang", offset: [-5, 1], requires: ok("B11") },
        { id: "o_uijeongseo", text: "점령된 서울", kind: "prompt", target: "p_uijeongseo", requires: not(ok("B11")) },
      ],
    },
    {
      id: "s10",
      year: 1905,
      narration: [
        "1905년 2월, 일본은 독도를 시마네현에 편입한다고 고시했다. 대한제국은 1900년 칙령 제41호로 울도군이 석도를 관할하게 한 바 있으며, 1906년 이를 알고 부정하는 지령을 냈다.",
        "[해석] 칙령의 '석도'를 독도로 보는 것은 한국 정부의 공식 입장이며, 일본은 다르게 주장한다.",
        "여름, 열강 사이에 밀약의 소문이 돈다.",
      ],
      objectives: [
        { id: "o_b12a", text: "헐버트를 만난다", kind: "talk", target: "hulbert", site: "hanyang", offset: [4, 0], prompt: "p_b12a" },
        { id: "o_lure", text: "공사관 통역이 찾아왔다", kind: "talk", target: "jp_agent", site: "hanyang", offset: [5, 3], prompt: "p_lure", optional: true },
      ],
    },
    {
      id: "s11",
      year: 1905,
      narration: [
        "7월 가쓰라-태프트 각서, 8월 제2차 영일동맹, 9월 포츠머스 조약 — 열강이 하나씩 고개를 돌렸다.",
        "11월 17일. 일본군이 경운궁을 에워쌌다.",
      ],
      objectives: [
        { id: "o_hangyuseol", text: "중명전에서 참정대신 한규설을 만난다", kind: "talk", target: "han_gyuseol", site: "hanyang", offset: [1, -4], prompt: "p_hangyuseol", requires: minNation("defense", 60) },
        { id: "o_eulsa", text: "1905년 11월 17일", kind: "prompt", target: "p_eulsa", requires: not(minNation("defense", 60)) },
      ],
    },
    {
      id: "s12",
      year: 1905,
      objectives: [
        { id: "o_jungmyeong", text: "[대체역사] 새벽까지 중명전 회랑을 지킨다", kind: "battle", target: "b_jungmyeong", site: "hanyang", offset: [1, -4], requires: { k: "flag", flag: "ch16_jungmyeong_open" } },
      ],
    },
    {
      id: "s13",
      year: 1906,
      objectives: [
        { id: "o_after_jungmyeong", text: "1906년의 압박", kind: "prompt", target: "p_after_jungmyeong", requires: ok("B12b") },
        { id: "o_sindolseok", text: "안동 너머 골짜기에서 신돌석을 만난다", kind: "talk", target: "sin_dolseok", site: "andong", offset: [2, 1], prompt: "p_sindolseok", requires: not(ok("B12b")) },
      ],
    },
    {
      id: "s13b",
      year: 1906,
      objectives: [
        { id: "o_eulsa_uibyeong", text: "을사의병과 함께 수비대를 친다", kind: "battle", target: "b_eulsa_uibyeong", site: "andong", offset: [3, 3], requires: not(ok("B12b")) },
      ],
    },
    {
      id: "s14",
      year: 1907,
      narration: ["1907년 정월. 대구에서 나랏빚을 갚자는 소리가 일어났다. 공동 실록 '국채보상 의연금'."],
      objectives: [
        { id: "o_gukchae", text: "대구에서 서상돈을 만난다", kind: "talk", target: "seo_sangdon", site: "daegu", offset: [1, 1], prompt: "p_gukchae" },
      ],
    },
    {
      id: "s15",
      year: 1907,
      narration: ["1907년 6월, 황제는 헤이그 만국평화회의에 이상설·이준·이위종을 특사로 보냈다. 7월, 일본이 이를 구실로 황제를 압박했다."],
      objectives: [
        { id: "o_disband_talk", text: "시위대 정위를 만난다", kind: "talk", target: "guard_officer", site: "hanyang", offset: [-1, 4], prompt: "p_disband_alt", requires: ok("B12b") },
        { id: "o_disband_hist_card", text: "1907년 7월과 8월", kind: "prompt", target: "p_disband_hist", requires: not(ok("B12b")) },
      ],
    },
    {
      id: "s15b",
      year: 1907,
      narration: ["8월 1일 아침, 훈련원."],
      objectives: [
        { id: "o_disband_alt", text: "[대체역사] 무기고를 지킨다 (80초)", kind: "battle", target: "b_disband_alt", site: "hanyang", offset: [-1, 4], requires: ok("B12b") },
        { id: "o_disband_hist", text: "남대문 일대에서 사람들이 빠져나갈 시간을 번다 (75초)", kind: "battle", target: "b_disband_hist", site: "hanyang", offset: [0, 5], requires: not(ok("B12b")) },
      ],
    },
    {
      id: "s16",
      year: 1907,
      narration: ["1907년 겨울. 해산 군인이 합류한 의병이 고을마다 일어났다."],
      objectives: [
        { id: "o_heowi", text: "동대문 밖에서 군사장 허위를 만난다", kind: "talk", target: "heo_wi", site: "hanyang", offset: [6, 0], prompt: "p_heowi" },
      ],
    },
    {
      id: "s17",
      year: 1908,
      narration: ["1908년 1월. 동대문 밖 삼십 리, 눈 덮인 들판."],
      objectives: [
        { id: "o_seoul_full", text: "13도 창의군 서울 진공 — 동대문으로", kind: "battle", target: "b_seoul_full", site: "hanyang", offset: [6, 1], requires: tierIs(2) },
        { id: "o_seoul_mid", text: "13도 창의군 서울 진공 — 삼십 리를 넘어", kind: "battle", target: "b_seoul_mid", site: "hanyang", offset: [6, 1], requires: tierIs(1) },
        { id: "o_seoul_low", text: "13도 창의군 — 선발대의 후퇴를 엄호한다", kind: "battle", target: "b_seoul_low", site: "hanyang", offset: [6, 1], requires: tierIs(0) },
      ],
    },
    {
      id: "s18",
      year: 1909,
      objectives: [
        { id: "o_1909_alt", text: "1909년", kind: "prompt", target: "p_1909_alt", requires: ok("B12b") },
        { id: "o_1909", text: "1909년", kind: "prompt", target: "p_1909", requires: not(ok("B12b")) },
      ],
    },
    {
      id: "s19",
      year: 1910,
      objectives: [{ id: "o_finale", text: "1910년 여름", kind: "prompt", target: "p_finale" }],
    },
  ],
  worldEvent: {
    title: "국채보상 의연금",
    desc: "만민공동회의 함성과 국채보상의 모금이 쌓인다. 서울 진공의 깃발 아래 모일 사람이 늘어난다.",
    goal: 120,
  },
  companions: 12,
};
