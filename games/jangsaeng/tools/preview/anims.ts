// Animation sheet: every frame of every animation for selected sprites,
// one row per direction. KEYS may be preset by a wrapper entry.
import type { Anim, CharacterSprite, Dir } from "../../src/shared/sprites.ts";
import { drawCharacter } from "../../src/client/render/characters.ts";
import { ANIM_FRAMES } from "../../src/client/render/humanoid-pose.ts";
import { BEAST_FRAMES } from "../../src/client/render/beasts.ts";
import { ground, label, setup, world, SCALE } from "./sheet-lib.ts";

const preset = (globalThis as { KEYS?: CharacterSprite[]; DIRS?: Dir[] });
const keys: CharacterSprite[] = preset.KEYS ?? ["hero_youth", "soldier_joseon"];
const dirs: Dir[] = preset.DIRS ?? ["down", "left", "up", "right"];
const anims: Anim[] = ["idle", "walk", "attack", "shoot", "cast", "hurt", "dead"];
const beast = (k: CharacterSprite) => k === "tiger" || k === "wolf" || k === "boar" || k === "bear";
const cellW = 30;
const cellH = 38;
const cols = anims.reduce((n, a) => n + ANIM_FRAMES[a].length, 0);
const W = cols * cellW + 40;
const H = keys.length * dirs.length * cellH + 12;
const ctx = setup(W * SCALE, H * SCALE);
world(ctx);
ground(ctx, 0, 0, W, H, "grass");
let row = 0;
for (const key of keys) {
  for (const dir of dirs) {
    const y = 10 + row * cellH;
    label(ctx, `${key}`, 18, y + 4);
    label(ctx, dir, 18, y + 14);
    let col = 0;
    for (const anim of anims) {
      const frames = beast(key) ? BEAST_FRAMES[anim] : ANIM_FRAMES[anim];
      let t = 0;
      frames.forEach((d, i) => {
        const x = 40 + col * cellW + cellW / 2;
        if (row === 0) label(ctx, `${anim}${i}`, x, 0);
        drawCharacter(ctx, key, x, y + 28, dir, anim, t + 1);
        t += d;
        col++;
      });
    }
    row++;
  }
}
console.log("anims drawn");
