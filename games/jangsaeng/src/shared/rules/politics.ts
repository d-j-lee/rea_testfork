// Purge (숙청) risk and deterministic resolution. GDD §4.5:
//   R = E (−15 neutral) + 0.4·max(0, favor[loser]) − 0.3·max(0, favor[winner])
//     + 0.25·suspicion + (당상관 +10) + (공신 +10) − 1.0·tact − (bond ≥ 60 → −10)
//   clamped 5..95; roll = hash(seed, spec.id) mod 100; roll ≥ R survives.
import type { PurgeSpec } from "../content/schema.ts";
import type { PlayerSave } from "../types.ts";
import { rankLabel, setRank, SENIOR_RANK } from "./progression.ts";
import { chronicle, clamp, hashRoll, line, siteName, type Line } from "./util.ts";

export const DEFAULT_EXILE_SITE = "jeju";

export interface PurgeTerm {
  label: string;
  value: number;
}

/** Each term of the risk formula, for the 풍향계 explanation. */
export function purgeTerms(save: PlayerSave, spec: PurgeSpec): PurgeTerm[] {
  const terms: PurgeTerm[] = [{ label: "사건 강도", value: spec.intensity }];
  if (spec.neutral) terms.push({ label: "중립", value: -15 });
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
  if (save.meritSubject !== undefined) terms.push({ label: "공신", value: 10 });
  if (save.stats.tact > 0) terms.push({ label: "처세", value: -save.stats.tact });
  if (Object.values(save.bonds).some((bond) => bond >= 60)) terms.push({ label: "인연 보호", value: -10 });
  return terms;
}

/** Purge risk R (5..95, integer) for the save as it stands. */
export function computePurgeRisk(save: PlayerSave, spec: PurgeSpec): number {
  const raw = purgeTerms(save, spec).reduce((sum, term) => sum + term.value, 0);
  return Math.round(clamp(raw, 5, 95));
}

export type PurgeVerdict = "survived" | "dismissed" | "exiled" | "sentenced";

export interface PurgeResolution {
  risk: number;
  roll: number;
  verdict: PurgeVerdict;
  /** Death-sentence crisis: the session must run the escape battle. */
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
    const severity = risk - roll;
    if (severity < 15) {
      verdict = "dismissed";
      setRank(save, save.rank - 3);
      save.flags["salarySuspended"] = true;
      chronicle(save, "숙청의 바람에 파직당하다.", "bad");
      lines.push(line(`파직 — 품계 −3 (${rankLabel(save.rank, save.year)}) · 다음 녹봉 정지`, "bad"));
    } else if (severity < 35) {
      verdict = "exiled";
      setRank(save, save.rank - 5);
      const site = spec.exileSite ?? DEFAULT_EXILE_SITE;
      save.exile = site;
      chronicle(save, `${siteName(site)}(으)로 유배되다.`, "bad");
      lines.push(line(`유배 — 품계 −5 · 다음 시대를 ${siteName(site)}에서 맞는다`, "bad"));
    } else {
      verdict = "sentenced";
      chronicle(save, "사사(賜死)의 명이 내려지다. 추격을 뚫고 달아나야 한다.", "bad");
      lines.push(line("사사의 명 — 추격대를 뚫고 탈출하라", "bad"));
    }
  }
  save.flags[`purge:${spec.id}`] = verdict;
  return { risk, roll, verdict, escape: verdict === "sentenced", lines };
}
