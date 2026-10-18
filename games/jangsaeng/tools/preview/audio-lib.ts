// Offline rendering and signal analysis for the audio engine harnesses.
// Everything renders through the engine's own buildGraph() (compressor and
// soft clip included) on an OfflineAudioContext, scheduling progressively via
// ctx.suspend() so the music player runs its real lookahead path.

import { buildGraph, triggerSfx, type AudioGraph } from "../../src/client/audio/engine.ts";
import { createMusicPlayer, type MusicPlayer } from "../../src/client/audio/music.ts";
import type { MusicMood, SfxName } from "../../src/client/audio/types.ts";

export interface Rendered {
  readonly buf: AudioBuffer;
  /** Wall-clock milliseconds spent rendering (audio thread work). */
  readonly renderMs: number;
  /** Main-thread milliseconds spent in scheduling callbacks. */
  readonly schedMs: number;
}

/** Renders `seconds` of audio; `setup` wires the graph and returns a per-chunk scheduler. */
export async function renderOffline(seconds: number, sr: number, setup: (g: AudioGraph) => (now: number) => void, chunk = 0.25): Promise<Rendered> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const g = buildGraph(ctx, ctx.destination);
  const step = setup(g);
  let schedMs = 0;
  const run = (now: number): void => {
    const t0 = performance.now();
    step(now);
    schedMs += performance.now() - t0;
  };
  for (let t = chunk; t < seconds - 0.01; t += chunk) {
    const at = t;
    void ctx.suspend(at).then(() => {
      run(ctx.currentTime);
      return ctx.resume();
    });
  }
  run(0);
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  return { buf, renderMs: performance.now() - t0, schedMs };
}

export function musicTargets(g: AudioGraph): { ctx: BaseAudioContext; dry: AudioNode; wet: AudioNode; echo: AudioNode } {
  return { ctx: g.ctx, dry: g.music, wet: g.musicWet, echo: g.musicEcho };
}

/** One mood from t = 0.05 with no fade, scheduled with a 0.4 s lookahead; `solo` keeps one line. */
export function moodSetup(mood: MusicMood, solo?: string, lookahead = 0.4): (g: AudioGraph) => (now: number) => void {
  return (g) => {
    const p: MusicPlayer = createMusicPlayer(musicTargets(g), mood, 0.05, 0.01, solo === undefined ? {} : { solo });
    return (now) => p.scheduleUntil(now + lookahead);
  };
}

export function sfxSetup(name: SfxName, at = 0.01): (g: AudioGraph) => (now: number) => void {
  return (g) => {
    triggerSfx(g, name, at, undefined, 1, mulberry(7));
    return () => {};
  };
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------- analysis

export const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export function mono(buf: AudioBuffer): Float32Array {
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const m = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) m[i] = ((l[i] ?? 0) + (r[i] ?? 0)) / 2;
  return m;
}

export interface Stats {
  peak: number;
  rms: number;
  dc: number;
  crestDb: number;
  nan: number;
  /** Share of samples where the soft clip is active (|x| > 0.7). */
  clipShare: number;
  /** 1 s window RMS range (dBFS), from `from` seconds on. */
  winLoDb: number;
  winHiDb: number;
  onsetsPerSec: number;
  centroidHz: number;
  /** Energy shares: <200 Hz, 200–800, 800–3k, >3k. */
  bands: number[];
  /** Seconds from `from` to the first sample above 10% of peak. */
  attack: number;
  /** Seconds from `from` to the last sample above peak − 40 dB. */
  len40: number;
}

export function analyze(buf: AudioBuffer, from = 0): Stats {
  const sr = buf.sampleRate;
  const start = Math.floor(from * sr);
  let peak = 0;
  let nan = 0;
  let sum = 0;
  let sq = 0;
  let count = 0;
  let clip = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = start; i < d.length; i++) {
      const x = d[i] ?? 0;
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a > 0.7) clip++;
      sum += x;
      sq += x * x;
      count++;
    }
  }
  const rms = Math.sqrt(sq / Math.max(1, count));
  const m = mono(buf);
  // windowed loudness
  const win = sr;
  let lo = Infinity;
  let hi = -Infinity;
  for (let w = start; w + win <= m.length; w += win) {
    let s = 0;
    for (let i = w; i < w + win; i++) s += (m[i] ?? 0) ** 2;
    const v = db(Math.sqrt(s / win));
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  // onsets on an 11.6 ms energy envelope
  const hop = 512;
  const env: number[] = [];
  for (let i = start; i + hop <= m.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += (m[k] ?? 0) ** 2;
    env.push(db(Math.sqrt(s / hop) + 1e-9));
  }
  let onsets = 0;
  let lastOn = -99;
  for (let i = 6; i < env.length; i++) {
    let floor = Infinity;
    for (let k = i - 6; k < i; k++) floor = Math.min(floor, env[k] ?? 0);
    if ((env[i] ?? -99) > -50 && (env[i] ?? -99) - floor > 6 && i - lastOn > 5) {
      onsets++;
      lastOn = i;
    }
  }
  const spec = averageSpectrum(m, start, sr);
  let attack = -1;
  let last = -1;
  const thr = peak * 0.1;
  const tail = peak * 0.01;
  for (let i = start; i < m.length; i++) {
    const a = Math.abs(m[i] ?? 0);
    if (attack < 0 && a >= thr) attack = (i - start) / sr;
    if (a >= tail) last = i;
  }
  return {
    peak, rms, dc: sum / Math.max(1, count), crestDb: db(peak) - db(rms), nan, clipShare: clip / Math.max(1, count),
    winLoDb: lo, winHiDb: hi, onsetsPerSec: onsets / Math.max(0.001, (m.length - start) / sr),
    centroidHz: spec.centroid, bands: spec.bands, attack, len40: last < 0 ? 0 : (last - start) / sr,
  };
}

/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum of m[at … at+n). */
export function magnitudes(m: Float32Array, at: number, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (m[at + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i] ?? 0, im[i] ?? 0);
  return mag;
}

function averageSpectrum(m: Float32Array, start: number, sr: number): { centroid: number; bands: number[] } {
  const n = 2048;
  const power = new Float64Array(n / 2);
  for (let at = start; at + n <= m.length; at += n) {
    const mag = magnitudes(m, at, n);
    for (let i = 0; i < n / 2; i++) power[i] = (power[i] ?? 0) + (mag[i] ?? 0) ** 2;
  }
  const edges = [200, 800, 3000, Infinity];
  const bands = [0, 0, 0, 0];
  let total = 0;
  let weighted = 0;
  for (let i = 1; i < n / 2; i++) {
    const f = (i * sr) / n;
    const p = power[i] ?? 0;
    total += p;
    weighted += f * p;
    const b = edges.findIndex((e) => f < e);
    bands[b] = (bands[b] ?? 0) + p;
  }
  return { centroid: weighted / Math.max(1e-12, total), bands: bands.map((b) => b / Math.max(1e-12, total)) };
}

/** A-weighted RMS level in dB (mean-square from a Hann-windowed averaged spectrum). */
export function levelA(m: Float32Array, sr: number, from = 0): number {
  const n = 2048;
  let wsum = 0;
  for (let i = 0; i < n; i++) wsum += (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))) ** 2;
  const weight = new Float64Array(n / 2);
  for (let i = 1; i < n / 2; i++) {
    const f2 = ((i * sr) / n) ** 2;
    const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
    weight[i] = (ra * 1.2589) ** 2;
  }
  let total = 0;
  let frames = 0;
  for (let at = Math.floor(from * sr); at + n <= m.length; at += n) {
    const mag = magnitudes(m, at, n);
    for (let i = 1; i < n / 2; i++) total += (mag[i] ?? 0) ** 2 * (weight[i] ?? 0);
    frames++;
  }
  return db(Math.sqrt((2 * total) / Math.max(1, frames) / (n * wsum)) + 1e-12);
}

/** Loudest A-weighted level over `win`-second windows (momentary max, for sparse events). */
export function levelAMax(m: Float32Array, sr: number, from = 0, win = 0.4): number {
  const n = Math.floor(win * sr);
  let best = -240;
  for (let at = Math.floor(from * sr); at + n <= m.length; at += Math.floor(n / 2)) best = Math.max(best, levelA(m.subarray(at, at + n), sr));
  return best;
}

/** Pitch-class histogram (relative to `tonic`) from the strongest spectral peaks, 90–2500 Hz. */
export function pitchClasses(m: Float32Array, sr: number, tonic: number, from = 0): { hist: number[]; centsDev: number } {
  const n = 8192;
  const hist = new Array<number>(12).fill(0);
  let dev = 0;
  let devW = 0;
  for (let at = Math.floor(from * sr); at + n <= m.length; at += n / 2) {
    const mag = magnitudes(m, at, n);
    let frameMax = 0;
    for (const v of mag) frameMax = Math.max(frameMax, v);
    if (frameMax < 1e-3) continue;
    const peaks: [number, number][] = [];
    const lo = Math.floor((90 * n) / sr);
    const hi = Math.ceil((2500 * n) / sr);
    for (let i = lo; i < hi; i++) {
      const v = mag[i] ?? 0;
      if (v > frameMax * 0.08 && v > (mag[i - 1] ?? 0) && v >= (mag[i + 1] ?? 0)) peaks.push([i, v]);
    }
    peaks.sort((a, b) => b[1] - a[1]);
    for (const [i, v] of peaks.slice(0, 5)) {
      const a = mag[i - 1] ?? 0;
      const c = mag[i + 1] ?? 0;
      const den = a - 2 * v + c; // ≤ 0 at a peak
      const off = den < -1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const f = ((i + off) * sr) / n;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = (((Math.round(midi) - tonic) % 12) + 12) % 12;
      hist[pc] = (hist[pc] ?? 0) + v;
      dev += Math.abs(midi - Math.round(midi)) * 100 * v;
      devW += v;
    }
  }
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  return { hist: hist.map((h) => h / total), centsDev: dev / Math.max(1e-12, devW) };
}

/** Melody pitch classes from a harmonic-product-spectrum f0 track (80–1400 Hz), energy weighted. */
export function f0Classes(m: Float32Array, sr: number, tonic: number, from = 0): { hist: number[]; voiced: number } {
  const n = 8192;
  const hist = new Array<number>(12).fill(0);
  let frames = 0;
  let voiced = 0;
  for (let at = Math.floor(from * sr); at + n <= m.length; at += n / 4) {
    frames++;
    const mag = magnitudes(m, at, n);
    let best = 0;
    let bestK = 0;
    for (let k = Math.floor((80 * n) / sr); k < (1400 * n) / sr; k++) {
      const p = (mag[k] ?? 0) * Math.sqrt((mag[2 * k] ?? 0) * (mag[3 * k] ?? 0) + 1e-12);
      if (p > best) {
        best = p;
        bestK = k;
      }
    }
    const v = mag[bestK] ?? 0;
    if (v < 1) continue; // silence (magnitudes scale with n)
    voiced++;
    const a = mag[bestK - 1] ?? 0;
    const c = mag[bestK + 1] ?? 0;
    const den = a - 2 * v + c;
    const off = den < -1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const midi = 69 + 12 * Math.log2(((bestK + off) * sr) / n / 440);
    const pc = (((Math.round(midi) - tonic) % 12) + 12) % 12;
    hist[pc] = (hist[pc] ?? 0) + v;
  }
  const total = hist.reduce((x, y) => x + y, 0) || 1;
  return { hist: hist.map((h) => h / total), voiced: voiced / Math.max(1, frames) };
}

/** Log-frequency spectrogram: cols × rows magnitudes in dB (row 0 = lowest band). */
export function spectrogram(m: Float32Array, sr: number, cols: number, rows: number, fLo = 50, fHi = 12000): Float32Array {
  const n = 2048;
  const out = new Float32Array(cols * rows).fill(-120);
  for (let c = 0; c < cols; c++) {
    const at = Math.floor((c / cols) * Math.max(0, m.length - n));
    const mag = magnitudes(m, at, n);
    for (let r = 0; r < rows; r++) {
      const f0 = fLo * Math.pow(fHi / fLo, r / rows);
      const f1 = fLo * Math.pow(fHi / fLo, (r + 1) / rows);
      let best = 0;
      for (let i = Math.floor((f0 * n) / sr); i <= Math.ceil((f1 * n) / sr) && i < n / 2; i++) best = Math.max(best, mag[i] ?? 0);
      out[c * rows + r] = db(best / (n / 4) + 1e-9);
    }
  }
  return out;
}

/** Per-column min/max of a signal for waveform drawing. */
export function envelope(m: Float32Array, cols: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(cols);
  const max = new Float32Array(cols);
  const per = m.length / cols;
  for (let c = 0; c < cols; c++) {
    let lo = 0;
    let hi = 0;
    for (let i = Math.floor(c * per); i < Math.floor((c + 1) * per); i++) {
      const v = m[i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}

/** 16-bit PCM stereo WAV bytes. */
export function wavBytes(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  out.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c]?.[i] ?? 0));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}

export const fmt = (x: number, digits = 3): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
export const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
