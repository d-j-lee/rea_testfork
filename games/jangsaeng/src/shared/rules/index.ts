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
//   nation       nation meters, infiltration, carry-over, ending
//   save/migrate new characters, demo presets, untrusted-save parsing
export type { CreateOptions } from "./save.ts";
export { createSave, demoStartIndex, REFORM_DRIFT, skillsUnlockedBy } from "./save.ts";
export { migrateSave } from "./migrate.ts";

export type { Derived } from "./progression.ts";
export {
  allocatePoint,
  checkPromotion,
  derived,
  ensureEquipment,
  equipItem,
  eraGear,
  expToNext,
  grantExp,
  heroSprite,
  learnSkill,
  rankLabel,
  rankName,
  refreshEraGear,
  slotSkill,
} from "./progression.ts";

export type { EffectOutcome } from "./effects.ts";
export { applyEffects, battleResult, evalCond, HOLD_VICTORY_VIRTUE, purgeRisk, purgeRiskShown } from "./effects.ts";
export { discipleGeneration, hashRoll, isRenowned, virtueEarned } from "./util.ts";

export type { PurgeResolution, PurgeTerm, PurgeVerdict } from "./politics.ts";
export { PURGE_SIDE, purgeProtection, purgeSide, purgeTerms } from "./politics.ts";

export type { UseResult } from "./lifespan.ts";
export {
  applyResonance,
  changeLife,
  graceAvailable,
  offerVirtue,
  selfRevive,
  useItem,
  useLongevity,
} from "./lifespan.ts";

export type { WashSpec } from "./identity.ts";
export {
  apparentAge,
  eraFactor,
  exposure,
  growSuspicion,
  realAge,
  suggestName,
  suspicionBand,
  suspicionDelta,
  washBlocker,
  washCost,
  washIdentity,
  WASH_METHODS,
  WAR_CHAPTERS,
} from "./identity.ts";

export { pastLifeEnd, successorTakeover } from "./succession.ts";

export type { ActivityDef, SmallEvent, SmallEventContext, YearsChoice } from "./years.ts";
export { ACTIVITIES, advanceYears, SMALL_EVENTS, advanceStepYear, smallEventAt, tokensBetween, yearsPlan } from "./years.ts";

export {
  BRANCH_CHAPTER,
  BRANCH_LABELS,
  carryNation,
  chapterBranches,
  closeChapterBranches,
  computeEnding,
  finalInfiltration,
  INFILTRATION_WEIGHTS,
  longFlagSum,
  nationValue,
  setBranch,
  setLongFlag,
} from "./nation.ts";
