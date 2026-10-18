// Audio verification harness (cannot listen, so measure):
//   node scripts/preview.mjs tools/preview/audio.ts <out.png> 1400 1000 60000
// Renders every mood (12 s) and every sfx offline through the engine's own
// master graph, prints level / dynamics / spectrum / tonality tables, runs
// spam, combat-mix and crossfade stress tests plus a live AudioContext smoke
// test, then draws a waveform + spectrogram contact sheet on the canvas.
// Any failed criterion is reported with console.error (the preview fails).

import { createAudioEngine, triggerSfx } from "../../src/client/audio/engine.ts";
import { buk, janggu, jing, kkwaenggwari, mtof, playNote, type MelodicVoice, type VoiceOut } from "../../src/client/audio/instruments.ts";
import { checkTables, moodInfo } from "../../src/client/audio/moods.ts";
import { createMusicPlayer } from "../../src/client/audio/music.ts";
import { createSfxThrottle, SFX_SPECS } from "../../src/client/audio/sfx.ts";
import { MUSIC_MOODS, SFX_NAMES, type SfxName } from "../../src/client/audio/types.ts";
import {
  analyze, db, envelope, fmt, levelA, mono, moodSetup, mulberry, musicTargets, pad, pitchClasses, renderOffline, sfxSetup,
  spectrogram, type Stats,
} from "./audio-lib.ts";

const SR = 44100;
const MOOD_SECONDS = 12;
const failures: string[] = [];
const log = (s: string): void => console.log(s);
const check = (ok: boolean, what: string): void => {
  if (!ok) failures.push(what);
};
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const PC_NAMES = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];

interface Item {
  readonly name: string;
  readonly buf: AudioBuffer;
  readonly stats: Stats;
  readonly note: string;
}

function rmsRange(buf: AudioBuffer, t0: number, t1: number): number {
  const d = buf.getChannelData(0);
  let s = 0;
  const a = Math.floor(t0 * buf.sampleRate);
  const b = Math.min(d.length, Math.floor(t1 * buf.sampleRate));
  for (let i = a; i < b; i++) s += (d[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
}

async function voiceLevels(): Promise<void> {
  log("== raw voice levels (no master chain), vel 1, 1.5 s note ==");
  log("voice         hz      peak   rmsDb(note)  dBA(note)  len40");
  const voices: MelodicVoice[] = ["gayageum", "geomungo", "daegeum", "haegeum", "piri", "taepyeongso", "musicbox", "pyeonjong", "organ", "drone"];
  const play: [string, number, (o: VoiceOut) => void][] = voices.map((v) => {
    const hz = mtof(v === "daegeum" || v === "taepyeongso" || v === "musicbox" ? 75 : v === "geomungo" || v === "drone" ? 51 : 63);
    return [v, hz, (o: VoiceOut) => void playNote(v, o, 0.01, hz, 1.5, 1, {})];
  });
  play.push(["janggu 덩", 0, (o) => janggu(o, 0.01, "D", 1, 0.2)]);
  play.push(["buk", 58, (o) => void buk(o, 0.01, 1)]);
  play.push(["jing", 165, (o) => void jing(o, 0.01, 1)]);
  play.push(["kkwaenggwari", 2350, (o) => void kkwaenggwari(o, 0.01, 1, true)]);
  for (const [name, hz, fn] of play) {
    const ctx = new OfflineAudioContext(1, SR * 7, SR);
    fn({ ctx, dry: ctx.destination, wet: null });
    const buf = await ctx.startRendering();
    const s = analyze(buf, 0.01);
    check(s.nan === 0, `voice ${name}: NaN samples`);
    const noteA = levelA(buf.getChannelData(0).subarray(0, Math.floor(SR * 1.51)), SR);
    log(`${pad(name, 13)} ${pad(fmt(hz, 0), 7)} ${pad(fmt(s.peak), 6)} ${pad(fmt(db(rmsRange(buf, 0.01, 1.51)), 1), 12)} ${pad(fmt(noteA, 1), 10)} ${fmt(s.len40, 2)}`);
  }
}

async function moods(): Promise<Item[]> {
  log(`\n== moods: ${MOOD_SECONDS} s each through the master graph (stats skip the first 0.5 s) ==`);
  log("mood             peak   rmsDb  crest  dc       win1s(dB)     onset/s  centroid  bands <200/800/3k/>3k   inScale  top pcs                cents  render  sched");
  const items: Item[] = [];
  for (const mood of MUSIC_MOODS) {
    const r = await renderOffline(MOOD_SECONDS, SR, moodSetup(mood));
    const s = analyze(r.buf, 0.5);
    const info = moodInfo(mood);
    const pcs = pitchClasses(mono(r.buf), SR, info.tonic, 0.5);
    const inScale = info.scale.reduce((a, pc) => a + (pcs.hist[pc % 12] ?? 0), 0);
    const top = pcs.hist.map((h, pc) => [pc, h] as const).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([pc, h]) => `${PC_NAMES[pc]}:${Math.round(h * 100)}`).join(" ");
    const rmsDb = db(s.rms);
    check(s.nan === 0, `${mood}: NaN`);
    check(s.peak <= 0.98, `${mood}: peak ${fmt(s.peak)} > 0.98`);
    check(rmsDb > -38 && rmsDb < -10, `${mood}: rms ${fmt(rmsDb, 1)} dBFS outside (-38, -10)`);
    check(s.crestDb >= 7, `${mood}: crest ${fmt(s.crestDb, 1)} dB < 7 (no dynamics)`);
    check(Math.abs(s.dc) < 0.002, `${mood}: DC ${fmt(s.dc, 4)}`);
    check(inScale >= 0.6, `${mood}: only ${Math.round(inScale * 100)}% of pitch energy in scale`);
    log(`${pad(mood, 16)} ${pad(fmt(s.peak), 6)} ${pad(fmt(rmsDb, 1), 6)} ${pad(fmt(s.crestDb, 1), 6)} ${pad(fmt(s.dc, 4), 8)} ${pad(`${fmt(s.winLoDb, 1)}..${fmt(s.winHiDb, 1)}`, 13)} ${pad(fmt(s.onsetsPerSec, 2), 8)} ${pad(fmt(s.centroidHz, 0), 9)} ${pad(s.bands.map((b) => Math.round(b * 100)).join("/"), 23)} ${pad(`${Math.round(inScale * 100)}%`, 8)} ${pad(top, 22)} ${pad(fmt(pcs.centsDev, 0), 6)} ${pad(`${fmt(r.renderMs, 0)}ms`, 7)} ${fmt(r.schedMs, 0)}ms`);
    items.push({ name: mood, buf: r.buf, stats: s, note: `${info.jangdan} ${Math.round(inScale * 100)}%` });
  }
  return items;
}

const SOFT_ATTACK = new Set<SfxName>(["swing", "skill", "fire", "heal", "gong"]);
// years_pass is a deliberately slow whoosh swell (time-skip transition).
const ATTACK_LIMIT_MS: Partial<Record<SfxName, number>> = { years_pass: 450 };

async function sfx(): Promise<Item[]> {
  log("\n== sfx through the master graph (trigger at 10 ms) ==");
  log("sfx           peak   rmsDb  attack(ms)  len40(s)  nominal  centroid  verdict");
  const items: Item[] = [];
  for (const name of SFX_NAMES) {
    const nominal = SFX_SPECS[name].dur;
    const r = await renderOffline(Math.max(1.2, nominal + 1.2), SR, sfxSetup(name));
    const s = analyze(r.buf, 0.01);
    const attackMs = s.attack * 1000;
    const okAttack = attackMs <= (ATTACK_LIMIT_MS[name] ?? (SOFT_ATTACK.has(name) ? 120 : 12));
    const okLen = s.len40 >= nominal * 0.35 && s.len40 <= nominal * 1.6 + 0.3;
    check(s.nan === 0, `sfx ${name}: NaN`);
    check(s.peak <= 0.98, `sfx ${name}: peak ${fmt(s.peak)}`);
    check(s.peak > 0.05, `sfx ${name}: nearly silent (peak ${fmt(s.peak)})`);
    check(okAttack, `sfx ${name}: slow onset ${fmt(attackMs, 1)} ms`);
    check(okLen, `sfx ${name}: duration ${fmt(s.len40, 2)} s vs nominal ${nominal}`);
    log(`${pad(name, 13)} ${pad(fmt(s.peak), 6)} ${pad(fmt(db(s.rms), 1), 6)} ${pad(fmt(attackMs, 1), 11)} ${pad(fmt(s.len40, 2), 9)} ${pad(fmt(nominal, 2), 8)} ${pad(fmt(s.centroidHz, 0), 9)} ${okAttack && okLen ? "ok" : "CHECK"}`);
    items.push({ name, buf: r.buf, stats: s, note: `${fmt(attackMs, 0)}ms ${fmt(s.len40, 2)}s` });
  }
  return items;
}

async function stress(): Promise<void> {
  log("\n== stress ==");
  // 1. Spam: 100 'hit' and 60 'footstep' triggers in one second through the throttle.
  for (const [name, count] of [["hit", 100], ["footstep", 60], ["coin", 80]] as const) {
    let admitted = 0;
    const rand = mulberry(3);
    const r = await renderOffline(2, SR, (g) => {
      const throttle = createSfxThrottle();
      const times = Array.from({ length: count }, () => 0.01 + rand()).sort((a, b) => a - b);
      for (const t of times) {
        const scale = throttle.admit(name, t);
        if (scale === null) continue;
        admitted++;
        triggerSfx(g, name, t, { pan: rand() * 2 - 1 }, scale, rand);
      }
      return () => {};
    });
    const s = analyze(r.buf);
    check(s.peak <= 0.98, `spam ${name}: peak ${fmt(s.peak)}`);
    log(`spam ${pad(name, 9)} ${count} triggers/1 s → ${admitted} played, peak ${fmt(s.peak)}, rms ${fmt(db(s.rms), 1)} dB, soft-clip share ${fmt(s.clipShare * 100, 2)}%`);
  }
  // 2. Combat mix: war music under 250 random combat effects over 10 s.
  {
    const names: SfxName[] = ["hit", "hit_heavy", "crit", "swing", "gun", "cannon", "explosion", "arrow_hit", "block", "hurt", "enemy_death", "bow"];
    const rand = mulberry(11);
    let admitted = 0;
    const r = await renderOffline(10, SR, (g) => {
      const p = createMusicPlayer(musicTargets(g), "war", 0.05, 0.01);
      const throttle = createSfxThrottle();
      const events = Array.from({ length: 250 }, () => [0.2 + rand() * 9.5, names[Math.floor(rand() * names.length)] ?? "hit"] as const)
        .sort((a, b) => a[0] - b[0]);
      for (const [t, name] of events) {
        const scale = throttle.admit(name, t);
        if (scale === null) continue;
        admitted++;
        triggerSfx(g, name, t, { pan: rand() * 2 - 1, gain: 0.6 + rand() * 0.6 }, scale, rand);
      }
      return (now) => p.scheduleUntil(now + 0.4);
    });
    const s = analyze(r.buf);
    check(s.peak <= 0.98 && s.nan === 0, `combat mix: peak ${fmt(s.peak)} nan ${s.nan}`);
    log(`combat mix: war + 250 combat sfx (${admitted} admitted) / 10 s → peak ${fmt(s.peak)}, rms ${fmt(db(s.rms), 1)} dB, crest ${fmt(s.crestDb, 1)} dB, soft-clip share ${fmt(s.clipShare * 100, 2)}%`);
  }
  // 3. Crossfade peace → war at 4 s with the engine's 2 s crossfade.
  {
    const r = await renderOffline(9, SR, (g) => {
      const a = createMusicPlayer(musicTargets(g), "peace", 0.05, 0.01);
      const b = createMusicPlayer(musicTargets(g), "war", 4, 2);
      a.fadeOut(4, 2);
      return (now) => {
        a.scheduleUntil(now + 0.4);
        if (now + 0.4 >= 4) b.scheduleUntil(now + 0.4);
      };
    });
    const parts: string[] = [];
    let worst = 0;
    let prev: number | null = null;
    for (let t = 2; t < 8.5; t += 0.5) {
      const v = db(rmsRange(r.buf, t, t + 0.5));
      parts.push(`${fmt(t, 1)}:${fmt(v, 1)}`);
      if (prev !== null) worst = Math.max(worst, Math.abs(v - prev));
      prev = v;
    }
    const s = analyze(r.buf);
    check(s.peak <= 0.98, `crossfade: peak ${fmt(s.peak)}`);
    check(worst < 12, `crossfade: ${fmt(worst, 1)} dB jump between 0.5 s windows`);
    log(`crossfade peace→war @4 s (0.5 s RMS dB): ${parts.join(" ")}; max step ${fmt(worst, 1)} dB`);
  }
}

async function liveSmoke(): Promise<void> {
  log("\n== live AudioContext smoke test ==");
  const w = window as unknown as { AudioContext?: typeof AudioContext };
  const Real = w.AudioContext;
  try {
    w.AudioContext = undefined;
    const silent = createAudioEngine();
    await silent.unlock();
    silent.setMusic("war");
    silent.sfx("hit");
    silent.setVolumes({ music: 0.2 });
    silent.setMuted(true);
    silent.suspend();
    silent.resume();
    log(`no Web Audio → silent engine: unlocked=${silent.unlocked} muted=${silent.muted} (no throw)`);
  } catch (e) {
    check(false, `silent engine threw: ${String(e)}`);
  } finally {
    w.AudioContext = Real;
  }
  if (!Real) return log("no AudioContext in this browser");
  const made: AudioContext[] = [];
  let sources = 0;
  class Spy extends Real {
    constructor(o?: AudioContextOptions) {
      super(o);
      made.push(this);
      const osc = this.createOscillator.bind(this);
      const buf = this.createBufferSource.bind(this);
      this.createOscillator = () => (sources++, osc());
      this.createBufferSource = () => (sources++, buf());
    }
  }
  w.AudioContext = Spy;
  try {
    const eng = createAudioEngine();
    log(`before unlock: unlocked=${eng.unlocked}`);
    const t0 = performance.now();
    await eng.unlock();
    await eng.unlock();
    const ctx = made[0];
    log(`after unlock (${fmt(performance.now() - t0, 0)} ms): unlocked=${eng.unlocked} state=${ctx?.state} contexts=${made.length} sampleRate=${ctx?.sampleRate} baseLatency=${fmt(ctx?.baseLatency ?? NaN, 4)}`);
    eng.setMusic("war");
    eng.setMusic("war");
    for (let i = 0; i < 60; i++) eng.sfx("hit", { pan: Math.random() * 2 - 1 });
    for (let i = 0; i < 20; i++) eng.sfx("footstep");
    eng.sfx("explosion", { pan: 2, gain: 9, pitch: Number.NaN });
    const s0 = sources;
    const c0 = ctx?.currentTime ?? 0;
    await sleep(2000);
    const c1 = ctx?.currentTime ?? 0;
    log(`war 2 s: ctx time advanced ${fmt(c1 - c0, 2)} s, ${sources - s0} sources created (${fmt((sources - s0) / Math.max(0.001, c1 - c0), 0)}/s incl. 80 spammed sfx triggers)`);
    eng.setMusic("peace");
    await sleep(2500);
    eng.setVolumes({ master: 0.7, music: 0.5, sfx: 1 });
    eng.setMuted(true);
    eng.setMuted(false);
    const s1 = sources;
    await sleep(1500);
    log(`peace 1.5 s after crossfade: ${sources - s1} sources`);
    eng.suspend();
    await sleep(300);
    const s2 = sources;
    await sleep(500);
    log(`suspended: state=${ctx?.state}, sources while suspended=${sources - s2}`);
    eng.resume();
    await sleep(800);
    log(`resumed: state=${ctx?.state} unlocked=${eng.unlocked}`);
    eng.setMusic(null);
    await sleep(2400);
    const s3 = sources;
    await sleep(500);
    log(`music null: sources in 0.5 s after fade = ${sources - s3}`);
    check(sources - s2 >= 0, "live: impossible source count");
    if (ctx?.state === "running") check(c1 - c0 > 1.5 && sources - s0 > 20, "live: scheduler did not produce music");
    eng.suspend();
  } catch (e) {
    check(false, `live engine threw: ${String(e)}`);
  } finally {
    w.AudioContext = Real;
  }
}

function heat(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v));
  return [255 * Math.min(1, x * 1.8), 255 * Math.max(0, x * 1.6 - 0.6), 255 * (0.25 * (1 - x) + Math.max(0, x - 0.85) * 3)];
}

function drawCell(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, item: Item, spectro: boolean): void {
  g.fillStyle = "#1a1a21";
  g.fillRect(x, y, w, h);
  const m = mono(item.buf);
  const waveTop = y + 14;
  const waveH = spectro ? Math.floor((h - 16) * 0.42) : h - 16;
  const mid = waveTop + waveH / 2;
  g.strokeStyle = "#5a2a2a";
  g.beginPath();
  g.moveTo(x, mid - (waveH / 2) * 0.98);
  g.lineTo(x + w, mid - (waveH / 2) * 0.98);
  g.moveTo(x, mid + (waveH / 2) * 0.98);
  g.lineTo(x + w, mid + (waveH / 2) * 0.98);
  g.stroke();
  const env = envelope(m, Math.floor(w));
  g.strokeStyle = item.stats.peak > 0.98 ? "#ff4040" : "#7fd69a";
  g.beginPath();
  for (let c = 0; c < env.max.length; c++) {
    g.moveTo(x + c + 0.5, mid - (env.max[c] ?? 0) * (waveH / 2));
    g.lineTo(x + c + 0.5, mid - (env.min[c] ?? 0) * (waveH / 2) + 1);
  }
  g.stroke();
  if (spectro) {
    const sy = waveTop + waveH + 2;
    const sh = Math.max(8, y + h - sy - 2);
    const cols = Math.floor(w);
    const spec = spectrogram(m, item.buf.sampleRate, cols, sh);
    const img = g.createImageData(cols, sh);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < sh; r++) {
        const v = ((spec[c * sh + r] ?? -120) + 72) / 60;
        const [cr, cg, cb] = heat(v);
        const o = ((sh - 1 - r) * cols + c) * 4;
        img.data[o] = cr;
        img.data[o + 1] = cg;
        img.data[o + 2] = cb;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, x, sy);
  }
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = "#e8e2d0";
  g.fillText(`${item.name}  pk ${fmt(item.stats.peak, 2)} rms ${fmt(db(item.stats.rms), 0)}dB  ${item.note}`, x + 3, y + 11);
  g.restore();
}

function draw(moodItems: Item[], sfxItems: Item[]): void {
  const canvas = document.getElementById("preview") as HTMLCanvasElement;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#0e0e12";
  g.fillRect(0, 0, W, H);
  g.font = "10px monospace";
  g.fillStyle = failures.length ? "#ff8080" : "#9fe0a8";
  g.fillText(`장생 audio harness — ${failures.length ? `${failures.length} FAILED checks` : "all checks passed"} — moods ${MOOD_SECONDS}s (wave ±0.98 guides, log spectrogram 50 Hz–12 kHz), sfx below`, 4, 11);
  const top = 16;
  const moodH = Math.floor((H - top) * 0.6);
  const mc = 4;
  const mr = Math.ceil(moodItems.length / mc);
  moodItems.forEach((it, i) => {
    drawCell(g, (i % mc) * (W / mc) + 2, top + Math.floor(i / mc) * (moodH / mr), W / mc - 4, moodH / mr - 4, it, true);
  });
  const sc = 7;
  const sr = Math.ceil(sfxItems.length / sc);
  const sh = (H - top - moodH) / sr;
  sfxItems.forEach((it, i) => {
    drawCell(g, (i % sc) * (W / sc) + 2, top + moodH + Math.floor(i / sc) * sh, W / sc - 4, sh - 4, it, false);
  });
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const problems = checkTables();
  check(problems.length === 0, `장단 tables: ${problems.join("; ")}`);
  log(`장단 tables: ${problems.length ? problems.join("; ") : "consistent"}`);
  await voiceLevels();
  const moodItems = await moods();
  const sfxItems = await sfx();
  await stress();
  await liveSmoke();
  draw(moodItems, sfxItems);
  log(`\nharness finished in ${fmt((performance.now() - t0) / 1000, 1)} s; ${failures.length} failed checks`);
  if (failures.length) console.error(`FAILED:\n  ${failures.join("\n  ")}`);
  log("AUDIO HARNESS DONE");
}

main().catch((e: unknown) => console.error(`harness crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
