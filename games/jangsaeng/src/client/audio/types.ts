// Public contract of the procedural audio engine. Everything audible is
// synthesized with the Web Audio API; there are no audio assets.

export type MusicMood =
  | "title" | "goryeo_twilight" | "founding" | "court" | "peace" | "intrigue"
  | "war" | "naval" | "siege" | "reform" | "turmoil" | "modern" | "resistance"
  | "years" | "ending_good" | "ending_bad";

export type SfxName =
  | "swing" | "hit" | "hit_heavy" | "crit" | "bow" | "arrow_hit" | "gun" | "cannon" | "explosion"
  | "hurt" | "death" | "enemy_death" | "block" | "pickup" | "coin" | "levelup" | "quest" | "quest_done"
  | "ui_click" | "ui_open" | "ui_close" | "choice" | "gong" | "drum" | "bell" | "years_pass"
  | "warning" | "footstep" | "splash" | "fire" | "chat" | "denied" | "heal" | "skill";

export interface SfxOptions {
  /** Stereo position, -1 (left) … 1 (right). */
  pan?: number;
  /** Linear gain multiplier (default 1, clamped to 0…2). */
  gain?: number;
  /** Pitch multiplier (default 1, clamped to 0.25…4). */
  pitch?: number;
}

export interface AudioVolumes {
  master?: number;
  music?: number;
  sfx?: number;
}

export interface AudioEngine {
  /** Must be called from a user gesture (click/touch/key) to start audio on mobile. Safe to call repeatedly. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  /** Crossfades (~2 s) to the mood; null fades out. Calling with the current mood is a no-op. */
  setMusic(mood: MusicMood | null): void;
  sfx(name: SfxName, opts?: SfxOptions): void;
  setVolumes(v: AudioVolumes): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Stops scheduling and releases nodes (tab hidden / teardown). */
  suspend(): void;
  resume(): void;
}

// Exhaustive keyed tables so the lists below cannot drift from the unions.
const moodKeys = {
  title: 1, goryeo_twilight: 1, founding: 1, court: 1, peace: 1, intrigue: 1,
  war: 1, naval: 1, siege: 1, reform: 1, turmoil: 1, modern: 1, resistance: 1,
  years: 1, ending_good: 1, ending_bad: 1,
} satisfies Record<MusicMood, 1>;

const sfxKeys = {
  swing: 1, hit: 1, hit_heavy: 1, crit: 1, bow: 1, arrow_hit: 1, gun: 1, cannon: 1, explosion: 1,
  hurt: 1, death: 1, enemy_death: 1, block: 1, pickup: 1, coin: 1, levelup: 1, quest: 1, quest_done: 1,
  ui_click: 1, ui_open: 1, ui_close: 1, choice: 1, gong: 1, drum: 1, bell: 1, years_pass: 1,
  warning: 1, footstep: 1, splash: 1, fire: 1, chat: 1, denied: 1, heal: 1, skill: 1,
} satisfies Record<SfxName, 1>;

export const MUSIC_MOODS = Object.keys(moodKeys) as readonly MusicMood[];
export const SFX_NAMES = Object.keys(sfxKeys) as readonly SfxName[];
