// Persistent player state and the views the host sends to clients.
import type {
  BranchId,
  ChapterId,
  FlagValue,
  IdentityKind,
  MusicMood,
  NationKey,
  NationMeter,
  OriginId,
  PointKey,
  Season,
  StatKey,
  Weather,
} from "./content/schema.ts";
import type { Anim, BodyVariant, CharacterSprite, Dir, EffectKind, SpriteKey } from "./sprites.ts";

export const SAVE_VERSION = 1;
/** Year the hero awakens under the Old Man Star (노인성), aged 16. */
export const AWAKENING_YEAR = 1361;
export const AWAKENING_AGE = 16;
/** Natural lifespan: lifeEnd starts at AWAKENING_YEAR + 500 = 1861. */
export const BASE_LIFESPAN = 500;
export const FINAL_YEAR = 1910;

/**
 * Demo-mode starting histories: `history` keeps the historical baselines;
 * `reform` assumes the earlier chapters went well (branches won, best carry-over).
 */
export const DEMO_PATHS = ["history", "reform"] as const;
export type DemoPath = (typeof DEMO_PATHS)[number];

export interface IdentityRecord {
  name: string;
  kind: IdentityKind;
  from: number;
  to?: number;
}

export interface ChronicleEntry {
  year: number;
  text: string;
  tone?: "info" | "good" | "bad" | "epic";
}

export interface PlayerSave {
  version: number;
  token: string;
  /** Seed for deterministic per-player rolls (purge checks, skill checks). */
  seed: number;
  /** True for demo-mode characters created from a chapter preset. */
  demo: boolean;
  birthName: string;
  name: string;
  variant: BodyVariant;
  origin: OriginId;
  identity: { kind: IdentityKind; startYear: number; startAge: number };
  identities: IdentityRecord[];
  level: number;
  exp: number;
  stats: Record<StatKey, number>;
  freePoints: number;
  points: Record<PointKey, number>;
  /** Year the natural lifespan ends; the hero dies when year > lifeEnd. */
  lifeEnd: number;
  /** 노인성의 마지막 은혜 (+10 years once). */
  graceUsed: boolean;
  /** 노인성 일섬 uses in the current chapter (max 3). */
  longevityUses: number;
  /** Lifespan years granted by virtue offering in the current chapter (max 5). */
  offeredThisChapter: number;
  suspicion: number;
  rank: number;
  /** 개국공신 grade: 1-3 등, 4 = 원종공신. */
  meritSubject?: 1 | 2 | 3 | 4;
  titles: string[];
  favor: Record<string, number>;
  aligned: string | null;
  nation: Record<NationKey, number>;
  infiltration: number;
  /** Permanent bonuses carried across chapters by long-term flags. */
  longFlags: Record<string, { key: NationKey; add: number }>;
  branches: Partial<Record<BranchId, boolean>>;
  flags: Record<string, FlagValue>;
  bonds: Record<string, number>;
  inventory: Record<string, number>;
  equipment: { weapon: string; armor: string };
  skills: string[];
  /** Up to four equipped skill ids (slots 1-4). */
  skillSlots: string[];
  chapter: ChapterId;
  /** Index into the chapter's steps. */
  step: number;
  year: number;
  /** Progress counters by objective id for the current step. */
  objectives: Record<string, number>;
  promptsDone: string[];
  battlesWon: string[];
  /** Pending exile site: next chapter starts there. */
  exile?: string;
  /** Last position (tiles) for resuming; omitted at chapter start. */
  position?: { x: number; y: number };
  chronicle: ChronicleEntry[];
  record: {
    kills: number;
    bossKills: number;
    selfRevives: number;
    revivesGiven: number;
    washes: number;
    purgesSurvived: number;
    turncoat: number;
    lifeGained: number;
    lifeSpent: number;
  };
  successor?: { generation: number };
  ending?: EndingResult;
}

export interface EndingResult {
  nation: "N1" | "N2" | "N3";
  personal: "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
  score: number;
  breakdown: { label: string; value: number }[];
}

// ── Views ────────────────────────────────────────────────────────────────

export type EntityKind = "player" | "bot" | "npc" | "enemy" | "ally" | "prop";
export type Team = "self" | "player" | "ally" | "npc" | "enemy" | "boss";
export type Marker = "talk" | "quest" | "questDone" | "alert" | "zzz" | "heart" | "anger";

export interface EntitySnap {
  id: number;
  k: EntityKind;
  s: SpriteKey;
  x: number;
  y: number;
  d: Dir;
  a: Anim;
  /** Milliseconds since the current animation started (for frame sync). */
  at?: number;
  /** HP percentage 0..100. */
  hp?: number;
  n?: string;
  title?: string;
  lvl?: number;
  tm: Team;
  v?: BodyVariant;
  mk?: Marker;
  /** Downed (사경) — waiting for revive. */
  down?: boolean;
  /** Historical figure badge. */
  hist?: boolean;
}

export type Telegraph =
  | { shape: "line"; x: number; y: number; tx: number; ty: number; ms: number }
  | { shape: "circle"; x: number; y: number; r: number; ms: number }
  | { shape: "cone"; x: number; y: number; angle: number; spread: number; r: number; ms: number };

export interface FxEvent {
  k: EffectKind | "text" | "sfx" | "telegraph" | "shake" | "hitstop";
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  d?: Dir;
  angle?: number;
  text?: string;
  color?: string;
  crit?: boolean;
  /** For k="sfx": an SfxName understood by the audio engine. */
  sfx?: string;
  tg?: Telegraph;
  /** Strength for shake (px) or duration for hitstop (ms). */
  power?: number;
}

export interface ChapterView {
  id: ChapterId;
  order: number;
  title: string;
  subtitle: string;
  years: readonly [number, number];
  briefing: readonly string[];
  history: readonly string[];
  music: MusicMood;
  season: Season;
  weather: Weather;
  hour: number;
  montage: boolean;
}

export interface PromptOptionView {
  id: string;
  text: string;
  hint?: string;
  disabled?: string;
  /** 풍향계: purge risk R (0..100); `exact` false means ±10 blur. */
  risk?: { value: number; exact: boolean };
}

export interface PromptView {
  id: string;
  kind: "story" | "card" | "history" | "years" | "result" | "identity" | "death" | "notice" | "negotiation";
  title: string;
  speaker?: { name: string; sprite?: CharacterSprite; historical?: boolean };
  body: string[];
  options: PromptOptionView[];
  year?: number;
  /** Extra structured payload for special prompts (years planner, results). */
  data?: YearsPlanView | ResultView;
}

export interface YearsActivityView {
  id: string;
  name: string;
  desc: string;
  effect: string;
  disabled?: string;
}

export interface YearsPlanView {
  type: "years";
  fromYear: number;
  toYear: number;
  tokens: number;
  activities: YearsActivityView[];
  washes: { id: string; name: string; desc: string; disabled?: string }[];
  /** Suggest washing when suspicion is high. */
  washAdvised: boolean;
  lifeEnd: number;
  virtue: number;
  canOffer: number;
}

export interface ResultView {
  type: "result";
  lines: { text: string; tone: "info" | "good" | "bad" | "epic" }[];
}

export interface ObjectiveView {
  id: string;
  text: string;
  done: boolean;
  optional: boolean;
  progress?: readonly [number, number];
  /** Marker position in tiles, when the objective has a place. */
  x?: number;
  y?: number;
  siteName?: string;
}

export interface SkillView {
  id: string;
  name: string;
  desc: string;
  energy: number;
  cooldown: number;
  /** Seconds remaining. */
  ready: number;
  slot: number | null;
  kind: string;
}

export interface ItemView {
  id: string;
  name: string;
  kind: string;
  desc: string;
  count: number;
  equipped: boolean;
}

export interface FactionView {
  id: string;
  name: string;
  power: number;
  favor: number;
  ruling: boolean;
  aligned: boolean;
  desc?: string;
}

export interface BattleView {
  id: string;
  title: string;
  subtitle?: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  /** Remaining seconds for timed battles. */
  timeLeft?: number;
  wave?: readonly [number, number];
  boss?: { name: string; hp: number; title?: string };
  defend?: { name: string; hp: number };
  morale?: number;
  participants: number;
}

export interface SelfView {
  id: number;
  name: string;
  birthName: string;
  identityKind: IdentityKind;
  identities: IdentityRecord[];
  variant: BodyVariant;
  origin: OriginId;
  sprite: CharacterSprite;
  level: number;
  exp: number;
  expNext: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  stamina: number;
  stats: Record<StatKey, number>;
  freePoints: number;
  points: Record<PointKey, number>;
  year: number;
  /** Real age since birth (awakened at 16 in 1361). */
  age: number;
  /** Looks: 16 + years since awakening / 12. */
  apparentAge: number;
  lifeEnd: number;
  /** Projected year of death vs. FINAL_YEAR, for the HUD warning. */
  lifeShortfall: number;
  longevityUses: number;
  suspicion: number;
  suspicionBand: "calm" | "rumour" | "inquiry" | "exposed";
  rank: number;
  rankName: string;
  office: string;
  titles: string[];
  meritSubject?: 1 | 2 | 3 | 4;
  factions: FactionView[];
  nation: Record<NationMeter, number>;
  showInfiltration: boolean;
  branches: Partial<Record<BranchId, boolean>>;
  chapter: { id: ChapterId; title: string; order: number; stepYear: number };
  objectives: ObjectiveView[];
  skills: SkillView[];
  inventory: ItemView[];
  equipment: { weapon: string; armor: string };
  chronicle: ChronicleEntry[];
  bonds: { id: string; name: string; value: number }[];
  downed?: { secondsLeft: number };
  battle?: BattleView;
  worldEvent?: { title: string; desc: string; progress: number };
  channel: { id: string; name: string; players: number; companions: number };
  demo: boolean;
  dead?: boolean;
}

export interface RosterEntry {
  name: string;
  kind: "player" | "bot";
  level: number;
  title: string;
}

export interface EndingView {
  nation: { id: string; title: string; body: string[] };
  personal: { id: string; title: string; body: string[] };
  score: number;
  breakdown: { label: string; value: number }[];
  nationValues: Record<NationMeter, number>;
  branches: { id: BranchId; label: string; ok: boolean | null }[];
  identities: IdentityRecord[];
  lifeline: { lifeEnd: number; gained: number; spent: number };
  chronicle: ChronicleEntry[];
  record: PlayerSave["record"];
  historyNote: string[];
}

export type { Anim, Dir, FlagValue };
