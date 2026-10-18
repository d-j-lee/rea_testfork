// Static music tables: scales, 장단 stroke patterns and per-mood
// arrangements (voices, tempo, intensity arc, percussion) consumed by the
// generator in music.ts.

import type { MelodicVoice } from "./instruments.ts";
import type { MusicMood } from "./types.ts";

export type ScaleId = "pyeong" | "gyemyeon" | "minor";
// 평조 (황 태 중 임 남: sol-mode pentatonic), 계면조 (la-mode pentatonic; 떠는음 on
// the fifth, 꺾는음 on the minor third), and natural minor for 개화기 colour.
export const SCALES: Readonly<Record<ScaleId, readonly number[]>> = {
  pyeong: [0, 2, 5, 7, 9],
  gyemyeon: [0, 3, 5, 7, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export interface Jangdan {
  /** Substeps per beat (uneven for 엇모리). */
  readonly groups: readonly number[];
  /** One 장구 stroke per substep ("-" is silence). */
  readonly main: string;
  /** Variation for the last bar of a phrase. */
  readonly fill: string;
  /** Average substeps per beat, for tempo. */
  readonly beat: number;
}

const twos = (n: number): number[] => Array.from({ length: n }, () => 2);
export const JANGDAN = {
  semachi: { groups: [3, 3, 3], main: "D--D-TKT-", fill: "D--D-TKRT", beat: 3 },
  gutgeori: { groups: [3, 3, 3, 3], main: "D-GK-RK-GK-R", fill: "D-GK-RD-GDTR", beat: 3 },
  jungmori: { groups: twos(12), main: "D---K-----T-K---D---K-T-", fill: "D---K---K-T-K---D-T-K-RR", beat: 2 },
  jajinmori: { groups: [3, 3, 3, 3], main: "D-TKT-K-TKT-", fill: "D-TKT-D-TDRR", beat: 3 },
  hwimori: { groups: [2, 2, 2, 2], main: "D-TTK-T-", fill: "D-TTDTRR", beat: 2 },
  eotmori: { groups: [3, 2, 3, 2], main: "D-KT-K-TK-", fill: "D-KT-D-TRR", beat: 2.5 },
  daechwita: { groups: [2, 2, 2, 2], main: "D---K-k-", fill: "D-K-D-KT", beat: 2 },
  slow4: { groups: [2, 2, 2, 2], main: "D-------", fill: "D-----k-", beat: 2 },
  slow6: { groups: twos(6), main: "D-----K---t-", fill: "D---K-----TK", beat: 2 },
  waltz: { groups: [2, 2, 2], main: "k-t-t-", fill: "k-t-tt", beat: 2 },
} satisfies Record<string, Jangdan>;
export type JangdanId = keyof typeof JANGDAN;

export interface Line {
  readonly voice: MelodicVoice;
  /** Octave of the line's home relative to the mood tonic. */
  readonly oct: number;
  readonly gain: number;
  readonly wet: number;
  readonly echo?: number;
  /** Rhythmic density 0…1 (lead only). */
  readonly density?: number;
  /** Plays only at intensity ≥ minI. */
  readonly minI?: number;
  /** Chance of resting a whole phrase (lead only). */
  readonly rest?: number;
}
export type AccompKind = "arp" | "bass" | "drone" | "organ" | "bells" | "wind";
export type BukStyle = "slow" | "march" | "war" | "waves" | "heart" | "build";
export interface MoodSpec {
  readonly scale: ScaleId;
  /** MIDI note of the tonic (황 for 평조). */
  readonly tonic: number;
  readonly jd: JangdanId;
  /** Beats per minute; `accel` raises it with intensity. */
  readonly bpm: number;
  readonly accel?: number;
  readonly phraseBars: number;
  /** Intensity arc: length in bars, shape and range. */
  readonly arcBars: number;
  readonly arc: "hill" | "build" | "wave";
  readonly iLo: number;
  readonly iHi: number;
  readonly lead: Line;
  readonly counter?: Line & { readonly mode: "hetero" | "answer" };
  readonly accomp?: readonly (Line & { readonly kind: AccompKind })[];
  readonly janggu?: { readonly gain: number; readonly minI?: number };
  readonly buk?: { readonly gain: number; readonly style: BukStyle; readonly minI?: number };
  readonly jing?: { readonly gain: number; readonly every: number; readonly hz?: number };
  readonly kkw?: { readonly gain: number; readonly minI: number };
}

export const MOODS: Readonly<Record<MusicMood, MoodSpec>> = {
  title: {
    scale: "pyeong", tonic: 63, jd: "slow4", bpm: 50, phraseBars: 4, arcBars: 24, arc: "hill", iLo: 0.25, iHi: 1,
    lead: { voice: "daegeum", oct: 1, gain: 0.5, wet: 0.5, echo: 0.18, density: 0.3 },
    counter: { voice: "haegeum", oct: 0, gain: 0.24, wet: 0.4, minI: 0.6, mode: "hetero" },
    accomp: [
      { kind: "drone", voice: "drone", oct: -1, gain: 0.5, wet: 0.4 },
      { kind: "bass", voice: "geomungo", oct: -1, gain: 0.3, wet: 0.3, minI: 0.45 },
    ],
    buk: { gain: 1.1, style: "slow" }, jing: { gain: 0.9, every: 4 },
  },
  goryeo_twilight: {
    scale: "gyemyeon", tonic: 62, jd: "jungmori", bpm: 74, phraseBars: 2, arcBars: 8, arc: "hill", iLo: 0.3, iHi: 0.8,
    lead: { voice: "haegeum", oct: 0, gain: 0.52, wet: 0.4, echo: 0.08, density: 0.35 },
    accomp: [{ kind: "bass", voice: "geomungo", oct: -1, gain: 0.55, wet: 0.3 }],
    janggu: { gain: 0.5 },
  },
  founding: {
    scale: "pyeong", tonic: 65, jd: "daechwita", bpm: 64, phraseBars: 4, arcBars: 16, arc: "hill", iLo: 0.5, iHi: 1,
    lead: { voice: "taepyeongso", oct: 1, gain: 0.45, wet: 0.35, density: 0.35 },
    counter: { voice: "piri", oct: 0, gain: 0.26, wet: 0.3, minI: 0.7, mode: "hetero" },
    janggu: { gain: 0.45 }, buk: { gain: 0.8, style: "march" }, jing: { gain: 0.5, every: 2 },
  },
  court: {
    scale: "pyeong", tonic: 63, jd: "slow6", bpm: 34, phraseBars: 2, arcBars: 8, arc: "wave", iLo: 0.3, iHi: 0.7,
    lead: { voice: "daegeum", oct: 1, gain: 0.42, wet: 0.6, echo: 0.1, density: 0.15 },
    counter: { voice: "gayageum", oct: 0, gain: 0.6, wet: 0.5, mode: "hetero" },
    accomp: [{ kind: "bells", voice: "pyeonjong", oct: 0, gain: 0.35, wet: 0.6 }],
    janggu: { gain: 0.38 },
  },
  peace: {
    scale: "pyeong", tonic: 67, jd: "gutgeori", bpm: 84, phraseBars: 4, arcBars: 16, arc: "hill", iLo: 0.4, iHi: 0.9,
    lead: { voice: "gayageum", oct: 0, gain: 0.6, wet: 0.3, density: 0.6 },
    counter: { voice: "daegeum", oct: 1, gain: 0.33, wet: 0.4, minI: 0.55, mode: "answer" },
    accomp: [{ kind: "bass", voice: "geomungo", oct: -1, gain: 0.3, wet: 0.25, minI: 0.6 }],
    janggu: { gain: 0.5 },
  },
  intrigue: {
    scale: "gyemyeon", tonic: 61, jd: "jungmori", bpm: 66, phraseBars: 2, arcBars: 8, arc: "wave", iLo: 0.2, iHi: 0.6,
    lead: { voice: "geomungo", oct: -1, gain: 0.75, wet: 0.45, echo: 0.2, density: 0.25, rest: 0.3 },
    accomp: [{ kind: "drone", voice: "drone", oct: -1, gain: 0.28, wet: 0.3 }],
    buk: { gain: 0.45, style: "heart", minI: 0.35 },
  },
  war: {
    scale: "gyemyeon", tonic: 64, jd: "hwimori", bpm: 132, phraseBars: 4, arcBars: 32, arc: "wave", iLo: 0.35, iHi: 1,
    lead: { voice: "taepyeongso", oct: 1, gain: 0.4, wet: 0.25, density: 0.5, rest: 0.15 },
    counter: { voice: "piri", oct: 0, gain: 0.45, wet: 0.25, minI: 0.4, mode: "answer" },
    janggu: { gain: 0.5 }, buk: { gain: 0.6, style: "war" }, jing: { gain: 0.4, every: 4 },
    kkw: { gain: 0.25, minI: 0.55 },
  },
  naval: {
    scale: "pyeong", tonic: 62, jd: "semachi", bpm: 54, phraseBars: 4, arcBars: 16, arc: "hill", iLo: 0.35, iHi: 0.9,
    lead: { voice: "daegeum", oct: 1, gain: 0.45, wet: 0.5, echo: 0.15, density: 0.35 },
    accomp: [{ kind: "bass", voice: "geomungo", oct: -1, gain: 0.35, wet: 0.3, minI: 0.5 }],
    buk: { gain: 0.95, style: "waves" }, jing: { gain: 0.85, every: 4 },
  },
  siege: {
    scale: "gyemyeon", tonic: 59, jd: "slow4", bpm: 44, phraseBars: 4, arcBars: 16, arc: "wave", iLo: 0.2, iHi: 0.6,
    lead: { voice: "daegeum", oct: 1, gain: 0.42, wet: 0.6, echo: 0.2, density: 0.2, rest: 0.25 },
    accomp: [
      { kind: "drone", voice: "drone", oct: -1, gain: 0.6, wet: 0.4 },
      { kind: "wind", voice: "drone", oct: 0, gain: 0.3, wet: 0.5 },
    ],
    buk: { gain: 0.55, style: "heart", minI: 0.45 }, jing: { gain: 0.45, every: 8 },
  },
  reform: {
    scale: "pyeong", tonic: 65, jd: "jajinmori", bpm: 96, phraseBars: 4, arcBars: 16, arc: "hill", iLo: 0.4, iHi: 0.95,
    lead: { voice: "gayageum", oct: 0, gain: 0.6, wet: 0.3, density: 0.75 },
    counter: { voice: "haegeum", oct: 0, gain: 0.22, wet: 0.35, minI: 0.6, mode: "hetero" },
    accomp: [{ kind: "bass", voice: "geomungo", oct: -1, gain: 0.22, wet: 0.25, minI: 0.35 }],
    janggu: { gain: 0.5 },
  },
  turmoil: {
    scale: "gyemyeon", tonic: 62, jd: "eotmori", bpm: 92, phraseBars: 4, arcBars: 16, arc: "wave", iLo: 0.45, iHi: 1,
    lead: { voice: "haegeum", oct: 1, gain: 0.36, wet: 0.3, density: 0.6, rest: 0.1 },
    accomp: [{ kind: "bass", voice: "geomungo", oct: -1, gain: 0.3, wet: 0.25 }],
    janggu: { gain: 0.55 }, buk: { gain: 0.5, style: "build", minI: 0.5 },
  },
  modern: {
    scale: "minor", tonic: 57, jd: "waltz", bpm: 88, phraseBars: 4, arcBars: 16, arc: "hill", iLo: 0.3, iHi: 0.8,
    lead: { voice: "musicbox", oct: 1, gain: 0.5, wet: 0.45, echo: 0.12, density: 0.5 },
    counter: { voice: "haegeum", oct: 0, gain: 0.55, wet: 0.4, minI: 0.4, mode: "answer" },
    accomp: [{ kind: "organ", voice: "organ", oct: -1, gain: 0.16, wet: 0.35 }],
  },
  resistance: {
    scale: "gyemyeon", tonic: 60, jd: "jungmori", bpm: 72, accel: 0.4, phraseBars: 2, arcBars: 12, arc: "build", iLo: 0.15, iHi: 1,
    lead: { voice: "daegeum", oct: 1, gain: 0.45, wet: 0.45, echo: 0.1, density: 0.35 },
    counter: { voice: "piri", oct: 0, gain: 0.26, wet: 0.3, minI: 0.7, mode: "hetero" },
    accomp: [{ kind: "drone", voice: "drone", oct: -1, gain: 0.5, wet: 0.3 }],
    janggu: { gain: 0.5, minI: 0.5 }, buk: { gain: 0.85, style: "build" }, jing: { gain: 0.75, every: 2 },
  },
  years: {
    scale: "pyeong", tonic: 63, jd: "slow4", bpm: 40, phraseBars: 4, arcBars: 8, arc: "wave", iLo: 0.3, iHi: 0.6,
    lead: { voice: "daegeum", oct: 1, gain: 0.45, wet: 0.85, echo: 0.3, density: 0.2, rest: 0.1 },
    accomp: [{ kind: "wind", voice: "drone", oct: 0, gain: 0.35, wet: 0.6 }],
    jing: { gain: 0.9, every: 4 },
  },
  ending_good: {
    scale: "pyeong", tonic: 65, jd: "gutgeori", bpm: 76, phraseBars: 4, arcBars: 16, arc: "hill", iLo: 0.45, iHi: 1,
    lead: { voice: "daegeum", oct: 1, gain: 0.4, wet: 0.45, echo: 0.1, density: 0.45 },
    counter: { voice: "haegeum", oct: 0, gain: 0.3, wet: 0.35, minI: 0.35, mode: "hetero" },
    accomp: [
      { kind: "arp", voice: "gayageum", oct: 0, gain: 0.5, wet: 0.3, minI: 0.3 },
      { kind: "bass", voice: "geomungo", oct: -1, gain: 0.3, wet: 0.25, minI: 0.55 },
    ],
    janggu: { gain: 0.62 }, buk: { gain: 0.5, style: "slow", minI: 0.6 }, jing: { gain: 0.85, every: 4 },
    kkw: { gain: 0.18, minI: 0.8 },
  },
  ending_bad: {
    scale: "gyemyeon", tonic: 62, jd: "jungmori", bpm: 60, phraseBars: 2, arcBars: 8, arc: "wave", iLo: 0.2, iHi: 0.55,
    lead: { voice: "haegeum", oct: 0, gain: 0.5, wet: 0.55, echo: 0.12, density: 0.3 },
    accomp: [{ kind: "drone", voice: "drone", oct: -1, gain: 0.3, wet: 0.4 }],
    janggu: { gain: 0.45 },
  },
};

/** Tonal facts about a mood (for verification): tonic MIDI note and scale semitones. */
export function moodInfo(mood: MusicMood): { readonly tonic: number; readonly scale: readonly number[]; readonly jangdan: string; readonly lines: readonly string[] } {
  const s = MOODS[mood];
  const lines = ["lead", ...(s.counter ? ["counter"] : []), ...(s.accomp ?? []).map((_, i) => `acc${i}`)];
  if (s.janggu || s.buk || s.kkw) lines.push("perc");
  if (s.jing) lines.push("jing");
  return { tonic: s.tonic, scale: SCALES[s.scale], jangdan: s.jd, lines };
}

/** Consistency problems in the 장단 tables (empty when sound). */
export function checkTables(): string[] {
  const problems: string[] = [];
  for (const [id, jd] of Object.entries(JANGDAN) as [string, Jangdan][]) {
    const steps = jd.groups.reduce((a, b) => a + b, 0);
    for (const [name, pat] of [["main", jd.main], ["fill", jd.fill]] as const) {
      if (pat.length !== steps) problems.push(`${id}.${name}: ${pat.length} strokes for ${steps} steps`);
      if (!/^[DKkTtGR-]*$/.test(pat)) problems.push(`${id}.${name}: unknown stroke in "${pat}"`);
    }
  }
  return problems;
}
