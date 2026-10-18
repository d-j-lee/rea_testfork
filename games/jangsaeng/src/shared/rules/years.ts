// Passage of years between chapters (세월 흐르기, GDD §4.7): 10-year tokens,
// activities, small events, suspicion growth, salary, promotion, nation
// carry-over, chapter reset, washes, offerings and the successor takeover.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterId, Effect, StatKey, WashMethod } from "../content/schema.ts";
import type { PlayerSave, ResultView, YearsPlanView } from "../types.ts";
import { applyEffectsInto, emptyOutcome } from "./effects.ts";
import {
  applyGrace,
  BAND_NAMES,
  graceAvailable,
  growSuspicion,
  offerVirtue,
  OFFER_MAX_PER_CHAPTER,
  pastLifeEnd,
  successorTakeover,
  suggestName,
  suspicionBand,
  suspicionDelta,
  washBlocker,
  washIdentity,
  WASH_METHODS,
} from "./life.ts";
import { carryNation, INFILTRATION_FROM_ORDER } from "./nation.ts";
import { promote } from "./progression.ts";
import { FAMILY_BONDS, hashRoll, line, nationName, round1, type Line } from "./util.ts";

export interface YearsChoice {
  /** One activity id per 10-year token. */
  activities: string[];
  wash?: WashMethod;
  newName?: string;
  offer: boolean;
}

export const MERIT_STIPEND: Readonly<Record<1 | 2 | 3 | 4, number>> = { 1: 300, 2: 200, 3: 120, 4: 60 };
export const SALARY_PER_RANK = 40;
export const WASH_ADVISED_AT = 60;
const WASH_ORDER: readonly WashMethod[] = ["descendant", "fakeDeath", "monk", "merchant", "exam"];

export function tokensBetween(fromYear: number, toYear: number): number {
  return Math.max(1, Math.ceil((toYear - fromYear) / 10));
}

function commerceGain(save: PlayerSave): number {
  return Math.round(400 * (1 + save.stats.tact / 50));
}

// ── Activities ───────────────────────────────────────────────────────────

export interface ActivityDef {
  id: string;
  name: string;
  desc: string;
  /** Planner hint for this save. */
  effect: (save: PlayerSave) => string;
  blocker?: (save: PlayerSave) => string | undefined;
  /** Pure effects for one token. */
  effects: (save: PlayerSave, ruling: string | undefined, salt: string) => Effect[];
  /** Changes with no Effect kind (free points, bond decay, lineage counter); returns notes. */
  extra?: (save: PlayerSave) => string[];
}

export const ACTIVITIES: readonly ActivityDef[] = [
  {
    id: "martial", name: "무예 수련", desc: "산과 들에서 칼과 활을 갈고닦는다.", effect: () => "능력치 점수 +2",
    effects: () => [],
    extra: (save) => {
      save.freePoints += 2;
      return ["능력치 점수 +2"];
    },
  },
  {
    id: "mountain", name: "산중 수행", desc: "깊은 산에 들어 세상과 인연을 끊고 기를 기른다.",
    effect: () => "천수 +1년 · 의심도 −8 · 인연 −5%",
    effects: () => [{ k: "life", add: 1 }, { k: "suspicion", add: -8 }],
    extra: (save) => {
      for (const [npc, value] of Object.entries(save.bonds)) save.bonds[npc] = Math.round(value * 0.95);
      return ["인연 −5%"];
    },
  },
  {
    id: "commerce", name: "치부", desc: "상단을 꾸려 물산을 사고판다.",
    effect: (save) => `전 +${commerceGain(save)} · 의심도 +2 · 명망 +1`,
    effects: (save) => [
      { k: "point", point: "money", add: commerceGain(save) },
      { k: "suspicion", add: 2 },
      { k: "point", point: "fame", add: 1 },
    ],
  },
  {
    id: "office", name: "관직 근무", desc: "맡은 자리에서 성실히 봉직한다.",
    effect: (save) => `공적 +20 · 전 +${save.rank * SALARY_PER_RANK} · 집권 파벌 총애 +5 · 의심도 +4`,
    blocker: (save) => (save.rank >= 1 ? undefined : "관직이 없다"),
    effects: (save, ruling) => [
      { k: "point", point: "merit", add: 20 },
      { k: "point", point: "money", add: save.rank * SALARY_PER_RANK },
      ...(ruling ? [{ k: "favor", faction: ruling, add: 5 } as const] : []),
      { k: "suspicion", add: 4 },
    ],
  },
  {
    id: "study", name: "학문", desc: "경서와 병서를 읽는다.", effect: () => "지략 +2",
    effects: () => [{ k: "stat", stat: "wit", add: 2 }],
  },
  {
    id: "charity", name: "선행·구휼", desc: "굶주린 이웃에게 곡식을 나눈다.", effect: () => "전 −150 · 공덕 +60 · 민심 +1",
    blocker: (save) => (save.points.money >= 150 ? undefined : "전 150이 필요하다"),
    effects: () => [
      { k: "point", point: "money", add: -150 },
      { k: "point", point: "virtue", add: 60 },
      { k: "nation", key: "people", add: 1 },
    ],
  },
  {
    id: "network", name: "인맥 쌓기", desc: "오랜 가문들을 찾아 정을 잇는다.", effect: () => "가문 인연 +10",
    effects: (save, _ruling, salt) => [
      { k: "bond", npc: FAMILY_BONDS[hashRoll(save.seed, `network:${salt}`) % FAMILY_BONDS.length] ?? "smith", add: 10 },
    ],
  },
  {
    id: "disciples", name: "제자 양성", desc: "뒤를 이을 제자를 길러 낸다.", effect: () => "제자 인연 +10 · 제자 계보 +1",
    effects: () => [{ k: "bond", npc: "disciple", add: 10 }],
    extra: (save) => {
      const generations = save.flags["disciples"];
      save.flags["disciples"] = (typeof generations === "number" ? generations : 0) + 1;
      return ["제자 계보 +1"];
    },
  },
];

/** Runs one token; a blocked or unknown activity falls back to 무예 수련. */
function runActivity(content: ContentIndex, save: PlayerSave, id: string, salt: string, label: string): Line[] {
  const def = ACTIVITIES.find((activity) => activity.id === id);
  const blocked = def ? def.blocker?.(save) : "알 수 없는 활동";
  const chosen = def && !blocked ? def : (ACTIVITIES[0] as ActivityDef);
  const out = emptyOutcome();
  applyEffectsInto(content, save, chosen.effects(save, content.chapters[save.chapter]?.ruling, salt), out);
  const notes = chosen.extra?.(save) ?? [];
  const detail = [...out.lines.map((entry) => entry.text), ...notes].join(" · ");
  const prefix = blocked ? `${label} · ${def?.name ?? id} 불가(${blocked}) → ${chosen.name}` : `${label} · ${chosen.name}`;
  return [line(detail ? `${prefix} — ${detail}` : prefix, "info")];
}

// ── Small events ─────────────────────────────────────────────────────────

export interface SmallEvent {
  id: string;
  name: string;
  intro: string;
  stat: StatKey;
  base: number;
  per: number;
  success: (save: PlayerSave, ruling: string | undefined, salt: string) => Effect[];
  failure: (save: PlayerSave) => Effect[];
}

export const SMALL_EVENTS: readonly SmallEvent[] = [
  {
    id: "plague", name: "역병", intro: "역병이 고을을 휩쓸었다.", stat: "spirit", base: 35, per: 2,
    success: () => [{ k: "point", point: "virtue", add: 40 }, { k: "nation", key: "people", add: 1 }],
    failure: () => [{ k: "point", point: "money", add: -80 }],
  },
  {
    id: "tiger", name: "호환", intro: "범이 마을을 덮쳤다.", stat: "power", base: 30, per: 2.5,
    success: () => [{ k: "point", point: "fame", add: 2 }, { k: "point", point: "money", add: 100 }],
    failure: () => [{ k: "life", add: -1 }],
  },
  {
    id: "famine", name: "기근", intro: "큰 가뭄 끝에 기근이 들었다.", stat: "tact", base: 35, per: 2,
    success: () => [{ k: "point", point: "virtue", add: 50 }, { k: "nation", key: "people", add: 1 }],
    failure: () => [{ k: "nation", key: "people", add: -1 }, { k: "point", point: "money", add: -50 }],
  },
  {
    id: "marriage", name: "혼담", intro: "이웃 가문에서 혼담이 들어왔다.", stat: "tact", base: 40, per: 2,
    success: (save, _ruling, salt) => [
      { k: "bond", npc: FAMILY_BONDS[hashRoll(save.seed, `marriage:${salt}`) % FAMILY_BONDS.length] ?? "merchant", add: 8 },
      { k: "suspicion", add: -3 },
    ],
    failure: () => [{ k: "suspicion", add: 4 }],
  },
  {
    id: "bandits", name: "도적", intro: "고갯길에 도적 떼가 나타났다.", stat: "agility", base: 35, per: 2.5,
    success: () => [{ k: "point", point: "money", add: 150 }, { k: "point", point: "fame", add: 1 }],
    failure: () => [{ k: "point", point: "money", add: -100 }],
  },
  {
    id: "procession", name: "왕실 행차", intro: "임금의 행차가 고을을 지났다.", stat: "wit", base: 35, per: 2,
    success: (_save, ruling) => [
      { k: "point", point: "merit", add: 15 },
      ...(ruling ? [{ k: "favor", faction: ruling, add: 3 } as const] : []),
    ],
    failure: () => [{ k: "suspicion", add: 3 }],
  },
];

export const SMALL_EVENT_CHANCE = 30;

function tokenSalt(fromYear: number, next: ChapterId, index: number): string {
  return `${fromYear}:${next}:${index}`;
}

/** The small event (if any) that token `index` of the passage fromYear → next will roll. */
export function smallEventAt(seed: number, fromYear: number, next: ChapterId, index: number): SmallEvent | undefined {
  const salt = tokenSalt(fromYear, next, index);
  if (hashRoll(seed, `years:${salt}:event`) >= SMALL_EVENT_CHANCE) return undefined;
  return SMALL_EVENTS[hashRoll(seed, `years:${salt}:kind`) % SMALL_EVENTS.length];
}

function runSmallEvent(content: ContentIndex, save: PlayerSave, event: SmallEvent | undefined, salt: string, year: number): Line[] {
  if (!event) return [];
  const ruling = content.chapters[save.chapter]?.ruling;
  const out = emptyOutcome();
  applyEffectsInto(content, save, [{
    k: "check",
    id: `years:${salt}:${event.id}`,
    label: event.name,
    stat: event.stat,
    base: event.base,
    per: event.per,
    success: event.success(save, ruling, salt),
    failure: event.failure(save),
  }], out);
  const [verdict, ...rest] = out.lines;
  const detail = rest.map((entry) => entry.text).join(" · ");
  return [
    line(`${year}년 무렵, ${event.intro}`, "info"),
    line(`${verdict?.text ?? event.name}${detail ? ` — ${detail}` : ""}`, verdict?.tone ?? "info"),
  ];
}

// ── Planner ──────────────────────────────────────────────────────────────

function hadBattle(content: ContentIndex, save: PlayerSave): boolean {
  return (content.chapters[save.chapter]?.battles.length ?? 0) > 0;
}

function washDesc(method: WashMethod): string {
  const spec = WASH_METHODS[method];
  const cost = spec.cost === "all" ? "재산 전부" : `${spec.cost}전`;
  return `${cost} · 세탁 후 의심도 ${spec.suspicion} · ${spec.desc}`;
}

/** Suspicion if no activity changed it, for the wash advice. */
function projectedSuspicion(save: PlayerSave, toYear: number): number {
  let value = save.suspicion;
  for (let year = save.year + 1; year <= toYear; year++) value = Math.min(100, value + suspicionDelta(save, year));
  return round1(value);
}

/** Planner view for the years between the current chapter and `next`. */
export function yearsPlan(content: ContentIndex, save: PlayerSave, next: ChapterId): YearsPlanView {
  const toYear = Math.max(save.year, content.chapters[next]?.years[0] ?? save.year);
  const battle = hadBattle(content, save);
  const washes: YearsPlanView["washes"] = [];
  for (const method of WASH_ORDER) {
    const spec = WASH_METHODS[method];
    if (spec.needsBattle && !battle) continue;
    const blocked = washBlocker(save, method, battle);
    washes.push(blocked ? { id: method, name: spec.name, desc: washDesc(method), disabled: blocked } : { id: method, name: spec.name, desc: washDesc(method) });
  }
  return {
    type: "years",
    fromYear: save.year,
    toYear,
    tokens: tokensBetween(save.year, toYear),
    activities: ACTIVITIES.map((activity) => {
      const disabled = activity.blocker?.(save);
      const view = { id: activity.id, name: activity.name, desc: activity.desc, effect: activity.effect(save) };
      return disabled ? { ...view, disabled } : view;
    }),
    washes,
    washAdvised: save.suspicion >= WASH_ADVISED_AT || projectedSuspicion(save, toYear) >= 90,
    lifeEnd: save.lifeEnd,
    virtue: save.points.virtue,
    // Counters reset before the transition offering, so a fresh 5-year allowance applies.
    canOffer: Math.min(OFFER_MAX_PER_CHAPTER, Math.floor(save.points.virtue / 100)) + (graceAvailable(content, save, next) ? 10 : 0),
  };
}

// ── Advance ──────────────────────────────────────────────────────────────

function salary(save: PlayerSave): { total: number; stipend: number } {
  const stipend = save.meritSubject ? MERIT_STIPEND[save.meritSubject] : 0;
  return { total: save.rank * SALARY_PER_RANK + stipend, stipend };
}

/** Successor factions inherit 50% of favor (and a sole successor inherits alignment). */
function inheritFactions(content: ContentIndex, save: PlayerSave, next: ChapterId): void {
  const factions = content.chapters[next]?.factions ?? [];
  for (const faction of factions) {
    if (!faction.lineage || save.favor[faction.id] !== undefined) continue;
    const parent = save.favor[faction.lineage];
    if (parent !== undefined) save.favor[faction.id] = Math.round(parent * 0.5);
  }
  const aligned = save.aligned;
  if (aligned && !factions.some((faction) => faction.id === aligned)) {
    const heirs = factions.filter((faction) => faction.lineage === aligned);
    const [heir] = heirs;
    if (heir && heirs.length === 1) save.aligned = heir.id;
  }
}

/**
 * Advances save.year to the next chapter's start: applies activities and
 * small events, suspicion growth, salary, nation carry-over (hist baselines
 * and long flags), chapter counters reset, and successor takeover if the
 * lifespan ends. Returns result lines for the summary card.
 */
export function advanceYears(content: ContentIndex, save: PlayerSave, next: ChapterId, choice: YearsChoice): ResultView["lines"] {
  const target = content.chapters[next];
  if (!target) return [line("다음 시대를 찾을 수 없다", "bad")];
  const fromYear = save.year;
  const toYear = Math.max(fromYear, target.years[0]);
  const tokens = tokensBetween(fromYear, toYear);
  const battle = hadBattle(content, save);
  const current = content.chapters[save.chapter];
  const lines: Line[] = [line(`${fromYear}년 → ${toYear}년 · 세월이 흐른다 (${tokens}토큰)`, "info")];

  // Activities and small events, one per 10-year token.
  const chosen = Array.isArray(choice.activities) ? choice.activities : [];
  for (let index = 0; index < tokens; index++) {
    const salt = tokenSalt(fromYear, next, index);
    const decade = Math.min(toYear, fromYear + index * 10);
    const activity = chosen[index];
    lines.push(...runActivity(content, save, typeof activity === "string" ? activity : "martial", salt, `${decade}년~`));
    const event = smallEventAt(save.seed, fromYear, next, index);
    lines.push(...runSmallEvent(content, save, event, salt, Math.min(toYear, decade + 5)));
  }

  // Suspicion growth year by year.
  const suspicionBefore = save.suspicion;
  growSuspicion(save, fromYear, toYear);
  const band = suspicionBand(save.suspicion);
  lines.push(line(`의심도 ${suspicionBefore} → ${save.suspicion} (${BAND_NAMES[band]})`, band === "calm" ? "info" : "bad"));

  // Exile years, salary and promotion under the regime that is ending.
  if (save.exile) lines.push(line("유배지에서 세월을 견디다 — 녹봉 없음", "bad"));
  const pay = salary(save);
  if (save.flags["salarySuspended"]) {
    delete save.flags["salarySuspended"];
    if (pay.total > 0) lines.push(line("파직의 여파로 녹봉이 끊겼다", "bad"));
  } else if (!save.exile && pay.total > 0) {
    save.points.money += pay.total;
    lines.push(line(`녹봉 ${pay.total}전${pay.stipend > 0 ? ` (공신전 ${pay.stipend}전 포함)` : ""}`, "good"));
  }
  lines.push(...promote(save, current?.ruling).lines);

  // Nation carry-over and faction lineage.
  save.nation = carryNation(content, save, next);
  if (target.order < INFILTRATION_FROM_ORDER) save.infiltration = 0;
  inheritFactions(content, save, next);
  lines.push(line(`국운 이월 — ${(["defense", "finance", "people", "diplomacy", "reform"] as const).map((key) => `${nationName(key)} ${save.nation[key]}`).join(" · ")}`, "info"));

  // New chapter.
  save.step = 0;
  save.objectives = {};
  save.longevityUses = 0;
  save.offeredThisChapter = 0;
  delete save.position;
  save.year = toYear;
  save.chapter = next;

  if (choice.wash) {
    const blocked = WASH_METHODS[choice.wash] ? washBlocker(save, choice.wash, battle) : "알 수 없는 방법";
    if (blocked) lines.push(line(`신분 세탁 불가 — ${blocked}`, "bad"));
    else {
      const name = choice.newName?.trim() || suggestName(save, `wash:${choice.wash}:${toYear}:${save.record.washes}`);
      lines.push(...washIdentity(content, save, choice.wash, name));
    }
  }

  if (choice.offer) {
    const years = offerVirtue(save);
    if (years > 0) lines.push(line(`노인성 제단에 공덕을 바치다 — 천수 +${years}년 (${save.lifeEnd}년까지)`, "good"));
    const grace = graceAvailable(content, save, next);
    if (grace) lines.push(...applyGrace(save));
    if (years === 0 && !grace) lines.push(line("바칠 공덕이 모자라다", "info"));
  }

  if (suspicionBand(save.suspicion) === "exposed") {
    lines.push(line("정체가 드러났다! 쫓기듯 이름을 버린다", "bad"));
    lines.push(...washIdentity(content, save, "forced", suggestName(save, `forced:${toYear}:${save.record.washes}`)));
  }

  if (pastLifeEnd(save)) lines.push(...successorTakeover(content, save));
  return lines;
}

/**
 * Moves the in-chapter year forward (a step with a later year): suspicion
 * grows for the elapsed years and the successor takes over past lifeEnd.
 */
export function advanceStepYear(content: ContentIndex, save: PlayerSave, year: number): ResultView["lines"] {
  if (!Number.isFinite(year) || year <= save.year) return [];
  growSuspicion(save, save.year, year);
  save.year = Math.floor(year);
  return pastLifeEnd(save) ? successorTakeover(content, save) : [];
}
