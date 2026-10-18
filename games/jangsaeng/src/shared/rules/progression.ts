// Levels, stats, derived combat numbers, sprite choice, ranks, gear and
// skills. Formulas follow GDD §4.1 / §4.5.
import type { ContentIndex } from "../content/index.ts";
import { gradeName, officeTitle } from "../content/people.ts";
import type { StatKey } from "../content/schema.ts";
import { STAT_KEYS } from "../content/schema.ts";
import type { CharacterSprite } from "../sprites.ts";
import type { PlayerSave } from "../types.ts";
import { chronicle, clamp, line, skillName, type Line } from "./util.ts";

export const LEVEL_CAP = 40;
export const STAT_CAP = 99;
export const RANK_CAP = 18;
/** Rank step from which a post is 당상관 (needs ruling-faction favor). */
export const SENIOR_RANK = 14;
export const SKILL_SLOTS = 4;
export const POINTS_PER_LEVEL = 2;
export const DEFAULT_WEAPON = "rusty_hwando";
export const DEFAULT_ARMOR = "cotton_clothes";

export function expToNext(level: number): number {
  return Math.round(50 + 25 * Math.max(1, level) ** 1.5);
}

/** Adds exp, levels up (cap 40), grants 2 free points per level. */
export function grantExp(save: PlayerSave, amount: number): { levels: number } {
  if (!Number.isFinite(amount) || amount <= 0) return { levels: 0 };
  let levels = 0;
  save.exp += Math.round(amount);
  while (save.level < LEVEL_CAP && save.exp >= expToNext(save.level)) {
    save.exp -= expToNext(save.level);
    save.level += 1;
    save.freePoints += POINTS_PER_LEVEL;
    levels += 1;
  }
  if (save.level >= LEVEL_CAP) save.exp = Math.min(save.exp, expToNext(LEVEL_CAP));
  return { levels };
}

export function allocatePoint(save: PlayerSave, stat: StatKey): boolean {
  if (!(STAT_KEYS as readonly string[]).includes(stat)) return false;
  if (save.freePoints <= 0 || save.stats[stat] >= STAT_CAP) return false;
  save.stats[stat] += 1;
  save.freePoints -= 1;
  return true;
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
  const { power, agility, body, spirit } = save.stats;
  return {
    maxHp: 60 + 10 * body + 5 * save.level,
    maxEnergy: 100,
    energyRegen: 3 + 0.1 * spirit,
    moveSpeed: 4.0 * (1 + Math.min(0.2, 0.004 * agility)),
    critChance: 0.05 + 0.003 * agility,
    melee: 1 + 0.025 * power,
    bow: 1 + 0.025 * agility,
    skill: 1 + 0.02 * spirit,
    weaponAtk: content.items[save.equipment.weapon]?.atk ?? 0,
    armorDef: content.items[save.equipment.armor]?.def ?? 0,
    downSeconds: 10 + 0.1 * body,
  };
}

/**
 * Sprite for the hero from identity, cause, era, rank and disguise. A monk
 * keeps the robe (승병 fought in it); a hero who joined the 의병 wears its
 * dress over any rank; after 1895 an officer wears modern uniform.
 */
export function heroSprite(save: PlayerSave): CharacterSprite {
  if (save.identity.kind === "monk") return "hero_hermit";
  if (save.flags["righteous"] !== undefined && save.flags["righteous"] !== false) return "hero_righteous";
  if (save.year >= 1895 && save.rank >= 1) return "hero_modern";
  if (save.identity.kind === "merchant" || (save.rank === 0 && save.year >= 1392)) return "hero_disguise";
  if (save.rank >= SENIOR_RANK) return "hero_official";
  if (save.year < 1392) return save.level < 8 ? "hero_youth" : "hero_goryeo_officer";
  return "hero_joseon_general";
}

// ── Ranks ────────────────────────────────────────────────────────────────

export function rankName(rank: number, year: number): { grade: string; office: string } {
  const step = clamp(Math.floor(rank), 0, RANK_CAP);
  return { grade: gradeName(step), office: officeTitle(step, year) };
}

export function rankLabel(rank: number, year: number): string {
  const { grade, office } = rankName(rank, year);
  return rank <= 0 ? "무품" : `${grade} ${office}`;
}

export function setRank(save: PlayerSave, rank: number): void {
  save.rank = clamp(Math.round(rank), 0, RANK_CAP);
}

/**
 * Promotes while merit ≥ 25 × (rank+1); steps from 당상관 (14) up also need
 * ruling-faction favor ≥ 30. Merit is a threshold, not spent.
 */
export function promote(save: PlayerSave, ruling: string | undefined): { steps: number; lines: Line[] } {
  const before = save.rank;
  while (save.rank < RANK_CAP && save.points.merit >= 25 * (save.rank + 1)) {
    const target = save.rank + 1;
    if (target >= SENIOR_RANK && (ruling === undefined || (save.favor[ruling] ?? 0) < 30)) break;
    save.rank = target;
  }
  const steps = save.rank - before;
  if (steps === 0) return { steps, lines: [] };
  const label = rankLabel(save.rank, save.year);
  chronicle(save, `${label}에 오르다.`, save.rank >= SENIOR_RANK ? "epic" : "good");
  return { steps, lines: [line(`품계 승진 — ${label}`, save.rank >= SENIOR_RANK ? "epic" : "good")] };
}

/** Promotes while merit allows (and senior ranks need ruling favor ≥ 30). */
export function checkPromotion(content: ContentIndex, save: PlayerSave, ruling: string | undefined): number {
  void content;
  return promote(save, ruling).steps;
}

// ── Gear and skills ──────────────────────────────────────────────────────

function bestOwned(content: ContentIndex, save: PlayerSave, kind: "weapon" | "armor"): string | undefined {
  let best: string | undefined;
  let bestValue = -Infinity;
  for (const [id, count] of Object.entries(save.inventory)) {
    const item = content.items[id];
    if (!item || item.kind !== kind || count <= 0) continue;
    const value = (kind === "weapon" ? item.atk : item.def) ?? 0;
    if (value > bestValue) {
      best = id;
      bestValue = value;
    }
  }
  return best;
}

/** Keeps a valid weapon and armor equipped, falling back to the best owned or the default. */
export function ensureEquipment(content: ContentIndex, save: PlayerSave): void {
  for (const kind of ["weapon", "armor"] as const) {
    const current = save.equipment[kind];
    const def = content.items[current];
    if (def && def.kind === kind && (save.inventory[current] ?? 0) > 0) continue;
    const fallback = bestOwned(content, save, kind) ?? (kind === "weapon" ? DEFAULT_WEAPON : DEFAULT_ARMOR);
    save.equipment[kind] = fallback;
    if ((save.inventory[fallback] ?? 0) <= 0) save.inventory[fallback] = 1;
  }
}

/** Adds (or removes, for negative counts) items; stronger new gear is equipped. */
export function changeItem(content: ContentIndex, save: PlayerSave, id: string, add: number): Line[] {
  const item = content.items[id];
  const count = Math.round(add);
  if (!item || count === 0) return [];
  const lines: Line[] = [];
  const before = save.inventory[id] ?? 0;
  const after = Math.max(0, before + count);
  if (after > 0) save.inventory[id] = after;
  else delete save.inventory[id];
  if (count > 0) {
    lines.push(line(count > 1 ? `${item.name} ×${count} 획득` : `${item.name} 획득`, "good"));
    if (item.kind === "weapon" || item.kind === "armor") {
      const slot = item.kind;
      const current = content.items[save.equipment[slot]];
      const currentValue = (slot === "weapon" ? current?.atk : current?.def) ?? -1;
      const value = (slot === "weapon" ? item.atk : item.def) ?? 0;
      if (value > currentValue) {
        save.equipment[slot] = id;
        lines.push(line(`${item.name} 장착`, "good"));
      }
    }
  } else if (before > 0) {
    lines.push(line(`${item.name} ${before - after > 1 ? `×${before - after} ` : ""}잃음`, "bad"));
  }
  ensureEquipment(content, save);
  return lines;
}

export function equipItem(content: ContentIndex, save: PlayerSave, id: string): boolean {
  const item = content.items[id];
  if (!item || (item.kind !== "weapon" && item.kind !== "armor")) return false;
  if ((save.inventory[id] ?? 0) <= 0) return false;
  save.equipment[item.kind] = id;
  return true;
}

/** Adds a skill and puts it in the first free slot (1-4). */
export function learnSkill(content: ContentIndex, save: PlayerSave, id: string): Line[] {
  if (!content.skills[id] || save.skills.includes(id)) return [];
  save.skills.push(id);
  if (save.skillSlots.length < SKILL_SLOTS && !save.skillSlots.includes(id)) save.skillSlots.push(id);
  return [line(`새 기술 — ${skillName(content, id)}`, "epic")];
}

/** Assigns a known skill to slot 1-4 (swapping if it is already slotted). */
export function slotSkill(save: PlayerSave, skill: string, slot: number): boolean {
  if (!save.skills.includes(skill) || !Number.isInteger(slot) || slot < 1 || slot > SKILL_SLOTS) return false;
  const slots = save.skillSlots.slice(0, SKILL_SLOTS);
  const index = slot - 1;
  const previous = slots.indexOf(skill);
  if (index >= slots.length) {
    if (previous >= 0) slots.splice(previous, 1);
    slots.push(skill);
  } else {
    const displaced = slots[index] as string;
    slots[index] = skill;
    if (previous >= 0 && previous !== index) slots[previous] = displaced;
  }
  save.skillSlots = slots;
  return true;
}

/** Weapon and armor a character of this year should carry (ERA_GEAR). */
export function eraGear(content: ContentIndex, year: number): { weapon: string; armor: string } {
  let gear = { weapon: DEFAULT_WEAPON, armor: DEFAULT_ARMOR };
  for (const entry of content.eraGear) if (year >= entry.from) gear = { weapon: entry.weapon, armor: entry.armor };
  return gear;
}

/** §5.9 시대 지급품: at a chapter start, era gear better than what is equipped is granted. */
export function refreshEraGear(content: ContentIndex, save: PlayerSave): Line[] {
  const gear = eraGear(content, save.year);
  const lines: Line[] = [];
  for (const slot of ["weapon", "armor"] as const) {
    const offered = content.items[gear[slot]];
    const current = content.items[save.equipment[slot]];
    const value = (slot === "weapon" ? offered?.atk : offered?.def) ?? 0;
    const currentValue = (slot === "weapon" ? current?.atk : current?.def) ?? 0;
    if (!offered || value <= currentValue) continue;
    save.inventory[gear[slot]] = Math.max(1, save.inventory[gear[slot]] ?? 0);
    save.equipment[slot] = gear[slot];
    lines.push(line(`시대 지급품 — ${offered.name}`, "good"));
  }
  return lines;
}
