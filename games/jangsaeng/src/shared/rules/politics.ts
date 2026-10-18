// Purge (숙청) risk and deterministic resolution, GDD §5.5.3:
//   R = E × side + 0.4·max(0, favor[loser]) − 0.3·max(0, favor[winner])
//     + 0.25·suspicion + 10·[rank ≥ 14] + 10·[renowned] − tact − protection
//   side 0.3 (aligned = winner) | 1.0 (aligned = loser) | 0.6 otherwise, and always 0.6
//   for an option that stays out of the event (spec.neutral)
//   protection = min(15, 5 × 열전 bonds ≥ 60) + 5·[vouch]; R = clamp(round(R), 5, 95)
//   roll = hashRoll(seed, spec.id); roll < R → purged, margin R − roll decides the outcome.
import type { PurgeSpec } from "../content/schema.ts";
import type { PlayerSave } from "../types.ts";
import { changeLife } from "./lifespan.ts";
import { rankLabel, setRank, SENIOR_RANK } from "./progression.ts";
import { chronicle, clamp, hashRoll, isFamilyBond, isRenowned, line, siteName, type Line } from "./util.ts";

export const DEFAULT_EXILE_SITE = "jeju";

export interface PurgeTerm {
  label: string;
  value: number;
}

/** E multiplier for standing with the winner, with the loser, or with neither (§5.5.3). */
export const PURGE_SIDE = { winner: 0.3, loser: 1.0, neutral: 0.6 } as const;

/**
 * E multiplier by the side the player stands on in this event. A neutral
 * option (`spec.neutral`) stays out of it: 0.6 even when an earlier choice in
 * the chapter aligned the player with the winner or the loser. This is the
 * only place `neutral` is read, so the 풍향계 preview and the roll agree.
 */
export function purgeSide(save: PlayerSave, spec: PurgeSpec): number {
  if (spec.neutral === true) return PURGE_SIDE.neutral;
  if (save.aligned !== null && save.aligned === spec.winner) return PURGE_SIDE.winner;
  if (save.aligned !== null && save.aligned === spec.loser) return PURGE_SIDE.loser;
  return PURGE_SIDE.neutral;
}

/** 열전 bonds ≥ 60 (5 each, max 15) plus 동료 보증 (5). Family houses are not 열전. */
export function purgeProtection(save: PlayerSave): number {
  const strong = Object.entries(save.bonds).filter(([id, value]) => value >= 60 && !isFamilyBond(id)).length;
  return Math.min(15, 5 * strong) + (save.flags["vouch"] === true ? 5 : 0);
}

/** Each term of the risk formula, for the 풍향계 explanation. */
export function purgeTerms(save: PlayerSave, spec: PurgeSpec): PurgeTerm[] {
  const side = purgeSide(save, spec);
  const terms: PurgeTerm[] = [{ label: `사건 강도 ${spec.intensity} × ${side}`, value: spec.intensity * side }];
  if (spec.loser) {
    const favor = Math.max(0, save.favor[spec.loser] ?? 0);
    if (favor > 0) terms.push({ label: "패배측 총애", value: 0.4 * favor });
  }
  if (spec.winner) {
    const favor = Math.max(0, save.favor[spec.winner] ?? 0);
    if (favor > 0) terms.push({ label: "승리측 총애", value: -0.3 * favor });
  }
  if (save.suspicion > 0) terms.push({ label: "의심도", value: 0.25 * save.suspicion });
  if (save.rank >= SENIOR_RANK) terms.push({ label: "당상관", value: 10 });
  if (isRenowned(save)) terms.push({ label: "공훈의 이름", value: 10 });
  if (save.stats.tact > 0) terms.push({ label: "처세", value: -save.stats.tact });
  const protection = purgeProtection(save);
  if (protection > 0) terms.push({ label: "보호", value: -protection });
  return terms;
}

/** Purge risk R (5..95, integer) for the save as it stands. */
export function computePurgeRisk(save: PlayerSave, spec: PurgeSpec): number {
  const raw = purgeTerms(save, spec).reduce((sum, term) => sum + term.value, 0);
  return clamp(Math.round(raw), 5, 95);
}

/** 풍향계 display: exact from 지략 30, else R blurred by a stable −10..+10. */
export function shownRisk(save: PlayerSave, spec: PurgeSpec, risk: number): { value: number; exact: boolean } {
  if (save.stats.wit >= 30) return { value: risk, exact: true };
  const blur = (hashRoll(save.seed, `${spec.id}:blur`) % 21) - 10;
  return { value: clamp(risk + blur, 0, 100), exact: false };
}

export type PurgeVerdict = "survived" | "dismissed" | "exiled" | "sentenced";

export interface PurgeResolution {
  risk: number;
  roll: number;
  verdict: PurgeVerdict;
  /** Death-sentence crisis: the session must show the 사사 위기 card (flee or plead, §3.2). */
  escape: boolean;
  lines: Line[];
}

/**
 * Resolves a purge. The verdict is also stored as flag `purge:<id>` so
 * content can branch on it later.
 */
export function resolvePurge(save: PlayerSave, spec: PurgeSpec): PurgeResolution {
  const risk = computePurgeRisk(save, spec);
  const roll = hashRoll(save.seed, spec.id);
  const lines: Line[] = [line(`숙청 판정 — 위험 ${risk} · 판정값 ${roll}`, "info")];
  let verdict: PurgeVerdict;
  if (roll >= risk) {
    verdict = "survived";
    save.record.purgesSurvived += 1;
    lines.push(line("칼바람을 피했다 — 무사", "good"));
  } else {
    const margin = risk - roll;
    if (margin < 15) {
      verdict = "dismissed";
      setRank(save, save.rank - 3);
      save.flags["salarySuspended"] = true;
      chronicle(save, "숙청의 바람에 파직당하다.", "bad");
      lines.push(line(`파직 — 품계 −3 (${rankLabel(save.rank, save.year)}) · 이번 시대 녹봉 없음`, "bad"));
    } else if (margin < 35) {
      verdict = "exiled";
      setRank(save, save.rank - 5);
      changeLife(save, -1);
      const site = spec.exileSite ?? DEFAULT_EXILE_SITE;
      save.exile = site;
      chronicle(save, `${siteName(site)}(으)로 유배되다.`, "bad");
      lines.push(line(`유배 — 품계 −5 · 천수 −1년 · 다음 시대를 ${siteName(site)}에서 맞는다`, "bad"));
    } else {
      verdict = "sentenced";
      chronicle(save, "사사(賜死)의 명이 내려지다.", "bad");
      lines.push(line("사사의 명 — 담을 넘어 달아날지, 끝까지 결백을 주장할지 정해야 한다", "bad"));
    }
  }
  save.flags[`purge:${spec.id}`] = verdict;
  return { risk, roll, verdict, escape: verdict === "sentenced", lines };
}
