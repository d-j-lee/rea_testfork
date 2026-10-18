// Structure checks and WAV export (see audio-run.mjs):
//   node tools/preview/audio-run.mjs tools/preview/audio-wav.ts <outDir>
// 1. Renders 20 s of several moods to <outDir>/<mood>.wav, with onset density
//    per 5 s and the solo lead's pitch-class histogram against the mood scale.
// 2. Renders 10 minutes of two moods (22.05 kHz) to check long-run stability:
//    per-minute level / peak / onset density, and a chroma self-similarity
//    scan that would expose a short obvious loop.

import { moodInfo } from "../../src/client/audio/moods.ts";
import type { MusicMood } from "../../src/client/audio/types.ts";
import { analyze, db, f0Classes, fmt, magnitudes, mono, moodSetup, renderOffline, wavBytes } from "./audio-lib.ts";

const log = (s: string): void => console.log(s);
const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  if (!ok) failures.push(what);
};
const save = (window as unknown as { __save?: (name: string, b64: string) => Promise<boolean> }).__save;

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function onsetsIn(m: Float32Array, sr: number, t0: number, t1: number): number {
  const hop = 512;
  const env: number[] = [];
  for (let i = Math.floor(t0 * sr); i + hop <= Math.min(m.length, t1 * sr); i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += (m[k] ?? 0) ** 2;
    env.push(db(Math.sqrt(s / hop) + 1e-9));
  }
  let n = 0;
  let last = -99;
  for (let i = 6; i < env.length; i++) {
    const floor = Math.min(...env.slice(i - 6, i));
    if ((env[i] ?? -99) > -50 && (env[i] ?? -99) - floor > 6 && i - last > 5) {
      n++;
      last = i;
    }
  }
  return n / (t1 - t0);
}

function inScale(hist: readonly number[], scale: readonly number[]): number {
  return scale.reduce((a, pc) => a + (hist[pc % 12] ?? 0), 0);
}

async function exports(): Promise<void> {
  const SR = 44100;
  log("== 20 s renders: onsets per 5 s, solo-lead pitch classes (relative to tonic) ==");
  for (const mood of ["title", "peace", "war", "court", "siege", "modern", "resistance", "ending_bad"] as MusicMood[]) {
    const info = moodInfo(mood);
    const full = await renderOffline(20, SR, moodSetup(mood));
    const lead = await renderOffline(20, SR, moodSetup(mood, "lead"));
    const m = mono(full.buf);
    const dens = [0, 5, 10, 15].map((t) => fmt(onsetsIn(m, SR, t, t + 5), 1)).join("/");
    const pcs = f0Classes(mono(lead.buf), SR, info.tonic, 0.2);
    const share = inScale(pcs.hist, info.scale);
    const hist = pcs.hist.map((h) => String(Math.round(h * 100)).padStart(3)).join("");
    check(share >= 0.8, `${mood}: solo lead only ${Math.round(share * 100)}% in scale`);
    log(`${mood.padEnd(11)} onsets/s ${dens.padEnd(16)} lead f0 in-scale ${String(Math.round(share * 100)).padStart(3)}% (voiced ${Math.round(pcs.voiced * 100)}%)  pcs[0..11]:${hist}  scale ${info.scale.join(",")}`);
    if (save) await save(`${mood}.wav`, base64(wavBytes(full.buf)));
  }
}

/** 12-bin chroma per `frame` seconds (fundamentals 80–2000 Hz). */
function chroma(m: Float32Array, sr: number, frame: number, tonic: number): Float64Array[] {
  const n = 4096;
  const out: Float64Array[] = [];
  for (let at = 0; at + frame * sr <= m.length; at += Math.floor(frame * sr)) {
    const c = new Float64Array(12);
    for (let k = at; k + n <= at + frame * sr; k += n) {
      const mag = magnitudes(m, k, n);
      for (let i = Math.floor((80 * n) / sr); i < (2000 * n) / sr; i++) {
        const f = (i * sr) / n;
        const pc = (((Math.round(69 + 12 * Math.log2(f / 440)) - tonic) % 12) + 12) % 12;
        c[pc] = (c[pc] ?? 0) + (mag[i] ?? 0) ** 2;
      }
    }
    const norm = Math.hypot(...c) || 1;
    out.push(c.map((v) => v / norm));
  }
  return out;
}

async function longRun(mood: MusicMood): Promise<void> {
  const SR = 22050;
  const SECONDS = 600;
  const t0 = performance.now();
  const r = await renderOffline(SECONDS, SR, moodSetup(mood));
  const wall = (performance.now() - t0) / 1000;
  const m = mono(r.buf);
  const all = analyze(r.buf);
  check(all.nan === 0 && all.peak <= 0.98, `${mood} 10 min: peak ${fmt(all.peak)} nan ${all.nan}`);
  const rows: string[] = [];
  let quiet = 0;
  for (let t = 0; t < SECONDS; t += 60) {
    let s = 0;
    let pk = 0;
    for (let i = t * SR; i < (t + 60) * SR; i++) {
      const x = m[i] ?? 0;
      s += x * x;
      pk = Math.max(pk, Math.abs(x));
    }
    const lvl = db(Math.sqrt(s / (60 * SR)));
    if (lvl < -40) quiet++;
    rows.push(`${t / 60}m ${fmt(lvl, 1)}dB pk${fmt(pk, 2)} on${fmt(onsetsIn(m, SR, t, t + 60), 1)}`);
  }
  check(quiet === 0, `${mood} 10 min: ${quiet} near-silent minutes`);
  // Longest silence (50 ms RMS below -50 dBFS).
  let run = 0;
  let longest = 0;
  const hop = Math.floor(0.05 * SR);
  for (let i = 0; i + hop <= m.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += (m[k] ?? 0) ** 2;
    run = db(Math.sqrt(s / hop)) < -50 ? run + 0.05 : 0;
    longest = Math.max(longest, run);
  }
  // Chroma self-similarity: an obvious loop shows a lag whose mean similarity → 1.
  const ch = chroma(m, SR, 1, moodInfo(mood).tonic);
  let bestLag = 0;
  let bestSim = 0;
  for (let lag = 8; lag <= 240; lag++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i + lag < ch.length; i++) {
      const a = ch[i];
      const b = ch[i + lag];
      if (!a || !b) continue;
      let dot = 0;
      for (let k = 0; k < 12; k++) dot += (a[k] ?? 0) * (b[k] ?? 0);
      s += dot;
      n++;
    }
    const sim = s / Math.max(1, n);
    if (sim > bestSim) {
      bestSim = sim;
      bestLag = lag;
    }
  }
  let base = 0;
  let pairs = 0;
  for (let i = 0; i < ch.length; i += 7) {
    for (let j = i + 13; j < ch.length; j += 29) {
      let dot = 0;
      for (let k = 0; k < 12; k++) dot += (ch[i]?.[k] ?? 0) * (ch[j]?.[k] ?? 0);
      base += dot;
      pairs++;
    }
  }
  log(`${mood} 10 min @${SR} Hz: rendered in ${fmt(wall, 1)} s (${fmt(SECONDS / wall, 0)}× realtime), sched ${fmt(r.schedMs, 0)} ms, peak ${fmt(all.peak)}, rms ${fmt(db(all.rms), 1)} dB, longest silence ${fmt(longest, 2)} s`);
  log(`  per minute: ${rows.join(" | ")}`);
  log(`  chroma self-similarity: best lag ${bestLag} s → ${fmt(bestSim, 3)} vs random-pair mean ${fmt(base / Math.max(1, pairs), 3)} (a strict loop would approach 1.000)`);
}

async function main(): Promise<void> {
  await exports();
  log("\n== 10-minute runs ==");
  await longRun("war");
  await longRun("peace");
  await longRun("intrigue");
  log(failures.length ? `FAILED:\n  ${failures.join("\n  ")}` : "structure checks passed");
  if (failures.length) console.error(failures.join("; "));
  log("DONE");
}

console.log("READY");
main().catch((e: unknown) => console.error(`crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
