// Persistent player state and the views the host sends to clients.
import type {
  BranchId,
  ChapterId,
  FlagValue,
  HistoryNote,
  IdentityKind,
  InputHint,
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
/** The path a demo takes when none is named. */
export const DEFAULT_DEMO_PATH: DemoPath = "history";

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
  /** A counterfactual (대체역사) outcome. */
  alt?: true;
}

/**
 * Story work the session owes the player across a reload, kept in the order it
 * comes: a card an effect raised (`prompt`, a PromptDef id), the 사사 위기 card
 * (`escape`, `<chapter>:<year>` of the sentence) and a story battle waiting
 * behind cards (`battle`, a BattleDef id). The step rebuilds everything else.
 */
export interface PendingStory {
  kind: "prompt" | "escape" | "battle";
  id: string;
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
  /** Cards and held battles still owed, first to come first (PendingStory). */
  pending: PendingStory[];
  /**
   * Demo preset of a chapter with ChapterDef.demoStart: the step the demo opens
   * at. On first entry the session plays the steps before it with 건너뛰기, then
   * clears this.
   */
  demoEntry?: string;
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
  /** The sum of the breakdown rows; every row and the score are settled to 0.1. */
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
  history: readonly HistoryNote[];
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
  /** A counterfactual scene (대체역사 tag). */
  alt?: boolean;
  year?: number;
  /** Extra structured payload for special prompts (years planner, results). */
  data?: YearsPlanView | ResultView;
}

/**
 * One activity of the years planner. life, virtue and money are what one token
 * of it does to the numbers the planner projects (rules projectYears); absent
 * means none.
 */
export interface YearsActivityView {
  id: string;
  name: string;
  desc: string;
  effect: string;
  disabled?: string;
  /** 천수 years (산중 수행 +1). */
  life?: number;
  /** 공덕 gained (선행·구휼 +60). */
  virtue?: number;
  /** 전 earned (+) or spent (−); a token that spends runs only while the purse holds it. */
  money?: number;
}

/** One identity wash of the years planner, with what projectYears needs (absent: none). */
export interface YearsWashView {
  id: string;
  name: string;
  desc: string;
  disabled?: string;
  /** 천수 years it costs (전사 위장 −1). */
  life?: number;
  /** 전 it needs; absent when it gives the whole purse away instead (출가). */
  cost?: number;
  /** 공덕 per 100전 it gives away (출가 +10). */
  alms?: number;
}

export interface YearsPlanView {
  type: "years";
  /** The year counter moves from fromYear to toYear when the plan is confirmed. */
  fromYear: number;
  toYear: number;
  /** The era the tokens stand for: this chapter's start → the next chapter's start. */
  eraFrom: number;
  eraTo: number;
  tokens: number;
  /** One consecutive span of the era per token. */
  spans: { from: number; to: number }[];
  /** Planner heading for the tokens, e.g. "1659~1776년, 이 시대를 어떻게 보냈나 · 5마디". */
  summary: string;
  activities: YearsActivityView[];
  washes: YearsWashView[];
  /** Suggest washing when suspicion is high. */
  washAdvised: boolean;
  lifeEnd: number;
  /** 공덕 held before the passage; the 노인성 봉헌 buys a year per 100 of it and what the plan adds. */
  virtue: number;
  /** 전 in hand when the tokens start: the purse once the chapter's salary is paid. */
  purse: number;
  /**
   * 노인성 감응 on leaving this chapter, when it is still due: `years`, and
   * `bonus` more once the passage has gained `bonusAt` 공덕 (0: already earned).
   */
  resonance?: { years: number; bonus: number; bonusAt: number };
  /**
   * 노인성의 마지막 은혜: the years it adds, present only while it can be taken.
   * Once in a run and it takes all 공덕 left and 10 명망, so only the player
   * chooses it; it is never part of `suggested`.
   */
  graceYears?: number;
  /** The plan a plain confirm submits; the planner starts from it. */
  suggested: { activities: string[]; offer: boolean };
  /**
   * The name a wash takes unless the player writes another: the planner's name
   * field starts with it, and the rules use it when the plan sends no valid
   * name (rules yearsPlan).
   */
  suggestedName: string;
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
  /** Controls this objective teaches, named for the player's device by the HUD. */
  hint?: readonly InputHint[];
  /** ObjectiveDef.solemn: finishing it is no achievement, so the HUD plays no completion sound. */
  solemn?: true;
  /** The battle it starts is counterfactual (BattleDef.alt): the HUD tags it 대체역사. */
  alt?: true;
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
  /** A counterfactual battle (BattleDef.alt): the banner tags it 대체역사. */
  alt?: true;
  kind: string;
  x: number;
  y: number;
  radius: number;
  /** Remaining seconds for timed battles. */
  timeLeft?: number;
  wave?: readonly [number, number];
  /** `historical`: a person named in the record (else an invented boss, marked 가상). */
  boss?: { name: string; hp: number; title?: string; historical: boolean };
  defend?: { name: string; hp: number };
  morale?: number;
  /** How many fight it: everyone at its ring who still has it to fight (sim/battle.ts muster). */
  participants: number;
  /** The battle's music (BattleDef.music), when it sets one; the client plays it in place of the chapter's. */
  music?: MusicMood;
  /**
   * The battle's own weather and hour (BattleDef.weather/hour), each sent
   * whenever the battle sets it, even if the chapter's is the same; the
   * client shows them over the arena in place of the chapter's.
   */
  weather?: Weather;
  hour?: number;
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

/** The 1910 settlement as decided: every number is the one the ending was judged on. */
export interface EndingView {
  nation: { id: string; title: string; body: string[] };
  personal: { id: string; title: string; body: string[] };
  /** The settled score: exactly the sum of the breakdown rows, all at 0.1 (show them with one decimal). */
  score: number;
  breakdown: { label: string; value: number }[];
  /** Meters at the settlement; infiltration is the final value (unresolved branches counted as failed). */
  nationValues: Record<NationMeter, number>;
  /** Branch states settled for 1910: anything not won counts as failed. */
  branches: { id: BranchId; label: string; ok: boolean }[];
  identities: IdentityRecord[];
  lifeline: { lifeEnd: number; gained: number; spent: number };
  chronicle: ChronicleEntry[];
  record: PlayerSave["record"];
  historyNote: HistoryNote[];
}

export type { Anim, Dir, FlagValue };
