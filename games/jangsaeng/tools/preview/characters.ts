// Contact sheet: every character sprite, idle, in all four directions.
// Page selected by PAGE (0 = heroes/court/towns, 1 = military/hostile/beasts).
import { CHARACTER_SPRITES, type Dir } from "../../src/shared/sprites.ts";
import { drawCharacter, supportsVariant } from "../../src/client/render/characters.ts";
import { ground, label, setup, world, SCALE } from "./sheet-lib.ts";

declare const PAGE: number | undefined;
const page = typeof PAGE === "number" ? PAGE : 0;
const keys =
  page === 0
    ? CHARACTER_SPRITES.slice(0, 31)
    : page === 1
      ? CHARACTER_SPRITES.slice(31)
      : CHARACTER_SPRITES.filter((k) => supportsVariant(k));
const variant = page === 2 ? "f" : undefined;
const dirs: Dir[] = ["down", "left", "up", "right"];
const cellW = 22;
const cellH = 40;
const perRow = 5;
const groupW = cellW * 4 + 6;
const rows = Math.ceil(keys.length / perRow);
const W = groupW * perRow;
const H = rows * cellH;
const ctx = setup(W * SCALE, H * SCALE);
world(ctx);
const grounds = ["grass", "sand", "town"] as const;
keys.forEach((key, i) => {
  const gx = (i % perRow) * groupW;
  const gy = Math.floor(i / perRow) * cellH;
  ground(ctx, gx, gy, groupW - 2, cellH - 2, grounds[Math.floor(i / perRow) % 3]);
  dirs.forEach((dir, j) => {
    drawCharacter(ctx, key, gx + 12 + j * cellW, gy + 31, dir, "idle", 0, { variant });
  });
  label(ctx, key, gx + groupW / 2, gy + 32);
});
console.log("characters page", page, "drawn", keys.length);
