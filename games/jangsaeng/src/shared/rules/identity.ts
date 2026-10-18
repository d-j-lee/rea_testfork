// Apparent age, suspicion (의심도) and identity washes (GDD §5.4).
import type { ContentIndex } from "../content/index.ts";
import type { ChapterId, IdentityKind, WashMethod } from "../content/schema.ts";
import { createRng } from "../rng.ts";
import { AWAKENING_AGE, AWAKENING_YEAR, type PlayerSave } from "../types.ts";
import { rankLabel, setRank } from "./progression.ts";
import { changeLife } from "./lifespan.ts";
import { chronicle, clamp, gainVirtue, isRenowned, josa, line, round1, signed, type Line } from "./util.ts";

export const BIRTH_YEAR = AWAKENING_YEAR - AWAKENING_AGE;

/** Looks: 16 + years since awakening / 12 (one decimal). */
export function apparentAge(year: number): number {
  return round1(AWAKENING_AGE + (year - AWAKENING_YEAR) / 12);
}

/** Real age since birth (1345). */
export function realAge(year: number): number {
  return year - BIRTH_YEAR;
}

export function suspicionBand(value: number): "calm" | "rumour" | "inquiry" | "exposed" {
  if (value < 40) return "calm";
  if (value < 70) return "rumour";
  if (value < 90) return "inquiry";
  return "exposed";
}

export const BAND_NAMES: Readonly<Record<ReturnType<typeof suspicionBand>, string>> = {
  calm: "평온",
  rumour: "소문",
  inquiry: "조사",
  exposed: "발각",
};

// ── Suspicion growth (§5.4.1) ────────────────────────────────────────────

/** Era: 1.00 to 1412, 1.15 from the 1413 호패법, 1.25 from the 1485 경국대전, 1.35 from 1896. */
export function eraFactor(year: number): number {
  if (year >= 1896) return 1.35;
  if (year >= 1485) return 1.25;
  if (year >= 1413) return 1.15;
  return 1.0;
}

/** X: 0.6 no rank, 1.0 당하관, 1.4 당상관; +0.4 when this identity is renowned. */
export function exposure(save: PlayerSave): number {
  const base = save.rank >= 14 ? 1.4 : save.rank >= 1 ? 1.0 : 0.6;
  return base + (isRenowned(save) ? 0.4 : 0);
}

/** g = 0.05 × max(0, D − 8) × X × Era for the year `year`. */
export function suspicionDelta(save: PlayerSave, year: number): number {
  // A successor is an ordinary mortal disciple: their face ages honestly.
  if (save.identity.kind === "successor") return 0;
  const identityAge = save.identity.startAge + (year - save.identity.startYear);
  const mismatch = identityAge - (AWAKENING_AGE + (year - AWAKENING_YEAR) / 12);
  return 0.05 * Math.max(0, mismatch - 8) * exposure(save) * eraFactor(year);
}

/** Applies yearly suspicion growth for the years (fromYear, toYear]. */
export function growSuspicion(save: PlayerSave, fromYear: number, toYear: number): number {
  const before = save.suspicion;
  let value = save.suspicion;
  for (let year = Math.floor(fromYear) + 1; year <= toYear; year++) {
    value = clamp(value + suspicionDelta(save, year), 0, 100);
  }
  save.suspicion = round1(value);
  return save.suspicion - before;
}

export function changeSuspicion(save: PlayerSave, add: number): number {
  const before = save.suspicion;
  save.suspicion = round1(clamp(save.suspicion + add, 0, 100));
  return save.suspicion - before;
}

// ── Names ────────────────────────────────────────────────────────────────

const FAMILY = [
  "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "신", "서", "권", "황", "안",
  "송", "류", "홍", "전", "고", "문", "양", "손", "배", "백", "허", "남", "심", "노", "하", "곽",
  "성", "차", "주", "우", "구", "민", "진", "지", "엄", "원", "변", "여", "도", "석", "설", "길",
  "연", "위", "표", "명", "기", "반", "어", "용", "남궁", "황보", "제갈", "선우", "독고",
];
const MALE_FIRST = [
  "성", "정", "경", "덕", "문", "무", "영", "원", "인", "의", "충", "효", "상", "세", "수", "승",
  "진", "태", "한", "희", "광", "석", "철", "응", "득", "대", "종", "준", "근", "언", "윤", "치",
];
const MALE_SECOND = [
  "수", "호", "길", "남", "룡", "석", "철", "순", "우", "원", "현", "복", "만", "춘", "동", "신",
  "연", "익", "환", "국", "걸", "손", "보", "생", "백", "립", "해", "로", "명", "규",
];
const FEMALE_FIRST = [
  "소", "연", "옥", "순", "덕", "향", "매", "춘", "월", "채", "은", "선", "정", "분", "귀", "금",
  "계", "단", "효", "말",
];
const FEMALE_SECOND = [
  "이", "례", "심", "화", "련", "아", "희", "영", "단", "녀", "향", "진", "월", "매", "랑", "선",
  "덕", "임",
];

/** A plausible period name for a new identity, deterministic per save and salt. */
export function suggestName(save: PlayerSave, salt: string): string {
  const rng = createRng(`${save.seed >>> 0}:name:${salt}`);
  const taken = new Set([save.name, save.birthName, ...save.identities.map((record) => record.name)]);
  const female = save.variant === "f";
  let candidate = "";
  for (let attempt = 0; attempt < 12; attempt++) {
    const first = rng.pick(female ? FEMALE_FIRST : MALE_FIRST);
    let second = rng.pick(female ? FEMALE_SECOND : MALE_SECOND);
    if (second === first) second = rng.pick(female ? FEMALE_SECOND : MALE_SECOND);
    candidate = `${rng.pick(FAMILY)}${first}${second}`;
    if (!taken.has(candidate)) return candidate;
  }
  return candidate;
}

/** The one cleanup a chosen name gets (control characters out, trimmed, at most 16). */
export function cleanName(name: string | undefined): string {
  return (name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
}

// ── Identity washes (§5.4.4) ─────────────────────────────────────────────

/** Chapters after which a faked battlefield death is believable. */
export const WAR_CHAPTERS: ReadonlySet<ChapterId> = new Set<ChapterId>([
  "ch02", "ch03", "ch05", "ch09", "ch10", "ch11", "ch14", "ch15", "ch16",
]);
export const TUTORIAL_WASH_CHAPTER: ChapterId = "ch04";
export const MERCHANT_DISCOUNT_BOND = "baek_house";

export interface WashSpec {
  name: string;
  desc: string;
  /** Money paid up front; "all" gives everything away (monk). */
  cost: number | "all";
  /** 공덕 per 100전 given away (출가's alms). */
  alms?: number;
  life: number;
  suspicion: number;
  /** Fractions carried into the new identity; rank "exam" = min(4, 1 + floor(agility / 15)). */
  carry: { money: number; rank: number | "exam"; bonds: number; merit: number };
  minYear?: number;
  needsWar?: boolean;
}

export const WASH_METHODS: Readonly<Record<WashMethod | "forced", WashSpec>> = {
  descendant: {
    name: "낙향 후 후손 행세",
    desc: "내가 내 아들·딸이 된다. 재산 80%·품계 절반·인연 70%·공적 50%를 잇는다.",
    cost: 300, life: 0, suspicion: 10, carry: { money: 0.8, rank: 0.5, bonds: 0.7, merit: 0.5 },
  },
  fakeDeath: {
    name: "전사 위장",
    desc: "전장에서 죽은 것으로 꾸민다. 천수 −1년, 재산 50%·인연 50%, 품계와 공적은 사라진다.",
    cost: 100, life: -1, suspicion: 0, carry: { money: 0.5, rank: 0, bonds: 0.5, merit: 0 }, needsWar: true,
  },
  monk: {
    name: "출가",
    desc: "재산을 모두 시주한다(100전당 공덕 +10). 인연 60%를 잇고 승병의 길이 열린다.",
    cost: "all", alms: 10, life: 0, suspicion: 5, carry: { money: 0, rank: 0, bonds: 0.6, merit: 0 },
  },
  merchant: {
    name: "상인 행세",
    desc: "송상의 객주로 새 삶을 연다. 재산은 그대로, 인연 80%, 품계는 사라진다. 백가 인연 60 이상이면 250전.",
    cost: 500, life: 0, suspicion: 15, carry: { money: 1, rank: 0, bonds: 0.8, merit: 0 },
  },
  exam: {
    name: "무과 재응시",
    desc: "새 이름으로 무과에 급제한다. 품계 1 + 신법÷15(최대 4), 재산 70%·인연 60%.",
    cost: 200, life: 0, suspicion: 10, carry: { money: 0.7, rank: "exam", bonds: 0.6, merit: 0 }, minYear: 1402,
  },
  forced: {
    name: "발각 도주",
    desc: "정체가 드러나 쫓기듯 달아난다. 천수 −2년, 재산 30%·인연 50%만 남는다.",
    cost: 0, life: -2, suspicion: 0, carry: { money: 0.3, rank: 0, bonds: 0.5, merit: 0 },
  },
};

/** Short identity names shown everywhere an identity is listed; each wash's name ends with its short name. */
const KIND_NAMES: Readonly<Record<IdentityKind, string>> = {
  birth: "본래 이름",
  descendant: "후손 행세",
  fakeDeath: "전사 위장",
  monk: "출가",
  merchant: "상인 행세",
  exam: "무과 재응시",
  forced: "발각 도주",
  successor: "계승자",
};

export function identityKindName(kind: IdentityKind): string {
  return KIND_NAMES[kind];
}

/** 공덕 that alms of `rate` per 100전 bring when `money` is given away (출가). */
export function almsVirtue(rate: number, money: number): number {
  return rate * Math.floor(Math.max(0, money) / 100);
}

/** The ch04 호패법 tutorial wash is free once. */
export function tutorialWashFree(save: PlayerSave): boolean {
  return save.chapter === TUTORIAL_WASH_CHAPTER && save.flags["tutorialWashUsed"] !== true;
}

/** Money a wash costs right now (all money for a monk). */
export function washCost(save: PlayerSave, method: WashMethod | "forced"): number {
  const spec = WASH_METHODS[method];
  if (spec.cost === "all") return save.points.money;
  if (method === "forced" || tutorialWashFree(save)) return 0;
  if (method === "merchant" && (save.bonds[MERCHANT_DISCOUNT_BOND] ?? 0) >= 60) return 250;
  return spec.cost;
}

/** Why a voluntary wash is unavailable right now (undefined when allowed). */
export function washBlocker(save: PlayerSave, method: WashMethod): string | undefined {
  const spec = WASH_METHODS[method];
  if (!spec) return "알 수 없는 방법";
  if (spec.needsWar && !WAR_CHAPTERS.has(save.chapter) && save.flags["escaped"] !== true) {
    return "전쟁이 있었던 시대나 탈출 직후에만 쓸 수 있다";
  }
  if (spec.minYear !== undefined && save.year < spec.minYear) return `${spec.minYear}년 무과 시행 이후에 가능하다`;
  const cost = washCost(save, method);
  if (spec.cost !== "all" && save.points.money < cost) return `전 ${cost}이 필요하다 (보유 ${Math.floor(save.points.money)})`;
  return undefined;
}

function scaleBonds(save: PlayerSave, factor: number): void {
  if (factor === 1) return;
  for (const [id, value] of Object.entries(save.bonds)) save.bonds[id] = Math.round(value * factor);
}

/** Closes the current identity record and opens a new one. */
export function startIdentity(save: PlayerSave, kind: IdentityKind, name: string, startAge: number): void {
  const last = save.identities[save.identities.length - 1];
  if (last && last.to === undefined) last.to = save.year;
  save.identities.push({ name, kind, from: save.year });
  save.name = name;
  save.identity = { kind, startYear: save.year, startAge };
  delete save.flags["renowned"];
}

/** Starts a new identity. Content-driven washes always succeed and pay what they can. */
export function washIdentity(
  content: ContentIndex,
  save: PlayerSave,
  method: WashMethod | "forced",
  newName: string,
): Line[] {
  void content;
  const spec = WASH_METHODS[method];
  const oldName = save.name;
  const name = cleanName(newName) || suggestName(save, `wash:${method}:${save.year}:${save.record.washes}`);
  const free = method !== "forced" && spec.cost !== "all" && tutorialWashFree(save);
  const cost = Math.min(washCost(save, method), save.points.money);
  const detail: string[] = [];
  if (method === "monk") {
    const alms = gainVirtue(save, almsVirtue(spec.alms ?? 0, cost));
    save.points.money = 0;
    if (cost > 0) detail.push(`시주 ${Math.floor(cost)}전`);
    if (alms > 0) detail.push(`공덕 +${alms}`);
  } else {
    save.points.money = Math.floor((save.points.money - cost) * spec.carry.money);
    if (cost > 0) detail.push(`전 −${Math.floor(cost)}`);
  }
  if (free) {
    save.flags["tutorialWashUsed"] = true;
    detail.push("호패법 첫 세탁 — 비용 면제");
  }
  const rank = spec.carry.rank === "exam"
    ? Math.min(4, 1 + Math.floor(save.stats.agility / 15))
    : Math.floor(save.rank * spec.carry.rank);
  setRank(save, rank);
  save.points.merit = Math.floor(save.points.merit * spec.carry.merit);
  scaleBonds(save, spec.carry.bonds);
  if (spec.life !== 0) changeLife(save, spec.life);
  if (method === "monk") save.flags["monk"] = true;
  if (method === "fakeDeath") delete save.flags["escaped"];
  save.suspicion = spec.suspicion;
  startIdentity(save, method, name, Math.round(apparentAge(save.year)));
  save.record.washes += 1;
  chronicle(save, `${oldName}의 이름을 버리고 ${josa(name, "으로/로")} 살아가다 (${spec.name}).`, method === "forced" ? "bad" : "info");
  detail.push(`의심도 ${spec.suspicion}`);
  detail.push(save.rank > 0 ? `품계 ${rankLabel(save.rank, save.year)}` : "품계 없음");
  if (spec.life !== 0) detail.push(`천수 ${signed(spec.life)}년`);
  const tone = method === "forced" ? "bad" : "epic";
  return [
    line(`신분 세탁 — ${spec.name}: ${oldName} → ${name}`, tone),
    line(detail.join(" · "), method === "forced" ? "bad" : "info"),
  ];
}
