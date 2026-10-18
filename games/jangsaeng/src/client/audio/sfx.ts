// Sound effects: short layered noise / sine / saw gestures plus 국악 voices
// (가야금 arpeggios, 징, 북, 범종, 꽹과리). Each effect schedules itself on a
// VoiceOut at time t and returns its nominal duration. The throttle keeps
// combat spam from stacking identical voices into clipping.

import {
  beomjong, buk, burst, gayageum, jing, kkwaenggwari, metal, mtof, pyeonjong, sweep, tone, voiced,
  type VoiceOut,
} from "./instruments.ts";
import type { SfxName } from "./types.ts";

export interface SfxSpec {
  /** Minimum seconds between two triggers of this effect. */
  readonly gap: number;
  /** Maximum overlapping instances. */
  readonly max: number;
  /** Nominal audible duration in seconds (used for voice accounting). */
  readonly dur: number;
  /** Reverb send level. */
  readonly wet: number;
}

const spec = (gap: number, max: number, dur: number, wet: number): SfxSpec => ({ gap, max, dur, wet });

export const SFX_SPECS: Readonly<Record<SfxName, SfxSpec>> = {
  swing: spec(0.05, 3, 0.25, 0.1),
  hit: spec(0.035, 4, 0.2, 0.08),
  hit_heavy: spec(0.06, 3, 0.45, 0.1),
  crit: spec(0.08, 2, 0.7, 0.15),
  bow: spec(0.08, 2, 0.35, 0.1),
  arrow_hit: spec(0.04, 3, 0.18, 0.08),
  gun: spec(0.07, 3, 0.9, 0.2),
  cannon: spec(0.15, 2, 1.9, 0.25),
  explosion: spec(0.12, 3, 1.8, 0.25),
  hurt: spec(0.15, 1, 0.3, 0.08),
  death: spec(0.4, 1, 1.3, 0.2),
  enemy_death: spec(0.08, 3, 0.7, 0.12),
  block: spec(0.05, 3, 0.45, 0.12),
  pickup: spec(0.06, 3, 0.9, 0.2),
  coin: spec(0.04, 4, 0.45, 0.15),
  levelup: spec(1.5, 1, 2.4, 0.35),
  quest: spec(0.8, 1, 1.6, 0.3),
  quest_done: spec(1.5, 1, 3.2, 0.35),
  ui_click: spec(0.03, 3, 0.08, 0),
  ui_open: spec(0.05, 2, 0.2, 0.05),
  ui_close: spec(0.05, 2, 0.2, 0.05),
  choice: spec(0.08, 2, 1.0, 0.2),
  gong: spec(0.6, 2, 4.8, 0.45),
  drum: spec(0.06, 3, 1.4, 0.2),
  bell: spec(1.5, 1, 7.0, 0.5),
  years_pass: spec(3, 1, 5.5, 0.5),
  warning: spec(0.4, 1, 0.9, 0.15),
  footstep: spec(0.12, 2, 0.12, 0.03),
  splash: spec(0.1, 2, 0.8, 0.15),
  fire: spec(0.15, 2, 1.1, 0.1),
  chat: spec(0.08, 2, 0.15, 0.05),
  denied: spec(0.15, 1, 0.32, 0.05),
  heal: spec(0.3, 2, 1.3, 0.3),
  skill: spec(0.12, 2, 0.75, 0.2),
};

export interface SfxThrottle {
  /** Admits a trigger at context time `now`; returns a gain scale, or null to drop it. */
  admit(name: SfxName, now: number): number | null;
}

/** Per-effect minimum gap and polyphony cap, plus a global voice cap. */
export function createSfxThrottle(maxVoices = 24): SfxThrottle {
  const last = new Map<SfxName, number>();
  const active = new Map<SfxName, number[]>();
  let all: number[] = [];
  return {
    admit(name, now) {
      const s = SFX_SPECS[name];
      const prev = last.get(name);
      if (prev !== undefined && now - prev < s.gap) return null;
      const mine = (active.get(name) ?? []).filter((end) => end > now);
      all = all.filter((end) => end > now);
      active.set(name, mine);
      if (mine.length >= s.max || all.length >= maxVoices) return null;
      last.set(name, now);
      mine.push(now + s.dur);
      all.push(now + s.dur);
      // Stacked copies of one effect get quieter so spam sums sub-linearly.
      return 1 / Math.sqrt(1 + 0.6 * (mine.length - 1));
    },
  };
}

type Fx = (o: VoiceOut, t: number, p: number, r: () => number) => number;

const PYEONG = [0, 2, 5, 7, 9];
/** Scale step i of 평조 above a MIDI root. */
const pyeongHz = (root: number, i: number): number => mtof(root + (PYEONG[i % 5] ?? 0) + 12 * Math.floor(i / 5));

const FX: Readonly<Record<SfxName, Fx>> = {
  swing: (o, t, p) => {
    sweep(o, t, 0.22, 500 * p, 2600 * p, 900 * p, 1.8, 0.8, 0.35);
    tone(o, t, "sine", 180 * p, 90 * p, 0.15, 0.01, 0.04, 0.15);
    return 0.25;
  },
  hit: (o, t, p) => {
    tone(o, t, "sine", 190 * p, 55 * p, 0.05, 0.001, 0.05, 1);
    burst(o, t, "bandpass", 1800 * p, 900 * p, 0.9, 0.001, 0.025, 0.9);
    burst(o, t, "highpass", 5000, 5000, 0.7, 0.0005, 0.006, 0.5);
    return 0.2;
  },
  hit_heavy: (o, t, p) => {
    tone(o, t, "sine", 130 * p, 38 * p, 0.12, 0.001, 0.09, 1.1);
    tone(o, t, "triangle", 90 * p, 45 * p, 0.1, 0.002, 0.06, 0.5);
    burst(o, t, "lowpass", 2600 * p, 500 * p, 0.7, 0.001, 0.06, 1.1);
    burst(o, t, "bandpass", 1200 * p, 800 * p, 1, 0.001, 0.03, 0.6);
    return 0.45;
  },
  crit: (o, t, p, r) => {
    FX.hit_heavy(o, t, p, r);
    metal(o, t + 0.01, 2400 * p, 1.37, 1.6, 0.001, 0.16, 0.3);
    sweep(o, t, 0.3, 2500 * p, 7000 * p, 3000 * p, 1.2, 0.35, 0.3);
    return 0.7;
  },
  bow: (o, t, p) => {
    voiced(o, t, "sawtooth", 210 * p, 180 * p, 0.12, "lowpass", 2400, 600, 1, 0.002, 0.02, 0.06, 0.3);
    burst(o, t, "bandpass", 2500 * p, 6000 * p, 2, 0.004, 0.05, 0.55, 0.12);
    tone(o, t, "sine", 95 * p, 70 * p, 0.05, 0.001, 0.04, 0.3);
    return 0.35;
  },
  arrow_hit: (o, t, p) => {
    tone(o, t, "sine", 340 * p, 110 * p, 0.04, 0.001, 0.035, 0.9);
    burst(o, t, "bandpass", 900 * p, 700 * p, 3, 0.001, 0.03, 0.9);
    burst(o, t, "highpass", 4000, 4000, 0.7, 0.0005, 0.006, 0.4);
    return 0.18;
  },
  gun: (o, t, p) => {
    burst(o, t, "highpass", 5500 * p, 7500 * p, 0.8, 0.002, 0.03, 0.3); // 화승 fizz in the pan
    const c = t + 0.04;
    burst(o, c, "lowpass", 9000 * p, 1500 * p, 0.5, 0.0008, 0.045, 1.3, 0.1); // crack
    tone(o, c, "sine", 150 * p, 45 * p, 0.08, 0.001, 0.09, 0.9);
    burst(o, c + 0.02, "bandpass", 3500 * p, 1800 * p, 0.7, 0.02, 0.16, 0.16, 0.5); // smoke tail
    return 0.9;
  },
  cannon: (o, t, p, r) => {
    tone(o, t, "sine", 72 * p, 28 * p, 0.45, 0.003, 0.32, 1.2);
    burst(o, t, "lowpass", 900 * p, 120 * p, 0.8, 0.004, 0.35, 1.1, 0.8);
    burst(o, t, "highpass", 2000, 1000, 0.7, 0.001, 0.02, 0.6);
    for (let i = 0; i < 9; i++) {
      burst(o, t + 0.12 + r() * 0.9, "bandpass", (1500 + r() * 2500) * p, 1200 * p, 2, 0.001, 0.015 + r() * 0.02, 0.15 + r() * 0.15);
    }
    return 1.9;
  },
  explosion: (o, t, p, r) => {
    burst(o, t, "lowpass", 4200 * p, 180 * p, 0.7, 0.004, 0.42, 1.2, 1.0);
    tone(o, t, "sine", 60 * p, 30 * p, 0.4, 0.005, 0.3, 1);
    for (let i = 0; i < 12; i++) {
      burst(o, t + 0.05 + r() * 1.1, "bandpass", (2000 + r() * 4000) * p, 1500 * p, 1.5, 0.0008, 0.008 + r() * 0.012, 0.12 + r() * 0.2);
    }
    return 1.8;
  },
  hurt: (o, t, p) => {
    voiced(o, t, "sawtooth", 260 * p, 165 * p, 0.16, "bandpass", 800 * p, 600 * p, 3, 0.012, 0.06, 0.05, 0.45);
    tone(o, t, "sine", 150 * p, 60 * p, 0.05, 0.001, 0.04, 0.6);
    return 0.3;
  },
  death: (o, t, p) => {
    voiced(o, t, "sawtooth", 300 * p, 70 * p, 0.9, "lowpass", 1400 * p, 300 * p, 1.5, 0.004, 0.6, 0.15, 0.35);
    tone(o, t + 0.05, "sine", 90 * p, 40 * p, 0.3, 0.002, 0.2, 0.8);
    return 1.3;
  },
  enemy_death: (o, t, p) => {
    voiced(o, t, "sawtooth", 380 * p, 120 * p, 0.45, "bandpass", 900 * p, 500 * p, 2, 0.005, 0.2, 0.08, 0.3);
    burst(o, t, "lowpass", 1200 * p, 300 * p, 0.7, 0.002, 0.08, 0.6);
    tone(o, t, "sine", 110 * p, 50 * p, 0.15, 0.001, 0.1, 0.6);
    return 0.7;
  },
  block: (o, t, p) => {
    metal(o, t, 880 * p, 1.44, 1.7, 0.0008, 0.12, 0.5, 0.04);
    burst(o, t, "highpass", 3000, 3000, 0.7, 0.0005, 0.012, 0.7);
    tone(o, t, "sine", 420 * p, 380 * p, 0.05, 0.001, 0.05, 0.3);
    return 0.45;
  },
  pickup: (o, t, p) => {
    gayageum(o, t, mtof(79) * p, 0.12, 0.55);
    gayageum(o, t + 0.07, mtof(84) * p, 0.2, 0.6);
    return 0.9;
  },
  coin: (o, t, p) => {
    metal(o, t, 2100 * p, 2.76, 0.4, 0.0005, 0.08, 0.4);
    metal(o, t + 0.065, 2500 * p, 2.76, 0.4, 0.0005, 0.07, 0.3);
    return 0.45;
  },
  levelup: (o, t, p) => {
    for (let i = 0; i < 9; i++) gayageum(o, t + i * 0.05, pyeongHz(63, 5 + i) * p, 0.3, 0.42 + i * 0.03);
    pyeonjong(o, t + 0.47, pyeongHz(63, 15) * p, 0.55);
    return 2.4;
  },
  quest: (o, t, p) => {
    [0, 2, 3, 5].forEach((d, i) => gayageum(o, t + i * 0.11, pyeongHz(63, 5 + d) * p, 0.4, 0.5 - i * 0.03));
    return 1.6;
  },
  quest_done: (o, t, p) => {
    [0, 1, 2, 3, 5].forEach((d, i) => gayageum(o, t + i * 0.09, pyeongHz(63, 5 + d) * p, 0.4, 0.5));
    pyeonjong(o, t + 0.45, pyeongHz(63, 10) * p, 0.5);
    pyeonjong(o, t + 0.75, pyeongHz(63, 13) * p, 0.4);
    jing(o, t + 0.4, 0.12, 170 * p, 1.2);
    return 3.2;
  },
  ui_click: (o, t, p) => {
    tone(o, t, "sine", 1500 * p, 1100 * p, 0.01, 0.0005, 0.012, 0.35);
    burst(o, t, "highpass", 6000, 6000, 0.7, 0.0003, 0.004, 0.25);
    return 0.08;
  },
  ui_open: (o, t, p) => {
    tone(o, t, "triangle", 700 * p, 1050 * p, 0.06, 0.002, 0.04, 0.35);
    tone(o, t + 0.05, "sine", 1400 * p, 1400 * p, 0, 0.002, 0.03, 0.15);
    return 0.2;
  },
  ui_close: (o, t, p) => {
    tone(o, t, "triangle", 1050 * p, 650 * p, 0.06, 0.002, 0.04, 0.35);
    tone(o, t + 0.04, "sine", 700 * p, 700 * p, 0, 0.002, 0.03, 0.12);
    return 0.2;
  },
  choice: (o, t, p) => {
    gayageum(o, t, mtof(75) * p, 0.25, 0.55);
    tone(o, t, "sine", 1200 * p, 1000 * p, 0.01, 0.0005, 0.01, 0.2);
    return 1.0;
  },
  gong: (o, t, p) => jing(o, t, 0.34, 160 * p, 3.6) - t,
  drum: (o, t, p) => {
    buk(o, t, 0.7, 64 * p);
    return 1.4;
  },
  bell: (o, t, p) => beomjong(o, t, 0.95, p, 5.8) - t,
  years_pass: (o, t, p) => {
    sweep(o, t, 4.6, 260 * p, 1800 * p, 380 * p, 3.5, 0.5, 0.42);
    sweep(o, t + 0.2, 4.2, 120 * p, 420 * p, 140 * p, 1.2, 0.35, 0.5);
    jing(o, t + 0.35, 0.26, 150 * p, 3.4);
    return 5.5;
  },
  warning: (o, t, p) => {
    buk(o, t, 0.5, 70 * p);
    [0, 0.11, 0.22].forEach((dt, i) => kkwaenggwari(o, t + dt, 0.75, i === 2));
    return 0.9;
  },
  footstep: (o, t, p, r) => {
    const v = 0.4 + r() * 0.2;
    burst(o, t, "lowpass", (380 + r() * 120) * p, 200 * p, 0.7, 0.002, 0.025, v);
    tone(o, t, "sine", 85 * p, 60 * p, 0.03, 0.001, 0.02, v * 0.6);
    return 0.12;
  },
  splash: (o, t, p, r) => {
    burst(o, t, "bandpass", 700 * p, 2800 * p, 1.2, 0.004, 0.14, 0.8, 0.1);
    burst(o, t + 0.01, "highpass", 2500 * p, 2500 * p, 0.7, 0.01, 0.2, 0.25);
    for (let i = 0; i < 4; i++) {
      const f = (800 + r() * 1200) * p;
      tone(o, t + 0.08 + r() * 0.35, "sine", f, f * 1.8, 0.03, 0.001, 0.025, 0.15);
    }
    return 0.8;
  },
  fire: (o, t, p, r) => {
    burst(o, t, "lowpass", 900 * p, 250 * p, 0.7, 0.004, 0.06, 0.5); // ignition whoomp
    sweep(o, t, 1.0, 180 * p, 420 * p, 200 * p, 0.8, 0.35, 0.3);
    for (let i = 0; i < 14; i++) {
      burst(o, t + r() * 0.9, "highpass", (2500 + r() * 3000) * p, 2000 * p, 0.8, 0.0005, 0.003 + r() * 0.006, 0.25 + r() * 0.35);
    }
    return 1.1;
  },
  chat: (o, t, p) => {
    tone(o, t, "sine", 880 * p, 990 * p, 0.03, 0.002, 0.03, 0.25);
    tone(o, t + 0.06, "sine", 1320 * p, 1320 * p, 0, 0.002, 0.03, 0.18);
    return 0.15;
  },
  denied: (o, t, p) => {
    for (const dt of [0, 0.12]) voiced(o, t + dt, "square", 150 * p, 140 * p, 0.08, "lowpass", 900, 600, 1, 0.003, 0.05, 0.02, 0.22);
    return 0.32;
  },
  heal: (o, t, p, r) => {
    voiced(o, t, "sine", 520 * p, 1040 * p, 0.5, "lowpass", 4000, 4000, 0.7, 0.05, 0.3, 0.2, 0.25);
    for (let i = 0; i < 5; i++) {
      const f = (1500 + r() * 1200) * p;
      tone(o, t + 0.1 + i * 0.12, "sine", f, f, 0, 0.002, 0.12, 0.12);
    }
    gayageum(o, t, pyeongHz(63, 10) * p, 0.3, 0.3);
    return 1.3;
  },
  skill: (o, t, p) => {
    burst(o, t, "bandpass", 400 * p, 4000 * p, 2.5, 0.08, 0.1, 0.7, 0.25);
    metal(o, t + 0.15, 1800 * p, 1.41, 1, 0.001, 0.2, 0.25);
    tone(o, t + 0.2, "sine", 120 * p, 60 * p, 0.1, 0.002, 0.08, 0.6);
    return 0.75;
  },
};

/** Schedules effect `name` at context time `t`; returns its nominal duration in seconds. */
export function playSfx(o: VoiceOut, name: SfxName, t: number, pitch = 1, rand: () => number = Math.random): number {
  const base = Number.isFinite(pitch) ? Math.min(4, Math.max(0.25, pitch)) : 1;
  return FX[name](o, t, base * (1 + (rand() - 0.5) * 0.04), rand);
}
