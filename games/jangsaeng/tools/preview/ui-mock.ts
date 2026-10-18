// Mock protocol data for UI previews (tools/preview/ui.ts). Values are
// illustrative only; they exercise every HUD/menu/prompt element.
import type { AudioEngine } from "../../src/client/audio/types.ts";
import type { ChapterView, EndingView, PromptView, SelfView } from "../../src/shared/types.ts";

export function mockAudio(): AudioEngine {
  let muted = false;
  return {
    unlock: async () => undefined,
    unlocked: false,
    setMusic: () => undefined,
    sfx: () => undefined,
    setVolumes: () => undefined,
    setMuted: (m: boolean) => {
      muted = m;
    },
    get muted() {
      return muted;
    },
    suspend: () => undefined,
    resume: () => undefined,
  };
}

export const CHAPTER: ChapterView = {
  id: "ch03",
  order: 3,
  title: "위화도에서 개국까지",
  subtitle: "장맛비 속의 회군, 그리고 새 왕조",
  years: [1388, 1392],
  briefing: [
    "1388년 여름, 요동 정벌군이 압록강 하류의 위화도에 머문다.",
    "그치지 않는 장맛비에 강물이 불어나고, 군영에는 회군을 청하는 목소리가 커진다.",
    "어느 편에 서느냐가 새 시대의 자리를 정할 것이다.",
  ],
  history: [
    "1388년 음력 5월, 이성계와 조민수가 위화도에서 군을 돌려 개경으로 향했다.",
    "[해석] 회군은 요동 정벌의 현실성을 둘러싼 판단과 권력 투쟁이 겹친 사건으로 본다.",
  ],
  music: "founding",
  season: "summer",
  weather: "rain",
  hour: 15,
  montage: false,
};

export function mockSelf(over: Partial<SelfView> = {}): SelfView {
  return {
    id: 1,
    name: "윤무진",
    birthName: "강무진",
    identityKind: "descendant",
    identities: [
      { name: "강무진", kind: "birth", from: 1361, to: 1387 },
      { name: "윤무진", kind: "descendant", from: 1387 },
    ],
    variant: "m",
    origin: "northeast",
    sprite: "hero_goryeo_officer",
    level: 12,
    exp: 3420,
    expNext: 5000,
    hp: 236,
    maxHp: 320,
    energy: 42,
    maxEnergy: 100,
    stamina: 74,
    stats: { power: 18, agility: 12, body: 16, spirit: 9, wit: 22, tact: 11 },
    freePoints: 3,
    points: { money: 1240, merit: 186, virtue: 140, fame: 9, honor: 35 },
    year: 1388,
    age: 43,
    apparentAge: 18,
    lifeEnd: 1861,
    lifeShortfall: 49,
    longevityUses: 1,
    suspicion: 38,
    suspicionBand: "rumour",
    rank: 9,
    rankName: "정5품",
    office: "낭장",
    titles: ["황산의 선봉", "동북면 무사"],
    meritSubject: 1,
    factions: [
      { id: "yi", name: "이성계파", power: 62, favor: 48, ruling: false, aligned: true, desc: "동북면 군벌과 신진 사대부." },
      { id: "choe", name: "최영파", power: 55, favor: -12, ruling: true, aligned: false, desc: "왕명을 받든 요동 정벌 주도 세력." },
      { id: "gwonmun", name: "권문세족", power: 30, favor: -25, ruling: false, aligned: false },
    ],
    nation: { defense: 46, finance: 31, people: 38, diplomacy: 42, reform: 27, infiltration: 18 },
    showInfiltration: true,
    branches: { B1: true, B2: false, B3: true },
    chapter: { id: "ch03", title: "위화도에서 개국까지", order: 3, stepYear: 1388 },
    objectives: [
      { id: "o1", text: "회군 회의에 참석한다", done: true, optional: false },
      { id: "o2", text: "강가의 왜구 척후를 물리친다", done: false, optional: false, progress: [3, 5], x: 14, y: 96, siteName: "위화도" },
      { id: "o3", text: "이지란과 이야기한다", done: false, optional: false, x: 12, y: 99 },
      { id: "o4", text: "피란민을 강 건너로 보낸다", done: false, optional: true, progress: [1, 4] },
    ],
    skills: [
      { id: "dash_slash", name: "돌진베기", desc: "3칸을 내달리며 벤다.", energy: 20, cooldown: 6, ready: 0, slot: 1, kind: "dash" },
      { id: "whirlwind", name: "회선참", desc: "주위를 두 바퀴 벤다.", energy: 30, cooldown: 10, ready: 6.2, slot: 2, kind: "spin" },
      { id: "war_cry", name: "함성", desc: "아군 공격력 +15%.", energy: 30, cooldown: 30, ready: 0, slot: 3, kind: "shout" },
      { id: "juhwa", name: "주화", desc: "불화살 세 발.", energy: 55, cooldown: 14, ready: 0, slot: 4, kind: "rockets" },
      { id: "longevity", name: "노인성 일섬", desc: "천수 1년을 태워 화면 안의 모든 적을 벤다.", energy: 0, cooldown: 20, ready: 0, slot: null, kind: "longevity" },
    ],
    inventory: [
      { id: "wolgdo", name: "월도", kind: "weapon", desc: "언월도. 휘두르는 힘이 크다.", count: 1, equipped: true },
      { id: "hwando", name: "환도", kind: "weapon", desc: "고려 군관의 허리칼.", count: 1, equipped: false },
      { id: "chalgap", name: "찰갑", kind: "armor", desc: "작은 쇳조각을 엮은 고려 갑옷.", count: 1, equipped: true },
      { id: "rice_ball", name: "주먹밥", kind: "consumable", desc: "체력 30 회복.", count: 4, equipped: false },
      { id: "herb_tonic", name: "탕약", kind: "consumable", desc: "체력 80 회복.", count: 2, equipped: false },
      { id: "ginseng", name: "산삼", kind: "consumable", desc: "천수 +2년.", count: 1, equipped: false },
      { id: "mapae", name: "마패", kind: "key", desc: "역참에서 말을 빌려 빠르게 이동할 수 있다.", count: 1, equipped: false },
    ],
    equipment: { weapon: "wolgdo", armor: "chalgap" },
    chronicle: [
      { year: 1361, text: "홍건적이 개경을 함락한 밤, 노인성의 빛을 받고 깨어났다.", tone: "epic" },
      { year: 1362, text: "개경 수복전에서 피란민을 먼저 구했다.", tone: "good" },
      { year: 1380, text: "황산대첩에서 선봉에 섰다. 천수 +2년.", tone: "epic" },
      { year: 1387, text: "얼굴이 늙지 않는다는 소문이 돌아 ‘조카 윤무진’으로 이름을 바꿨다.", tone: "bad" },
      { year: 1388, text: "위화도에 닿았다. 비가 그치지 않는다." },
    ],
    bonds: [
      { id: "jiran", name: "이지란", value: 62 },
      { id: "kanghwi", name: "강휘", value: 35 },
    ],
    battle: {
      id: "b1",
      title: "위화도 강변 방어",
      subtitle: "1388 · 위화도",
      kind: "boss",
      x: 14,
      y: 96,
      radius: 9,
      wave: [3, 5],
      boss: { name: "흑룡", title: "왜구 두목", hp: 64 },
      defend: { name: "군량 수레", hp: 72 },
      morale: 58,
      participants: 6,
    },
    worldEvent: { title: "새 왕조의 기틀", desc: "과전법 양전 측량을 호위한다.", progress: 46 },
    channel: { id: "ch03-2", name: "제3장 위화도 · 2마당", players: 3, companions: 7 },
    demo: true,
    ...over,
  };
}

export const STORY_PROMPT: PromptView = {
  id: "p-hoegun",
  kind: "story",
  title: "회군 회의",
  speaker: { name: "이성계", sprite: "general_goryeo", historical: true },
  year: 1388,
  body: [
    "장맛비가 그치지 않는다. 강물은 이미 섬을 반쯤 삼켰고, 군량은 젖어 썩어 간다.",
    "“이대로 강을 건너면 군사의 절반을 물에 바치게 될 것이오. 그대는 어찌 생각하오?”",
  ],
  options: [
    { id: "support", text: "회군에 찬성한다", hint: "이성계파 총애 ▲ · 개국공신 경로", risk: { value: 32, exact: false } },
    { id: "oppose", text: "왕명을 받들어 진군을 주장한다", hint: "최영파 총애 ▲ · 이성계파 총애 ▼▼", risk: { value: 71, exact: false } },
    { id: "silent", text: "침묵한다", hint: "누구의 눈 밖에도 나지 않는다", disabled: "처세 15 이상 필요" },
  ],
};

export const CARD_PROMPT: PromptView = {
  id: "p-card",
  kind: "card",
  title: "기묘사화",
  year: 1519,
  body: ["조광조와 사림이 하루아침에 조정에서 쫓겨났다.", "그대가 몰래 세운 학당에도 감시의 눈이 닿는다."],
  options: [
    { id: "hide", text: "학당을 닫고 몸을 숨긴다", hint: "의심도 ▼ · 개혁 ▼" },
    { id: "keep", text: "제자들을 지킨다", hint: "명예 ▲ · 숙청 위험", risk: { value: 45, exact: true } },
  ],
};

export const RESULT_PROMPT: PromptView = {
  id: "p-result",
  kind: "result",
  title: "세월의 결과 · 1418 → 1448",
  body: ["서른 해가 흘렀다. 사람들은 그대를 ‘윤 진사의 손자’로 기억한다."],
  data: {
    type: "result",
    lines: [
      { text: "학문에 힘써 지략 +3", tone: "good" },
      { text: "공덕 +60 · 명망 +2", tone: "good" },
      { text: "의심도 −20 (신분 세탁: 후손 행세)", tone: "good" },
      { text: "노인성 봉헌: 천수 +3년", tone: "epic" },
      { text: "전 −300", tone: "bad" },
    ],
  },
  options: [{ id: "ok", text: "계속" }],
};

export const DEATH_PROMPT: PromptView = {
  id: "p-death",
  kind: "death",
  title: "천수가 다하다",
  body: ["1861년 가을, 노인성의 빛이 마침내 사그라든다.", "그대가 남긴 제자가 남은 세월을 잇는다."],
  options: [{ id: "ok", text: "유지를 잇는다" }],
};

export const YEARS_PROMPT: PromptView = {
  id: "p-years",
  kind: "years",
  title: "세월 흐르기",
  body: ["태종의 치세가 저물고 세종이 즉위한다. 새 이름: 윤현"],
  options: [],
  data: {
    type: "years",
    fromYear: 1418,
    toYear: 1419,
    eraFrom: 1393,
    eraTo: 1419,
    tokens: 2,
    spans: [{ from: 1393, to: 1406 }, { from: 1406, to: 1419 }],
    summary: "1393~1419년, 이 시대를 어떻게 보냈나 · 2마디",
    activities: [
      { id: "study", name: "학문", desc: "성균관 근처에서 글을 읽는다.", effect: "지략 +1 · 명망 +1" },
      { id: "train", name: "수련", desc: "산사에서 무예를 닦는다.", effect: "완력 +1 · 근골 +1" },
      { id: "trade", name: "치부", desc: "송상과 함께 장사를 한다.", effect: "전 +400" },
      { id: "relief", name: "구휼", desc: "흉년의 마을에 곡식을 나눈다.", effect: "공덕 +40 · 민심 +1" },
      { id: "court", name: "출사", desc: "조정에 나아가 일한다.", effect: "공적 +30 · 의심도 +10" },
      { id: "hide", name: "은거", desc: "산골에 숨어 지낸다.", effect: "의심도 −15", disabled: "이번 장에서는 이미 은거했다" },
    ],
    washes: [
      { id: "descendant", name: "후손 행세", desc: "자신의 조카·손자로 행세한다. 전 300 · 의심도 −30" },
      { id: "fakeDeath", name: "죽음 위장", desc: "장례를 치르고 다른 고을에서 산다. 의심도 −50 · 인연 일부 끊김" },
      { id: "monk", name: "출가", desc: "법명을 받고 산사로 든다. 의심도 −40 · 관직 잃음" },
      { id: "exam", name: "과거 급제", desc: "새 이름으로 무과에 급제한다.", disabled: "지략 25 이상 필요" },
    ],
    washAdvised: true,
    lifeEnd: 1861,
    virtue: 140,
    canOffer: 3,
    suggested: { activities: ["study", "study"], offer: true },
  },
};

export const ENDING: EndingView = {
  nation: {
    id: "N2",
    title: "위태로운 존속",
    body: [
      "1910년 8월, 병합 조약은 끝내 조인되지 않았다. 그러나 외교권의 일부는 여전히 남의 손에 있다.",
      "대한제국은 보호국 체제 아래 위태롭게 이어진다. 주권을 되찾기 위한 세월이 다시 시작된다.",
    ],
  },
  personal: {
    id: "P2",
    title: "이름 없는 수호자",
    body: ["네 번 이름을 바꾸며 살아온 장생인은 어떤 실록에도 이름을 남기지 않았다.", "그러나 그가 지킨 마을과 사람들은 그를 기억한다."],
  },
  score: 52.4,
  breakdown: [
    { label: "국방 47 × 0.25", value: 11.8 },
    { label: "외교 52 × 0.20", value: 10.4 },
    { label: "재정 38 × 0.15", value: 5.7 },
    { label: "민심 61 × 0.20", value: 12.2 },
    { label: "개혁 49 × 0.20", value: 9.8 },
    { label: "분기 성공 6 × 3", value: 18 },
    { label: "침투도 52 × −0.3", value: -15.6 },
  ],
  nationValues: { defense: 47, finance: 38, people: 61, diplomacy: 52, reform: 49, infiltration: 52 },
  branches: [
    { id: "B1", label: "장용영 유지 (1800)", ok: true },
    { id: "B2", label: "삼정 개혁 유지 (1862)", ok: false },
    { id: "B3", label: "주체적 개항 교섭 (1866~75)", ok: true },
    { id: "B4", label: "강화도조약 조항 (1876)", ok: true },
    { id: "B5", label: "군란 예방 (1882)", ok: false },
    { id: "B6", label: "온건 개혁 연합 (1884)", ok: true },
    { id: "B7", label: "중립화 외교 (1885~87)", ok: true },
    { id: "B8", label: "차병 반대·폐정 개혁 (1894)", ok: false },
    { id: "B9", label: "만민공동회·의회 (1898)", ok: true },
    { id: "B10", label: "재정 일원화·상비군 (1899~1904)", ok: false },
    { id: "B11", label: "중립 실효 (1904)", ok: false },
    { id: "B12a", label: "열강 사전 외교 (1905)", ok: false },
    { id: "B12b", label: "중명전 수호 (1905)", ok: false },
    { id: "B12c", label: "군대 해산 저지 (1907)", ok: false },
  ],
  identities: [
    { name: "강무진", kind: "birth", from: 1361, to: 1387 },
    { name: "윤무진", kind: "descendant", from: 1387, to: 1453 },
    { name: "혜각", kind: "monk", from: 1453, to: 1592 },
    { name: "윤현", kind: "descendant", from: 1592, to: 1790 },
    { name: "백도윤", kind: "exam", from: 1790 },
  ],
  lifeline: { lifeEnd: 1913, gained: 61, spent: 9 },
  chronicle: mockSelf().chronicle,
  record: { kills: 1843, bossKills: 11, selfRevives: 3, revivesGiven: 27, washes: 4, purgesSurvived: 9, turncoat: 0, lifeGained: 61, lifeSpent: 9 },
  historyNote: [
    "실제 역사에서 1910년 8월 29일 한일병합조약이 공포되었다.",
    "[해석] 게임 속 분기점들은 당시 개혁 논의에서 실제로 제기된 대안들을 바탕으로 했다.",
  ],
};
