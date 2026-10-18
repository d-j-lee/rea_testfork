// Rules engine: pure, deterministic functions over PlayerSave (GDD v1.0 §5,
// §8). No I/O, no clocks, no Math.random — every chance is
// hashRoll(save.seed, id) or an Rng seeded from the save. Modules:
//   progression  levels, stats, derived numbers, sprite, ranks, gear, skills
//   lifespan     천수: changeLife, offering, grace, 감응, 일섬, self-revive, items
//   identity     apparent age, suspicion, names, identity washes
//   succession   successor takeover when the lifespan ends
//   politics     purge risk, 풍향계 blur and resolution
//   effects      conditions, effect interpreter, purge-risk preview
//   years        passage of years planner and transition
//   nation       nation meters, infiltration, carry-over, 공동 실록, ending
//   save/migrate new characters, demo presets, untrusted-save parsing
// This index is the layer's public surface: it re-exports what the host, the
// client and the tests use, and nothing else.
export type { CreateOptions } from "./save.ts";
export { createSave, REFORM_DRIFT, skillsUnlockedBy } from "./save.ts";
export { migrateSave } from "./migrate.ts";

export type { Derived } from "./progression.ts";
export {
  allocatePoint,
  checkPromotion,
  derived,
  equipItem,
  expToNext,
  grantExp,
  heroSprite,
  rankName,
  slotSkill,
} from "./progression.ts";

export type { EffectOutcome } from "./effects.ts";
export { applyEffects, battleResult, evalCond, HOLD_VICTORY_VIRTUE, purgeRisk, purgeRiskShown } from "./effects.ts";
export { bondName, hashRoll, virtueEarned } from "./util.ts";

export { purgeProtection, purgeSide, purgeTerms } from "./politics.ts";

export {
  applyResonance,
  changeLife,
  graceAvailable,
  LONGEVITY_MAX_PER_CHAPTER,
  longevityBlocker,
  offerVirtue,
  reviveVirtue,
  selfRevive,
  useItem,
  useLongevity,
} from "./lifespan.ts";

export {
  apparentAge,
  eraFactor,
  exposure,
  growSuspicion,
  realAge,
  suggestName,
  suspicionBand,
  washBlocker,
  washCost,
  washIdentity,
  WASH_METHODS,
} from "./identity.ts";

export { successorTakeover } from "./succession.ts";

export type { YearsChoice } from "./years.ts";
export { advanceStepYear, advanceYears, smallEventAt, tokensBetween, yearsPlan } from "./years.ts";

export {
  BRANCH_CHAPTER,
  BRANCH_LABELS,
  carryNation,
  closeChapterBranches,
  completeWorldEvent,
  computeEnding,
  finalInfiltration,
  longFlagSum,
  nationValue,
} from "./nation.ts";
