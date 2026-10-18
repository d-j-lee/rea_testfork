// Generative 국악-style music.
//
// A MusicPlayer turns a mood spec into bars: 장단 strokes, a lead line built
// from call/response phrases (a recurring theme, its variations and fresh
// material over a 4-phrase period), heterophonic or answering counter lines,
// accompaniment and a slow intensity arc. Bars become plain timed events that
// are dispatched to voices only inside the caller's lookahead window, so any
// BaseAudioContext (live or offline) can host a player and a mood change never
// leaves a backlog of scheduled nodes.

import { createRng, type Rng } from "../../shared/rng.ts";
import {
  buk, janggu, jing, kkwaenggwari, mtof, playNote, wind,
  type JangguStroke, type MelodicVoice, type Ornament, type VoiceOut,
} from "./instruments.ts";
import { JANGDAN, MOODS, SCALES, type BukStyle, type Jangdan, type Line, type MoodSpec } from "./moods.ts";
import type { MusicMood } from "./types.ts";

export interface MusicTargets {
  readonly ctx: BaseAudioContext;
  readonly dry: AudioNode;
  readonly wet: AudioNode;
  readonly echo: AudioNode;
}

export interface MusicPlayer {
  readonly mood: MusicMood;
  /** Context time after which the player is silent (Infinity until faded out). */
  readonly endTime: number;
  /** Dispatches every event that starts before `until`; slightly late ones start now, stale ones are skipped. */
  scheduleUntil(until: number): void;
  /** Fades out over `seconds` from `at`, then stops generating. Returns the end time. */
  fadeOut(at: number, seconds: number): number;
  /** Disconnects the player's output immediately. */
  dispose(): void;
}

interface Cell { s: number; l: number; rest: boolean }
interface BarMotif { readonly cells: Cell[]; readonly steps: number[] }
interface PhraseMotif { readonly bars: readonly BarMotif[]; readonly start: number }
interface Note { s: number; l: number; deg: number }
/** A timed event; `run` receives the actual start time (later than `t` when dispatched late). */
interface Ev { readonly t: number; readonly run: (at: number) => void }

/** Events up to this late still play (shifted to now); a longer stall skips them. */
const LATE_LIMIT = 0.3;

export interface PlayerOptions {
  /** Verification only: keep a single line audible ("lead", "counter", "acc0"…, "perc", "jing"). */
  readonly solo?: string;
}

/** Phrase kinds per 4-phrase period: A = theme, A1/A2 its variations, B period motif, C fresh. */
const PLANS: readonly (readonly string[])[] = [
  ["A", "A1", "B", "A2"], ["A", "B", "A1", "B1"], ["A1", "A2", "B", "C"], ["A", "C", "B", "A1"],
];
const STEP_WEIGHTS: readonly (readonly [number, number])[] = [
  [-3, 0.04], [-2, 0.13], [-1, 0.3], [0, 0.1], [1, 0.27], [2, 0.12], [3, 0.04],
];
const SPLITS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [[1, 1]],
  3: [[2, 1], [1, 2], [1, 1, 1], [2, 1]],
};
const ARPS: readonly (readonly number[])[] = [[0, 2, 3], [0, 3, 5], [5, 3, 2], [0, 2, 5], [3, 2, 0]];
// Minor-key bars for 개화기: bar 2 holds the dominant (half cadence), bar 4 the tonic.
const PROGRESSIONS: readonly (readonly (readonly number[])[])[] = [
  [[0, 2, 4], [4, 6, 8], [5, 7, 9], [0, 2, 4]],
  [[0, 2, 4], [2, 4, 6], [3, 5, 7], [0, 2, 4]],
  [[5, 7, 9], [4, 6, 8], [3, 5, 7], [0, 2, 4]],
  [[0, 2, 4], [2, 4, 6], [5, 7, 9], [0, 2, 4]],
];

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const cents = (c: number): number => Math.pow(2, c / 1200);
const reflect = (d: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, d > hi ? 2 * hi - d : d < lo ? 2 * lo - d : d));

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

class Player implements MusicPlayer {
  readonly mood: MusicMood;
  endTime = Infinity;
  private readonly ctx: BaseAudioContext;
  private readonly spec: MoodSpec;
  private readonly jd: Jangdan;
  private readonly scale: readonly number[];
  private readonly rng: Rng;
  private readonly sums: { readonly dry: GainNode; readonly wet: GainNode; readonly echo: GainNode };
  private readonly outs: GainNode[] = [];
  private readonly lines = new Map<string, VoiceOut>();
  private readonly beats: readonly number[];
  private readonly prev = new Map<string, number>();
  private q: Ev[] = [];
  private nextBar: number;
  private bar = 0;
  private theme: PhraseMotif;
  private periodB: PhraseMotif;
  private plan: readonly string[] = PLANS[0] ?? [];
  private progression: readonly (readonly number[])[] = PROGRESSIONS[0] ?? [];
  private notes: Note[][] = [];
  private chords: readonly (readonly number[])[] = [];
  private leadRest = false;
  private disposed = false;
  private readonly solo: string | undefined;
  // Drum and gong pitches sit on the mood's tonic or fifth.
  private readonly kungHz: number;
  private readonly bukHz: number;
  private readonly jingHz: number;

  constructor(targets: MusicTargets, mood: MusicMood, startAt: number, fadeIn: number, opts: PlayerOptions) {
    this.mood = mood;
    this.solo = opts.solo;
    this.ctx = targets.ctx;
    this.spec = MOODS[mood];
    this.jd = JANGDAN[this.spec.jd];
    this.scale = SCALES[this.spec.scale];
    this.rng = createRng(`jangsaeng-music:${mood}`);
    const near = (target: number): number => {
      const { tonic } = this.spec;
      const pick = (pc: number): number => target + mod(pc - target + 6, 12) - 6;
      const a = pick(tonic);
      const b = pick(tonic + 7);
      return mtof(Math.abs(a - target) <= Math.abs(b - target) ? a : b);
    };
    this.kungHz = near(44);
    this.bukHz = near(38);
    this.jingHz = near(52);
    const chain = (dest: AudioNode): GainNode => {
      const fadeInGain = gainNode(this.ctx, fadeIn > 0 ? 0 : 1);
      if (fadeIn > 0) {
        fadeInGain.gain.setValueAtTime(0, startAt);
        fadeInGain.gain.linearRampToValueAtTime(1, startAt + fadeIn);
      }
      const fadeOutGain = gainNode(this.ctx, 1);
      fadeInGain.connect(fadeOutGain).connect(dest);
      this.outs.push(fadeOutGain);
      return fadeInGain;
    };
    this.sums = { dry: chain(targets.dry), wet: chain(targets.wet), echo: chain(targets.echo) };
    this.nextBar = startAt;
    let acc = 0;
    this.beats = this.jd.groups.map((g) => (acc += g) - g);
    this.theme = this.newMotif();
    this.periodB = this.newMotif();
  }

  scheduleUntil(until: number): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    // After a stall (throttled timer, debugger) resume from now instead of replaying the gap.
    if (this.nextBar < now - 0.5) this.nextBar = now + 0.05;
    const horizon = Math.min(until, this.endTime);
    let generated = false;
    while (this.nextBar < horizon) {
      this.genBar();
      generated = true;
    }
    if (generated) this.q.sort((a, b) => a.t - b.t);
    let i = 0;
    for (; i < this.q.length; i++) {
      const ev = this.q[i];
      if (!ev || ev.t >= horizon) break;
      if (ev.t < now - LATE_LIMIT) continue;
      try {
        ev.run(Math.max(ev.t, now + 0.002));
      } catch {
        // A voice that cannot be scheduled must not stop the music.
      }
    }
    if (i > 0) this.q.splice(0, i);
  }

  fadeOut(at: number, seconds: number): number {
    if (this.endTime !== Infinity) return this.endTime;
    for (const g of this.outs) {
      g.gain.setValueAtTime(1, at);
      g.gain.linearRampToValueAtTime(0, at + seconds);
    }
    this.endTime = at + seconds;
    return this.endTime;
  }

  dispose(): void {
    this.disposed = true;
    this.q = [];
    for (const g of this.outs) g.disconnect();
  }

  // ------------------------------------------------------------ generation

  private push(t: number, run: (at: number) => void): void {
    this.q.push({ t, run });
  }

  private line(key: string, gain: number, wet: number, echo = 0): VoiceOut {
    let out = this.lines.get(key);
    if (!out) {
      if (this.solo !== undefined && key !== this.solo) gain = 0;
      const dry = gainNode(this.ctx, gain);
      dry.connect(this.sums.dry);
      const w = gainNode(this.ctx, gain * wet);
      w.connect(this.sums.wet);
      if (echo > 0) dry.connect(gainNode(this.ctx, echo)).connect(this.sums.echo);
      out = { ctx: this.ctx, dry, wet: w };
      this.lines.set(key, out);
    }
    return out;
  }

  private semi(deg: number): number {
    const n = this.scale.length;
    return (this.scale[mod(deg, n)] ?? 0) + 12 * Math.floor(deg / n);
  }

  private hz(deg: number): number {
    return mtof(this.spec.tonic + this.semi(deg));
  }

  private halfIdx(): number {
    return Math.max(0, this.scale.indexOf(7));
  }

  private intensity(bar: number): number {
    const { arcBars, iLo, iHi, arc, tonic } = this.spec;
    const cycle = Math.floor(bar / arcBars);
    const p = ((bar % arcBars) + 0.5) / arcBars;
    const shape =
      arc === "hill" ? Math.pow(Math.sin(Math.PI * p), 1.3)
      : arc === "build" ? Math.pow(p, 1.4)
      : 0.5 - 0.5 * Math.cos(4 * Math.PI * p);
    const r = Math.sin(cycle * 78.233 + tonic) * 43758.5453;
    const peak = cycle === 0 ? 1 : 0.7 + 0.3 * (r - Math.floor(r));
    return iLo + (iHi - iLo) * shape * peak;
  }

  private genBar(): void {
    const { spec, jd } = this;
    const bar = this.bar++;
    const t0 = this.nextBar;
    const intensity = this.intensity(bar);
    const stepDur = 60 / (spec.bpm * (1 + (spec.accel ?? 0) * intensity)) / jd.beat;
    const barDur = jd.main.length * stepDur;
    this.nextBar = t0 + barDur;
    const pos = bar % spec.phraseBars;
    if (pos === 0) this.startPhrase(bar);
    const at = (s: number): number => t0 + s * stepDur;
    this.melody(pos, intensity, at, stepDur);
    this.accompany(bar, pos, intensity, at, stepDur, barDur);
    this.percussion(bar, pos, intensity, at, stepDur);
  }

  private step(): number {
    let r = this.rng.next();
    for (const [d, w] of STEP_WEIGHTS) if ((r -= w) < 0) return d;
    return 0;
  }

  private rhythm(cadence: boolean): Cell[] {
    const { groups, beat } = this.jd;
    const density = this.spec.lead.density ?? 0.4;
    const rng = this.rng;
    const cells: Cell[] = [];
    let s = 0;
    for (let g = 0; g < groups.length; ) {
      const len = groups[g] ?? 2;
      const left = groups.length - g;
      if (left >= 2 && rng.chance(0.55 * (1 - density))) {
        const span = Math.min(left, rng.int(2, density < 0.25 ? 4 : 2));
        let l = 0;
        for (let k = 0; k < span; k++) l += groups[g + k] ?? 0;
        cells.push({ s, l, rest: false });
        s += l;
        g += span;
        continue;
      }
      const parts = rng.chance(density) ? rng.pick(SPLITS[len] ?? [[len]]) : [len];
      for (const part of parts) {
        cells.push({ s, l: part, rest: false });
        s += part;
      }
      g++;
    }
    for (let i = 1; i < cells.length - 1; i++) {
      const c = cells[i];
      if (c && rng.chance(0.05 + 0.12 * (1 - density))) c.rest = true;
    }
    if (cadence) {
      // Land on a long final note; long bars leave a breath before the next phrase.
      while (cells.length > 2 && (cells[cells.length - 1]?.l ?? 0) < 2 * beat) {
        const tail = cells.pop();
        const prev = cells[cells.length - 1];
        if (tail && prev) prev.l += tail.l;
      }
      const fin = cells[cells.length - 1];
      if (fin) {
        fin.rest = false;
        const cut = groups[groups.length - 1] ?? 0;
        if (groups.length >= 6 && fin.l > cut * 2 && rng.chance(0.5)) fin.l -= cut;
      }
    }
    return cells;
  }

  private cadenceBar(b: number): boolean {
    const n = this.spec.phraseBars;
    return b === n - 1 || b === Math.max(0, n / 2 - 1);
  }

  private newMotif(): PhraseMotif {
    const bars: BarMotif[] = [];
    for (let b = 0; b < this.spec.phraseBars; b++) {
      const cells = this.rhythm(this.cadenceBar(b));
      bars.push({ cells, steps: cells.map(() => this.step()) });
    }
    return { bars, start: this.rng.pick([0, 1, 2, 3, -1]) };
  }

  /** Variation: inversion, re-rhythm keeping the contour, neighbour-note split, or local mutation. */
  private vary(m: PhraseMotif, amount: number): PhraseMotif {
    const rng = this.rng;
    const bars = m.bars.map((bm, b): BarMotif => {
      const cells = bm.cells.map((c) => ({ ...c }));
      let steps = [...bm.steps];
      if (!rng.chance(amount)) return { cells, steps };
      switch (rng.int(0, 3)) {
        case 0:
          steps = steps.map((d) => -d);
          break;
        case 1: {
          const fresh = this.rhythm(this.cadenceBar(b));
          return { cells: fresh, steps: fresh.map((_, i) => steps[i % Math.max(1, steps.length)] ?? this.step()) };
        }
        case 2: {
          let li = 0;
          cells.forEach((c, i) => {
            if (c.l > (cells[li]?.l ?? 0)) li = i;
          });
          const c = cells[li];
          if (c && c.l >= 2) {
            const a = Math.ceil(c.l / 2);
            cells.splice(li + 1, 0, { s: c.s + a, l: c.l - a, rest: false });
            c.l = a;
            steps.splice(li + 1, 0, rng.pick([1, -1]));
          }
          break;
        }
        default:
          steps = steps.map((d, i) => (i > 0 && rng.chance(0.3) ? this.step() : d));
      }
      return { cells, steps };
    });
    return { bars, start: m.start + (rng.chance(amount * 0.5) ? rng.pick([-1, 1, 2]) : 0) };
  }

  private startPhrase(bar: number): void {
    const { spec, rng } = this;
    const n = this.scale.length;
    const phrase = Math.floor(bar / spec.phraseBars);
    if (phrase % 4 === 0) {
      this.plan = rng.pick(PLANS);
      this.progression = rng.pick(PROGRESSIONS);
      if (phrase > 0) this.periodB = this.newMotif();
    }
    const kind = this.plan[phrase % 4] ?? "A";
    const motif =
      kind === "A" ? this.theme
      : kind === "A1" ? this.vary(this.theme, 0.35)
      : kind === "A2" ? this.vary(this.theme, 0.7)
      : kind === "B" ? this.periodB
      : kind === "B1" ? this.vary(this.periodB, 0.5)
      : this.newMotif();
    const home = spec.lead.oct * n;
    const mid = Math.max(0, spec.phraseBars / 2 - 1);
    const goals = motif.bars.map((_, b) => (b === spec.phraseBars - 1 ? home : b === mid ? home + this.halfIdx() : null));
    this.chords = spec.scale === "minor" ? motif.bars.map((_, b) => this.progression[b % 4] ?? [0, 2, 4]) : [];
    const start = home + motif.start + (kind.startsWith("B") ? 2 : 0);
    this.notes = this.realize(motif, start, home - 2, home + n + 3, goals);
    this.leadRest = phrase % 4 !== 0 && rng.chance(spec.lead.rest ?? 0);
  }

  /** Walks the motif's scale steps, steering cadence bars onto their goal degree. */
  private realize(m: PhraseMotif, start: number, lo: number, hi: number, goals: readonly (number | null)[]): Note[][] {
    let deg = start;
    let first = true;
    return m.bars.map((bm, b) => {
      const goal = goals[b] ?? null;
      const chord = this.chords[b];
      const playable = bm.cells.flatMap((c, i) => (c.rest ? [] : [i]));
      return playable.map((ci, k): Note => {
        const cell = bm.cells[ci] ?? { s: 0, l: 1, rest: false };
        if (first) first = false;
        else deg += bm.steps[ci] ?? 0;
        const left = playable.length - 1 - k;
        if (goal !== null) {
          if (left === 0) deg = goal;
          else if (left === 1) deg = deg >= goal ? goal + 1 : goal - 1;
          else if (Math.abs(goal - deg) > left * 2) deg += Math.sign(goal - deg) * 2;
        }
        deg = reflect(deg, lo, hi);
        if (chord && left > 0 && this.beats.includes(cell.s)) deg = this.snap(deg, chord);
        return { s: cell.s, l: cell.l, deg };
      });
    });
  }

  private snap(deg: number, chord: readonly number[]): number {
    const n = this.scale.length;
    const pcs = chord.map((c) => mod(c, n));
    for (const off of [0, -1, 1, -2, 2]) if (pcs.includes(mod(deg + off, n))) return deg + off;
    return deg;
  }

  /** 시김새 by scale: 계면조 떠는음 / 꺾는음, 평조 퇴성 / 추성, wind graces, bowed slides. */
  private ornament(voice: MelodicVoice, deg: number, prev: number | null, dur: number, beatSec: number): Ornament {
    const rng = this.rng;
    const n = this.scale.length;
    const pc = mod(deg, n);
    const windy = voice === "daegeum" || voice === "piri" || voice === "taepyeongso";
    const bowed = voice === "haegeum";
    const plucked = voice === "gayageum" || voice === "geomungo";
    const orn: Ornament = {};
    const long = dur > beatSec * 1.1;
    if (long) {
      orn.vib = windy ? 18 : bowed ? 30 : plucked ? 35 : 8;
      orn.vibRate = windy ? 4.6 : bowed ? 5.8 : 5.2;
      orn.vibDelay = Math.min(0.6, dur * (plucked ? 0.25 : 0.4));
    }
    if (this.spec.scale === "gyemyeon") {
      if (pc === 3 && dur > beatSec * 0.7) {
        orn.vib = plucked ? 70 : 55;
        orn.vibRate = 6.4;
        orn.vibDelay = plucked ? 0.12 : 0.08;
      } else if (pc === 1 && prev !== null && prev > deg && dur > beatSec * 0.9 && rng.chance(0.65)) {
        orn.bend = -100;
        orn.bendAt = 0.6;
      }
    } else if (this.spec.scale === "pyeong" && long) {
      if (prev !== null && prev > deg && rng.chance(0.25)) {
        orn.bend = -100 * (this.semi(deg) - this.semi(deg - 1));
        orn.bendAt = 0.75;
      } else if (plucked && rng.chance(0.2)) {
        orn.bend = 100 * (this.semi(deg + 1) - this.semi(deg));
        orn.bendAt = 0.35;
      }
    }
    if (windy && !orn.bend && dur > beatSec * 0.8 && rng.chance(0.22)) orn.grace = this.hz(deg + 1) / this.hz(deg);
    const leap = prev === null ? 99 : Math.abs(this.semi(prev) - this.semi(deg));
    if (prev !== null && prev !== deg && leap <= 5 && (bowed ? rng.chance(0.6) : windy && rng.chance(0.25))) {
      orn.from = this.hz(prev) / this.hz(deg);
      orn.slide = bowed ? 0.16 : 0.08;
    } else if (voice === "taepyeongso" && !orn.grace && rng.chance(0.35)) {
      orn.from = cents(-70);
      orn.slide = 0.07;
    }
    return orn;
  }

  private playLine(key: string, line: Line, notes: readonly Note[], octShift: number, intensity: number, at: (s: number) => number, stepDur: number, lag: number): void {
    const out = this.line(key, line.gain, line.wet, line.echo);
    const n = this.scale.length;
    const beatSec = stepDur * this.jd.beat;
    const plucked = line.voice === "gayageum" || line.voice === "geomungo" || line.voice === "musicbox";
    for (const note of notes) {
      const deg = note.deg + octShift * n;
      const t = at(note.s) + lag + (this.rng.next() - 0.5) * 0.012;
      const dur = note.l * stepDur * (plucked ? 1 : 0.96);
      const orn = this.ornament(line.voice, deg, this.prev.get(key) ?? null, dur, beatSec);
      const accent = this.beats.includes(note.s) ? 1 : 0.84;
      const vel = (0.62 + 0.38 * intensity) * accent * (0.92 + 0.12 * this.rng.next());
      this.voice(line.voice, out, t, deg, dur, vel, orn);
      this.prev.set(key, deg);
    }
  }

  private voice(v: MelodicVoice, out: VoiceOut, t: number, deg: number, dur: number, vel: number, orn: Ornament = {}): void {
    const hz = this.hz(deg);
    this.push(t, (at) => playNote(v, out, at, hz, dur, vel, orn));
  }

  /** Heterophony: the counter line holds the lead's skeleton, absorbing most short notes. */
  private skeleton(notes: readonly Note[]): Note[] {
    const out: Note[] = [];
    for (const nt of notes) {
      const last = out[out.length - 1];
      if (last && nt.l < this.jd.beat && this.rng.chance(0.7)) last.l = nt.s + nt.l - last.s;
      else out.push({ ...nt });
    }
    return out;
  }

  private melody(pos: number, intensity: number, at: (s: number) => number, stepDur: number): void {
    const { lead, counter, phraseBars } = this.spec;
    if (this.leadRest) return;
    const notes = this.notes[pos] ?? [];
    const counterOn = counter !== undefined && intensity >= (counter.minI ?? 0);
    const answering = counter !== undefined && counterOn && counter.mode === "answer" && pos >= phraseBars / 2;
    if (!answering) this.playLine("lead", lead, notes, 0, intensity, at, stepDur, 0);
    if (!counter || !counterOn) return;
    const shift = counter.oct - lead.oct;
    if (counter.mode === "hetero") this.playLine("counter", counter, this.skeleton(notes), shift, intensity, at, stepDur, 0.035);
    else if (answering) this.playLine("counter", counter, notes, shift, intensity, at, stepDur, 0);
  }

  private accompany(bar: number, pos: number, intensity: number, at: (s: number) => number, stepDur: number, barDur: number): void {
    const n = this.scale.length;
    const half = this.halfIdx();
    const leadHome = this.spec.lead.oct * n;
    const notes = this.leadRest ? [] : (this.notes[pos] ?? []);
    const rel = mod((notes[0]?.deg ?? leadHome) - leadHome, n);
    const rootOff = rel >= 2 && rel <= 3 ? half : 0;
    const v = 0.6 + 0.4 * intensity;
    (this.spec.accomp ?? []).forEach((a, i) => {
      if (intensity < (a.minI ?? 0)) return;
      const out = this.line(`acc${i}`, a.gain, a.wet, a.echo);
      const base = a.oct * n;
      switch (a.kind) {
        case "bass": {
          const main = this.jd.main;
          for (let s = 0; s < main.length; s++) {
            const c = main[s];
            if (c !== "D" && c !== "K") continue;
            const deg = base + (s === 0 ? rootOff : this.rng.chance(0.5) ? half : 0);
            this.voice(a.voice, out, at(s), deg, stepDur * this.jd.beat * 1.5, v * (s === 0 ? 0.95 : 0.6));
          }
          if (intensity > 0.7) this.voice(a.voice, out, at(main.length - 1), base + 1, stepDur, v * 0.45);
          break;
        }
        case "arp":
          this.beats.forEach((s0, bi) => {
            if (intensity < 0.5 && bi % 2 === 1) return;
            const pat = this.rng.pick(ARPS);
            const len = intensity < 0.65 ? 1 : (this.jd.groups[bi] ?? 1);
            for (let k = 0; k < len; k++) {
              this.voice(a.voice, out, at(s0 + k), base + rootOff + (pat[k % pat.length] ?? 0), stepDur * 1.6, v * (0.55 - k * 0.08));
            }
          });
          break;
        case "drone":
          if (bar % 2 === 0) {
            this.voice(a.voice, out, at(0), base, barDur * 2 + 0.4, v * 0.8);
            if (intensity > 0.5) this.voice(a.voice, out, at(0) + 0.3, base + half, barDur * 2, v * 0.45);
          }
          break;
        case "wind":
          if (bar % 2 === 0) {
            const t = at(0) + this.rng.next();
            this.push(t, (at) => wind(out, at, barDur * 2 + 1, v));
          }
          break;
        case "organ": {
          const chord = this.chords[pos] ?? [0, 2, 4];
          for (const c of chord) this.voice(a.voice, out, at(0), base + c, barDur * 0.97, v * 0.5);
          this.voice(a.voice, out, at(0), base - n + (chord[0] ?? 0), barDur * 0.97, v * 0.35);
          break;
        }
        case "bells": {
          let lastS = -99;
          for (const nt of notes) {
            if (!this.beats.includes(nt.s) || nt.l < this.jd.beat || nt.s - lastS < 2 * this.jd.beat) continue;
            lastS = nt.s;
            this.voice(a.voice, out, at(nt.s) + 0.02, base + nt.deg - leadHome, 2, v * 0.6);
          }
          break;
        }
      }
    });
  }

  private percussion(bar: number, pos: number, intensity: number, at: (s: number) => number, stepDur: number): void {
    const { spec, jd, rng } = this;
    const out = this.line("perc", 1, 0.22);
    const pat = pos === spec.phraseBars - 1 && intensity > 0.45 ? jd.fill : jd.main;
    const steps = pat.length;
    const hum = (): number => (rng.next() - 0.5) * 0.008;
    const jg = spec.janggu;
    if (jg && intensity >= (jg.minI ?? 0)) {
      for (let s = 0; s < steps; s++) {
        let c = pat[s] ?? "-";
        if (c === "-") continue;
        if (intensity < 0.4 && (c === "G" || c === "R")) c = "T";
        if (intensity < 0.3 && !this.beats.includes(s)) continue;
        const vel = jg.gain * (0.62 + 0.38 * intensity) * (s === 0 ? 1 : 0.8) * (0.9 + 0.2 * rng.next());
        const t = at(s) + hum();
        const stroke = c as JangguStroke;
        this.push(t, (at) => janggu(out, at, stroke, vel, stepDur, this.kungHz));
      }
    }
    const bk = spec.buk;
    if (bk && intensity >= (bk.minI ?? 0)) {
      for (const [s, w] of this.bukHits(bk.style, bar, intensity, steps, stepDur)) {
        const t = at(s) + hum();
        const vel = bk.gain * w * (0.6 + 0.4 * intensity) * (0.9 + 0.2 * rng.next());
        this.push(t, (at) => buk(out, at, vel, this.bukHz));
      }
    }
    const jn = spec.jing;
    if (jn && bar % jn.every === 0) {
      const jout = this.line("jing", 1, 0.55);
      const t = at(0);
      const vel = jn.gain * (0.65 + 0.35 * intensity);
      this.push(t, (at) => jing(jout, at, vel, jn.hz ?? this.jingHz));
    }
    const kk = spec.kkw;
    if (kk && intensity >= kk.minI) {
      for (let s = 0; s < steps; s++) {
        const c = pat[s] ?? "-";
        const t = at(s) + hum();
        const open = c === "D";
        const vel = kk.gain * (c === "-" ? 0.35 : open ? 1 : 0.65);
        if (c !== "-" || intensity > 0.8) this.push(t, (at) => kkwaenggwari(out, at, vel, open));
      }
    }
  }

  /** 북 hits as [substep, weight]; substeps may be fractional. */
  private bukHits(style: BukStyle, bar: number, intensity: number, steps: number, stepDur: number): [number, number][] {
    const b = this.beats;
    const hits: [number, number][] = [];
    switch (style) {
      case "slow":
        hits.push([0, 1]);
        if (b.length >= 4) hits.push([b[Math.floor(b.length / 2)] ?? 0, 0.6]);
        if (intensity > 0.65) hits.push([steps - 1, 0.45]);
        break;
      case "march":
        b.forEach((s, i) => hits.push([s, i === 0 ? 1 : 0.7]));
        if (intensity > 0.7) hits.push([steps - 1, 0.5]);
        break;
      case "war":
        b.forEach((s, i) => {
          hits.push([s, i % 2 === 0 ? 1 : 0.75]);
          if (intensity > 0.6 && i % 2 === 1) hits.push([s + 1, 0.45]);
        });
        break;
      case "waves":
        for (let s = 0; s < steps; s++) {
          if (intensity < 0.6 && !b.includes(s)) continue;
          const ph = ((bar % 2) + s / steps) / 2;
          hits.push([s, 0.25 + 0.75 * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph))]);
        }
        break;
      case "heart":
        if (bar % 2 === 0) hits.push([0, 1], [0.24 / stepDur, 0.7]);
        break;
      case "build": {
        const every = intensity < 0.35 ? b.length : intensity < 0.6 ? Math.max(1, b.length / 2) : 1;
        b.forEach((s, i) => {
          if (i % every === 0) hits.push([s, i === 0 ? 1 : 0.7]);
          if (intensity > 0.85) hits.push([s + 1, 0.4]);
        });
        break;
      }
    }
    return hits;
  }
}

/** Starts a mood at context time `startAt`, fading in over `fadeIn` seconds. */
export function createMusicPlayer(targets: MusicTargets, mood: MusicMood, startAt: number, fadeIn = 2, opts: PlayerOptions = {}): MusicPlayer {
  return new Player(targets, mood, startAt, fadeIn, opts);
}
