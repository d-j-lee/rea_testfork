// DRAFT core state and view types — finalised after the GDD lands.
import type {
  Anim,
  BodyVariant,
  Dir,
  EffectKind,
  SpriteKey,
} from "./sprites.ts";

export type EntityKind =
  | "player"
  | "bot"
  | "npc"
  | "enemy"
  | "ally"
  | "prop"
  | "projectile";
export type Team = "self" | "player" | "ally" | "npc" | "enemy" | "boss";

export interface EntitySnap {
  id: number;
  k: EntityKind;
  s: SpriteKey;
  x: number;
  y: number;
  d: Dir;
  a: Anim;
  /** HP percentage 0..100 (omitted for props). */
  hp?: number;
  n?: string;
  title?: string;
  lvl?: number;
  tm: Team;
  v?: BodyVariant;
  /** Emote/quest marker shown above the head. */
  mk?: "talk" | "quest" | "questDone" | "alert" | "zzz" | "heart" | "anger";
}

export interface FxEvent {
  k: EffectKind | "text" | "sfx";
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  d?: Dir;
  text?: string;
  color?: string;
  crit?: boolean;
  sfx?: string;
}

export interface ChapterView {
  id: string;
  title: string;
  subtitle: string;
  years: readonly [number, number];
  briefing: string[];
  music: string;
  season: "spring" | "summer" | "autumn" | "winter";
  weather: "clear" | "rain" | "snow" | "fog" | "smoke";
  hour: number;
}

export interface PromptOptionView {
  id: string;
  text: string;
  hint?: string;
  disabled?: string;
}

export interface PromptView {
  id: string;
  kind: "story" | "years" | "result" | "notice" | "identity" | "death";
  title: string;
  speaker?: { name: string; sprite?: SpriteKey };
  body: string[];
  options: PromptOptionView[];
  year?: number;
}

export interface RosterEntry {
  name: string;
  kind: "player" | "bot";
  level: number;
  title: string;
}

export interface EndingView {
  id: string;
  title: string;
  body: string[];
  stats: { label: string; value: string }[];
}

export interface SelfView {
  [key: string]: unknown;
}

export interface PlayerSave {
  version: number;
  token: string;
  name: string;
  [key: string]: unknown;
}
