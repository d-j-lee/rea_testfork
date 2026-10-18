// Passage of years between chapters (세월 흐르기, GDD §5.7). advanceYears
// follows the fixed processing order of §5.7.2.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterId, Effect, WashMethod } from "../content/schema.ts";
import type { PlayerSave, ResultView, YearsPlanView } from "../types.ts";
import { applyEffectsInto, emptyOutcome } from "./effects.ts";
import {
  BAND_NAMES,
  changeSuspicion,
  growSuspicion,
  suggestName,
  suspicionBand,
  suspicionDelta,
  washBlocker,
  washCost,
  washIdentity,
  WASH_METHODS,
} from "./identity.ts";
import { applyGrace, applyResonance, graceAvailable, GRACE_YEARS, offerableYears, offerVirtue } from "./lifespan.ts";
import { carryNation, closeChapterBranches, INFILTRATION_FROM_ORDER } from "./nation.ts";
import { promote, refreshEraGear } from "./progression.ts";
import { pastLifeEnd, successorTakeover } from "./succession.ts";
import {
  FAMILY_BONDS,
  hashRoll,
  hasSchool,
  isFamilyBond,
  line,
  nationName,
  round1,
  statName,
  type Line,
} from "./util.ts";

export interface YearsChoice {
  /** One activity id per token of the era. */
  activities: string[];
  wash?: WashMethod;
  newName?: string;
  /** 노인성 봉헌: 100 공덕 a year, up to this chapter's allowance. */
  offer: boolean;
  /** 노인성의 마지막 은혜: taken only when the player asks for it (never by the offering). */
  grace?: boolean;
}

export const SALARY_PER_RANK = 40;
export const WASH_ADVISED_AT = 60;
export const MAX_TOKENS = 5;
const WASH_ORDER: readonly WashMethod[] = ["descendant", "fakeDeath", "monk", "merchant", "exam"];

/** §5.7.1: clamp(ceil((next start − current start) / 15), 1, 5). */
export function tokensBetween(currentStart: number, nextStart: number): number {
  return Math.min(MAX_TOKENS, Math.max(1, Math.ceil((nextStart - currentStart) / 15)));
}

/** The era the tokens stand for: this chapter's start to the next chapter's start (§5.7.1). */
function eraOf(content: ContentIndex, save: PlayerSave, next: ChapterId): { from: number; to: number } {
  const from = content.chapters[save.chapter]?.years[0] ?? save.year;
  return { from, to: Math.max(from, content.chapters[next]?.years[0] ?? from) };
}

function tokensFor(content: ContentIndex, save: PlayerSave, next: ChapterId): number {
  const era = eraOf(content, save, next);
  return tokensBetween(era.from, era.to);
}

/** Splits the era into `tokens` consecutive spans (one per 세월 token). */
export function tokenSpans(from: number, to: number, tokens: number): YearsPlanView["spans"] {
  const length = Math.max(0, to - from);
  return Array.from({ length: tokens }, (_, index) => ({
    from: from + Math.round((length * index) / tokens),
    to: from + Math.round((length * (index + 1)) / tokens),
  }));
}

function commerceGain(save: PlayerSave): number {
  const merchants = (save.bonds["baek_house"] ?? 0) >= 60 ? 1.2 : 1;
  return Math.round(400 * (1 + save.stats.tact / 50) * merchants);
}

/** The strongest 열전 (historical) bond, for 인맥 쌓기. */
function topHistoricalBond(save: PlayerSave): string | undefined {
  let best: string | undefined;
  let bestValue = -1;
  for (const id of Object.keys(save.bonds).sort()) {
    const value = save.bonds[id] ?? 0;
    if (!isFamilyBond(id) && value > bestValue) {
      best = id;
      bestValue = value;
    }
  }
  return best;
}

// ── Activities (§5.7.3) ──────────────────────────────────────────────────

export interface ActivityDef {
  id: string;
  name: string;
  desc: string;
  /** Planner hint for this save. */
  effect: (save: PlayerSave) => string;
  blocker?: (save: PlayerSave) => string | undefined;
  /** Pure effects for one token. */
  effects: (save: PlayerSave, ruling: string | undefined) => Effect[];
  /** Changes with no Effect kind (free points, bond decay); returns notes. */
  extra?: (save: PlayerSave) => string[];
}

export const ACTIVITIES: readonly ActivityDef[] = [
  {
    id: "train", name: "무예 수련", desc: "산과 들에서 칼과 활을 갈고닦는다.", effect: () => "자유 포인트 +2",
    effects: () => [],
    extra: (save) => {
      save.freePoints += 2;
      return ["자유 포인트 +2"];
    },
  },
  {
    id: "seclusion", name: "산중 수행", desc: "깊은 산에 들어 세상과 인연을 끊고 기를 기른다.",
    effect: () => "천수 +1년 · 의심도 −12 · 인연 −5%",
    effects: () => [{ k: "life", add: 1 }, { k: "suspicion", add: -12 }],
    extra: (save) => {
      for (const [id, value] of Object.entries(save.bonds)) save.bonds[id] = Math.round(value * 0.95);
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
    effect: (save) => `공적 +40 · 전 +${20 * save.rank} · 총애 +5 · 의심도 +4`,
    blocker: (save) => (save.rank >= 1 ? undefined : "관직이 없다"),
    effects: (save, ruling) => [
      { k: "point", point: "merit", add: 40 },
      { k: "point", point: "money", add: 20 * save.rank },
      ...(ruling ? [{ k: "favor", faction: ruling, add: 5 } as const] : []),
      { k: "suspicion", add: 4 },
    ],
  },
  {
    id: "study", name: "학문", desc: "경서와 병서를 읽는다.", effect: () => "지략 +2",
    effects: () => [{ k: "stat", stat: "wit", add: 2 }],
  },
  {
    id: "charity", name: "선행·구휼", desc: "굶주린 이웃에게 곡식을 나눈다.", effect: () => "공덕 +60 · 민심 +1 · 전 −150",
    blocker: (save) => (save.points.money >= 150 ? undefined : "전 150이 필요하다"),
    effects: () => [
      { k: "point", point: "money", add: -150 },
      { k: "point", point: "virtue", add: 60 },
      { k: "nation", key: "people", add: 1 },
    ],
  },
  {
    id: "network", name: "인맥 쌓기", desc: "오랜 가문과 옛 벗을 찾아 정을 잇는다.", effect: () => "가문 인연 3가 +8 · 가장 깊은 열전 인연 +5",
    effects: (save) => {
      const top = topHistoricalBond(save);
      return [
        ...FAMILY_BONDS.map((family) => ({ k: "bond", npc: family, add: 8 }) as const),
        ...(top ? [{ k: "bond", npc: top, add: 5 } as const] : []),
      ];
    },
  },
  {
    id: "disciple", name: "제자 양성", desc: "유파의 제자를 길러 낸다.", effect: () => "제자 경험 +1",
    blocker: (save) => (hasSchool(save) ? undefined : "유파를 세운 뒤에 가능하다"),
    effects: () => [{ k: "disciple", add: 1 }],
  },
];

/** Runs one token; a blocked or unknown activity falls back to 무예 수련. */
function runActivity(content: ContentIndex, save: PlayerSave, id: string, label: string): { lines: Line[]; ran: string } {
  const def = ACTIVITIES.find((activity) => activity.id === id);
  const blocked = def ? def.blocker?.(save) : "알 수 없는 활동";
  const chosen = def && !blocked ? def : (ACTIVITIES[0] as ActivityDef);
  const out = emptyOutcome();
  applyEffectsInto(content, save, chosen.effects(save, content.chapters[save.chapter]?.ruling), out);
  const notes = chosen.extra?.(save) ?? [];
  const detail = [...out.lines.map((entry) => entry.text), ...notes].join(" · ");
  const prefix = blocked ? `${label} · ${def?.name ?? id} 불가(${blocked}) → ${chosen.name}` : `${label} · ${chosen.name}`;
  return { lines: [line(detail ? `${prefix} — ${detail}` : prefix, "info")], ran: chosen.id };
}

// ── Small events (§5.7.4) ────────────────────────────────────────────────

export interface SmallEventContext {
  /** Roll id prefix `yrs:<chapter>:<index>`. */
  id: string;
  /** Activity actually run for this token. */
  activity: string;
  ruling: string | undefined;
}

export interface SmallEvent {
  kind: number;
  name: string;
  intro: string;
  effects: (save: PlayerSave, context: SmallEventContext) => Effect[];
}

const statCheck = (id: string, label: string, stat: "agility" | "power", success: Effect[], failure: Effect[]): Effect => ({
  k: "check", id: `${id}:check`, label: `${label}(${statName(stat)})`, stat, base: 50, per: 1, success, failure,
});

export const SMALL_EVENTS: readonly SmallEvent[] = [
  {
    kind: 0, name: "역병", intro: "역병이 고을을 휩쓸었다.",
    effects: (_save, context) => (context.activity === "charity"
      ? [{ k: "point", point: "virtue", add: 30 }]
      : [{ k: "life", add: -1 }]),
  },
  {
    kind: 1, name: "흉년", intro: "가뭄 끝에 흉년이 들었다.",
    effects: (_save, context) => [
      { k: "nation", key: "people", add: -1 },
      ...(context.activity === "charity" ? [{ k: "point", point: "virtue", add: 60 } as const] : []),
    ],
  },
  {
    kind: 2, name: "호환", intro: "범이 마을을 덮쳤다.",
    effects: (_save, context) => [statCheck(context.id, "호환", "agility", [{ k: "item", item: "ginseng", add: 1 }], [{ k: "life", add: -1 }])],
  },
  {
    kind: 3, name: "혼담", intro: "이웃 가문에서 혼담이 들어왔다.",
    effects: (save, context) => [
      { k: "bond", npc: FAMILY_BONDS[hashRoll(save.seed, `${context.id}:family`) % FAMILY_BONDS.length] ?? "han_house", add: 10 },
      { k: "point", point: "virtue", add: 10 },
    ],
  },
  {
    kind: 4, name: "도적", intro: "고갯길에 도적 떼가 나타났다.",
    effects: (save, context) => (save.points.money >= 1000
      ? [statCheck(context.id, "도적", "power",
        [{ k: "point", point: "merit", add: 20 }],
        [{ k: "point", point: "money", add: -Math.round(save.points.money * 0.15) }])]
      : []),
  },
  { kind: 5, name: "화원의 초상화", intro: "화원이 그린 초상이 저잣거리에 나돌았다.", effects: () => [{ k: "suspicion", add: 10 }] },
  { kind: 6, name: "옛 벗의 방문", intro: "한씨 가문의 옛 벗이 찾아왔다.", effects: () => [{ k: "bond", npc: "han_house", add: 10 }] },
  {
    kind: 7, name: "귀인", intro: "길에서 귀인을 만났다.",
    effects: (save) => [{ k: "stat", stat: save.stats.tact < save.stats.wit ? "tact" : "wit", add: 1 }],
  },
  {
    kind: 8, name: "산삼 발견", intro: "깊은 골짜기에서 붉은 열매를 보았다.",
    effects: (_save, context) => (context.activity === "train" || context.activity === "seclusion"
      ? [{ k: "item", item: "ginseng", add: 1 }]
      : [{ k: "point", point: "money", add: 50 }]),
  },
  {
    kind: 9, name: "왕실 행차 호위", intro: "임금의 행차를 호위했다.",
    effects: (_save, context) => [
      { k: "point", point: "merit", add: 20 },
      ...(context.ruling ? [{ k: "favor", faction: context.ruling, add: 3 } as const] : []),
    ],
  },
];

export const SMALL_EVENT_CHANCE = 30;

/** The small event (if any) token `index` rolls when leaving `chapter`. */
export function smallEventAt(seed: number, chapter: ChapterId, index: number): SmallEvent | undefined {
  const id = `yrs:${chapter}:${index}`;
  if (hashRoll(seed, id) >= SMALL_EVENT_CHANCE) return undefined;
  return SMALL_EVENTS[hashRoll(seed, `${id}:k`) % SMALL_EVENTS.length];
}

function runSmallEvent(content: ContentIndex, save: PlayerSave, chapter: ChapterId, index: number, activity: string): Line[] {
  const event = smallEventAt(save.seed, chapter, index);
  if (!event) return [];
  const context = { id: `yrs:${chapter}:${index}`, activity, ruling: content.chapters[chapter]?.ruling };
  const out = emptyOutcome();
  applyEffectsInto(content, save, event.effects(save, context), out);
  const detail = out.lines.map((entry) => entry.text).join(" · ");
  const tone = out.lines.some((entry) => entry.tone === "bad") ? "bad" : out.lines.length > 0 ? "good" : "info";
  return [line(`${event.name} — ${event.intro}${detail ? ` ${detail}` : ""}`, tone)];
}

// ── Planner ──────────────────────────────────────────────────────────────

function washDesc(save: PlayerSave, method: WashMethod): string {
  const spec = WASH_METHODS[method];
  const cost = spec.cost === "all" ? "재산 전부" : washCost(save, method) === 0 ? "비용 면제" : `${washCost(save, method)}전`;
  return `${cost} · 세탁 후 의심도 ${spec.suspicion} · ${spec.desc}`;
}

/** Suspicion at the next chapter if nothing changed it, for the wash advice. */
function projectedSuspicion(save: PlayerSave, toYear: number): number {
  let value = save.suspicion;
  for (let year = save.year + 1; year <= toYear; year++) value = Math.min(100, value + suspicionDelta(save, year));
  return round1(value);
}

/**
 * Planner view for the years between the current chapter and `next`. The
 * tokens stand for the whole era (chapter start → next start, §5.7.1), so the
 * view carries those spans and the copy; fromYear → toYear is only what the
 * year counter still has to move. `suggested` is the plan a plain confirm or a
 * demo skip submits: the first open activity, and the offering whenever it adds
 * years. The last grace is offered (`graceYears`) but never suggested.
 */
export function yearsPlan(content: ContentIndex, save: PlayerSave, next: ChapterId): YearsPlanView {
  const toYear = Math.max(save.year, content.chapters[next]?.years[0] ?? save.year);
  const era = eraOf(content, save, next);
  const tokens = tokensBetween(era.from, era.to);
  const washes: YearsPlanView["washes"] = [];
  for (const method of WASH_ORDER) {
    const blocked = washBlocker(save, method);
    if (WASH_METHODS[method].needsWar && blocked && blocked.startsWith("전쟁")) continue;
    const view = { id: method, name: WASH_METHODS[method].name, desc: washDesc(save, method) };
    washes.push(blocked ? { ...view, disabled: blocked } : view);
  }
  const activities = ACTIVITIES.map((activity): YearsPlanView["activities"][number] => {
    const disabled = activity.blocker?.(save);
    const view = { id: activity.id, name: activity.name, desc: activity.desc, effect: activity.effect(save) };
    return disabled ? { ...view, disabled } : view;
  });
  const firstOpen = activities.find((activity) => !activity.disabled)?.id ?? (ACTIVITIES[0] as ActivityDef).id;
  const canOffer = offerableYears(save);
  const plan: YearsPlanView = {
    type: "years",
    fromYear: save.year,
    toYear,
    eraFrom: era.from,
    eraTo: era.to,
    tokens,
    spans: tokenSpans(era.from, era.to, tokens),
    summary: `${era.from}~${era.to}년, 이 시대를 어떻게 보냈나 · ${tokens}마디`,
    activities,
    washes,
    washAdvised: save.suspicion >= WASH_ADVISED_AT || projectedSuspicion(save, toYear) >= 90,
    lifeEnd: save.lifeEnd,
    virtue: save.points.virtue,
    canOffer,
    suggested: { activities: Array.from({ length: tokens }, () => firstOpen), offer: canOffer > 0 },
  };
  if (graceAvailable(content, save, next)) plan.graceYears = GRACE_YEARS;
  return plan;
}

// ── Advance ──────────────────────────────────────────────────────────────

/** Successor factions start at 50% of their lineage's favor (kept if already set). */
function inheritFactions(content: ContentIndex, save: PlayerSave, next: ChapterId): void {
  for (const faction of content.chapters[next]?.factions ?? []) {
    if (!faction.lineage || save.favor[faction.id] !== undefined) continue;
    const parent = save.favor[faction.lineage];
    if (parent !== undefined) save.favor[faction.id] = Math.round(parent * 0.5);
  }
}

/**
 * Advances save.year to the next chapter's start in the §5.7.2 order:
 * 1 salary (and promotion at the chapter's settlement), 2 activities and small
 * events, 3 wash, 4 동료 보증, 5 노인성 감응, offering and (when chosen) the
 * last grace, 6 yearly suspicion, 8 the chapter's undecided branches fail, then
 * nation carry-over, 9 chapter counters reset, 10 successor, 11 forced wash or
 * inquiry, 12 era gear. (7, farewell cards, is the session's.)
 */
export function advanceYears(content: ContentIndex, save: PlayerSave, next: ChapterId, choice: YearsChoice): ResultView["lines"] {
  const target = content.chapters[next];
  if (!target) return [line("다음 시대를 찾을 수 없다", "bad")];
  const leaving = save.chapter;
  const fromYear = save.year;
  const toYear = Math.max(fromYear, target.years[0]);
  const tokens = tokensFor(content, save, next);
  const lines: Line[] = [line(`${fromYear}년 → ${toYear}년 · 세월이 흐른다 (${tokens}토큰)`, "info")];

  // 1. Salary, then promotion under the regime that is ending.
  const pay = SALARY_PER_RANK * save.rank;
  if (save.exile) lines.push(line("유배지에서 세월을 견디다 — 녹봉 없음", "bad"));
  else if (save.flags["salarySuspended"] === true) {
    if (pay > 0) lines.push(line("파직의 여파로 녹봉이 끊겼다", "bad"));
  } else if (pay > 0) {
    save.points.money += pay;
    lines.push(line(`녹봉 ${pay}전`, "good"));
  }
  delete save.flags["salarySuspended"];
  lines.push(...promote(save, content.chapters[leaving]?.ruling).lines);

  // 2. Activities and small events, one per token.
  const chosen = Array.isArray(choice.activities) ? choice.activities : [];
  for (let index = 0; index < tokens; index++) {
    const wanted = chosen[index];
    const { lines: activityLines, ran } = runActivity(content, save, typeof wanted === "string" ? wanted : "train", `${index + 1}번째 세월`);
    lines.push(...activityLines);
    lines.push(...runSmallEvent(content, save, leaving, index, ran));
  }

  // 3. Wash.
  if (choice.wash) {
    const blocked = washBlocker(save, choice.wash);
    if (blocked) lines.push(line(`신분 세탁 불가 — ${blocked}`, "bad"));
    else {
      const name = choice.newName?.trim() || suggestName(save, `wash:${choice.wash}:${save.year}:${save.record.washes}`);
      lines.push(...washIdentity(content, save, choice.wash, name));
    }
  }

  // 4. 동료 보증.
  if (save.flags["vouch"] === true) {
    const delta = changeSuspicion(save, -10);
    lines.push(line(`동료 보증 — 함께 싸운 장생인이 새 신분을 증언했다 (의심도 ${delta === 0 ? "0" : `−${Math.abs(delta)}`})`, "good"));
  }

  // 5. 노인성 감응, then the offering, then the last grace when the player asked for it.
  lines.push(...applyResonance(save, leaving));
  if (choice.offer) {
    const years = offerVirtue(save);
    lines.push(years > 0
      ? line(`노인성 제단에 공덕을 바치다 — 천수 +${years}년 (${save.lifeEnd}년까지)`, "good")
      : line("바칠 공덕이 모자라다", "info"));
  }
  if (choice.grace === true) {
    lines.push(...(graceAvailable(content, save, next)
      ? applyGrace(save)
      : [line("노인성의 마지막 은혜는 지금 받을 수 없다", "info")]));
  }

  // 6. Years pass one by one.
  const suspicionBefore = save.suspicion;
  growSuspicion(save, fromYear, toYear);
  save.year = toYear;
  const band = suspicionBand(save.suspicion);
  lines.push(line(`의심도 ${suspicionBefore} → ${save.suspicion} (${BAND_NAMES[band]})`, band === "calm" ? "info" : "bad"));

  // 8. The chapter's undecided branches fail (so infiltration holds what the
  // ending charges), then nation carry-over and faction lineage.
  closeChapterBranches(save, leaving);
  save.nation = carryNation(content, save, next);
  if (target.order < INFILTRATION_FROM_ORDER) save.infiltration = 0;
  inheritFactions(content, save, next);
  lines.push(line(`국운 이월 — ${(["defense", "finance", "people", "diplomacy", "reform"] as const).map((key) => `${nationName(key)} ${save.nation[key]}`).join(" · ")}`, "info"));

  // 9. Chapter counters.
  save.chapter = next;
  save.step = 0;
  save.objectives = {};
  save.pending = [];
  save.longevityUses = 0;
  save.offeredThisChapter = 0;
  save.aligned = null;
  delete save.position;
  for (const flag of ["freeReviveUsed", "vouch", "escaped"]) delete save.flags[flag];

  // 10. Lifespan.
  if (pastLifeEnd(save)) lines.push(...successorTakeover(content, save));

  // 11. Suspicion bands.
  lines.push(...settleSuspicion(content, save));

  // 12. Era gear.
  lines.push(...refreshEraGear(content, save));
  return lines;
}

/**
 * §5.4.3 band consequences once years have passed (between chapters and at an
 * in-chapter year jump): exposed → forced flight wash at once; inquiry → flag
 * `inquiry`, which the session turns into the 사헌부 card at the next story beat.
 */
export function settleSuspicion(content: ContentIndex, save: PlayerSave): Line[] {
  const band = suspicionBand(save.suspicion);
  if (band === "exposed") {
    return [
      line("정체가 드러났다! 쫓기듯 이름을 버린다", "bad"),
      ...washIdentity(content, save, "forced", suggestName(save, `forced:${save.year}:${save.record.washes}`)),
    ];
  }
  if (band === "inquiry" && save.flags["inquiry"] !== true) {
    save.flags["inquiry"] = true;
    return [line("사헌부가 그대의 내력을 캐기 시작했다 — 곧 조사가 닥친다", "bad")];
  }
  return [];
}

/**
 * In-chapter year change (a step with a later year): suspicion grows for the
 * elapsed years, the successor takes over past lifeEnd, then the bands settle.
 */
export function advanceStepYear(content: ContentIndex, save: PlayerSave, toYear: number): ResultView["lines"] {
  if (!Number.isFinite(toYear) || toYear <= save.year) return [];
  growSuspicion(save, save.year, toYear);
  save.year = Math.floor(toYear);
  const lines = pastLifeEnd(save) ? successorTakeover(content, save) : [];
  lines.push(...settleSuspicion(content, save));
  return lines;
}
