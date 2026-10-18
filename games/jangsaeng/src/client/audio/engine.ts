// Procedural audio engine: master graph, lookahead music scheduler and sfx.
//
//   music ─┐                                 ┌→ convolver (generated IR) ─┐
//   sfx ───┼→ master → mute → compressor → soft clip → destination        │
//   reverb/echo returns ──────────────────────────────────────────────────┘
//
// buildGraph() targets any BaseAudioContext + destination so the offline
// verification harness renders exactly what the live engine plays. Without
// Web Audio, createAudioEngine() returns a silent engine that never throws.

import { createRng } from "../../shared/rng.ts";
import { createMusicPlayer, type MusicPlayer } from "./music.ts";
import { createSfxThrottle, playSfx, SFX_SPECS } from "./sfx.ts";
import type { AudioEngine, AudioVolumes, MusicMood, SfxName, SfxOptions } from "./types.ts";

export const DEFAULT_VOLUMES: Readonly<Required<AudioVolumes>> = { master: 0.85, music: 0.6, sfx: 0.85 };
/** Crossfade between moods, seconds. */
export const CROSSFADE = 2;
const LOOKAHEAD = 0.15;
/** Hidden tabs clamp timers to ~1 s; look further ahead so unsuspended music stays continuous. */
const HIDDEN_LOOKAHEAD = 1.5;
const TICK_MS = 25;

export interface AudioGraph {
  readonly ctx: BaseAudioContext;
  /** User master volume. */
  readonly master: GainNode;
  readonly mute: GainNode;
  /** Music bus and its reverb / echo sends (each scaled by the music volume). */
  readonly music: GainNode;
  readonly musicWet: GainNode;
  readonly musicEcho: GainNode;
  /** Sfx bus and its reverb send (each scaled by the sfx volume). */
  readonly sfx: GainNode;
  readonly sfxWet: GainNode;
}

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Soft clipper: unity below 0.7, tanh knee approaching 0.98 at input ±2 (fed at half gain). */
function clipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  return curve;
}

/** Stereo hall impulse: early reflections, then darkening exponential noise (T60 ≈ 2.4 s). */
function impulse(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.6);
  const buf = ctx.createBuffer(2, len, sr);
  const r = createRng("jangsaeng-reverb");
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / sr;
      const damp = 0.85 - 0.7 * Math.min(1, x / 2);
      lp += damp * (r.next() * 2 - 1 - lp);
      d[i] = x < 0.012 ? 0 : lp * Math.exp((-6.9 * x) / 2.4);
    }
    for (const tap of [0.013, 0.021, 0.034, 0.047, 0.066]) {
      const i = Math.floor((tap + ch * 0.0023) * sr);
      d[i] = (d[i] ?? 0) + (r.next() - 0.5) * 0.9;
    }
  }
  return buf;
}

/** Builds the master chain, buses and shared reverb / echo on any context. */
export function buildGraph(ctx: BaseAudioContext, destination: AudioNode): AudioGraph {
  const master = gainNode(ctx, DEFAULT_VOLUMES.master);
  const mute = gainNode(ctx, 1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  const pre = gainNode(ctx, 0.5);
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve();
  clip.oversample = "none";
  master.connect(mute).connect(comp).connect(pre).connect(clip).connect(destination);

  const music = gainNode(ctx, DEFAULT_VOLUMES.music);
  const sfx = gainNode(ctx, DEFAULT_VOLUMES.sfx);
  music.connect(master);
  sfx.connect(master);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  verb.connect(gainNode(ctx, 0.5)).connect(master);
  const musicWet = gainNode(ctx, DEFAULT_VOLUMES.music);
  const sfxWet = gainNode(ctx, DEFAULT_VOLUMES.sfx);
  musicWet.connect(verb);
  sfxWet.connect(verb);

  const musicEcho = gainNode(ctx, DEFAULT_VOLUMES.music);
  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = 0.42;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 2400;
  musicEcho.connect(delay).connect(damp);
  damp.connect(gainNode(ctx, 0.33)).connect(delay);
  damp.connect(gainNode(ctx, 0.6)).connect(master);
  damp.connect(gainNode(ctx, 0.3)).connect(verb);

  return { ctx, master, mute, music, musicWet, musicEcho, sfx, sfxWet };
}

/** Applies volumes (0…1) to a graph, smoothed from `at`. */
export function applyVolumes(g: AudioGraph, v: Readonly<Required<AudioVolumes>>, at: number, smooth = 0.05): void {
  const set = (node: GainNode, value: number): void => {
    node.gain.setTargetAtTime(value, at, smooth);
  };
  set(g.master, v.master);
  set(g.music, v.music);
  set(g.musicWet, v.music);
  set(g.musicEcho, v.music);
  set(g.sfx, v.sfx);
  set(g.sfxWet, v.sfx);
}

/** Plays one effect through a per-trigger gain / panner on the graph's sfx bus. Returns its end time. */
export function triggerSfx(g: AudioGraph, name: SfxName, t: number, opts: SfxOptions | undefined, scale: number, rand: () => number): { end: number; nodes: AudioNode[] } {
  const ctx = g.ctx;
  const level = clamp(opts?.gain ?? 1, 0, 2, 1) * scale;
  const dry = gainNode(ctx, level);
  const wet = gainNode(ctx, level * SFX_SPECS[name].wet);
  const nodes: AudioNode[] = [dry, wet];
  const pan = opts?.pan;
  if (pan !== undefined && pan !== 0 && Number.isFinite(pan) && typeof ctx.createStereoPanner === "function") {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1, 0);
    dry.connect(p).connect(g.sfx);
    nodes.push(p);
  } else dry.connect(g.sfx);
  wet.connect(g.sfxWet);
  const dur = playSfx({ ctx, dry, wet }, name, t, opts?.pitch ?? 1, rand);
  return { end: t + dur, nodes };
}

/** Clamps finite values; non-finite input (NaN, ±Infinity, wrong type) yields `fallback`. */
function clamp(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Runs a context state call that may throw, return a promise, or (old WebKit) return nothing. */
function settle(call: () => Promise<void> | undefined, then?: () => void): void {
  try {
    void Promise.resolve(call()).then(then, () => {});
  } catch {
    // Already closed or not allowed: the statechange handler keeps the engine consistent.
  }
}

function silentEngine(): AudioEngine {
  let muted = false;
  return {
    unlock: () => Promise.resolve(),
    get unlocked() {
      return false;
    },
    setMusic() {},
    sfx() {},
    setVolumes() {},
    setMuted(m) {
      muted = m;
    },
    get muted() {
      return muted;
    },
    suspend() {},
    resume() {},
  };
}

type ContextCtor = new (options?: AudioContextOptions) => AudioContext;

function findContext(): ContextCtor | null {
  const g = globalThis as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Creates the engine; returns a silent no-op engine when Web Audio is unavailable. */
export function createAudioEngine(): AudioEngine {
  try {
    const Ctor = findContext();
    return Ctor ? liveEngine(Ctor) : silentEngine();
  } catch {
    return silentEngine();
  }
}

function liveEngine(Ctor: ContextCtor): AudioEngine {
  let ctx: AudioContext | null = null;
  let graph: AudioGraph | null = null;
  let desired: MusicMood | null = null;
  let player: MusicPlayer | null = null;
  let fading: MusicPlayer[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let muted = false;
  let suspended = false;
  let failed = false;
  const vols: Required<AudioVolumes> = { ...DEFAULT_VOLUMES };
  const throttle = createSfxThrottle();
  let garbage: { at: number; nodes: AudioNode[] }[] = [];

  const running = (): boolean => !suspended && ctx !== null && ctx.state === "running";

  function ensureContext(): boolean {
    if (ctx) return true;
    if (failed) return false;
    try {
      try {
        ctx = new Ctor({ latencyHint: "interactive" });
      } catch {
        ctx = new Ctor();
      }
      graph = buildGraph(ctx, ctx.destination);
      applyVolumes(graph, vols, ctx.currentTime, 0.001);
      graph.mute.gain.value = muted ? 0 : 1;
      ctx.onstatechange = sync;
      return true;
    } catch {
      failed = true;
      ctx = null;
      graph = null;
      return false;
    }
  }

  /** Starts or stops the scheduler to match the context state. */
  function sync(): void {
    if (running()) {
      if (timer === null) timer = setInterval(tick, TICK_MS);
      tick();
    } else if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function release(): void {
    player?.dispose();
    for (const p of fading) p.dispose();
    player = null;
    fading = [];
    for (const item of garbage) for (const n of item.nodes) n.disconnect();
    garbage = [];
  }

  function tick(): void {
    if (!ctx || !graph || !running()) return;
    try {
      const now = ctx.currentTime;
      if ((player?.mood ?? null) !== desired) {
        const at = now + 0.03;
        if (player) {
          player.fadeOut(at, CROSSFADE);
          fading.push(player);
        }
        while (fading.length > 3) fading.shift()?.dispose();
        player = desired
          ? createMusicPlayer({ ctx, dry: graph.music, wet: graph.musicWet, echo: graph.musicEcho }, desired, at, CROSSFADE)
          : null;
      }
      const until = now + (typeof document !== "undefined" && document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD);
      player?.scheduleUntil(until);
      fading = fading.filter((p) => {
        if (now > p.endTime + 0.25) {
          p.dispose();
          return false;
        }
        p.scheduleUntil(until);
        return true;
      });
      if (garbage.length && (garbage[0]?.at ?? Infinity) < now) {
        garbage = garbage.filter((item) => {
          if (item.at >= now) return true;
          for (const n of item.nodes) n.disconnect();
          return false;
        });
      }
    } catch {
      // The scheduler must never throw out of the timer.
    }
  }

  return {
    async unlock() {
      if (!ensureContext() || !ctx) return;
      try {
        // iOS only unlocks output when a source starts inside the gesture.
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
        if (!suspended && ctx.state !== "running") {
          // resume() can stay pending without user activation; never hang the caller.
          await Promise.race([ctx.resume(), new Promise<void>((done) => setTimeout(done, 300))]);
        }
      } catch {
        // Autoplay policy or a closed device: stay locked, retry on the next gesture.
      }
      sync();
    },
    get unlocked() {
      return ctx !== null && ctx.state === "running";
    },
    setMusic(mood) {
      if (mood === desired) return;
      desired = mood;
      tick();
    },
    sfx(name, opts) {
      if (!ctx || !graph || muted || !running() || !Object.hasOwn(SFX_SPECS, name)) return;
      try {
        const now = ctx.currentTime;
        const scale = throttle.admit(name, now);
        if (scale === null) return;
        const { end, nodes } = triggerSfx(graph, name, now + 0.005, opts, scale, Math.random);
        garbage.push({ at: end + 0.5, nodes });
      } catch {
        // Bad options or a device hiccup must not reach game code.
      }
    },
    setVolumes(v) {
      vols.master = clamp(v.master ?? vols.master, 0, 1, vols.master);
      vols.music = clamp(v.music ?? vols.music, 0, 1, vols.music);
      vols.sfx = clamp(v.sfx ?? vols.sfx, 0, 1, vols.sfx);
      if (ctx && graph) applyVolumes(graph, vols, ctx.currentTime);
    },
    setMuted(m) {
      muted = m;
      if (ctx && graph) graph.mute.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.04);
    },
    get muted() {
      return muted;
    },
    suspend() {
      if (suspended) return;
      suspended = true;
      sync();
      const c = ctx;
      if (!c || !graph) return release();
      graph.mute.gain.setTargetAtTime(0, c.currentTime, 0.015);
      setTimeout(() => {
        if (!suspended) return;
        release();
        settle(() => c.suspend());
      }, 80);
    },
    resume() {
      if (!suspended) return;
      suspended = false;
      const c = ctx;
      if (!c || !graph) return;
      graph.mute.gain.setTargetAtTime(muted ? 0 : 1, c.currentTime, 0.03);
      settle(() => c.resume(), sync);
      sync();
    },
  };
}
