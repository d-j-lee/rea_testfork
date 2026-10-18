// Lifespan (천수, GDD §5.3): every change goes through changeLife. Offering,
// 노인성의 마지막 은혜, 노인성 감응, 노인성 일섬, self-revive and 산삼.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterId } from "../content/schema.ts";
import { FINAL_YEAR, type PlayerSave } from "../types.ts";
import { chronicle, itemName, line, signed, virtueEarned, type Line } from "./util.ts";

export const OFFER_COST = 100;
export const OFFER_MAX_PER_CHAPTER = 5;
export const GRACE_YEARS = 10;
/** Grace is offered when the next chapter starts in or after this year. */
export const GRACE_FROM_YEAR = 1776;
export const LONGEVITY_MAX_PER_CHAPTER = 3;

/** 노인성 감응 when leaving these chapters: +4, +2 more at the cumulative-virtue threshold. */
export const RESONANCE: Readonly<Partial<Record<ChapterId, number>>> = { ch03: 600, ch10: 2000, ch13: 2800 };

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

/** Years an offering would grant right now (this chapter's allowance). */
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

/** 노인성의 마지막 은혜 (§5.3.3): once, when the next chapter starts ≥ 1776 and lifeEnd < 1910. */
export function graceAvailable(content: ContentIndex, save: PlayerSave, next: ChapterId): boolean {
  const start = content.chapters[next]?.years[0] ?? 0;
  return !save.graceUsed && save.lifeEnd < FINAL_YEAR && start >= GRACE_FROM_YEAR;
}

/** +10 years; consumes all virtue and 10 fame. */
export function applyGrace(save: PlayerSave): Line[] {
  save.graceUsed = true;
  changeLife(save, GRACE_YEARS);
  const virtue = save.points.virtue;
  save.points.virtue = 0;
  save.points.fame = Math.max(0, save.points.fame - 10);
  chronicle(save, "노인성이 마지막 은혜를 내리다. 천수 10년이 더해졌다.", "epic");
  return [
    line(`노인성의 마지막 은혜 — 천수 +${GRACE_YEARS}년 (${save.lifeEnd}년까지)`, "epic"),
    line(`공덕 ${virtue} 전부를 바치다 · 명망 −10`, "info"),
  ];
}

/** 노인성 감응 (§5.3.2) for the chapter being left; once per chapter. */
export function applyResonance(save: PlayerSave, chapter: ChapterId): Line[] {
  const threshold = RESONANCE[chapter];
  const flag = `resonance:${chapter}`;
  if (threshold === undefined || save.flags[flag] === true) return [];
  save.flags[flag] = true;
  const bonus = virtueEarned(save) >= threshold ? 2 : 0;
  changeLife(save, 4 + bonus);
  chronicle(save, "노인성이 다시 빛났다. 지켜 온 사람들의 숨결이 천수가 되었다.", "epic");
  return [line(`노인성 감응 — 천수 +${4 + bonus}년${bonus ? ` (누적 공덕 ${threshold} 이상 +2)` : ""}`, "epic")];
}

/** 노인성 일섬 (§5.2.6): −1 year, 3 per chapter; not with ≤ 1 year left, never for a mortal successor. */
export function useLongevity(save: PlayerSave): boolean {
  if (save.identity.kind === "successor") return false;
  if (save.longevityUses >= LONGEVITY_MAX_PER_CHAPTER || save.lifeEnd - save.year <= 1) return false;
  save.longevityUses += 1;
  changeLife(save, -1);
  return true;
}

/** Self-revive (§5.2.7): the first one each chapter is free, then −1 year. */
export function selfRevive(save: PlayerSave): Line[] {
  save.record.selfRevives += 1;
  if (save.flags["freeReviveUsed"] !== true) {
    save.flags["freeReviveUsed"] = true;
    return [line("스스로 일어서다 — 이번 시대 첫 소생은 천수를 쓰지 않는다", "info")];
  }
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
