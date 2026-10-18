// Condition evaluation and the effect interpreter. Pure effects mutate the
// save; runtime effects (prompt, battle, objective, goto, worldEvent) are
// collected into an EffectOutcome for the session to perform.
import type { ContentIndex } from "../content/index.ts";
import type { BattleDef, Cond, Effect, PurgeSpec } from "../content/schema.ts";
import type { PlayerSave, ResultView } from "../types.ts";
import { changeLife, changeSuspicion, lifeLine, suggestName, washIdentity } from "./life.ts";
import { BRANCH_LABELS, changeNation, nationValue, setBranch } from "./nation.ts";
import { computePurgeRisk, resolvePurge } from "./politics.ts";
import { changeItem, grantExp, learnSkill, rankLabel, setRank, STAT_CAP } from "./progression.ts";
import {
  bondName,
  chronicle,
  clamp,
  cloneSave,
  factionName,
  flagTruthy,
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
  /** Purge produced a death sentence crisis: session starts the escape battle. */
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

/** Same wording as the CH03 content titles, so the title is never duplicated. */
export function meritSubjectTitle(grade: 1 | 2 | 3 | 4): string {
  return grade === 4 ? "원종공신" : `개국공신 ${grade}등`;
}

/** Honor may go negative (betrayal); other points floor at 0. */
function changePoint(save: PlayerSave, point: keyof PlayerSave["points"], add: number): number {
  const before = save.points[point];
  const after = Math.round(before + add);
  save.points[point] = point === "honor" ? after : Math.max(0, after);
  const delta = save.points[point] - before;
  if (point === "virtue" && delta > 0) {
    const earned = save.flags["virtueEarned"];
    save.flags["virtueEarned"] = (typeof earned === "number" ? earned : 0) + delta;
  }
  return delta;
}

function applyOne(content: ContentIndex, save: PlayerSave, effect: Effect, out: EffectOutcome, depth: number): void {
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
      save.longFlags[effect.flag] = { key: effect.key, add: effect.add };
      lines.push(line(`장기 국운 — ${nationName(effect.key)} ${signed(effect.add)} (다음 시대부터 매번)`, "epic"));
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
      const result = resolvePurge(save, effect.spec);
      lines.push(...result.lines);
      if (result.escape) out.escape = true;
      return;
    }
    case "check": {
      const stat = effect.stat ? save.stats[effect.stat] : 0;
      const chance = Math.round(clamp(effect.base + (effect.per ?? 0) * stat, 5, 95));
      const success = hashRoll(save.seed, effect.id) < chance;
      lines.push(line(`${effect.label} 판정 ${success ? "성공" : "실패"} (${chance}%)`, success ? "good" : "bad"));
      save.flags[`check:${effect.id}`] = success;
      applyList(content, save, success ? effect.success : effect.failure, out, depth + 1);
      return;
    }
    case "if":
      applyList(content, save, evalCond(content, save, effect.cond) ? effect.then : (effect.else ?? []), out, depth + 1);
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

function applyList(content: ContentIndex, save: PlayerSave, effects: readonly Effect[], out: EffectOutcome, depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const effect of effects) applyOne(content, save, effect, out, depth);
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

/** Purge risk R (5..95) for a spec, optionally after hypothetical effects. */
export function purgeRisk(content: ContentIndex, save: PlayerSave, spec: PurgeSpec, preview?: readonly Effect[]): number {
  if (!preview || preview.length === 0) return computePurgeRisk(save, spec);
  const hypothetical = cloneSave(save);
  applyEffects(content, hypothetical, preview);
  return computePurgeRisk(hypothetical, spec);
}

/**
 * Records a battle outcome: victory/defeat effects, battlesWon, and the 대첩
 * first-victory reward (+2 lifespan years and a chronicle line).
 */
export function battleResult(content: ContentIndex, save: PlayerSave, battle: BattleDef, won: boolean): EffectOutcome {
  const out = emptyOutcome();
  if (won) {
    const first = !save.battlesWon.includes(battle.id);
    if (first) save.battlesWon.push(battle.id);
    if (first && battle.great) {
      changeLife(save, 2);
      out.lines.push(line(`대첩 — ${battle.title}`, "epic"), lifeLine(2));
      chronicle(save, `${battle.title}에서 이기다.`, "epic");
    }
  }
  applyList(content, save, won ? battle.victory : battle.defeat, out, 0);
  return out;
}
