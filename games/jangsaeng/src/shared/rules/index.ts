// CONTRACT STUB — implemented by the rules pass. Pure functions over
// PlayerSave: no I/O, no clocks, no Math.random (use the save's seed with
// hashRoll for any chance). Signatures are fixed; add internal modules freely.
import type {
  BranchId,
  ChapterId,
  Cond,
  Effect,
  NationMeter,
  OriginId,
  PurgeSpec,
  StatKey,
  WashMethod,
} from "../content/schema.ts";
import type { ContentIndex } from "../content/index.ts";
import type { EndingResult, PlayerSave, ResultView, YearsPlanView } from "../types.ts";
import type { BodyVariant, CharacterSprite } from "../sprites.ts";

const todo = (name: string): never => {
  throw new Error(`rules.${name} not implemented`);
};

// ── Creation, migration, derived stats ───────────────────────────────────

export interface CreateOptions {
  token: string;
  name: string;
  variant: BodyVariant;
  origin: OriginId;
  seed: number;
  /** Demo mode: start at this chapter with a balanced preset build. */
  demoChapter?: ChapterId;
}

export function createSave(content: ContentIndex, options: CreateOptions): PlayerSave {
  return todo(`createSave ${String(content)} ${String(options)}`);
}

/** Validates and upgrades untrusted stored JSON; null when unusable. */
export function migrateSave(content: ContentIndex, raw: unknown): PlayerSave | null {
  return todo(`migrateSave ${String(content)} ${String(raw)}`);
}

export interface Derived {
  maxHp: number;
  maxEnergy: number;
  energyRegen: number;
  moveSpeed: number;
  critChance: number;
  /** Damage multipliers (1 = base). */
  melee: number;
  bow: number;
  skill: number;
  weaponAtk: number;
  armorDef: number;
  /** Seconds a downed player waits for revive. */
  downSeconds: number;
}

export function derived(content: ContentIndex, save: PlayerSave): Derived {
  return todo(`derived ${String(content)} ${String(save)}`);
}

export function expToNext(level: number): number {
  return todo(`expToNext ${level}`);
}

/** Adds exp, levels up (cap 40), grants 2 free points per level. */
export function grantExp(save: PlayerSave, amount: number): { levels: number } {
  return todo(`grantExp ${String(save)} ${amount}`);
}

export function allocatePoint(save: PlayerSave, stat: StatKey): boolean {
  return todo(`allocatePoint ${String(save)} ${stat}`);
}

/** Sprite for the hero from era, rank, identity and disguise. */
export function heroSprite(save: PlayerSave): CharacterSprite {
  return todo(`heroSprite ${String(save)}`);
}

// ── Conditions and effects ───────────────────────────────────────────────

export function evalCond(content: ContentIndex, save: PlayerSave, cond: Cond | undefined): boolean {
  return todo(`evalCond ${String(content)} ${String(save)} ${String(cond)}`);
}

/** Runtime work the session must perform after pure state changes. */
export interface EffectOutcome {
  prompts: string[];
  battles: string[];
  objectives: string[];
  goto?: { site: string; offset?: readonly [number, number] };
  worldEvent: number;
  toasts: { text: string; tone: "info" | "good" | "bad" | "warn" | "epic" }[];
  /** Human-readable result lines for a result card. */
  lines: ResultView["lines"];
  levelsGained: number;
  /** An identity wash happened (session must rename the entity). */
  washed: boolean;
  /** Purge produced a death sentence crisis: session starts the escape battle. */
  escape: boolean;
}

/** Applies effects in order, mutating `save`. Deterministic for a save seed. */
export function applyEffects(
  content: ContentIndex,
  save: PlayerSave,
  effects: readonly Effect[],
): EffectOutcome {
  return todo(`applyEffects ${String(content)} ${String(save)} ${String(effects)}`);
}

/** Deterministic 0..99 roll for (save.seed, id). */
export function hashRoll(seed: number, id: string): number {
  return todo(`hashRoll ${seed} ${id}`);
}

// ── Politics ─────────────────────────────────────────────────────────────

/** Purge risk R (5..95) for a spec, optionally after hypothetical effects. */
export function purgeRisk(
  content: ContentIndex,
  save: PlayerSave,
  spec: PurgeSpec,
  preview?: readonly Effect[],
): number {
  return todo(`purgeRisk ${String(content)} ${String(save)} ${String(spec)} ${String(preview)}`);
}

export function rankName(rank: number, year: number): { grade: string; office: string } {
  return todo(`rankName ${rank} ${year}`);
}

/** Promotes while merit allows (and senior ranks need ruling favor ≥ 30). */
export function checkPromotion(content: ContentIndex, save: PlayerSave, ruling: string | undefined): number {
  return todo(`checkPromotion ${String(content)} ${String(save)} ${String(ruling)}`);
}

// ── Life, suspicion, identity ────────────────────────────────────────────

export function apparentAge(year: number): number {
  return todo(`apparentAge ${year}`);
}

export function suspicionBand(value: number): "calm" | "rumour" | "inquiry" | "exposed" {
  return todo(`suspicionBand ${value}`);
}

/** Converts virtue into lifespan (100 → +1 year, max 5 per chapter). */
export function offerVirtue(save: PlayerSave): number {
  return todo(`offerVirtue ${String(save)}`);
}

/** Adds or removes lifespan years and records gained/spent totals. */
export function changeLife(save: PlayerSave, years: number): void {
  return todo(`changeLife ${String(save)} ${years}`);
}

export function washIdentity(
  content: ContentIndex,
  save: PlayerSave,
  method: WashMethod | "forced",
  newName: string,
): ResultView["lines"] {
  return todo(`washIdentity ${String(content)} ${String(save)} ${method} ${newName}`);
}

/** A plausible period name for a new identity, deterministic per save. */
export function suggestName(save: PlayerSave, salt: string): string {
  return todo(`suggestName ${String(save)} ${salt}`);
}

// ── Passage of years ─────────────────────────────────────────────────────

/** Planner view for the years between the current chapter and `next`. */
export function yearsPlan(content: ContentIndex, save: PlayerSave, next: ChapterId): YearsPlanView {
  return todo(`yearsPlan ${String(content)} ${String(save)} ${next}`);
}

export interface YearsChoice {
  /** One activity id per 10-year token. */
  activities: string[];
  wash?: WashMethod;
  newName?: string;
  offer: boolean;
}

/**
 * Advances save.year to the next chapter's start: applies activities and
 * small events, suspicion growth, salary, nation carry-over (hist baselines
 * and long flags), chapter counters reset, and successor takeover if the
 * lifespan ends. Returns result lines for the summary card.
 */
export function advanceYears(
  content: ContentIndex,
  save: PlayerSave,
  next: ChapterId,
  choice: YearsChoice,
): ResultView["lines"] {
  return todo(`advanceYears ${String(content)} ${String(save)} ${next} ${String(choice)}`);
}

// ── Nation and endings ───────────────────────────────────────────────────

export function nationValue(save: PlayerSave, key: NationMeter): number {
  return todo(`nationValue ${String(save)} ${key}`);
}

export const BRANCH_LABELS: Readonly<Record<BranchId, string>> = {
  B1: "장용영 유지 (1800)",
  B2: "삼정 개혁 유지 (1862)",
  B3: "주체적 개항 교섭 (1866~75)",
  B4: "강화도조약 조항 (1876)",
  B5: "군란 예방 (1882)",
  B6: "온건 개혁 연합 (1884)",
  B7: "중립화 외교 (1885~87)",
  B8: "차병 반대·폐정 개혁 (1894)",
  B9: "만민공동회·의회 (1898)",
  B10: "재정 일원화·상비군 (1899~1904)",
  B11: "중립 실효 (1904)",
  B12a: "열강 사전 외교 (1905)",
  B12b: "중명전 수호 (1905)",
  B12c: "군대 해산 저지 (1907)",
};

export function computeEnding(content: ContentIndex, save: PlayerSave): EndingResult {
  return todo(`computeEnding ${String(content)} ${String(save)}`);
}
