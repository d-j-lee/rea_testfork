// Live AudioContext test driven by a real click (see audio-run.mjs):
//   node tools/preview/audio-run.mjs tools/preview/audio-live.ts <outDir>
// Wraps the AudioContext to tap the engine's output with an AnalyserNode and
// count created sources, and wraps setInterval to time the scheduler, then
// walks the public API: unlock, moods, rapid crossfades, sfx spam with bad
// options, volumes, mute, suspend / resume and fade to silence.

import { createAudioEngine } from "../../src/client/audio/engine.ts";
import { SFX_NAMES, type MusicMood } from "../../src/client/audio/types.ts";
import { db, fmt } from "./audio-lib.ts";

const log = (s: string): void => console.log(s);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  if (!ok) failures.push(what);
};

const w = window as unknown as { AudioContext: typeof AudioContext };
const Real = w.AudioContext;
let sources = 0;
let active = 0;
let maxActive = 0;
const track = <T extends AudioScheduledSourceNode>(node: T): T => {
  sources++;
  active++;
  maxActive = Math.max(maxActive, active);
  node.addEventListener("ended", () => active--, { once: true });
  return node;
};
let tap: AnalyserNode | null = null;
let ctx: AudioContext | null = null;
class Spy extends Real {
  constructor(o?: AudioContextOptions) {
    super(o);
    ctx = this;
    const osc = this.createOscillator.bind(this);
    const buf = this.createBufferSource.bind(this);
    this.createOscillator = () => track(osc());
    this.createBufferSource = () => track(buf());
    const real = super.destination;
    const input = new GainNode(this);
    input.connect(real);
    tap = new AnalyserNode(this, { fftSize: 2048 });
    input.connect(tap);
    Object.defineProperty(this, "destination", { value: input });
  }
}
w.AudioContext = Spy;

// Time the engine's scheduler callbacks.
let tickMs = 0;
let ticks = 0;
const realSetInterval = window.setInterval.bind(window);
window.setInterval = ((fn: () => void, ms?: number) =>
  realSetInterval(() => {
    const t0 = performance.now();
    fn();
    tickMs += performance.now() - t0;
    ticks++;
  }, ms)) as typeof window.setInterval;

/** Samples the output for `ms`, returning peak and RMS (dBFS) plus sources created. */
async function watch(ms: number): Promise<{ peak: number; rmsDb: number; made: number; ctxAdvance: number; maxLive: number }> {
  const data = new Float32Array(2048);
  let peak = 0;
  let sq = 0;
  let n = 0;
  const s0 = sources;
  maxActive = active;
  const c0 = ctx?.currentTime ?? 0;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await sleep(40);
    if (!tap) continue;
    tap.getFloatTimeDomainData(data);
    for (const x of data) {
      peak = Math.max(peak, Math.abs(x));
      sq += x * x;
      n++;
    }
  }
  return { peak, rmsDb: db(Math.sqrt(sq / Math.max(1, n))), made: sources - s0, ctxAdvance: (ctx?.currentTime ?? 0) - c0, maxLive: maxActive };
}

const eng = createAudioEngine();

async function run(): Promise<void> {
  const unlocking = eng.unlock(); // inside the click handler: resume() starts synchronously
  await unlocking;
  await eng.unlock();
  log(`unlock: unlocked=${eng.unlocked} state=${ctx?.state} rate=${ctx?.sampleRate} baseLatency=${fmt(ctx?.baseLatency ?? NaN, 4)}`);
  check(eng.unlocked, "live: unlock() inside a click did not start the context");

  const phase = async (label: string, ms: number): Promise<void> => {
    const t0 = tickMs;
    const k0 = ticks;
    const r = await watch(ms);
    const perSec = r.made / Math.max(0.001, r.ctxAdvance);
    log(`${label.padEnd(34)} ctx +${fmt(r.ctxAdvance, 2)} s  peak ${fmt(r.peak)}  rms ${fmt(r.rmsDb, 1)} dB  sources ${r.made} (${fmt(perSec, 0)}/s, max live ${r.maxLive})  scheduler ${fmt((tickMs - t0) / Math.max(0.001, ms / 1000), 2)} ms/s over ${ticks - k0} ticks`);
    check(r.peak <= 0.98, `live ${label}: peak ${fmt(r.peak)}`);
  };

  for (const mood of ["title", "war", "court"] as MusicMood[]) {
    eng.setMusic(mood);
    eng.setMusic(mood);
    await phase(`music ${mood}`, 3500);
  }
  eng.setMusic("peace");
  await sleep(300);
  eng.setMusic("war");
  await sleep(300);
  eng.setMusic("naval");
  await phase("rapid peace→war→naval switches", 3000);
  const spam = async (): Promise<void> => {
    for (let i = 0; i < 300; i++) {
      const name = SFX_NAMES[i % SFX_NAMES.length] ?? "hit";
      eng.sfx(name, { pan: Math.sin(i) * 1.5, gain: i % 7 === 0 ? 50 : 1, pitch: i % 11 === 0 ? -3 : 1 + (i % 5) * 0.1 });
      if (i % 10 === 0) await sleep(10);
    }
  };
  void spam();
  await phase("300 mixed sfx (bad opts) over war", 2500);
  eng.setVolumes({ master: 0.5, music: 0.3, sfx: 1 });
  await phase("volumes master .5 music .3", 1500);
  eng.setVolumes({ master: 2, music: -1, sfx: Number.NaN });
  eng.setVolumes({ master: 0.85, music: 0.6, sfx: 0.85 });
  eng.setMuted(true);
  for (let i = 0; i < 20; i++) eng.sfx("explosion");
  await phase(`muted (muted=${eng.muted})`, 1500);
  eng.setMuted(false);
  eng.suspend();
  eng.suspend();
  await sleep(250);
  await phase(`suspended (state=${ctx?.state})`, 1000);
  eng.resume();
  eng.resume();
  await phase("resumed", 2500);
  log(`after resume: state=${ctx?.state} unlocked=${eng.unlocked}`);
  check(ctx?.state === "running", "live: resume() did not restart the context");
  eng.setMusic(null);
  await sleep(2600);
  await phase("music null (after 2 s fade)", 1500);
  eng.suspend();
  log(failures.length ? `FAILED:\n  ${failures.join("\n  ")}` : "live checks passed");
  if (failures.length) console.error(failures.join("; "));
  log("DONE");
}

window.addEventListener("click", () => void run().catch((e: unknown) => console.error(String(e))), { once: true });
log("READY");
