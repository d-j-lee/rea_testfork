// Condition evaluation and the effect interpreter. Pure effects mutate the
// save; runtime effects (prompt, battle, objective, goto, worldEvent) are
// collected into an EffectOutcome for the session to perform.
import type { ContentIndex } from "../content/index.ts";
import type { BattleDef, Cond, Effect, PurgeSpec } from "../content/schema.ts";
import type { PlayerSave, ResultView } from "../types.ts";
import { changeSuspicion, suggestName, washIdentity } from "./identity.ts";
import { changeLife, lifeLine } from "./lifespan.ts";
import { BRANCH_LABELS, changeNation, nationValue, setBranch, setLongFlag } from "./nation.ts";
import { computePurgeRisk, resolvePurge, shownRisk } from "./politics.ts";
import { changeItem, grantExp, learnSkill, rankLabel, setRank, STAT_CAP } from "./progression.ts";
import {
  bondName,
  chronicle,
  clamp,
  cloneSave,
  factionName,
  flagTruthy,
  gainVirtue,
  hashRoll,
  line,
  nationName,
  pointName,
  signed,
  siteName,
  statName,
  toneOf,
} from "./util.ts";

// ── Conditions ───────────────────────────────────────────────────────────

function inRange(value: number, range: { min?: number; max?: number }): boolean {
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

export function evalCond(content: ContentIndex, save: PlayerSave, cond: Cond | undefined): boolean {
  if (!cond) return true;
  switch (cond.k) {
    case "all":
      return cond.of.every((inner) => evalCond(content, save, inner));
    case "any":
      return cond.of.some((inner) => evalCond(content, save, inner));
    case "not":
      return !evalCond(content, save, cond.of);
    case "stat":
      return inRange(save.stats[cond.stat] ?? 0, cond);
    case "point":
      return inRange(save.points[cond.point] ?? 0, cond);
    case "nation":
      return inRange(nationValue(save, cond.key), cond);
    case "favor":
      return inRange(save.favor[cond.faction] ?? 0, cond);
    case "bond":
      return inRange(save.bonds[cond.npc] ?? 0, cond);
    case "rank":
      return inRange(save.rank, cond);
    case "level":
      return inRange(save.level, cond);
    case "suspicion":
      return inRange(save.suspicion, cond);
    case "year":
      return inRange(save.year, cond);
    case "lifeEnd":
      return inRange(save.lifeEnd, cond);
    case "flag": {
      const value = save.flags[cond.flag];
      if (cond.eq === undefined) return flagTruthy(value);
      if (cond.eq === false) return !flagTruthy(value);
      return value === cond.eq;
    }
    case "branch": {
      // ok:false means "has not succeeded" (failed or never attempted).
      const succeeded = save.branches[cond.id] === true;
      return cond.ok === false ? !succeeded : succeeded;
    }
    case "aligned":
      return save.aligned === cond.faction;
    case "identity":
      return save.identity.kind === cond.kind;
    case "origin":
      return save.origin === cond.origin;
    case "item":
      return (save.inventory[cond.item] ?? 0) >= (cond.count ?? 1);
    case "battleWon":
      return save.battlesWon.includes(cond.battle);
    default:
      return false;
  }
}

// ── Effects ──────────────────────────────────────────────────────────────

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
  /** Purge produced a death-sentence crisis: the session shows the 사사 위기 card. */
  escape: boolean;
}

export function emptyOutcome(): EffectOutcome {
  return {
    prompts: [],
    battles: [],
    objectives: [],
    worldEvent: 0,
    toasts: [],
    lines: [],
    levelsGained: 0,
    washed: false,
    escape: false,
  };
}

const MERIT_SUBJECT_RANK: Readonly<Record<1 | 2 | 3 | 4, number>> = { 1: 14, 2: 13, 3: 12, 4: 10 };
const MAX_DEPTH = 16;
/** 공덕 for the first victory in a 방어·생존형 battle (GDD §5.3.2). */
export const HOLD_VICTORY_VIRTUE = 30;

/**
 * 풍향계 preview probe: the walk stops at the purge with this id and records
 * the risk that purge would roll against, instead of resolving it.
 */
interface PurgeProbe {
  id: string;
  risk?: number;
}

/** Does this effect list (including check/if branches) contain the purge `id`? */
function reachesPurge(effects: readonly Effect[], id: string): boolean {
  return effects.some((effect) => {
    switch (effect.k) {
      case "purge":
        return effect.spec.id === id;
      case "check":
        return reachesPurge(effect.success, id) || reachesPurge(effect.failure, id);
      case "if":
        return reachesPurge(effect.then, id) || reachesPurge(effect.else ?? [], id);
      default:
        return false;
    }
  });
}

/** Same wording as the CH03 content titles, so the title is never duplicated. */
export function meritSubjectTitle(grade: 1 | 2 | 3 | 4): string {
  return grade === 4 ? "원종공신" : `개국공신 ${grade}등`;
}

/** Honor may go negative (betrayal); other points floor at 0. Virtue gains are cumulative. */
function changePoint(save: PlayerSave, point: keyof PlayerSave["points"], add: number): number {
  if (point === "virtue" && add > 0) return gainVirtue(save, add);
  const before = save.points[point];
  const after = Math.round(before + add);
  save.points[point] = point === "honor" ? after : Math.max(0, after);
  return save.points[point] - before;
}

function applyOne(
  content: ContentIndex,
  save: PlayerSave,
  effect: Effect,
  out: EffectOutcome,
  depth: number,
  probe?: PurgeProbe,
): void {
  const lines = out.lines;
  switch (effect.k) {
    case "stat": {
      const before = save.stats[effect.stat];
      save.stats[effect.stat] = clamp(Math.round(before + effect.add), 1, STAT_CAP);
      const delta = save.stats[effect.stat] - before;
      if (delta !== 0) lines.push(line(`${statName(effect.stat)} ${signed(delta)}`, toneOf(delta)));
      return;
    }
    case "point": {
      const delta = changePoint(save, effect.point, effect.add);
      if (delta !== 0) lines.push(line(`${pointName(effect.point)} ${signed(delta)}`, toneOf(delta)));
      return;
    }
    case "exp": {
      const { levels } = grantExp(save, effect.add);
      if (effect.add > 0) lines.push(line(`경험치 +${Math.round(effect.add)}`, "good"));
      if (levels > 0) {
        out.levelsGained += levels;
        lines.push(line(`레벨 ${save.level} 달성 (능력치 점수 +${levels * 2})`, "epic"));
      }
      return;
    }
    case "nation": {
      const delta = changeNation(save, effect.key, effect.add);
      if (delta !== 0) {
        lines.push(line(`${nationName(effect.key)} ${signed(delta)}`, toneOf(delta, effect.key !== "infiltration")));
      }
      return;
    }
    case "longFlag": {
      setLongFlag(save, effect.flag, effect.key, effect.add);
      lines.push(line(`장기 국운 — ${nationName(effect.key)} ${signed(effect.add)} (1910년까지 유지)`, "epic"));
      return;
    }
    case "favor": {
      const before = save.favor[effect.faction] ?? 0;
      const after = clamp(Math.round(before + effect.add), -100, 100);
      save.favor[effect.faction] = after;
      const delta = after - before;
      if (delta !== 0) lines.push(line(`${factionName(content, save, effect.faction)} 총애 ${signed(delta)}`, toneOf(delta)));
      return;
    }
    case "align":
      save.aligned = effect.faction;
      if (effect.faction) lines.push(line(`${factionName(content, save, effect.faction)}에 몸을 담다`, "info"));
      return;
    case "bond": {
      const before = save.bonds[effect.npc] ?? 0;
      const after = clamp(Math.round(before + effect.add), 0, 100);
      save.bonds[effect.npc] = after;
      const delta = after - before;
      if (delta !== 0) lines.push(line(`${bondName(content, effect.npc)} 인연 ${signed(delta)}`, toneOf(delta)));
      return;
    }
    case "rank": {
      const before = save.rank;
      if (effect.set !== undefined) setRank(save, effect.set);
      if (effect.add !== undefined) setRank(save, save.rank + effect.add);
      const delta = save.rank - before;
      if (delta !== 0) {
        lines.push(line(`품계 ${signed(delta)} — ${rankLabel(save.rank, save.year)}`, toneOf(delta)));
      }
      return;
    }
    case "suspicion": {
      const delta = changeSuspicion(save, effect.add);
      if (delta !== 0) lines.push(line(`의심도 ${signed(delta)}`, toneOf(delta, false)));
      return;
    }
    case "life": {
      const years = Math.round(effect.add);
      changeLife(save, years);
      if (years !== 0) lines.push(lifeLine(years));
      return;
    }
    case "flag": {
      const value = effect.value ?? true;
      if (effect.flag === "turncoat") {
        // '변절' score for P5: each turncoat flag counts (numbers add that many).
        save.record.turncoat += typeof value === "number" ? Math.max(0, Math.round(value)) : value ? 1 : 0;
      }
      save.flags[effect.flag] = value;
      return;
    }
    case "branch": {
      setBranch(save, effect.id, effect.ok);
      lines.push(line(`역사의 분기 ${effect.id} ${BRANCH_LABELS[effect.id]} — ${effect.ok ? "성공" : "실패"}`, effect.ok ? "epic" : "bad"));
      return;
    }
    case "item":
      lines.push(...changeItem(content, save, effect.item, effect.add));
      return;
    case "skill":
      lines.push(...learnSkill(content, save, effect.skill));
      return;
    case "title":
      if (!save.titles.includes(effect.title)) {
        save.titles.push(effect.title);
        lines.push(line(`칭호 — ${effect.title}`, "epic"));
      }
      return;
    case "meritSubject": {
      save.meritSubject = effect.grade;
      save.flags["renowned"] = true;
      setRank(save, Math.max(save.rank, MERIT_SUBJECT_RANK[effect.grade]));
      const title = meritSubjectTitle(effect.grade);
      if (!save.titles.includes(title)) save.titles.push(title);
      lines.push(line(`${title} 책록 — ${rankLabel(save.rank, save.year)}`, "epic"));
      return;
    }
    case "chronicle":
      chronicle(save, effect.text);
      return;
    case "toast":
      out.toasts.push({ text: effect.text, tone: effect.tone ?? "info" });
      return;
    case "wash": {
      const name = suggestName(save, `wash:${effect.method}:${save.year}:${save.record.washes}`);
      lines.push(...washIdentity(content, save, effect.method, name));
      out.washed = true;
      return;
    }
    case "exile":
      save.exile = effect.site;
      lines.push(line(`유배 — 다음 시대를 ${siteName(effect.site)}에서 맞는다`, "bad"));
      return;
    case "goto":
      out.goto = effect.offset ? { site: effect.site, offset: effect.offset } : { site: effect.site };
      return;
    case "purge": {
      if (probe && effect.spec.id === probe.id) {
        probe.risk = computePurgeRisk(save, effect.spec);
        return;
      }
      const result = resolvePurge(save, effect.spec);
      lines.push(...result.lines);
      if (result.escape) out.escape = true;
      return;
    }
    case "check": {
      if (probe) {
        // When only one outcome leads to the previewed purge, the purge is rolled
        // only there: walk that side without consulting the hidden check roll.
        const onSuccess = reachesPurge(effect.success, probe.id);
        if (onSuccess !== reachesPurge(effect.failure, probe.id)) {
          applyList(content, save, onSuccess ? effect.success : effect.failure, out, depth + 1, probe);
          return;
        }
      }
      const stat = effect.stat ? save.stats[effect.stat] : 0;
      const chance = Math.round(clamp(effect.base + (effect.per ?? 0) * stat, 5, 95));
      const success = hashRoll(save.seed, effect.id) < chance;
      lines.push(line(`${effect.label} 판정 ${success ? "성공" : "실패"} (${chance}%)`, success ? "good" : "bad"));
      save.flags[`check:${effect.id}`] = success;
      applyList(content, save, success ? effect.success : effect.failure, out, depth + 1, probe);
      return;
    }
    case "if":
      applyList(content, save, evalCond(content, save, effect.cond) ? effect.then : (effect.else ?? []), out, depth + 1, probe);
      return;
    case "prompt":
      out.prompts.push(effect.prompt);
      return;
    case "battle":
      out.battles.push(effect.battle);
      return;
    case "objective":
      out.objectives.push(effect.objective);
      return;
    case "worldEvent":
      out.worldEvent += effect.add;
      return;
    default:
      return;
  }
}

function applyList(
  content: ContentIndex,
  save: PlayerSave,
  effects: readonly Effect[],
  out: EffectOutcome,
  depth: number,
  probe?: PurgeProbe,
): void {
  if (depth > MAX_DEPTH) return;
  for (const effect of effects) {
    if (probe?.risk !== undefined) return;
    applyOne(content, save, effect, out, depth, probe);
  }
}

/** Applies effects in order, mutating `save`. Deterministic for a save seed. */
export function applyEffects(content: ContentIndex, save: PlayerSave, effects: readonly Effect[]): EffectOutcome {
  const out = emptyOutcome();
  applyList(content, save, effects, out, 0);
  return out;
}

/** Applies effects into an existing outcome (merging lines and runtime work). */
export function applyEffectsInto(content: ContentIndex, save: PlayerSave, effects: readonly Effect[], out: EffectOutcome): void {
  applyList(content, save, effects, out, 0);
}

/**
 * Purge risk R (5..95) for `spec`. With an option's effects (`preview`) it is
 * the R that option's purge will roll against: the effects before that purge
 * run on a clone and the purge itself never resolves there. A check with the
 * purge on exactly one side (success or failure) is walked on that side
 * without its roll, so the preview shows no hidden verdict; that walk sets no
 * `check:<id>` flag. Two shapes would break this and content must not use
 * them (tests/unit/rules-politics.test.ts guards both): a check with the purge
 * on both sides (its roll runs on the clone, so R could give the verdict
 * away), and a `check:` flag read on the way to a guarded purge (the preview
 * reads it unset). Without a purge on the option's path, R after all its effects.
 */
export function purgeRisk(content: ContentIndex, save: PlayerSave, spec: PurgeSpec, preview?: readonly Effect[]): number {
  if (!preview || preview.length === 0) return computePurgeRisk(save, spec);
  const hypothetical = cloneSave(save);
  const probe: PurgeProbe = { id: spec.id };
  applyList(content, hypothetical, preview, emptyOutcome(), 0, probe);
  return probe.risk ?? computePurgeRisk(hypothetical, spec);
}

/** 풍향계 value for an option: exact with 지략 ≥ 30, otherwise a stable ±10 blur. */
export function purgeRiskShown(
  content: ContentIndex,
  save: PlayerSave,
  spec: PurgeSpec,
  preview?: readonly Effect[],
): { value: number; exact: boolean } {
  return shownRisk(save, spec, purgeRisk(content, save, spec, preview));
}

/**
 * Records a battle outcome. A defeat applies the defeat effects every time.
 * Victory rewards are granted once per battle (§3.7): the first victory is
 * recorded in battlesWon, a 대전 adds +2 lifespan years, a chronicle line and
 * renown for this identity, a 방어·생존형 battle adds 공덕 +30 (§5.3.2), then
 * the victory effects apply. A repeated victory changes nothing.
 */
export function battleResult(content: ContentIndex, save: PlayerSave, battle: BattleDef, won: boolean): EffectOutcome {
  const out = emptyOutcome();
  if (!won) {
    applyList(content, save, battle.defeat, out, 0);
    return out;
  }
  if (save.battlesWon.includes(battle.id)) return out;
  save.battlesWon.push(battle.id);
  if (battle.great) {
    changeLife(save, 2);
    save.flags["renowned"] = true;
    out.lines.push(line(`대전 — ${battle.title}`, "epic"), lifeLine(2));
    chronicle(save, `${battle.title}에서 이기다.`, "epic");
  }
  if (battle.kind === "defend" || battle.kind === "survive") {
    const gained = gainVirtue(save, HOLD_VICTORY_VIRTUE);
    const text = `지켜 낸 싸움 — ${pointName("virtue")} ${signed(gained)}`;
    out.lines.push(line(text, "good"));
    // Shown as it happens: the field has no result card.
    out.toasts.push({ text, tone: "good" });
  }
  applyList(content, save, battle.victory, out, 0);
  return out;
}
