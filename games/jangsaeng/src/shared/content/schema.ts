// Content schema: every chapter, prompt, battle, enemy, skill and item is data
// in this shape. Rules (src/shared/rules) interpret conditions and effects;
// the session (src/shared/host) runs chapter steps; the world
// (src/shared/sim) runs NPCs, spawns and battles in real time.
import type { CharacterSprite, Dir, PropSprite } from "../sprites.ts";

// ── Core vocabularies ────────────────────────────────────────────────────

export const STAT_KEYS = ["power", "agility", "body", "spirit", "wit", "tact"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAMES: Readonly<Record<StatKey, string>> = {
  power: "완력",
  agility: "신법",
  body: "근골",
  spirit: "기백",
  wit: "지략",
  tact: "처세",
};
export const STAT_HELP: Readonly<Record<StatKey, string>> = {
  power: "근접 피해 +2.5%/점",
  agility: "활 피해 +2.5%/점, 이동속도·치명타",
  body: "최대 체력 +10/점, 사경 시간",
  spirit: "기술 피해 +2%/점, 기력 회복",
  wit: "정치 판정·협상, 풍향계 정밀도(30+)",
  tact: "총애 획득, 숙청 위험 −1/점, 의심 감소",
};

export const NATION_KEYS = ["defense", "finance", "people", "diplomacy", "reform"] as const;
export type NationKey = (typeof NATION_KEYS)[number];
/** Nation indicator or the foreign-infiltration meter (shown from CH14). */
export type NationMeter = NationKey | "infiltration";
export const NATION_NAMES: Readonly<Record<NationMeter, string>> = {
  defense: "국방",
  finance: "재정",
  people: "민심",
  diplomacy: "외교",
  reform: "개혁",
  infiltration: "침투도",
};

export const POINT_KEYS = ["money", "merit", "virtue", "fame", "honor"] as const;
export type PointKey = (typeof POINT_KEYS)[number];
export const POINT_NAMES: Readonly<Record<PointKey, string>> = {
  money: "전",
  merit: "공적",
  virtue: "공덕",
  fame: "명망",
  honor: "명예",
};

export const CHAPTER_IDS = [
  "ch01", "ch02", "ch03", "ch04", "ch05", "ch06", "ch07", "ch08",
  "ch09", "ch10", "ch11", "ch12", "ch13", "ch14", "ch15", "ch16",
] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];

export const BRANCH_IDS = [
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12a", "B12b", "B12c",
] as const;
export type BranchId = (typeof BRANCH_IDS)[number];

export type OriginId = "northeast" | "kaesong" | "southcoast";
export type WashMethod = "descendant" | "fakeDeath" | "monk" | "merchant" | "exam";
export type IdentityKind = "birth" | WashMethod | "forced" | "successor";
export type FlagValue = boolean | number | string;

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "clear" | "rain" | "snow" | "fog" | "smoke";
export type MusicMood =
  | "title" | "goryeo_twilight" | "founding" | "court" | "peace" | "intrigue"
  | "war" | "naval" | "siege" | "reform" | "turmoil" | "modern" | "resistance"
  | "years" | "ending_good" | "ending_bad";

/** Tile offset relative to a site centre. */
export type Offset = readonly [number, number];

// ── Conditions and effects ───────────────────────────────────────────────

interface Range {
  min?: number;
  max?: number;
}

export type Cond =
  | { k: "all"; of: readonly Cond[] }
  | { k: "any"; of: readonly Cond[] }
  | { k: "not"; of: Cond }
  | ({ k: "stat"; stat: StatKey } & Range)
  | ({ k: "point"; point: PointKey } & Range)
  | ({ k: "nation"; key: NationMeter } & Range)
  | ({ k: "favor"; faction: string } & Range)
  | ({ k: "bond"; npc: string } & Range)
  | ({ k: "rank" } & Range)
  | ({ k: "level" } & Range)
  | ({ k: "suspicion" } & Range)
  | ({ k: "year" } & Range)
  | ({ k: "lifeEnd" } & Range)
  | { k: "flag"; flag: string; eq?: FlagValue }
  | { k: "branch"; id: BranchId; ok?: boolean }
  | { k: "aligned"; faction: string | null }
  | { k: "identity"; kind: IdentityKind }
  | { k: "origin"; origin: OriginId }
  | { k: "item"; item: string; count?: number }
  | { k: "battleWon"; battle: string };

/** Deterministic political purge check (see rules/politics.ts). */
export interface PurgeSpec {
  /** Stable id; the roll is hash(playerSeed, id) so reloading cannot reroll. */
  id: string;
  /** Event intensity E (e.g. 1차 왕자의 난 45, 계유정난 60). */
  intensity: number;
  winner: string | null;
  loser: string | null;
  /** Player stayed neutral: E −15, gains halved by the caller's effects. */
  neutral?: boolean;
  /** Site for exile outcomes. */
  exileSite?: string;
}

export type Effect =
  | { k: "stat"; stat: StatKey; add: number }
  | { k: "point"; point: PointKey; add: number }
  | { k: "exp"; add: number }
  | { k: "nation"; key: NationMeter; add: number }
  | { k: "longFlag"; flag: string; key: NationKey; add: number }
  | { k: "favor"; faction: string; add: number }
  | { k: "align"; faction: string | null }
  | { k: "bond"; npc: string; add: number }
  | { k: "rank"; add?: number; set?: number }
  | { k: "suspicion"; add: number }
  | { k: "life"; add: number }
  | { k: "flag"; flag: string; value?: FlagValue }
  | { k: "branch"; id: BranchId; ok: boolean }
  | { k: "item"; item: string; add: number }
  | { k: "skill"; skill: string }
  | { k: "title"; title: string }
  | { k: "meritSubject"; grade: 1 | 2 | 3 | 4 }
  | { k: "chronicle"; text: string }
  | { k: "toast"; text: string; tone?: "info" | "good" | "bad" | "warn" | "epic" }
  | { k: "wash"; method: WashMethod | "forced" }
  | { k: "exile"; site: string }
  | { k: "goto"; site: string; offset?: Offset }
  | { k: "purge"; spec: PurgeSpec }
  | {
      k: "check";
      /** Stable id for the deterministic roll. */
      id: string;
      label: string;
      stat?: StatKey;
      /** Success chance % = base + per × stat (clamped 5..95). */
      base: number;
      per?: number;
      success: readonly Effect[];
      failure: readonly Effect[];
    }
  | { k: "if"; cond: Cond; then: readonly Effect[]; else?: readonly Effect[] }
  | { k: "prompt"; prompt: string }
  | { k: "battle"; battle: string }
  | { k: "objective"; objective: string }
  | { k: "worldEvent"; add: number };

// ── Story prompts (dialogue with choices) ────────────────────────────────

export interface OptionDef {
  id: string;
  text: string;
  /** Visible consequence hint, e.g. "이성계파 총애 ▲ · 숙청 위험 ▲". */
  hint?: string;
  requires?: Cond;
  /** Shown disabled with this reason when `requires` fails (else hidden). */
  lockedText?: string;
  effects: readonly Effect[];
  /** When set, the UI shows the 풍향계 risk R for this option before choosing. */
  risk?: PurgeSpec;
}

export interface PromptDef {
  id: string;
  title: string;
  speaker?: { name: string; sprite?: CharacterSprite };
  body: readonly string[];
  /** One option = acknowledgement ("계속"). */
  options: readonly OptionDef[];
  /** Montage cards use a compact card layout. */
  style?: "story" | "card" | "history";
}

// ── World population ─────────────────────────────────────────────────────

export interface NpcDef {
  id: string;
  name: string;
  /** Role line under the name, e.g. "동북면 원수". */
  title?: string;
  sprite: CharacterSprite;
  site: string;
  offset?: Offset;
  dir?: Dir;
  /** Real historical person (shown with a 실존 badge in UI). */
  historical?: boolean;
  /** Ambient lines when talked to with nothing pending. */
  talk: readonly string[];
  /** Visible only within these chapter steps (inclusive, by step id). */
  fromStep?: string;
  untilStep?: string;
  /** Follows and fights beside the player during battles at this site. */
  fights?: boolean;
}

export type EnemyBehavior =
  | "melee"
  | "brute"
  | "archer"
  | "charger"
  | "shield"
  | "musket"
  | "rifle"
  | "beast"
  | "boss";

export interface EnemyDef {
  id: string;
  /** Named by allegiance and arm, e.g. "왜구 궁수" — never ethnic slurs. */
  name: string;
  sprite: CharacterSprite;
  behavior: EnemyBehavior;
  hp: number;
  atk: number;
  def: number;
  /** Tiles per second. */
  speed: number;
  /** Attack reach in tiles (melee ~1.2, archers 6, muskets 8). */
  range: number;
  /** Seconds between attacks. */
  cooldown: number;
  /** Sight radius in tiles. */
  sight: number;
  /** Stagger resistance (balance gauge size). */
  poise: number;
  elite?: boolean;
  drops?: readonly { item: string; chance: number }[];
}

export interface BossPhase {
  /** Phase begins when HP ratio falls to this value (1 = from start). */
  at: number;
  /** Mechanic keyword interpreted by sim/battle.ts. */
  mechanic:
    | "charge"
    | "spin"
    | "summon"
    | "guard_front"
    | "fire_zone"
    | "volley"
    | "cannon"
    | "frenzy"
    | "shield_wall";
  line?: string;
  summon?: { enemy: string; count: number };
}

export interface BossDef {
  enemy: string;
  name: string;
  title?: string;
  level: number;
  hpScale: number;
  phases: readonly BossPhase[];
  /** Closing narration if a historical figure lands the final blow. */
  finisher?: string;
}

export interface SpawnDef {
  id: string;
  enemy: string;
  site: string;
  offset?: Offset;
  radius: number;
  count: number;
  level: number;
  respawnSec?: number;
  fromStep?: string;
  untilStep?: string;
}

export interface WaveDef {
  /** Seconds after battle start (or after the previous wave is cleared if omitted). */
  at?: number;
  enemies: readonly { enemy: string; count: number; level: number }[];
  /** Spawn side relative to the battle centre. */
  from?: "north" | "south" | "east" | "west" | "around" | "sea";
  line?: string;
}

export type BattleKind =
  | "waves"
  | "boss"
  | "survive"
  | "defend"
  | "escape"
  | "deck"
  | "duel";

export interface BattleDef {
  id: string;
  title: string;
  /** Short subtitle, e.g. "1380 · 운봉 황산". */
  subtitle?: string;
  site: string;
  offset?: Offset;
  /** Arena radius in tiles; leaving it during a battle is blocked by a ring. */
  radius: number;
  kind: BattleKind;
  intro?: readonly string[];
  waves: readonly WaveDef[];
  boss?: BossDef;
  /** survive/escape/defend: seconds to hold. */
  timeLimit?: number;
  /** defend: the protected object. */
  defend?: { name: string; sprite: CharacterSprite | PropSprite; hp: number };
  allies?: readonly { sprite: CharacterSprite; name: string; count: number }[];
  /** A 대전(大戰): first victory grants +2 lifespan years and appears in 연대기. */
  great?: boolean;
  /** Enemy HP/count scale with participants (MMO world-event scaling). */
  scaled?: boolean;
  music?: MusicMood;
  weather?: Weather;
  victory: readonly Effect[];
  defeat: readonly Effect[];
}

// ── Chapter flow ─────────────────────────────────────────────────────────

export type ObjectiveKind =
  | "talk"
  | "reach"
  | "defeat"
  | "battle"
  | "prompt"
  | "collect"
  | "auto";

export interface ObjectiveDef {
  id: string;
  text: string;
  kind: ObjectiveKind;
  /** npc id (talk), site id (reach), enemy id (defeat), battle id, prompt id, item id. */
  target?: string;
  count?: number;
  /** Marker location for UI and companions. */
  site?: string;
  offset?: Offset;
  optional?: boolean;
  requires?: Cond;
  /** talk: prompt opened when talking to the target NPC for this objective. */
  prompt?: string;
  onComplete?: readonly Effect[];
}

export interface StepDef {
  id: string;
  /** In-game year shown while this step is active. */
  year: number;
  /** Narration card shown when the step starts. */
  narration?: readonly string[];
  objectives: readonly ObjectiveDef[];
  onEnter?: readonly Effect[];
}

export interface FactionDef {
  id: string;
  name: string;
  /** Faction power 0..100 at chapter start. */
  power: number;
  /** Successor faction in a later chapter inherits 50% of favor. */
  lineage?: string;
  desc?: string;
}

export interface ChapterDef {
  id: ChapterId;
  order: number;
  title: string;
  subtitle: string;
  years: readonly [number, number];
  level: readonly [number, number];
  music: MusicMood;
  season: Season;
  weather: Weather;
  /** Hour of day 0..24 for lighting. */
  hour: number;
  start: { site: string; offset?: Offset };
  /** Narration shown on entering the chapter. */
  briefing: readonly string[];
  /** 실제 역사 노트 lines (facts; mark interpretations with [해석]). */
  history: readonly string[];
  /** Historical nation baseline at chapter start (carry-over formula). */
  hist: Readonly<Record<NationKey, number>>;
  factions: readonly FactionDef[];
  ruling?: string;
  npcs: readonly NpcDef[];
  spawns: readonly SpawnDef[];
  battles: readonly BattleDef[];
  prompts: readonly PromptDef[];
  steps: readonly StepDef[];
  /** Montage chapters play mostly as cards during the passage of years. */
  montage?: boolean;
  /** 공동 실록 world event shown to the channel. */
  worldEvent?: { title: string; desc: string; goal: number };
  /** Simulated companions in the offline channel. */
  companions: number;
  /** Skills unlocked when the chapter starts. */
  unlocks?: readonly string[];
}

// ── Items, skills, origins, ranks, endings ───────────────────────────────

export type ItemKind = "weapon" | "armor" | "consumable" | "treasure" | "key";

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
  atk?: number;
  def?: number;
  heal?: number;
  /** Lifespan years granted on use (산삼). */
  life?: number;
  price?: number;
  /** Era weapon family: sword, spear, bow, musket, rifle. */
  family?: "sword" | "spear" | "bow" | "musket" | "rifle";
}

export type SkillKind =
  | "dash"
  | "spin"
  | "shout"
  | "pierce"
  | "rockets"
  | "barrage"
  | "parry"
  | "bomb"
  | "musket"
  | "rifle"
  | "longevity";

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  kind: SkillKind;
  /** Chapter in which it unlocks (or via an effect). */
  unlock: ChapterId;
  energy: number;
  cooldown: number;
  coef: number;
  range?: number;
  radius?: number;
}

export interface OriginDef {
  id: OriginId;
  name: string;
  desc: string;
  stats: Partial<Readonly<Record<StatKey, number>>>;
  favor?: Readonly<Record<string, number>>;
  points?: Partial<Readonly<Record<PointKey, number>>>;
}

export interface RankDef {
  /** 1 = 종9품 … 18 = 정1품. */
  step: number;
  grade: string;
  /** 당상관 (step ≥ 14). */
  senior: boolean;
}

export interface OfficeTable {
  /** First year this table applies. */
  from: number;
  /** Office title by rank step (index 0 = 무직). */
  titles: readonly string[];
}

export interface NationEndingDef {
  id: "N1" | "N2" | "N3";
  title: string;
  body: readonly string[];
  music: MusicMood;
}

export interface PersonalEndingDef {
  id: "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
  title: string;
  body: readonly string[];
}

export interface CompanionPersona {
  name: string;
  /** Short flavour shown in the roster, e.g. "개경 출신 궁수". */
  title: string;
  sprite: CharacterSprite;
  variant: "m" | "f";
  style: "brave" | "cautious" | "chatty" | "quiet" | "scholar";
}

export interface CompanionLines {
  greet: readonly string[];
  battle: readonly string[];
  victory: readonly string[];
  revive: readonly string[];
  downed: readonly string[];
  idle: readonly string[];
  /** Chapter-specific chatter (about the era, never spoilers of later eras). */
  byChapter: Partial<Readonly<Record<ChapterId, readonly string[]>>>;
}
