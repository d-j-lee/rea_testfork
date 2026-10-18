// Mix balance check: renders each mood once per line (solo) and prints the
// A-weighted level of every line next to the full mix.
//   node scripts/preview.mjs tools/preview/audio-balance.ts <out.png> 400 200 120000

import { moodInfo } from "../../src/client/audio/moods.ts";
import { MUSIC_MOODS } from "../../src/client/audio/types.ts";
import { analyze, db, fmt, levelA, levelAMax, mono, moodSetup, pad, renderOffline } from "./audio-lib.ts";

const SR = 32000;
const SECONDS = 12;

async function main(): Promise<void> {
  console.log("mood             mix dBA/max (rms dB) | per-line dBA average/momentary max (0.4 s)");
  for (const mood of MUSIC_MOODS) {
    const full = await renderOffline(SECONDS, SR, moodSetup(mood));
    const parts: string[] = [];
    for (const line of moodInfo(mood).lines) {
      const r = await renderOffline(SECONDS, SR, moodSetup(mood, line));
      const m = mono(r.buf);
      parts.push(`${line} ${fmt(levelA(m, SR, 0.5), 0)}/${fmt(levelAMax(m, SR, 0.5), 0)}`);
    }
    const s = analyze(full.buf, 0.5);
    const fm = mono(full.buf);
    console.log(`${pad(mood, 16)} ${pad(`${fmt(levelA(fm, SR, 0.5), 0)}/${fmt(levelAMax(fm, SR, 0.5), 0)}`, 11)} (${fmt(db(s.rms), 1)}) | ${parts.join("  ")}`);
  }
  console.log("BALANCE DONE");
}

main().catch((e: unknown) => console.error(String(e)));
