// Lifespan (천수), apparent age, suspicion (의심도), identity washes and the
// successor takeover. GDD §4.3 / §4.4 / §4.8.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterId, IdentityKind, WashMethod } from "../content/schema.ts";
import { createRng } from "../rng.ts";
import { AWAKENING_AGE, AWAKENING_YEAR, FINAL_YEAR, type PlayerSave } from "../types.ts";
import { rankLabel, setRank } from "./progression.ts";
import { chronicle, clamp, itemName, line, round1, signed, type Line } from "./util.ts";

export const BIRTH_YEAR = AWAKENING_YEAR - AWAKENING_AGE;
export const OFFER_COST = 100;
export const OFFER_MAX_PER_CHAPTER = 5;
export const GRACE_YEARS = 10;
export const LONGEVITY_MAX_PER_CHAPTER = 3;
export const SUCCESSOR_LIFESPAN = 55;
export const SUCCESSOR_START_AGE = 25;

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

// ── Lifespan ─────────────────────────────────────────────────────────────

/** Adds or removes lifespan years and records gained/spent totals. */
export function changeLife(save: PlayerSave, years: number): void {
  if (!Number.isFinite(years) || years === 0) return;
  const delta = Math.round(years);
  if (delta === 0) return;
  save.lifeEnd += delta;
  if (delta > 0) save.record.lifeGained += delta;
  else save.record.lifeSpent += -delta;
}

export function lifeLine(years: number): Line {
  return line(`천수 ${signed(years)}년`, years >= 0 ? "good" : "bad");
}

/** Years an offering would grant right now. */
export function offerableYears(save: PlayerSave): number {
  const room = Math.max(0, OFFER_MAX_PER_CHAPTER - save.offeredThisChapter);
  return Math.max(0, Math.min(room, Math.floor(save.points.virtue / OFFER_COST)));
}

/** Converts virtue into lifespan (100 → +1 year, max 5 per chapter). */
export function offerVirtue(save: PlayerSave): number {
  const years = offerableYears(save);
  if (years <= 0) return 0;
  save.points.virtue -= years * OFFER_COST;
  save.offeredThisChapter += years;
  changeLife(save, years);
  return years;
}

/** 노인성의 마지막 은혜: once, when the lifespan falls short of 1910 from CH14 on. */
export function graceAvailable(content: ContentIndex, save: PlayerSave, next: ChapterId): boolean {
  const order = content.chapters[next]?.order ?? 0;
  return !save.graceUsed && save.lifeEnd < FINAL_YEAR && order >= 14;
}

export function applyGrace(save: PlayerSave): Line[] {
  save.graceUsed = true;
  changeLife(save, GRACE_YEARS);
  chronicle(save, "노인성이 마지막 은혜를 내리다. 천수 10년이 더해졌다.", "epic");
  return [line(`노인성의 마지막 은혜 — 천수 +${GRACE_YEARS}년 (${save.lifeEnd}년까지)`, "epic")];
}

/** 노인성 일섬: burns one lifespan year, max 3 per chapter. */
export function useLongevity(save: PlayerSave): boolean {
  if (save.longevityUses >= LONGEVITY_MAX_PER_CHAPTER) return false;
  save.longevityUses += 1;
  changeLife(save, -1);
  return true;
}

/** Gives up waiting for a revive: −1 lifespan year. */
export function selfRevive(save: PlayerSave): Line[] {
  save.record.selfRevives += 1;
  changeLife(save, -1);
  return [line("스스로 일어서다 — 천수 −1년", "bad")];
}

export interface UseResult {
  ok: boolean;
  /** HP the session should restore. */
  heal: number;
  /** Lifespan years granted (already applied). */
  life: number;
  lines: Line[];
}

/** Consumes one consumable or sells one treasure; lifespan items apply here, heals are returned. */
export function useItem(content: ContentIndex, save: PlayerSave, id: string): UseResult {
  const item = content.items[id];
  const none: UseResult = { ok: false, heal: 0, life: 0, lines: [] };
  if (!item || (save.inventory[id] ?? 0) <= 0) return none;
  if (item.kind !== "consumable" && item.kind !== "treasure") return none;
  const left = (save.inventory[id] ?? 0) - 1;
  if (left > 0) save.inventory[id] = left;
  else delete save.inventory[id];
  if (item.kind === "treasure") {
    const price = item.price ?? 0;
    save.points.money += price;
    return { ok: true, heal: 0, life: 0, lines: [line(`${itemName(content, id)} 처분 — 전 +${price}`, "good")] };
  }
  const life = item.life ?? 0;
  const lines: Line[] = [];
  if (life !== 0) {
    changeLife(save, life);
    lines.push(line(`${item.name} — 천수 ${signed(life)}년`, "epic"));
  }
  return { ok: true, heal: item.heal ?? 0, life, lines };
}

// ── Suspicion ────────────────────────────────────────────────────────────

/** 노출계수: commoner 0.6, 당하관 1.0, 당상관 1.4, 공신·명망가 1.8. */
export function exposure(save: PlayerSave): number {
  if (save.meritSubject !== undefined || save.points.fame >= 50) return 1.8;
  if (save.rank >= 14) return 1.4;
  if (save.rank >= 1) return 1.0;
  return 0.6;
}

/** Suspicion gained during `year` by the current identity. */
export function suspicionDelta(save: PlayerSave, year: number): number {
  // A successor is an ordinary mortal disciple: their face ages honestly.
  if (save.identity.kind === "successor") return 0;
  const identityAge = save.identity.startAge + (year - save.identity.startYear);
  const mismatch = identityAge - (AWAKENING_AGE + (year - AWAKENING_YEAR) / 12);
  let delta = 0.15 * Math.max(0, mismatch - 10) * exposure(save);
  // 식년 호적: from the 1413 호패법, every third year.
  if (year >= 1413 && (year - 1413) % 3 === 0) delta += 1;
  return delta;
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

/** A plausible period name for a new identity, deterministic per save. */
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

function cleanName(name: string | undefined): string {
  return (name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
}

// ── Identity washes ──────────────────────────────────────────────────────

export interface WashSpec {
  name: string;
  desc: string;
  /** Money paid up front; "all" spends everything. */
  cost: number | "all";
  life: number;
  suspicion: number;
  money: number;
  /** Rank after the wash: multiplier of the current rank, or a fixed step. */
  rank: { mul: number } | { set: number };
  bonds: number;
  minYear?: number;
  needsBattle?: boolean;
}

export const WASH_METHODS: Readonly<Record<WashMethod | "forced", WashSpec>> = {
  descendant: {
    name: "낙향 후 후손 행세",
    desc: "아들·조카로 행세한다. 재산 80%·품계 절반·인연 70%를 잇는다.",
    cost: 300, life: 0, suspicion: 10, money: 0.8, rank: { mul: 0.5 }, bonds: 0.7,
  },
  fakeDeath: {
    name: "전사 위장",
    desc: "전장에서 죽은 것으로 꾸민다. 천수 −1년, 재산 50%·인연 50%, 품계는 사라진다.",
    cost: 100, life: -1, suspicion: 0, money: 0.5, rank: { set: 0 }, bonds: 0.5, needsBattle: true,
  },
  monk: {
    name: "출가(승려)",
    desc: "재산을 모두 시주하고 절에 든다. 인연 60%를 잇고 승병의 길이 열린다.",
    cost: "all", life: 0, suspicion: 5, money: 1, rank: { set: 0 }, bonds: 0.6,
  },
  merchant: {
    name: "상인 행세",
    desc: "송상의 객주로 새 삶을 연다. 재산은 그대로, 품계는 사라진다.",
    cost: 500, life: 0, suspicion: 15, money: 1, rank: { set: 0 }, bonds: 1,
  },
  exam: {
    name: "무과 재응시",
    desc: "새 이름으로 무과에 급제한다. 종9품부터 다시 시작하고 재산 70%를 잇는다.",
    cost: 200, life: 0, suspicion: 10, money: 0.7, rank: { set: 1 }, bonds: 1, minYear: 1402,
  },
  forced: {
    name: "강제 도주",
    desc: "정체가 드러나 쫓기듯 달아난다. 재산 30%만 남고 품계는 사라지며 천수 −2년.",
    cost: 0, life: -2, suspicion: 15, money: 0.3, rank: { set: 0 }, bonds: 0.5,
  },
};

const KIND_NAMES: Readonly<Record<IdentityKind, string>> = {
  birth: "본래 이름",
  descendant: "후손 행세",
  fakeDeath: "전사 위장",
  monk: "출가",
  merchant: "상인 행세",
  exam: "무과 재응시",
  forced: "강제 도주",
  successor: "후계자",
};

export function identityKindName(kind: IdentityKind): string {
  return KIND_NAMES[kind];
}

/** Why a voluntary wash is unavailable right now (undefined when allowed). */
export function washBlocker(save: PlayerSave, method: WashMethod, hadBattle: boolean): string | undefined {
  const spec = WASH_METHODS[method];
  if (spec.needsBattle && !hadBattle) return "전쟁이 있었던 시대에만 쓸 수 있다";
  if (spec.minYear !== undefined && save.year < spec.minYear) return `${spec.minYear}년 무과 시행 이후에 가능하다`;
  if (typeof spec.cost === "number" && save.points.money < spec.cost) return `전 ${spec.cost}이 필요하다 (보유 ${Math.floor(save.points.money)})`;
  return undefined;
}

function scaleBonds(save: PlayerSave, factor: number): void {
  if (factor === 1) return;
  for (const [id, value] of Object.entries(save.bonds)) save.bonds[id] = Math.round(value * factor);
}

function startIdentity(save: PlayerSave, kind: IdentityKind, name: string, startAge: number): void {
  const last = save.identities[save.identities.length - 1];
  if (last && last.to === undefined) last.to = save.year;
  save.identities.push({ name, kind, from: save.year });
  save.name = name;
  save.identity = { kind, startYear: save.year, startAge };
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
  const cost = spec.cost === "all" ? save.points.money : Math.min(spec.cost, save.points.money);
  save.points.money = Math.floor((save.points.money - cost) * (spec.cost === "all" ? 0 : spec.money));
  if ("mul" in spec.rank) setRank(save, Math.floor(save.rank * spec.rank.mul));
  else setRank(save, spec.rank.set);
  scaleBonds(save, spec.bonds);
  if (spec.life !== 0) changeLife(save, spec.life);
  // 공신 status belongs to the old name, except for an heir posing as the son.
  if (method !== "descendant") delete save.meritSubject;
  if (method === "monk") save.flags["monk"] = true;
  save.suspicion = spec.suspicion;
  startIdentity(save, method, name, Math.round(apparentAge(save.year)));
  save.record.washes += 1;
  chronicle(save, `${oldName}의 이름을 버리고 ${name}(으)로 살아가다 (${spec.name}).`, method === "forced" ? "bad" : "info");
  const lines: Line[] = [
    line(`신분 세탁 — ${spec.name}: ${oldName} → ${name}`, method === "forced" ? "bad" : "epic"),
  ];
  const detail: string[] = [];
  if (cost > 0) detail.push(`전 −${Math.floor(cost)}`);
  detail.push(`의심도 ${spec.suspicion}`);
  detail.push(save.rank > 0 ? `품계 ${rankLabel(save.rank, save.year)}` : "품계 없음");
  if (spec.life !== 0) detail.push(`천수 ${signed(spec.life)}년`);
  lines.push(line(detail.join(" · "), method === "forced" ? "bad" : "info"));
  return lines;
}

// ── Successor ────────────────────────────────────────────────────────────

export function pastLifeEnd(save: PlayerSave): boolean {
  return save.year > save.lifeEnd;
}

/** The disciple line takes over when the lifespan ends; the run continues (P4). */
export function successorTakeover(content: ContentIndex, save: PlayerSave): Line[] {
  void content;
  const generation = (save.successor?.generation ?? 0) + 1;
  const oldName = save.name;
  const name = suggestName(save, `successor:${generation}`);
  for (const stat of Object.keys(save.stats) as (keyof PlayerSave["stats"])[]) {
    save.stats[stat] = Math.max(5, Math.floor(save.stats[stat] * 0.7));
  }
  setRank(save, Math.floor(save.rank * 0.5));
  scaleBonds(save, 0.8);
  save.successor = { generation };
  save.suspicion = 0;
  save.lifeEnd = save.year + SUCCESSOR_LIFESPAN;
  startIdentity(save, "successor", name, SUCCESSOR_START_AGE);
  chronicle(save, `${oldName}의 천수가 다하다. 제자 ${name}이(가) 유지를 잇는다 (${generation}대).`, "epic");
  return [
    line(`천수가 다했다 — ${oldName}의 오백 년이 여기서 멈춘다`, "bad"),
    line(`제자 ${name}이(가) 유지를 잇는다 (${generation}대 · 능력치 70% · 품계 절반 · 인연 80%)`, "epic"),
  ];
}
