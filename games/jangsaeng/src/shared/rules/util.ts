// Small shared helpers for the rules engine: deterministic rolls, clamps,
// display names and result-line formatting. Pure; no clocks, no Math.random.
import type { ContentIndex } from "../content/index.ts";
import type { NationMeter, PointKey, StatKey } from "../content/schema.ts";
import { NATION_NAMES, POINT_NAMES, STAT_NAMES } from "../content/schema.ts";
import { SITES } from "../map/geo.ts";
import { hashString } from "../rng.ts";
import type { PlayerSave, ResultView } from "../types.ts";

export type Line = ResultView["lines"][number];
export type Tone = Line["tone"];

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** murmur3 finaliser: spreads FNV-1a's weak low bits before the modulo. */
function mix32(input: number): number {
  let h = input >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 0..99 roll for (seed, id): reloading can never reroll. */
export function hashRoll(seed: number, id: string): number {
  return mix32(hashString(`${seed >>> 0}:${id}`)) % 100;
}

/** "+3" / "−3" with a true minus sign, as shown on result cards. */
export function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

export function toneOf(delta: number, positiveIsGood = true): Tone {
  if (delta === 0) return "info";
  return delta > 0 === positiveIsGood ? "good" : "bad";
}

export function line(text: string, tone: Tone = "info"): Line {
  return { text, tone };
}

/** JSON round-trip clone; PlayerSave is plain JSON data by contract. */
export function cloneSave(save: PlayerSave): PlayerSave {
  return JSON.parse(JSON.stringify(save)) as PlayerSave;
}

export function chronicle(save: PlayerSave, text: string, tone?: "info" | "good" | "bad" | "epic"): void {
  save.chronicle.push(tone ? { year: save.year, text, tone } : { year: save.year, text });
}

// ── Names ────────────────────────────────────────────────────────────────

/** The six fictional families whose bonds carry across generations. */
export const FAMILY_BONDS = ["smith", "merchant", "monk", "clerk", "interpreter", "disciple"] as const;
export type FamilyBond = (typeof FAMILY_BONDS)[number];

export const FAMILY_NAMES: Readonly<Record<FamilyBond, string>> = {
  smith: "대장장이 석가",
  merchant: "개성 송상 백가",
  monk: "보현사 노승 계보",
  clerk: "한양 아전 문가",
  interpreter: "사역원 역관 홍가",
  disciple: "무가 제자 계보",
};

/** Faction ids seeded by origins before any chapter defines them. */
const ORIGIN_FACTION_NAMES: Readonly<Record<string, string>> = { yi: "이성계파", choe: "최영파" };

export function factionName(content: ContentIndex, save: PlayerSave, id: string): string {
  const current = content.chapters[save.chapter]?.factions.find((faction) => faction.id === id);
  if (current) return current.name;
  for (const chapter of Object.values(content.chapters)) {
    const found = chapter.factions.find((faction) => faction.id === id);
    if (found) return found.name;
  }
  return ORIGIN_FACTION_NAMES[id] ?? id;
}

export function bondName(content: ContentIndex, id: string): string {
  if ((FAMILY_BONDS as readonly string[]).includes(id)) return FAMILY_NAMES[id as FamilyBond];
  for (const chapter of Object.values(content.chapters)) {
    const npc = chapter.npcs.find((candidate) => candidate.id === id);
    if (npc) return npc.name;
  }
  return id;
}

export function siteName(id: string): string {
  return SITES.find((site) => site.id === id)?.name ?? id;
}

export function itemName(content: ContentIndex, id: string): string {
  return content.items[id]?.name ?? id;
}

export function skillName(content: ContentIndex, id: string): string {
  if (id === content.longevity.id) return content.longevity.name;
  return content.skills[id]?.name ?? id;
}

export function statName(stat: StatKey): string {
  return STAT_NAMES[stat];
}

export function pointName(point: PointKey): string {
  return POINT_NAMES[point];
}

export function nationName(key: NationMeter): string {
  return NATION_NAMES[key];
}

export function numberFlag(save: PlayerSave, flag: string): number {
  const value = save.flags[flag];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function flagTruthy(value: unknown): boolean {
  return value !== undefined && value !== false && value !== 0 && value !== "";
}
