// Rules engine: pure, deterministic functions over PlayerSave. No I/O, no
// clocks, no Math.random — every chance is hashRoll(save.seed, id) or an Rng
// seeded from the save. Modules:
//   progression  levels, stats, derived numbers, sprite, ranks, gear, skills
//   life         lifespan, apparent age, suspicion, washes, successor
//   politics     purge risk and resolution
//   effects      conditions, effect interpreter, purge-risk preview
//   years        passage of years planner and transition
//   nation       nation meters, infiltration, carry-over, ending
//   save/migrate new characters, demo presets, untrusted-save parsing
export type { CreateOptions } from "./save.ts";
export { createSave, eraGear, skillsUnlockedBy } from "./save.ts";
export { migrateSave } from "./migrate.ts";

export type { Derived } from "./progression.ts";
export {
  allocatePoint,
  checkPromotion,
  derived,
  ensureEquipment,
  equipItem,
  expToNext,
  grantExp,
  heroSprite,
  learnSkill,
  rankLabel,
  rankName,
  slotSkill,
} from "./progression.ts";

export type { EffectOutcome } from "./effects.ts";
export { applyEffects, battleResult, evalCond, purgeRisk } from "./effects.ts";
export { hashRoll } from "./util.ts";

export type { PurgeResolution, PurgeTerm, PurgeVerdict } from "./politics.ts";
export { purgeTerms } from "./politics.ts";

export type { UseResult, WashSpec } from "./life.ts";
export {
  apparentAge,
  changeLife,
  exposure,
  graceAvailable,
  growSuspicion,
  offerVirtue,
  realAge,
  selfRevive,
  successorTakeover,
  suggestName,
  suspicionBand,
  suspicionDelta,
  useItem,
  useLongevity,
  washBlocker,
  washIdentity,
  WASH_METHODS,
} from "./life.ts";

export type { SmallEvent, YearsChoice } from "./years.ts";
export { ACTIVITIES, advanceStepYear, advanceYears, SMALL_EVENTS, smallEventAt, tokensBetween, yearsPlan } from "./years.ts";

export {
  BRANCH_LABELS,
  carryNation,
  computeEnding,
  finalInfiltration,
  INFILTRATION_WEIGHTS,
  nationValue,
  setBranch,
} from "./nation.ts";
