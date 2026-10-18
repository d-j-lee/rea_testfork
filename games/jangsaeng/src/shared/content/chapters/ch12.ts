// CH12 · 1659~1775 · 환국과 탕평 — 몽타주. 카드로 넘기는 백여 년: 예송, 세 번의 환국
// 줄서기(숙청 판정 E35, 탕평 지지 시 −10), 안용복과 백두산정계비(사실만), 이인좌의 난
// 짧은 전투 1회, 균역법, 임오화변(절제된 서사). 사실 기준: E068~E077.
import type { ChapterDef, OptionDef, PurgeSpec } from "../schema.ts";

/** One 환국 card: side with the winner, the loser, or stay neutral; 탕평 lowers E by 10. */
function hwanguk(id: string, winner: string, loser: string, winnerName: string, loserName: string): OptionDef[] {
  const spec = (tangpyeong: boolean, neutral?: boolean): PurgeSpec => ({
    id,
    intensity: tangpyeong ? 25 : 35,
    winner,
    loser,
    ...(neutral ? { neutral: true } : {}),
  });
  const variants = [false, true] as const;
  return variants.flatMap((tp) => {
    const requires = tp
      ? { k: "flag" as const, flag: "ch12_tangpyeong" }
      : { k: "not" as const, of: { k: "flag" as const, flag: "ch12_tangpyeong" } };
    const tag = tp ? " · 탕평으로 판정이 누그러진다" : "";
    return [
      {
        id: `${winner}${tp ? "_tp" : ""}`,
        text: `${winnerName} 쪽에 선다.`,
        hint: `${winnerName} 총애 ▲ · 숙청 판정${tag}`,
        requires,
        risk: spec(tp),
        effects: [
          { k: "favor", faction: winner, add: 15 },
          { k: "favor", faction: loser, add: -10 },
          { k: "align", faction: winner },
          { k: "purge", spec: spec(tp) },
        ],
      },
      {
        id: `${loser}${tp ? "_tp" : ""}`,
        text: `${loserName} 쪽을 지킨다.`,
        hint: `명예 ▲ · 숙청 위험 ▲${tag}`,
        requires,
        risk: spec(tp),
        effects: [
          { k: "favor", faction: loser, add: 15 },
          { k: "point", point: "honor", add: 8 },
          { k: "align", faction: loser },
          { k: "purge", spec: spec(tp) },
        ],
      },
      {
        id: `neutral${tp ? "_tp" : ""}`,
        text: "어느 줄에도 서지 않는다.",
        hint: `중립 · 얻는 것 없음${tag}`,
        requires,
        risk: spec(tp, true),
        effects: [
          { k: "align", faction: null },
          { k: "purge", spec: spec(tp, true) },
        ],
      },
    ];
  });
}

export const ch12: ChapterDef = {
  id: "ch12",
  order: 12,
  title: "환국과 탕평",
  subtitle: "백 년을 넘기는 카드",
  years: [1659, 1775],
  level: [34, 35],
  music: "years",
  season: "autumn",
  weather: "clear",
  hour: 15,
  start: { site: "hanyang", offset: [0, 1] },
  montage: true,
  briefing: [
    "전쟁이 멎은 백 년. 이번에는 붓과 상복이 칼이 된다.",
    "왕의 마음이 바뀔 때마다 조정이 통째로 뒤집혔다. 사람들은 그것을 환국이라 불렀다.",
    "당신은 줄을 서야 할 때와 줄 밖에 서야 할 때를 안다. 삼백 년을 살았으니까.",
  ],
  history: [
    { kind: "fact", text: "1659년과 1674년, 자의대비의 상복 기간을 두고 서인과 남인이 맞섰다(기해·갑인예송)." },
    { kind: "fact", text: "숙종 대에 경신환국(1680), 기사환국(1689), 갑술환국(1694)으로 집권 붕당이 거듭 뒤바뀌며 보복이 심해졌다." },
    { kind: "fact", text: "1693~1696년 안용복 사건을 계기로 울릉도 귀속 교섭이 벌어졌고, 막부는 1696년 일본인의 울릉도 도해를 금지했다." },
    { kind: "fact", text: "1712년 청과 조선은 백두산에 정계비를 세웠다. 1728년 이인좌의 난이 진압되었고, 영조는 탕평책을 펴고 1750년 균역법을 시행했다." },
    { kind: "fact", text: "1762년 영조는 세자를 뒤주에 가두었고 세자는 8일 만에 숨졌다(임오화변)." },
    { kind: "interp", text: "임오화변의 원인은 세자의 병을 강조하는 시각과 당쟁의 희생으로 보는 시각이 엇갈린다." },
  ],
  hist: { defense: 32, finance: 32, people: 35, diplomacy: 30, reform: 33 },
  factions: [
    { id: "seoin", name: "서인", power: 55, lineage: "seoin", desc: "송시열을 중심으로 한 무리. 뒤에 노론과 소론으로 갈라진다." },
    { id: "namin", name: "남인", power: 40, lineage: "namin", desc: "허목·윤휴 등의 무리. 환국 때마다 부침을 겪는다." },
    { id: "noron", name: "노론", power: 45, lineage: "seoin", desc: "서인의 다수파. 영조를 지지했다." },
    { id: "soron", name: "소론", power: 35, lineage: "seoin", desc: "서인의 소수파. 경종 대에 힘을 얻었다." },
    { id: "tangpyeong", name: "탕평파 (영조)", power: 40, desc: "붕당의 온건파를 고루 쓰려는 국왕의 무리." },
  ],
  ruling: "seoin",
  npcs: [
    {
      id: "montage_scribe",
      name: "실록청 서리 노씨",
      title: "세월의 증인",
      sprite: "scholar",
      site: "hanyang",
      offset: [2, 2],
      talk: ["이번 상복 논쟁이 끝나면 또 다음 논쟁이 오겠지요.", "어르신은 우리 할아버지 때도 이 거리에 계셨다던데요?"],
    },
    {
      id: "oh_myeonghang",
      name: "오명항",
      title: "도순무사",
      sprite: "general_joseon",
      site: "chungju",
      offset: [-2, 1],
      historical: true,
      talk: ["청주성이 떨어지고 병사가 죽었소.", "반란군은 북으로 오르고 있소. 길목에서 막아야 하오."],
      fromStep: "s8",
      untilStep: "s9",
    },
    {
      id: "park_munsu",
      name: "박문수",
      title: "종사관",
      sprite: "official_blue",
      site: "chungju",
      offset: [1, 2],
      historical: true,
      talk: ["백성을 반란의 무리와 한데 묶어서는 안 되오.", "벌은 우두머리에게, 쌀은 백성에게."],
      fromStep: "s8",
      untilStep: "s9",
    },
  ],
  spawns: [
    { id: "sp_hill_tiger", enemy: "tiger", site: "andong", offset: [3, -3], radius: 4, count: 1, level: 34, respawnSec: 180, fromStep: "s6", untilStep: "s10" },
    { id: "sp_road_bandit", enemy: "bandit", site: "gongju", offset: [2, 3], radius: 4, count: 3, level: 34, respawnSec: 90, fromStep: "s7", untilStep: "s9" },
  ],
  battles: [
    {
      id: "b_muxin",
      title: "무신란 — 청주 길목",
      subtitle: "1728 · 충청도",
      site: "chungju",
      offset: [-3, 3],
      radius: 7,
      kind: "boss",
      music: "war",
      weather: "rain",
      intro: [
        "음력 3월, 이인좌의 무리가 청주성을 차지하고 북쪽으로 올라온다.",
        "백성까지 베지 마라. 무기를 든 자만 막는다.",
      ],
      waves: [
        { from: "south", enemies: [{ enemy: "rebel_spear", count: 4, level: 34 }], line: "반란군 선두다!" },
        { from: "south", enemies: [{ enemy: "rebel_shield", count: 3, level: 34 }, { enemy: "rebel_spear", count: 2, level: 35 }], line: "방패를 세웠다. 옆으로 돌아라." },
      ],
      boss: {
        enemy: "boss_rebel_captain",
        name: "반란군 부장",
        historical: false,
        level: 35,
        hpScale: 1,
        phases: [
          { at: 1, mechanic: "shield_wall", line: "길을 열어라!" },
          { at: 0.4, mechanic: "charge", line: "한양까지 간다!" },
        ],
      },
      allies: [{ sprite: "soldier_joseon", name: "순무영 관군", count: 5 }],
      victory: [
        { k: "point", point: "merit", add: 60 },
        { k: "exp", add: 1800 },
        { k: "nation", key: "defense", add: 1 },
        { k: "favor", faction: "tangpyeong", add: 10 },
        { k: "toast", text: "반란군이 흩어졌다. 오명항의 관군이 안성과 죽산에서 본대를 깨뜨렸다.", tone: "good" },
      ],
      defeat: [{ k: "toast", text: "길목을 내주었다. 빗속에서 다시 진을 친다.", tone: "warn" }],
    },
  ],
  prompts: [
    {
      id: "p_yesong",
      title: "1659 · 상복 논쟁",
      style: "card",
      body: [
        "효종이 승하했다. 자의대비가 상복을 몇 해 입어야 하는가.",
        "서인은 1년, 남인은 3년. 효종을 둘째 아들로 볼 것인가, 왕통을 이은 이로 볼 것인가.",
      ],
      options: [
        { id: "seoin", text: "서인의 1년설에 붓을 보탠다.", hint: "서인 총애 ▲", effects: [{ k: "favor", faction: "seoin", add: 10 }] },
        { id: "namin", text: "남인의 3년설에 붓을 보탠다.", hint: "남인 총애 ▲", effects: [{ k: "favor", faction: "namin", add: 10 }] },
        {
          id: "witness",
          text: "고려 왕실의 상례를 '옛 기록에서 읽은 것처럼' 증언한다.",
          hint: "명망 ▲ · 의심도 ▲▲",
          effects: [
            { k: "point", point: "fame", add: 4 },
            { k: "suspicion", add: 12 },
            { k: "toast", text: "삼백 년 전 개경의 상례 행렬을 당신은 직접 보았다. 너무 자세했다.", tone: "warn" },
          ],
        },
      ],
    },
    {
      id: "p_gyeongsin",
      title: "1680 · 경신환국",
      style: "card",
      body: [
        "남인 영의정 허적이 궁중의 기름 천막을 허락 없이 가져다 썼다. 숙종이 노했다.",
        "곧이어 허적의 서자가 역모를 꾀했다는 고변이 나왔다. 남인이 쫓겨나고 서인이 돌아온다.",
      ],
      options: hwanguk("ch12_gyeongsin", "seoin", "namin", "서인", "남인"),
    },
    {
      id: "p_tangpyeong",
      title: "숙종 대 · 탕평의 말",
      style: "card",
      body: [
        "박세채 등이 말했다. 한쪽 붕당만 쓰지 말고, 양쪽의 바른 이를 고루 쓰자고 — 탕평.",
        "아직은 힘없는 말이다. 그러나 오래 산 당신은 안다. 이런 말이 백 년 뒤에 법이 된다.",
      ],
      options: [
        {
          id: "support",
          text: "탕평의 말을 지지하고 다닌다.",
          hint: "이후 환국의 숙청 판정이 누그러진다 · 탕평파 총애 ▲",
          effects: [
            { k: "flag", flag: "ch12_tangpyeong" },
            { k: "favor", faction: "tangpyeong", add: 15 },
            { k: "nation", key: "reform", add: 1 },
          ],
        },
        { id: "pass", text: "지금은 듣기만 한다.", effects: [] },
      ],
    },
    {
      id: "p_gisa",
      title: "1689 · 기사환국",
      style: "card",
      body: [
        "숙종이 희빈 장씨의 아들을 원자로 정하자 송시열 등 서인이 반대했다.",
        "서인이 쫓겨나고 남인이 돌아온다. 인현왕후가 폐위되고, 송시열은 정읍에서 사사되었다.",
      ],
      options: hwanguk("ch12_gisa", "namin", "seoin", "남인", "서인"),
    },
    {
      id: "p_gapsul",
      title: "1694 · 갑술환국",
      style: "card",
      body: [
        "폐비 복위 운동을 남인이 옥사로 몰아가려 하자, 숙종은 오히려 남인을 내쫓았다.",
        "인현왕후가 돌아오고 장씨는 희빈으로 내려갔다. 세 번째 환국이다.",
      ],
      options: hwanguk("ch12_gapsul", "seoin", "namin", "서인", "남인"),
    },
    {
      id: "p_anyongbok",
      title: "1693~1696 · 울릉도의 어부",
      style: "card",
      body: [
        "1693년 울릉도에서 고기를 잡던 동래 사람 안용복과 박어둔이 일본 어민들에게 일본으로 끌려갔다.",
        "이를 계기로 쓰시마번을 사이에 두고 울릉도를 둘러싼 교섭이 벌어졌다. 막부는 1696년 1월 일본인의 울릉도 도해를 금지했다.",
        "안용복은 그해 다시 일본에 건너가 항의한 뒤 돌아와 처벌받았다. 조선은 이 무렵부터 관리를 보내 섬을 살피는 수토를 했다.",
        "[불확실] 안용복이 일본에서 했다는 진술은 실록에 실린 본인 진술이며 일본 측 기록과 다른 부분이 있다.",
      ],
      options: [
        {
          id: "patrol",
          text: "수토 순찰선에 무관으로 자원한다.",
          hint: "외교 ▲ · 공적 ▲",
          effects: [
            { k: "nation", key: "diplomacy", add: 1 },
            { k: "point", point: "merit", add: 20 },
            { k: "chronicle", text: "수토선을 타고 동해의 섬을 살폈다. 바람이 거셌다." },
          ],
        },
        { id: "record", text: "사실을 적어 둔다.", effects: [{ k: "stat", stat: "wit", add: 1 }] },
      ],
    },
    {
      id: "p_jeonggye",
      title: "1712 · 백두산의 비석",
      style: "card",
      body: [
        "청의 목극등이 국경을 정하러 왔다. 조선 측 고위 관리는 산 위까지 동행하지 않았고, 군관과 역관이 따라 올랐다.",
        "분수령에 세운 비석에는 '서쪽은 압록, 동쪽은 토문'이라 새겼다.",
        "[불확실] 훗날 '토문'이 어느 강인지를 두고 해석이 갈리게 된다. 비석은 1931년 무렵 사라졌다.",
      ],
      options: [
        {
          id: "climb",
          text: "군관으로 따라 올라 물줄기와 지형을 꼼꼼히 기록한다.",
          hint: "장기 플래그: 외교 +1",
          effects: [
            { k: "longFlag", flag: "jeonggye_record", key: "diplomacy", add: 1 },
            { k: "flag", flag: "ch12_jeonggye_record" },
            { k: "point", point: "merit", add: 20 },
            { k: "chronicle", text: "1712년, 백두산 분수령의 물줄기를 기록했다." },
          ],
        },
        { id: "stay", text: "산 아래에 남는다.", effects: [] },
      ],
    },
    {
      id: "p_muxin_after",
      title: "1728 · 반란 뒤의 처분",
      speaker: { name: "박문수", sprite: "official_blue" },
      style: "card",
      body: [
        "이인좌는 붙잡혀 처형되었소. 이제 연루자를 어디까지 벌할지를 정해야 하오.",
        "고을 하나를 통째로 역적의 땅이라 부르면, 그 고을은 백 년을 운다오.",
      ],
      options: [
        {
          id: "mercy",
          text: "연좌를 넓히지 말자고 진언한다.",
          hint: "민심 ▲ · 공덕 ▲",
          effects: [
            { k: "nation", key: "people", add: 5 },
            { k: "point", point: "virtue", add: 40 },
            { k: "favor", faction: "tangpyeong", add: 5 },
          ],
        },
        {
          id: "strict",
          text: "엄히 다스려 다시는 군사를 일으키지 못하게 한다.",
          hint: "영조 신임 ▲ · 민심 ▼",
          effects: [
            { k: "favor", faction: "tangpyeong", add: 10 },
            { k: "nation", key: "people", add: -2 },
          ],
        },
      ],
    },
    {
      id: "p_gyunyeok",
      title: "1750 · 균역법",
      style: "card",
      body: [
        "양인 남자가 해마다 내던 군포 2필을 1필로 줄인다. 영조의 균역법이다.",
        "모자란 재정은 어장세·염세·선박세와 결작으로 메운다. 군포를 걷는 아전들의 장부가 문제다.",
      ],
      options: [
        {
          id: "audit",
          text: "군포 장부를 감찰해 죽은 이와 아이에게 걷는 일을 적발한다.",
          hint: "민심 ▲ · 재정 ▼",
          effects: [
            { k: "nation", key: "people", add: 5 },
            { k: "nation", key: "finance", add: -2 },
            { k: "point", point: "virtue", add: 30 },
          ],
        },
        {
          id: "treasury",
          text: "모자란 재원을 메울 방도부터 찾는다.",
          hint: "재정 ▲",
          effects: [{ k: "nation", key: "finance", add: 2 }],
        },
      ],
    },
    {
      id: "p_imo",
      title: "1762 · 여름의 궁궐",
      style: "history",
      body: [
        "윤5월, 영조는 세자를 폐하고 뒤주에 가두었다. 세자는 여드레 만에 숨졌다.",
        "영조는 뒤에 '사도(思悼)'라는 이름을 내렸다. 열한 살 세손이 그 여름을 지켜보았다.",
        "당신은 궁궐 숙위로 그 문밖에 서 있었다. 할 수 있는 일은 없었다.",
      ],
      options: [
        {
          id: "vow",
          text: "세손을 지키겠다고 마음속으로 맹세한다.",
          effects: [
            { k: "flag", flag: "ch12_vow_seson" },
            { k: "chronicle", text: "1762년 여름, 세손을 지키겠다고 맹세했다." },
          ],
        },
      ],
    },
    {
      id: "p_1775",
      title: "1775 · 세손의 대리청정",
      style: "card",
      body: [
        "늙은 영조가 세손에게 정사를 맡겼다. 세손을 견제하는 이들이 궁궐 안팎에 많다.",
        "백 년이 카드 몇 장처럼 넘어갔다. 그 사이 친구 셋을 묻었고, 거울 속 얼굴은 그대로였다.",
      ],
      options: [{ id: "go", text: "세손 곁으로 간다.", effects: [{ k: "exp", add: 800 }] }],
    },
  ],
  steps: [
    { id: "s1", year: 1659, objectives: [{ id: "o_yesong", text: "예송", kind: "prompt", target: "p_yesong" }] },
    { id: "s2", year: 1680, objectives: [{ id: "o_gyeongsin", text: "경신환국", kind: "prompt", target: "p_gyeongsin" }] },
    { id: "s3", year: 1683, objectives: [{ id: "o_tangpyeong", text: "탕평의 말", kind: "prompt", target: "p_tangpyeong" }] },
    { id: "s4", year: 1689, objectives: [{ id: "o_gisa", text: "기사환국", kind: "prompt", target: "p_gisa" }] },
    { id: "s5", year: 1694, objectives: [{ id: "o_gapsul", text: "갑술환국", kind: "prompt", target: "p_gapsul" }] },
    { id: "s6", year: 1696, objectives: [{ id: "o_anyongbok", text: "울릉도의 어부", kind: "prompt", target: "p_anyongbok" }] },
    { id: "s7", year: 1712, objectives: [{ id: "o_jeonggye", text: "백두산정계비", kind: "prompt", target: "p_jeonggye" }] },
    {
      id: "s8",
      year: 1728,
      narration: [
        "1721~1722년 신임옥사로 노론 대신들이 화를 입었다. 1724년 영조가 즉위했다.",
        "1728년 봄, 영조가 경종의 죽음에 관련되었다며 이인좌의 무리가 군사를 일으켰다.",
      ],
      objectives: [
        { id: "o_ohmh", text: "충청도로 내려가 도순무사 오명항을 만난다", kind: "talk", target: "oh_myeonghang", site: "chungju", offset: [-2, 1] },
      ],
    },
    {
      id: "s8b",
      year: 1728,
      objectives: [
        { id: "o_muxin", text: "청주 길목에서 반란군을 막는다", kind: "battle", target: "b_muxin" },
      ],
    },
    {
      id: "s9",
      year: 1728,
      objectives: [
        { id: "o_muxin_after", text: "박문수와 처분을 의논한다", kind: "talk", target: "park_munsu", site: "chungju", offset: [1, 2], prompt: "p_muxin_after" },
      ],
    },
    { id: "s10", year: 1750, objectives: [{ id: "o_gyunyeok", text: "균역법", kind: "prompt", target: "p_gyunyeok" }] },
    { id: "s11", year: 1762, objectives: [{ id: "o_imo", solemn: true, text: "임오년 여름", kind: "prompt", target: "p_imo" }] },
    { id: "s12", year: 1775, objectives: [{ id: "o_1775", text: "세손의 곁으로", kind: "prompt", target: "p_1775" }] },
  ],
  worldEvent: {
    title: "균역과 구휼",
    desc: "흉년의 고을에 곡식을 나르고 군포 장부의 부정을 바로잡는다.",
    goal: 80,
  },
  companions: 6,
};
