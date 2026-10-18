// CH07 · 1469~1574 · 사화의 세기 — 몽타주. 세월 카드와 두 번의 짧은 전투.
// 사건: E114 경국대전, E032 무오사화, E033 갑자사화, E034 중종반정, E035 삼포왜란,
// E036 기묘사화, E037 을사사화, E038 을묘왜변.
import { SCHOOL_FLAG, type ChapterDef } from "../schema.ts";

const muo = { id: "ch07_muo", intensity: 40, winner: "hungu", loser: "sarim" } as const;
const gapja = { id: "ch07_gapja", intensity: 55, winner: null, loser: null } as const;
const gimyo = { id: "ch07_gimyo", intensity: 45, winner: "hungu", loser: "sarim" } as const;
const eulsa = { id: "ch07_eulsa", intensity: 45, winner: "soyun", loser: "daeyun" } as const;

export const ch07: ChapterDef = {
  id: "ch07",
  order: 7,
  title: "사화의 세기",
  subtitle: "선비가 화를 입은 네 번의 겨울",
  years: [1469, 1574],
  level: [21, 23],
  music: "years",
  season: "spring",
  weather: "clear",
  hour: 14,
  start: { site: "hanyang", offset: [1, 1] },
  montage: true,
  briefing: [
    "백 년. 장생인에게는 긴 숨 한 번, 사람들에게는 네 대의 삶이다.",
    "『경국대전』이 나라의 뼈대를 세웠고, 그 뼈대 위에서 선비들이 피를 흘렸다.",
    "사화 — 선비가 화를 입은 네 번의 겨울. 그리고 남쪽 바다의 불길.",
    "【몽타주】 세월이 카드처럼 넘어간다. 짧게 고르고, 오래 견뎌라.",
  ],
  history: [
    { kind: "fact", text: "1485년 1월 1일 『경국대전』이 시행되어 이·호·예·병·형·공 6전 체제로 국가 운영의 기본 규칙이 정해졌다." },
    { kind: "fact", text: "1498년 무오사화: 김일손이 사초에 실은 스승 김종직의 「조의제문」이 문제가 되어 김일손 등이 처형되고, 많은 사림이 화를 입었다. 1504년 갑자사화: 연산군이 생모 폐비 윤씨의 죽음에 얽힌 이들을 대거 처벌했다." },
    { kind: "fact", text: "1506년 중종반정으로 연산군이 폐위되었다. 1510년 삼포왜란: 조선이 삼포에 사는 일본인(항거왜인)에 대한 통제를 강화하자, 항거왜인과 쓰시마 세력 4~5천 명(기록상)이 부산포와 제포를 습격했다. 1512년 임신약조로 교역이 크게 줄었다." },
    { kind: "fact", text: "1519년 기묘사화: 현량과 실시·소격서 폐지·위훈 삭제 등 급진 개혁을 이끈 조광조가 훈구파의 반격으로 유배되었다가 사사되었다." },
    { kind: "uncertain", text: "'주초위왕' 나뭇잎 이야기는 야사 전승이다." },
    { kind: "fact", text: "1545년 을사사화: 명종 즉위 뒤 문정왕후의 동생 윤원형(소윤)이 인종의 외숙 윤임(대윤) 세력을 역모로 몰아 제거했다." },
    { kind: "fact", text: "1555년 을묘왜변: 왜선 70여 척이 전라도 달량성을 함락했고, 영암성에서 이윤경 등이 물리쳤다. 이를 계기로 비변사가 상설 기구가 되었다." },
  ],
  hist: { defense: 54, finance: 54, people: 50, diplomacy: 52, reform: 50 },
  factions: [
    { id: "hungu", name: "훈구", power: 70, lineage: "suyang", desc: "정난과 반정의 공신 가문들. 땅과 벼슬을 대물림한다." },
    { id: "sarim", name: "사림", power: 30, lineage: "boksa", desc: "지방에서 성리학을 닦은 선비들. 절의를 앞세운다." },
    { id: "soyun", name: "소윤(윤원형)", power: 40, desc: "문정왕후의 동생 윤원형을 따르는 외척." },
    { id: "daeyun", name: "대윤(윤임)", power: 40, desc: "인종의 외숙 윤임을 따르는 외척." },
  ],
  ruling: "hungu",
  npcs: [
    {
      id: "yi_yungyeong",
      name: "이윤경",
      title: "전주부윤",
      sprite: "general_joseon",
      site: "gwangju",
      offset: [0, 8],
      dir: "down",
      historical: true,
      fights: true,
      talk: ["달이 지면 성문을 연다. 저들은 우리가 나오리라 생각지 못할 것이다."],
      fromStep: "s7",
      untilStep: "s7",
    },
  ],
  spawns: [
    { id: "ch07_sp_jepo", enemy: "wokou_raider", site: "dongnae", offset: [-6, -10], radius: 3, count: 2, level: 21, respawnSec: 40, fromStep: "s4", untilStep: "s4" },
    { id: "ch07_sp_dalyang", enemy: "wokou_archer", site: "gwangju", offset: [-4, 12], radius: 3, count: 2, level: 22, respawnSec: 40, fromStep: "s7", untilStep: "s7" },
  ],
  battles: [
    {
      id: "ch07_jepo",
      title: "삼포왜란 — 제포",
      subtitle: "1510 · 제포",
      site: "dongnae",
      offset: [-8, -7],
      radius: 5,
      kind: "waves",
      music: "war",
      intro: ["1510년 4월, 제포. 항거왜인과 쓰시마 군사가 성을 에워쌌다.", "무기를 든 자만 상대하라. 왜관 골목의 상인과 아이들은 해치지 마라."],
      waves: [
        {
          enemies: [
            { enemy: "wokou_raider", count: 5, level: 21 },
            { enemy: "wokou_archer", count: 2, level: 21 },
          ],
          from: "sea",
          line: "성벽 아래로 무리가 몰려온다!",
        },
        { enemies: [{ enemy: "wokou_raider", count: 6, level: 22 }], from: "south", line: "마지막 무리다 — 성문을 지켜라!" },
      ],
      allies: [{ sprite: "soldier_joseon", name: "제포진 수군", count: 4 }],
      victory: [
        { k: "point", point: "merit", add: 40 },
        { k: "nation", key: "defense", add: 1 },
        { k: "exp", add: 2000 },
        { k: "worldEvent", add: 40 },
        { k: "chronicle", text: "1510년 4월, 제포. 무기를 든 이들만 막아 냈다. 왜관 골목의 아이들은 무사했다." },
        { k: "toast", text: "제포를 지켰다", tone: "good" },
      ],
      defeat: [{ k: "toast", text: "성문이 밀렸다. 다시 막는다.", tone: "warn" }],
    },
    {
      id: "ch07_yeongam",
      title: "을묘왜변 — 영암성 새벽 역습",
      subtitle: "1555 · 영암",
      site: "gwangju",
      offset: [2, 10],
      radius: 6,
      kind: "waves",
      music: "war",
      weather: "fog",
      intro: ["1555년 5월, 영암성. 달량성을 함락한 왜구가 성을 에워쌌다.", "달이 진 새벽, 성문을 열고 역습한다!"],
      waves: [
        { enemies: [{ enemy: "wokou_raider", count: 6, level: 22 }], from: "south", line: "잠에서 깬 왜구가 허둥지둥 몰려든다!" },
        {
          enemies: [
            { enemy: "wokou_archer", count: 4, level: 23 },
            { enemy: "wokou_raider", count: 3, level: 23 },
          ],
          from: "west",
          line: "궁수가 방책 뒤에 숨었다 — 신기전을 퍼부어라!",
        },
      ],
      allies: [{ sprite: "soldier_joseon", name: "영암성 수비군", count: 5 }],
      victory: [
        { k: "point", point: "merit", add: 40 },
        { k: "nation", key: "defense", add: 1 },
        { k: "exp", add: 2200 },
        { k: "worldEvent", add: 50 },
        { k: "chronicle", text: "1555년 5월, 영암. 새벽 역습으로 성을 지켰다." },
        { k: "toast", text: "영암성 역습 성공", tone: "good" },
      ],
      defeat: [{ k: "toast", text: "역습이 막혔다. 성으로 물러나 다시 나선다.", tone: "warn" }],
    },
  ],
  prompts: [
    {
      id: "ch07_daejeon",
      title: "1485 · 경국대전",
      style: "card",
      body: [
        "1485년 정월, 『경국대전』이 시행되었다. 호적과 호패의 규칙도 법전에 굳었다.",
        "편찬관 하나가 당신을 찾아왔다. '고려 말 군제를 직접 본 사람처럼 말씀하신다 들었소.'",
      ],
      options: [
        {
          id: "testify",
          text: "본 대로 증언한다",
          hint: "개혁 ▲ · 지략 +1 · 의심도 ▲",
          effects: [
            { k: "nation", key: "reform", add: 1 },
            { k: "stat", stat: "wit", add: 1 },
            { k: "suspicion", add: 8 },
            { k: "flag", flag: "daejeon_testimony", value: true },
          ],
        },
        { id: "deny", text: "할아버지께 들은 이야기일 뿐이오.", hint: "변화 없음", effects: [] },
      ],
    },
    {
      id: "ch07_muo",
      title: "1498 · 무오사화",
      style: "card",
      body: [
        "『성종실록』을 엮던 실록청에서 김일손의 사초가 문제가 되었다. 스승 김종직의 「조의제문」이 세조의 즉위를 빗댄 글이라 했다.",
        "실록청 경비 무관인 당신에게 젊은 사관이 사초 몇 장을 내밀었다. '이것만은 지켜 주십시오.'",
      ],
      options: [
        {
          id: "hide",
          text: "사초를 품에 숨긴다",
          hint: "사림 총애 ▲▲ · 명예 ▲ · 숙청 위험 ▲",
          risk: muo,
          effects: [
            { k: "favor", faction: "sarim", add: 20 },
            { k: "point", point: "honor", add: 10 },
            { k: "flag", flag: "muo_saved", value: true },
            { k: "align", faction: "sarim" },
            { k: "purge", spec: muo },
          ],
        },
        {
          id: "report",
          text: "유자광·이극돈에게 알린다",
          hint: "훈구 총애 ▲ · 명예 ▼▼",
          risk: muo,
          effects: [
            { k: "favor", faction: "hungu", add: 15 },
            { k: "point", point: "honor", add: -20 },
            { k: "align", faction: "hungu" },
            { k: "purge", spec: muo },
          ],
        },
        {
          id: "blind",
          text: "보지 못한 것으로 한다",
          hint: "중립 · 숙청 판정은 피할 수 없다",
          risk: { ...muo, neutral: true },
          effects: [{ k: "purge", spec: { ...muo, neutral: true } }],
        },
      ],
    },
    {
      id: "ch07_gapja",
      title: "1504 · 갑자사화",
      style: "card",
      body: [
        "생모의 죽음을 알게 된 임금이 피바람을 일으켰다. 이미 세상을 떠난 이들의 무덤까지 화를 입었다.",
        "도성 밖에는 사냥터를 넓힌다며 금표가 세워졌고, 마을이 통째로 쫓겨났다. 임금의 측근이 당신을 불렀다. '전하께서 날랜 무사를 찾으신다.'",
      ],
      options: [
        {
          id: "shelter",
          text: "쫓겨난 마을 사람들을 몰래 숨긴다",
          hint: "공덕 +40 · 민심 ▲ · 숙청 위험 ▲",
          risk: gapja,
          effects: [
            { k: "point", point: "virtue", add: 40 },
            { k: "nation", key: "people", add: 1 },
            { k: "purge", spec: gapja },
          ],
        },
        {
          id: "guard",
          text: "임금의 친위 무사가 된다",
          hint: "전 +200 · 품계 +2 · 민심 ▼ · 명예 ▼",
          risk: gapja,
          effects: [
            { k: "point", point: "money", add: 200 },
            { k: "rank", add: 2 },
            { k: "nation", key: "people", add: -2 },
            { k: "point", point: "honor", add: -10 },
            { k: "flag", flag: "yeonsan_guard", value: true },
            { k: "purge", spec: gapja },
          ],
        },
        {
          id: "leave",
          text: "변방 근무를 자청해 도성을 떠난다",
          hint: "의심도 −10 · 숙청 판정은 피할 수 없다",
          risk: { ...gapja, neutral: true },
          effects: [
            { k: "suspicion", add: -10 },
            { k: "purge", spec: { ...gapja, neutral: true } },
          ],
        },
      ],
    },
    {
      id: "ch07_banjeong",
      title: "1506 · 중종반정",
      style: "card",
      body: [
        "9월 2일 밤, 박원종·성희안·유순정이 군사를 일으켰다.",
        "궁문 앞에 선 당신에게 반정군 장수가 외쳤다. '문을 열면 피를 덜 흘린다!'",
      ],
      options: [
        {
          id: "open_merit",
          text: "궁문을 열고, 정국공신 녹권을 받는다",
          hint: "공적 +30 · 훈구 총애 ▲ · 훗날 위훈 논란",
          effects: [
            { k: "point", point: "merit", add: 30 },
            { k: "favor", faction: "hungu", add: 10 },
            { k: "flag", flag: "jeongguk", value: true },
          ],
        },
        {
          id: "open_humble",
          text: "궁문을 열되, 공신 녹권은 사양한다",
          hint: "명예 ▲ · 사림 총애 ▲",
          effects: [
            { k: "point", point: "honor", add: 10 },
            { k: "favor", faction: "sarim", add: 5 },
          ],
        },
        {
          id: "escort",
          text: "폐위된 옛 주군을 교동까지 호송한다",
          hint: "의심도 ▲ · 훈구 총애 ▼",
          requires: { k: "flag", flag: "yeonsan_guard", eq: true },
          effects: [
            { k: "suspicion", add: 10 },
            { k: "favor", faction: "hungu", add: -10 },
            { k: "point", point: "honor", add: 5 },
          ],
        },
      ],
    },
    {
      id: "ch07_gimyo",
      title: "1519 · 기묘사화",
      style: "card",
      body: [
        "조광조가 정국공신 117명 가운데 76명의 공을 지우자고 했다(위훈 삭제). 훈구 공신들이 밤에 궁으로 들어갔다.",
        "개혁은 옳았다. 다만 너무 빨랐다 — 백칠십 년 넘게 산 당신은 그렇게 생각했다.",
      ],
      options: [
        {
          id: "reform",
          text: "조광조의 개혁을 끝까지 돕는다",
          hint: "개혁 +4 · 사림 총애 ▲ · 숙청 위험 ▲",
          risk: gimyo,
          effects: [
            { k: "nation", key: "reform", add: 4 },
            { k: "favor", faction: "sarim", add: 15 },
            { k: "flag", flag: "gimyo", value: "reform" },
            { k: "align", faction: "sarim" },
            { k: "purge", spec: gimyo },
          ],
        },
        {
          id: "hungu",
          text: "훈구 공신들에게 협조한다",
          hint: "재정 +2 · 전 +300 · 명예 ▼",
          risk: gimyo,
          effects: [
            { k: "nation", key: "finance", add: 2 },
            { k: "point", point: "money", add: 300 },
            { k: "favor", faction: "hungu", add: 10 },
            { k: "point", point: "honor", add: -10 },
            { k: "flag", flag: "gimyo", value: "hungu" },
            { k: "align", faction: "hungu" },
            { k: "purge", spec: gimyo },
          ],
        },
        {
          id: "return",
          text: "제 손으로 정국공신 훈작을 반납한다",
          hint: "사림 총애 ▲ · 명예 +15 · 공적 −30 · 중립",
          requires: { k: "flag", flag: "jeongguk", eq: true },
          risk: { ...gimyo, neutral: true },
          effects: [
            { k: "favor", faction: "sarim", add: 15 },
            { k: "point", point: "honor", add: 15 },
            { k: "point", point: "merit", add: -30 },
            { k: "flag", flag: "gimyo", value: "returned" },
            { k: "purge", spec: { ...gimyo, neutral: true } },
          ],
        },
        {
          id: "quiet",
          text: "말을 아낀다",
          hint: "중립 · 숙청 판정은 피할 수 없다",
          risk: { ...gimyo, neutral: true },
          effects: [
            { k: "flag", flag: "gimyo", value: "quiet" },
            { k: "purge", spec: { ...gimyo, neutral: true } },
          ],
        },
      ],
    },
    {
      id: "ch07_name",
      title: "1530 · 이름을 바꿀 때",
      style: "card",
      body: [
        "실록청 시절의 동료가 손자를 데리고 찾아왔다. 백발의 그가 한참 당신을 보다가 말했다.",
        "'그대는… 그대의 자식인가? 꼭 그때 그 얼굴이로군.'",
      ],
      options: [
        {
          id: "descendant",
          text: "낙향했다가 '자손'으로 돌아온다",
          hint: "신분 세탁 · 의심도 크게 ▼",
          effects: [{ k: "wash", method: "descendant" }],
        },
        {
          id: "monk",
          text: "머리를 깎고 산사로 들어간다",
          hint: "출가 · 재산을 시주하고 새 이름을 얻는다",
          effects: [{ k: "wash", method: "monk" }],
        },
        {
          id: "endure",
          text: "'제 자식이라오.' 웃어넘기고 버틴다",
          hint: "의심도 +10",
          effects: [{ k: "suspicion", add: 10 }],
        },
      ],
    },
    {
      id: "ch07_eulsa",
      title: "1545 · 을사사화",
      style: "card",
      body: [
        "인종이 즉위 여덟 달 만에 승하하고 열두 살 명종이 섰다. 문정왕후가 수렴청정을 시작했다.",
        "왕후의 동생 윤원형과 인종의 외숙 윤임, 양쪽에서 사람이 왔다. '사병 몇을 빌려 주시오.'",
      ],
      options: [
        {
          id: "refuse",
          text: "양쪽 모두 거절한다",
          hint: "중립 · 양쪽의 의심 ▲",
          risk: { ...eulsa, neutral: true },
          effects: [
            { k: "suspicion", add: 5 },
            { k: "purge", spec: { ...eulsa, neutral: true } },
          ],
        },
        {
          id: "soyun",
          text: "윤원형에게 사람을 보낸다",
          hint: "소윤 총애 ▲▲ · 명예 ▼",
          risk: eulsa,
          effects: [
            { k: "favor", faction: "soyun", add: 20 },
            { k: "point", point: "honor", add: -10 },
            { k: "align", faction: "soyun" },
            { k: "purge", spec: eulsa },
          ],
        },
        {
          id: "daeyun",
          text: "윤임 편에 선다",
          hint: "대윤 총애 ▲▲ · 숙청 위험 ▲▲",
          risk: eulsa,
          effects: [
            { k: "favor", faction: "daeyun", add: 20 },
            { k: "align", faction: "daeyun" },
            { k: "purge", spec: eulsa },
          ],
        },
        {
          id: "rescue",
          text: "화를 입은 집안의 아이들을 몰래 빼돌린다",
          hint: "공덕 +40 · 명예 ▲ · 숙청 위험 ▲",
          risk: eulsa,
          effects: [
            { k: "point", point: "virtue", add: 40 },
            { k: "point", point: "honor", add: 5 },
            { k: "flag", flag: "eulsa_rescue", value: true },
            { k: "purge", spec: eulsa },
          ],
        },
      ],
    },
    {
      id: "ch07_bibyeonsa",
      title: "1555 · 비변사",
      style: "card",
      body: [
        "을묘왜변 뒤, 조정은 임시로 두던 비변사를 상설 기구로 삼기로 했다.",
        "회의 말석에서 당신은 남해의 성들이 얼마나 낡았는지 말할 수 있다. 무신의 말이 받아들여질지는 모른다.",
      ],
      options: [
        {
          id: "speak",
          text: "무신의 눈으로 본 것을 끝까지 아뢴다 (지략 판정)",
          hint: "성공하면 장기: 국방 +1 (전쟁 대비)",
          effects: [
            {
              k: "check",
              id: "ch07_bibyeonsa",
              label: "비변사 진언",
              stat: "wit",
              base: 35,
              per: 2,
              success: [
                { k: "longFlag", flag: "bibyeonsa_voice", key: "defense", add: 1 },
                { k: "nation", key: "defense", add: 2 },
                { k: "chronicle", text: "1555년, 비변사 회의에서 남해 성곽의 보수를 관철했다." },
              ],
              failure: [
                { k: "favor", faction: "hungu", add: -5 },
                { k: "toast", text: "'무관이 말이 많군.' 아무도 받아 적지 않았다.", tone: "bad" },
              ],
            },
          ],
        },
        { id: "defer", text: "문관들에게 맡긴다", hint: "변화 없음", effects: [] },
      ],
    },
    {
      id: "ch07_school",
      title: "1574 · 산골 학당",
      style: "card",
      body: [
        "세상이 잠잠해지자 당신은 깊은 산골에 작은 학당을 열었다.",
        "덕보의 후손이라는 소년이 낡은 활을 들고 찾아왔다. 활 끝에 '황산'이라는 두 글자가 새겨져 있다.",
      ],
      options: [
        {
          id: "teach",
          text: "제자로 받는다",
          hint: "유파 · 제자 경험 +1 · 덕윤과의 인연 ▲ · 공덕 ▲",
          effects: [
            { k: "flag", flag: SCHOOL_FLAG },
            { k: "disciple", add: 1 },
            { k: "bond", npc: "deokyun", add: 20 },
            { k: "point", point: "virtue", add: 20 },
            { k: "chronicle", text: "1574년, 덕보의 후손 덕윤을 제자로 받았다. 이백 년 전 남경 들판의 활이 다시 시위를 얹었다." },
          ],
        },
        {
          id: "alone",
          text: "홀로 산중에서 수행한다",
          hint: "천수 +1 · 의심도 ▼",
          effects: [
            { k: "life", add: 1 },
            { k: "suspicion", add: -8 },
          ],
        },
      ],
    },
  ],
  steps: [
    {
      id: "s1",
      year: 1485,
      narration: ["1485년, 한양."],
      objectives: [{ id: "ch07_o_daejeon", text: "경국대전", kind: "prompt", target: "ch07_daejeon" }],
    },
    {
      id: "s2",
      year: 1498,
      narration: ["1498년 7월, 실록청."],
      objectives: [{ id: "ch07_o_muo", text: "무오사화", kind: "prompt", target: "ch07_muo" }],
    },
    {
      id: "s3",
      year: 1504,
      narration: ["1504년, 연산군 10년."],
      objectives: [
        {
          id: "ch07_o_gapja",
          text: "갑자사화",
          kind: "prompt",
          target: "ch07_gapja",
          onComplete: [{ k: "flag", flag: "ch07_gapja_done", value: true }],
        },
        {
          id: "ch07_o_banjeong",
          text: "1506년, 반정의 밤",
          kind: "prompt",
          target: "ch07_banjeong",
          requires: { k: "flag", flag: "ch07_gapja_done", eq: true },
        },
      ],
    },
    {
      id: "s4",
      year: 1510,
      narration: ["1510년 4월, 남쪽 바다 제포에서 봉수가 올랐다."],
      onEnter: [{ k: "goto", site: "dongnae", offset: [-5, -5] }],
      objectives: [
        {
          id: "ch07_o_jepo",
          text: "삼포왜란 — 제포 성문을 지킨다",
          kind: "battle",
          target: "ch07_jepo",
        },
      ],
    },
    {
      id: "s5",
      year: 1519,
      narration: ["1519년 겨울, 한양."],
      onEnter: [{ k: "goto", site: "hanyang", offset: [1, 1] }],
      objectives: [
        {
          id: "ch07_o_gimyo",
          text: "기묘사화",
          kind: "prompt",
          target: "ch07_gimyo",
          onComplete: [{ k: "flag", flag: "ch07_gimyo_done", value: true }],
        },
        {
          id: "ch07_o_name",
          text: "1530년, 낯익은 얼굴",
          kind: "prompt",
          target: "ch07_name",
          requires: { k: "flag", flag: "ch07_gimyo_done", eq: true },
        },
      ],
    },
    {
      id: "s6",
      year: 1545,
      narration: ["1545년, 을사년."],
      objectives: [{ id: "ch07_o_eulsa", text: "을사사화", kind: "prompt", target: "ch07_eulsa" }],
    },
    {
      id: "s7",
      year: 1555,
      narration: ["1555년 5월, 전라도. 왜선 70여 척이 달량성을 함락했다."],
      onEnter: [{ k: "goto", site: "gwangju", offset: [1, 6] }],
      objectives: [
        {
          id: "ch07_o_yeongam",
          text: "을묘왜변 — 영암성에서 새벽 역습에 나선다",
          kind: "battle",
          target: "ch07_yeongam",
        },
        {
          id: "ch07_o_bibyeonsa",
          text: "비변사 회의",
          kind: "prompt",
          target: "ch07_bibyeonsa",
          requires: { k: "battleWon", battle: "ch07_yeongam" },
          onComplete: [{ k: "flag", flag: "ch07_bibyeonsa_done", value: true }],
        },
        {
          id: "ch07_o_school",
          text: "1574년, 산골 학당",
          kind: "prompt",
          target: "ch07_school",
          requires: { k: "flag", flag: "ch07_bibyeonsa_done", eq: true },
        },
      ],
    },
  ],
  worldEvent: {
    title: "남해 방어",
    desc: "삼포와 남해안의 왜변을 막아 낸 공이 채널에 쌓인다.",
    goal: 150,
  },
  companions: 6,
};
