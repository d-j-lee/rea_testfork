// Nation meters (국운), infiltration (침투도), carry-over between chapters
// and the 1910 settlement. GDD §4.6 / §6.
import type { ContentIndex } from "../content/index.ts";
import type { BranchId, ChapterId, NationKey, NationMeter } from "../content/schema.ts";
import { BRANCH_IDS, NATION_KEYS } from "../content/schema.ts";
import type { EndingResult, PlayerSave } from "../types.ts";
import { clamp, nationName, numberFlag } from "./util.ts";

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

/** Infiltration added by each branch that did not succeed (all failed = 100). */
export const INFILTRATION_WEIGHTS: Readonly<Partial<Record<BranchId, number>>> = {
  B4: 15, B5: 10, B6: 8, B8: 20, B9: 8, B10: 7, B11: 15, B12a: 7, B12b: 10,
};

/** Infiltration is shown and carried from CH14 on. */
export const INFILTRATION_FROM_ORDER = 14;
export const ZEITGEIST_MAX = 5;

/** Flag marking that a failed branch's weight is already inside save.infiltration. */
export function infiltrationFlag(id: BranchId): string {
  return `infiltration:${id}`;
}

function uncountedWeight(save: PlayerSave, include: (state: boolean | undefined) => boolean): number {
  let sum = 0;
  for (const id of BRANCH_IDS) {
    if (include(save.branches[id]) && save.flags[infiltrationFlag(id)] !== true) sum += INFILTRATION_WEIGHTS[id] ?? 0;
  }
  return sum;
}

/**
 * Records a branch outcome. A failure adds its infiltration weight to
 * save.infiltration once (so the stored meter is what players see); a later
 * success takes it back out.
 */
export function setBranch(save: PlayerSave, id: BranchId, ok: boolean): void {
  save.branches[id] = ok;
  const weight = INFILTRATION_WEIGHTS[id] ?? 0;
  if (weight === 0) return;
  const flag = infiltrationFlag(id);
  const counted = save.flags[flag] === true;
  if (!ok && !counted) {
    save.infiltration = clamp(save.infiltration + weight, 0, 100);
    save.flags[flag] = true;
  } else if (ok && counted) {
    save.infiltration = clamp(save.infiltration - weight, 0, 100);
    delete save.flags[flag];
  }
}

/**
 * Current meter value. Infiltration also counts failed branches that were
 * set without the branch effect (e.g. hand-built saves), clamped 0..100.
 */
export function nationValue(save: PlayerSave, key: NationMeter): number {
  if (key !== "infiltration") return save.nation[key];
  return clamp(save.infiltration + uncountedWeight(save, (state) => state === false), 0, 100);
}

export function changeNation(save: PlayerSave, key: NationMeter, add: number): number {
  if (key === "infiltration") {
    const before = save.infiltration;
    save.infiltration = clamp(Math.round(save.infiltration + add), 0, 100);
    return save.infiltration - before;
  }
  const before = save.nation[key];
  save.nation[key] = clamp(Math.round(before + add), 0, 100);
  return save.nation[key] - before;
}

export function longFlagSum(save: PlayerSave, key: NationKey): number {
  let sum = 0;
  for (const flag of Object.values(save.longFlags)) if (flag.key === key) sum += flag.add;
  return sum;
}

/**
 * next = hist[next] + clamp(0.8 × (current − hist[current]), −20, 20) + Σ long flags.
 * Returns the carried values without mutating the save.
 */
export function carryNation(content: ContentIndex, save: PlayerSave, next: ChapterId): Record<NationKey, number> {
  const current = content.chapters[save.chapter];
  const target = content.chapters[next];
  const result = { ...save.nation };
  if (!current || !target) return result;
  for (const key of NATION_KEYS) {
    const drift = clamp(0.8 * (save.nation[key] - current.hist[key]), -20, 20);
    result[key] = clamp(Math.round(target.hist[key] + drift + longFlagSum(save, key)), 0, 100);
  }
  return result;
}

// ── Ending ───────────────────────────────────────────────────────────────

const WEIGHTS: readonly (readonly [NationKey, number])[] = [
  ["defense", 0.25],
  ["diplomacy", 0.2],
  ["finance", 0.15],
  ["people", 0.2],
  ["reform", 0.2],
];

/** Final infiltration: every branch that did not succeed adds its weight (unresolved = failed). */
export function finalInfiltration(save: PlayerSave): number {
  return clamp(save.infiltration + uncountedWeight(save, (state) => state !== true), 0, 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Cumulative virtue for P2 (spending on offerings does not erase deeds). */
export function virtueEarned(save: PlayerSave): number {
  return Math.max(save.points.virtue, numberFlag(save, "virtueEarned"));
}

export function computeEnding(content: ContentIndex, save: PlayerSave): EndingResult {
  void content;
  const breakdown: EndingResult["breakdown"] = [];
  let score = 0;
  for (const [key, weight] of WEIGHTS) {
    const value = round2(save.nation[key] * weight);
    breakdown.push({ label: `${nationName(key)} ${save.nation[key]} × ${weight}`, value });
    score += value;
  }
  const succeeded = BRANCH_IDS.filter((id) => save.branches[id] === true).length;
  breakdown.push({ label: `분기 성공 ${succeeded}개 × 3`, value: 3 * succeeded });
  score += 3 * succeeded;
  const infiltration = finalInfiltration(save);
  const infiltrationTerm = round2(-0.3 * infiltration);
  breakdown.push({ label: `침투도 ${infiltration} × −0.3`, value: infiltrationTerm });
  score += infiltrationTerm;
  const zeitgeist = clamp(numberFlag(save, "zeitgeist"), 0, ZEITGEIST_MAX);
  if (zeitgeist > 0) {
    breakdown.push({ label: "시대정신 보너스", value: zeitgeist });
    score += zeitgeist;
  }
  score = round2(score);

  const ok = (id: BranchId) => save.branches[id] === true;
  let nation: EndingResult["nation"] = "N3";
  if (score >= 70 && save.nation.defense >= 60 && (ok("B11") || ok("B12b")) && ok("B12c")) nation = "N1";
  else if (score >= 45 || ok("B12b")) nation = "N2";

  const strongBonds = Object.values(save.bonds).filter((value) => value >= 60).length;
  let personal: EndingResult["personal"] = "P0";
  if (save.record.turncoat >= 3) personal = "P5";
  else if (save.successor !== undefined && save.successor.generation >= 1) personal = "P4";
  else if (save.rank >= 16 && save.points.honor >= 50 && save.suspicion < 70) personal = "P1";
  else if (strongBonds >= 4 || numberFlag(save, "disciples") >= 3) personal = "P3";
  else if (save.record.washes >= 4 && save.rank <= 6 && virtueEarned(save) >= 600) personal = "P2";

  return { nation, personal, score, breakdown };
}
