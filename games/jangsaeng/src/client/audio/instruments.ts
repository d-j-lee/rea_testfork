// 국악 voices synthesized with the Web Audio API.
//
// Every voice schedules its own nodes on any BaseAudioContext at an absolute
// context time, sums them into one gain wired to the caller's dry (and
// optional reverb) destination, and detaches that gain when its last source
// ends. Plucked strings play cached Karplus-Strong buffers whose playbackRate
// carries 농현 (vibrato and bends); winds and the fiddle are oscillators with
// breath/bow noise; drums and gongs are pitched sines, FM and filtered noise.

import { createRng } from "../../shared/rng.ts";

export interface VoiceOut {
  readonly ctx: BaseAudioContext;
  readonly dry: AudioNode;
  readonly wet: AudioNode | null;
}

/** Expressive pitch gestures (시김새). Ratios are relative to the target pitch. */
export interface Ornament {
  /** Start pitch ratio of a slide into the note (previous pitch / target). */
  from?: number;
  /** Slide duration in seconds. */
  slide?: number;
  /** Short leading grace note, as a pitch ratio. */
  grace?: number;
  /** Vibrato depth in cents (농현, 떠는음). */
  vib?: number;
  vibRate?: number;
  /** Seconds after onset before the vibrato fades in. */
  vibDelay?: number;
  /** Bend in cents reached late in the note (추성 > 0, 퇴성/꺾는음 < 0). */
  bend?: number;
  /** Where the bend starts, as a fraction of the duration. */
  bendAt?: number;
}

export type MelodicVoice =
  | "gayageum" | "geomungo" | "daegeum" | "haegeum" | "piri" | "taepyeongso"
  | "musicbox" | "pyeonjong" | "organ" | "drone";

/** 장구 strokes: 덩 (both heads), 쿵 / soft 쿵, 덕 / soft 덕, 기덕, 더러러 roll. */
export type JangguStroke = "D" | "K" | "k" | "T" | "t" | "G" | "R";

type Wave = Exclude<OscillatorType, "custom">;
type Partial3 = readonly [ratio: number, amp: number, tau: number];

const jitter = createRng("jangsaeng-audio-jitter");

export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
const cents = (c: number): number => Math.pow(2, c / 1200);

// ---------------------------------------------------------------- plumbing

/** The voice's summing gain and only link to the outputs; detached when `last` ends. */
function voiceBus(o: VoiceOut, last: AudioScheduledSourceNode, level = 0): GainNode {
  const g = o.ctx.createGain();
  g.gain.value = level;
  g.connect(o.dry);
  if (o.wet) g.connect(o.wet);
  last.onended = () => g.disconnect();
  return g;
}

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function perc(p: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  const a = Math.max(0.0005, attack);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, tau);
}

/** Sustained-note envelope; long notes dip then swell toward the end (밀어 올림). */
function swellEnv(p: AudioParam, t: number, dur: number, vel: number, attack: number, release: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(vel * 0.85, t + attack);
  if (dur > 0.7) {
    p.linearRampToValueAtTime(vel * 0.72, t + dur * 0.4);
    p.linearRampToValueAtTime(vel, t + dur * 0.85);
  }
  p.setTargetAtTime(0, t + Math.max(dur, attack), release);
}

function osc(ctx: BaseAudioContext, kind: Wave | PeriodicWave, hz: number, t: number, end: number): OscillatorNode {
  const s = ctx.createOscillator();
  // PeriodicWave is structurally empty, so narrow by typeof and cast.
  if (typeof kind === "string") s.type = kind as Wave;
  else s.setPeriodicWave(kind);
  s.frequency.value = hz;
  s.start(t);
  s.stop(end);
  return s;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q = 0.707, db = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  f.gain.value = db;
  return f;
}

function glideParam(p: AudioParam, t: number, from: number, to: number, time: number): void {
  p.setValueAtTime(from, t);
  if (to !== from) p.exponentialRampToValueAtTime(to, t + Math.max(0.001, time));
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const r = createRng("jangsaeng-noise");
    for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function noise(ctx: BaseAudioContext, t: number, end: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t, jitter.next() * 1.8);
  s.stop(end);
  return s;
}

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

function periodic(ctx: BaseAudioContext, key: string, harmonics: readonly number[]): PeriodicWave {
  let byKey = waveCache.get(ctx);
  if (!byKey) waveCache.set(ctx, (byKey = new Map()));
  let w = byKey.get(key);
  if (!w) {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((a, i) => (imag[i + 1] = a));
    w = ctx.createPeriodicWave(real, imag);
    byKey.set(key, w);
  }
  return w;
}

/** Pitch path of a note: grace or slide into it, then an optional late bend. */
function pitchAuto(p: AudioParam, t: number, base: number, dur: number, orn: Ornament): void {
  let settle = t;
  if (orn.grace) {
    const g = base * orn.grace;
    p.setValueAtTime(g, t);
    p.setValueAtTime(g, t + 0.05);
    p.exponentialRampToValueAtTime(base, t + 0.08);
    settle = t + 0.08;
  } else if (orn.from) {
    const st = Math.min(orn.slide ?? 0.12, dur * 0.4);
    glideParam(p, t, base * orn.from, base, st);
    settle = t + st;
  } else p.setValueAtTime(base, t);
  if (orn.bend) {
    const bt = Math.max(settle + 0.03, t + dur * (orn.bendAt ?? 0.65));
    p.setValueAtTime(base, bt);
    p.exponentialRampToValueAtTime(base * cents(orn.bend), bt + Math.min(0.25, Math.max(0.06, dur * 0.25)));
  }
}

/** Delayed, slowly accelerating vibrato added to frequency-like params whose nominal value is `base`. */
function vibrato(ctx: BaseAudioContext, params: readonly AudioParam[], base: number, t: number, end: number, orn: Ornament): void {
  const depth = orn.vib ?? 0;
  const start = t + (orn.vibDelay ?? 0.2);
  if (depth <= 0 || start >= end - 0.1) return;
  const rate = orn.vibRate ?? 5;
  const lfo = osc(ctx, "sine", rate * 0.9, start, end);
  lfo.frequency.setValueAtTime(rate * 0.9, start);
  lfo.frequency.linearRampToValueAtTime(rate * 1.12, end);
  const amt = gainNode(ctx, 0);
  amt.gain.setValueAtTime(0, start);
  amt.gain.linearRampToValueAtTime(base * (cents(depth) - 1), Math.min(end, start + 0.4));
  lfo.connect(amt);
  for (const p of params) amt.connect(p);
}

// -------------------------------------------------------------- primitives

/** Pitched blip: oscillator gliding f0→f1 under a percussive envelope. Returns its end time. */
export function tone(o: VoiceOut, t: number, type: Wave, f0: number, f1: number, glide: number, attack: number, tau: number, vel: number): number {
  const end = t + attack + tau * 7;
  const s = osc(o.ctx, type, f0, t, end);
  glideParam(s.frequency, t, f0, f1, glide);
  const g = voiceBus(o, s);
  perc(g.gain, t, vel, attack, tau);
  s.connect(g);
  return end;
}

/** Filtered noise burst; the filter glides f0→f1. Returns its end time. */
export function burst(o: VoiceOut, t: number, type: BiquadFilterType, f0: number, f1: number, q: number, attack: number, tau: number, vel: number, glide = attack + tau * 2): number {
  const end = t + attack + tau * 7;
  const n = noise(o.ctx, t, end);
  const f = filter(o.ctx, type, f0, q);
  glideParam(f.frequency, t, f0, f1, glide);
  const g = voiceBus(o, n);
  perc(g.gain, t, vel, attack, tau);
  n.connect(f).connect(g);
  return end;
}

/** Two-operator FM clang (bells, gongs, metal impacts); the index decays faster than the tone. */
export function metal(o: VoiceOut, t: number, hz: number, ratio: number, index: number, attack: number, tau: number, vel: number, indexTau = tau * 0.5): number {
  const ctx = o.ctx;
  const end = t + attack + tau * 7;
  const c = osc(ctx, "sine", hz, t, end);
  const m = osc(ctx, "sine", hz * ratio, t, end);
  const depth = gainNode(ctx, hz * index);
  depth.gain.setValueAtTime(hz * index, t);
  depth.gain.setTargetAtTime(hz * index * 0.08, t + attack, indexTau);
  m.connect(depth).connect(c.frequency);
  const g = voiceBus(o, c);
  perc(g.gain, t, vel, attack, tau);
  c.connect(g);
  return end;
}

/** Oscillator through a swept filter with attack / hold / release (grunts, buzzes, sweeps). */
export function voiced(o: VoiceOut, t: number, type: Wave, f0: number, f1: number, glide: number, ftype: BiquadFilterType, fc0: number, fc1: number, q: number, attack: number, hold: number, tau: number, vel: number): number {
  const ctx = o.ctx;
  const end = t + attack + hold + tau * 7;
  const s = osc(ctx, type, f0, t, end);
  glideParam(s.frequency, t, f0, f1, glide);
  const f = filter(ctx, ftype, fc0, q);
  glideParam(f.frequency, t, fc0, fc1, glide);
  const g = voiceBus(o, s);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setValueAtTime(vel, t + attack + hold);
  g.gain.setTargetAtTime(0, t + attack + hold, tau);
  s.connect(f).connect(g);
  return end;
}

/** Band-noise swell (wind, whooshes): filter glides lo→hi→end while the level rises and falls. */
export function sweep(o: VoiceOut, t: number, dur: number, lo: number, hi: number, endHz: number, q: number, vel: number, peakAt = 0.5): number {
  const ctx = o.ctx;
  const end = t + dur + 0.05;
  const n = noise(ctx, t, end);
  const bp = filter(ctx, "bandpass", lo, q);
  bp.frequency.setValueAtTime(lo, t);
  bp.frequency.exponentialRampToValueAtTime(hi, t + dur * peakAt);
  bp.frequency.exponentialRampToValueAtTime(endHz, t + dur);
  const g = voiceBus(o, n);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + dur * peakAt);
  g.gain.linearRampToValueAtTime(0, t + dur);
  n.connect(bp).connect(g);
  return end;
}

// ------------------------------------------------------ plucked strings (KS)

interface StringModel {
  readonly seconds: number;
  readonly t60: number;
  readonly stretch: number;
  readonly bright: number;
  readonly pick: number;
}
interface Pluck {
  readonly buf: AudioBuffer;
  readonly rate: number;
}

const KS_RATE = 24000;
/** LRU cap: ≤ 32 mono buffers × ≤ 2.4 s × 24 kHz ≈ 7.4 MB. */
const KS_MAX = 32;
const GAYA: StringModel = { seconds: 2.4, t60: 2.1, stretch: 0.38, bright: 0.62, pick: 0.13 };
const GEO: StringModel = { seconds: 2.0, t60: 1.4, stretch: 0.5, bright: 0.3, pick: 0.21 };
const ksCache = new Map<string, Pluck>();

/** Karplus-Strong string rendered once per semitone; buffers are context-independent. */
function renderString(ctx: BaseAudioContext, m: StringModel, hz: number, seed: string): Pluck {
  const len = Math.floor(KS_RATE * m.seconds);
  const buf = ctx.createBuffer(1, len, KS_RATE);
  const d = buf.getChannelData(0);
  const s = m.stretch;
  const n = Math.max(2, Math.floor(KS_RATE / hz - s));
  const actual = KS_RATE / (n + s);
  const t60 = m.t60 * Math.min(1.6, Math.max(0.6, Math.pow(220 / hz, 0.35)));
  const rho = Math.pow(10, -3 / (t60 * actual));
  const r = createRng(seed);
  let lp = 0;
  for (let i = 0; i < n; i++) d[i] = lp += m.bright * (r.next() * 2 - 1 - lp);
  const pick = Math.max(1, Math.round(m.pick * n));
  for (let i = n - 1; i >= pick; i--) d[i] = (d[i] ?? 0) - (d[i - pick] ?? 0);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += (d[i] ?? 0) / n;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs((d[i] = (d[i] ?? 0) - mean)));
  for (let i = 0; i < n; i++) d[i] = (d[i] ?? 0) / peak;
  for (let i = n; i < len; i++) d[i] = rho * ((1 - s) * (d[i - n] ?? 0) + s * (d[i - n - 1] ?? 0));
  // DC blocker plus a short tail fade so the buffer never ends on a step.
  const fade = Math.floor(KS_RATE * 0.03);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < len; i++) {
    const x = d[i] ?? 0;
    y1 = x - x1 + 0.995 * y1;
    x1 = x;
    d[i] = i > len - fade ? (y1 * (len - i)) / fade : y1;
  }
  return { buf, rate: hz / actual };
}

function pluckBuffer(ctx: BaseAudioContext, kind: "gaya" | "geo", hz: number): Pluck {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const key = kind + midi;
  let p = ksCache.get(key);
  if (p) ksCache.delete(key);
  else p = renderString(ctx, kind === "gaya" ? GAYA : GEO, mtof(midi), key);
  ksCache.set(key, p);
  if (ksCache.size > KS_MAX) {
    const oldest = ksCache.keys().next().value;
    if (oldest !== undefined) ksCache.delete(oldest);
  }
  return { buf: p.buf, rate: (p.rate * hz) / mtof(midi) };
}

function pluck(o: VoiceOut, kind: "gaya" | "geo", t: number, hz: number, dur: number, vel: number, orn: Ornament, damp: number): number {
  const { buf, rate } = pluckBuffer(o.ctx, kind, hz);
  const src = o.ctx.createBufferSource();
  src.buffer = buf;
  const end = t + Math.max(0.05, Math.min(dur + damp * 6, buf.duration / rate - 0.01));
  pitchAuto(src.playbackRate, t, rate, dur, orn);
  vibrato(o.ctx, [src.playbackRate], rate, t, end, orn);
  const g = voiceBus(o, src);
  g.gain.setValueAtTime(vel, t);
  g.gain.setTargetAtTime(0, t + dur, damp);
  src.connect(g);
  src.start(t);
  src.stop(end);
  return end;
}

/** 가야금: bright silk pluck; 농현 vibrato and bends ride on the playback rate. */
export function gayageum(o: VoiceOut, t: number, hz: number, dur: number, vel: number, orn: Ornament = {}): number {
  return pluck(o, "gaya", t, hz, dur, vel * 2.2, orn, 0.22);
}

/** 거문고: dark, heavier string struck with the 술대 stick (board slap plus thud). */
export function geomungo(o: VoiceOut, t: number, hz: number, dur: number, vel: number, orn: Ornament = {}): number {
  burst(o, t, "bandpass", 1700, 1100, 1.6, 0.001, 0.012, vel * 0.8);
  tone(o, t, "sine", 150, 85, 0.04, 0.001, 0.035, vel * 0.4);
  return pluck(o, "geo", t + 0.004, hz, dur, vel * 1.8, orn, 0.15);
}

// ------------------------------------------------------- winds and bowed

const DAEGEUM = [1, 0.3, 0.12, 0.06, 0.03, 0.018, 0.01];
// Upper register: the 청 membrane adds a reedy buzz.
const DAEGEUM_CHEONG = [1, 0.42, 0.3, 0.2, 0.15, 0.12, 0.09, 0.07, 0.055, 0.045, 0.035, 0.03];
const ORGAN = [1, 0.55, 0.42, 0.3, 0.22, 0.16, 0.12, 0.09, 0.07, 0.05];

/** 대금: breathy bamboo flute; band-noise breath with an attack chiff, slow vibrato. */
export function daegeum(o: VoiceOut, t: number, hz: number, dur: number, vel: number, orn: Ornament = {}): number {
  const ctx = o.ctx;
  const end = t + dur + 0.4;
  const hi = hz > 640;
  const s = osc(ctx, periodic(ctx, hi ? "dgc" : "dg", hi ? DAEGEUM_CHEONG : DAEGEUM), hz, t, end);
  pitchAuto(s.frequency, t, hz, dur, orn);
  vibrato(ctx, [s.frequency], hz, t, end, orn);
  const bus = voiceBus(o, s, 1);
  const amp = gainNode(ctx, 0);
  swellEnv(amp.gain, t, dur, vel * 0.8, Math.min(0.1, dur * 0.3), 0.09);
  s.connect(amp).connect(bus);
  const n = noise(ctx, t, end);
  const bp = filter(ctx, "bandpass", hz * 2, 2.2);
  glideParam(bp.frequency, t, hz * 4, hz * 2, 0.09);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(vel * 1.5, t + 0.025);
  ng.gain.setTargetAtTime(vel * 0.42, t + 0.03, 0.07);
  ng.gain.setTargetAtTime(0, t + dur, 0.06);
  n.connect(bp).connect(ng).connect(bus);
  return end;
}

/** 해금: bowed two-string fiddle; nasal sawtooth formant, bow scratch, wide slides. */
export function haegeum(o: VoiceOut, t: number, hz: number, dur: number, vel: number, orn: Ornament = {}): number {
  const ctx = o.ctx;
  const end = t + dur + 0.35;
  const s = osc(ctx, "sawtooth", hz, t, end);
  pitchAuto(s.frequency, t, hz, dur, orn);
  vibrato(ctx, [s.frequency], hz, t, end, orn);
  const bus = voiceBus(o, s, 1);
  const nasal = filter(ctx, "peaking", 1150, 1.5, 11);
  const top = filter(ctx, "lowpass", 3600, 0.8);
  const amp = gainNode(ctx, 0);
  swellEnv(amp.gain, t, dur, vel * 0.42, Math.min(0.13, dur * 0.35), 0.08);
  s.connect(nasal).connect(top).connect(amp).connect(bus);
  const n = noise(ctx, t, Math.min(end, t + 0.5));
  const ng = gainNode(ctx, 0);
  perc(ng.gain, t, vel * 0.25, 0.01, 0.06);
  n.connect(filter(ctx, "bandpass", 2600, 0.9)).connect(ng).connect(bus);
  return end;
}

/** 피리 (bright 0) … 태평소 (bright 1): nasal double reed; 태평소 is loud and brassy. */
export function reed(o: VoiceOut, t: number, hz: number, dur: number, vel: number, orn: Ornament, bright: number): number {
  const ctx = o.ctx;
  const end = t + dur + 0.25;
  const a = osc(ctx, "sawtooth", hz, t, end);
  const b = osc(ctx, "square", hz, t, end);
  b.detune.value = 5;
  pitchAuto(a.frequency, t, hz, dur, orn);
  pitchAuto(b.frequency, t, hz, dur, orn);
  vibrato(ctx, [a.frequency, b.frequency], hz, t, end, orn);
  const bus = voiceBus(o, a, 1);
  const mix = gainNode(ctx, 1);
  a.connect(mix);
  b.connect(gainNode(ctx, 0.45)).connect(mix);
  const formant = filter(ctx, "peaking", 1400, 1.1, 8);
  const top = filter(ctx, "lowpass", 2200 + 5200 * bright, 0.9);
  const amp = gainNode(ctx, 0);
  swellEnv(amp.gain, t, dur, vel * (0.3 + 0.06 * bright), Math.min(0.035, dur * 0.3), 0.07);
  mix.connect(formant).connect(top).connect(amp).connect(bus);
  return end;
}

/** 개화기 music box: comb-tine sine with a short inharmonic 'ting'. */
export function musicBox(o: VoiceOut, t: number, hz: number, vel: number): number {
  const end = tone(o, t, "sine", hz, hz, 0, 0.002, 0.5, vel * 0.75);
  if (hz * 6.27 < 14000) tone(o, t, "sine", hz * 6.27, hz * 6.27, 0, 0.001, 0.035, vel * 0.22);
  tone(o, t, "triangle", hz * 2, hz * 2, 0, 0.002, 0.12, vel * 0.12);
  return end;
}

/** 개화기 reed organ (harmonium): reedy periodic wave, soft speaking attack. */
export function organ(o: VoiceOut, t: number, hz: number, dur: number, vel: number): number {
  const ctx = o.ctx;
  const hold = Math.max(dur, 0.3);
  const end = t + hold + 0.8;
  const s = osc(ctx, periodic(ctx, "organ", ORGAN), hz, t, end);
  s.detune.value = (jitter.next() - 0.5) * 8;
  const bus = voiceBus(o, s);
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(vel * 0.6, t + 0.05);
  bus.gain.linearRampToValueAtTime(vel, t + 0.25);
  bus.gain.setValueAtTime(vel, t + hold);
  bus.gain.setTargetAtTime(0, t + hold, 0.12);
  s.connect(filter(ctx, "lowpass", 1900, 0.6)).connect(bus);
  return end;
}

/** Low sustained drone: two beating saws under a slowly opening lowpass. */
export function drone(o: VoiceOut, t: number, hz: number, dur: number, vel: number): number {
  const ctx = o.ctx;
  const end = t + dur + 1.6;
  const a = osc(ctx, "sawtooth", hz, t, end);
  const b = osc(ctx, "sawtooth", hz * 1.0035, t, end);
  const lp = filter(ctx, "lowpass", hz * 2, 1.2);
  lp.frequency.setValueAtTime(hz * 2, t);
  lp.frequency.linearRampToValueAtTime(hz * 4, t + dur * 0.5);
  lp.frequency.linearRampToValueAtTime(hz * 2.2, t + dur);
  const bus = voiceBus(o, a);
  const atk = Math.min(1.5, dur * 0.35);
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(vel * 0.5, t + atk);
  bus.gain.setValueAtTime(vel * 0.5, t + dur);
  bus.gain.setTargetAtTime(0, t + dur, 0.35);
  a.connect(lp);
  b.connect(lp);
  lp.connect(bus);
  return end;
}

/** Cold wind: wandering band noise. */
export function wind(o: VoiceOut, t: number, dur: number, vel: number): number {
  return sweep(o, t, dur, 380, 900 + jitter.next() * 400, 420, 2.5, vel, 0.4 + jitter.next() * 0.3);
}

// ------------------------------------------------------- percussion, bells

// 북편 (left, palm): low membrane with an inharmonic overtone so it reads on small speakers.
function kung(o: VoiceOut, t: number, vel: number, hz: number): void {
  tone(o, t, "sine", hz * 2.05, hz, 0.06, 0.002, 0.14, vel * 0.85);
  tone(o, t, "sine", hz * 4.67, hz * 2.55, 0.05, 0.002, 0.06, vel * 0.3);
  burst(o, t, "lowpass", 420, 220, 0.7, 0.002, 0.025, vel * 0.5);
}

// 채편 (right, bamboo stick): sharp crack plus a short ringing skin tone two octaves over 북편.
function deok(o: VoiceOut, t: number, vel: number, hz: number): void {
  burst(o, t, "bandpass", 3600, 2600, 1.1, 0.0006, 0.032, vel * 1.3);
  tone(o, t, "triangle", hz * 6, hz * 4, 0.03, 0.0008, 0.05, vel * 0.45);
}

/**
 * 장구 stroke; `step` is the 장단 substep length (for 기덕 graces and 더러러 rolls)
 * and `hz` the 북편 pitch (tuned to the mood so the drum never clashes with the mode).
 */
export function janggu(o: VoiceOut, t: number, stroke: JangguStroke, level: number, step: number, hz = 110): void {
  const vel = level * 1.4;
  switch (stroke) {
    case "D": kung(o, t, vel, hz); deok(o, t, vel * 0.85, hz); break;
    case "K": kung(o, t, vel, hz); break;
    case "k": kung(o, t, vel * 0.55, hz); break;
    case "T": deok(o, t, vel, hz); break;
    case "t": deok(o, t, vel * 0.5, hz); break;
    case "G": deok(o, Math.max(0, t - Math.min(0.07, step * 0.45)), vel * 0.45, hz); deok(o, t, vel, hz); break;
    case "R": for (let i = 0; i < 3; i++) deok(o, t + (i * step) / 3, vel * (0.62 - i * 0.08), hz); break;
  }
}

/** 북: deep barrel drum with a falling pitch and a skin slap. */
export function buk(o: VoiceOut, t: number, vel: number, hz = 72): number {
  const end = tone(o, t, "sine", hz * 2, hz, 0.12, 0.002, 0.28, vel * 1.35);
  tone(o, t, "sine", hz * 2.9, hz * 1.6, 0.08, 0.002, 0.12, vel * 0.72);
  burst(o, t, "lowpass", 1800, 600, 0.8, 0.001, 0.03, vel * 1.45);
  burst(o, t, "bandpass", 320, 260, 1.5, 0.002, 0.06, vel * 0.8);
  return end;
}

/** Sum of decaying sine partials faded out after `len` seconds; returns the end time. */
function partials(o: VoiceOut, t: number, hz: number, set: readonly Partial3[], vel: number, attack: number, len: number, sag: number): number {
  const ctx = o.ctx;
  const end = t + len + 1.2;
  let bus: GainNode | null = null;
  for (const [ratio, amp, tau] of set) {
    const f = hz * ratio;
    const s = osc(ctx, "sine", f, t, end);
    s.frequency.setValueAtTime(f * (1 - sag), t);
    s.frequency.linearRampToValueAtTime(f, t + 0.5);
    s.frequency.linearRampToValueAtTime(f * (1 - sag * 0.5), t + len);
    if (!bus) {
      bus = voiceBus(o, s, 1);
      bus.gain.setValueAtTime(1, t + len);
      bus.gain.linearRampToValueAtTime(0, t + len + 1.1);
    }
    const g = gainNode(ctx, 0);
    perc(g.gain, t, amp * vel, attack, tau);
    s.connect(g).connect(bus);
  }
  return end;
}

const JING: readonly Partial3[] = [
  [1, 1, 2.4], [1.0047, 0.6, 2.0], [2.02, 0.32, 1.4], [2.74, 0.2, 1.0], [3.47, 0.13, 0.7], [4.63, 0.07, 0.45],
];
// 범종 (temple bell): hum and strike tones in beating pairs (맥놀이).
const BEOMJONG: readonly Partial3[] = [
  [1, 1, 3.2], [1.0093, 0.8, 3.0], [2.61, 0.55, 2.2], [2.632, 0.45, 2.0], [3.63, 0.32, 1.5], [5.12, 0.24, 1.1], [7.2, 0.16, 0.8], [9.52, 0.1, 0.55],
];

/** 징: large gong; inharmonic partials with a slow shimmer and a wavering pitch. */
export function jing(o: VoiceOut, t: number, vel: number, hz = 165, len = 5): number {
  burst(o, t, "lowpass", 500, 250, 0.7, 0.004, 0.04, vel * 0.35);
  return partials(o, t, hz, JING, vel * 0.96, 0.01, len, 0.008);
}

/** 범종 temple bell: low beating hum, struck with a wooden log (당목). */
export function beomjong(o: VoiceOut, t: number, vel: number, pitch = 1, len = 6): number {
  burst(o, t, "lowpass", 380 * pitch, 160 * pitch, 0.8, 0.003, 0.05, vel * 0.7);
  return partials(o, t, 64.2 * pitch, BEOMJONG, vel * 0.36, 0.006, len, 0.002);
}

/** 꽹과리: small bright gong; damped strokes are short, open strokes ring. */
export function kkwaenggwari(o: VoiceOut, t: number, vel: number, open: boolean): number {
  const tau = open ? 0.17 : 0.04;
  const end = metal(o, t, 2350, 1.37, 2.4, 0.0008, tau, vel * 0.5, tau * 0.6);
  burst(o, t, "highpass", 6500, 6500, 0.7, 0.0005, 0.012, vel * 0.4);
  return end;
}

/** 편종: tuned bronze bell for court music. */
export function pyeonjong(o: VoiceOut, t: number, hz: number, vel: number): number {
  tone(o, t, "sine", hz, hz, 0, 0.004, 1.3, vel * 0.4);
  return metal(o, t, hz, 1.41, 1.1, 0.002, 0.9, vel * 0.6, 0.25);
}

/** Dispatches a melodic note to its voice. Returns the end time. */
export function playNote(v: MelodicVoice, o: VoiceOut, t: number, hz: number, dur: number, vel: number, orn: Ornament = {}): number {
  switch (v) {
    case "gayageum": return gayageum(o, t, hz, dur, vel, orn);
    case "geomungo": return geomungo(o, t, hz, dur, vel, orn);
    case "daegeum": return daegeum(o, t, hz, dur, vel, orn);
    case "haegeum": return haegeum(o, t, hz, dur, vel, orn);
    case "piri": return reed(o, t, hz, dur, vel, orn, 0.2);
    case "taepyeongso": return reed(o, t, hz, dur, vel, orn, 1);
    case "musicbox": return musicBox(o, t, hz, vel);
    case "pyeonjong": return pyeonjong(o, t, hz, vel);
    case "organ": return organ(o, t, hz, dur, vel);
    case "drone": return drone(o, t, hz, dur, vel);
  }
}
