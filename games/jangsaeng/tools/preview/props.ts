// Props sheet: every prop on grass / sand / town ground, plus animation frames.
import { PROP_SPRITES } from "../../src/shared/sprites.ts";
import { drawProp } from "../../src/client/render/props.ts";
import { ground, label, setup, world, SCALE } from "./sheet-lib.ts";

const cellW = 34;
const cellH = 46;
const W = cellW * PROP_SPRITES.length;
const H = cellH * 3 + 50;
const ctx = setup(W * SCALE, H * SCALE);
world(ctx);
(["grass", "sand", "town"] as const).forEach((kind, row) => {
  ground(ctx, 0, row * cellH, W, cellH, kind);
  PROP_SPRITES.forEach((key, i) => {
    drawProp(ctx, key, i * cellW + cellW / 2, row * cellH + cellH - 8, 30 + row * 400);
    if (row === 0) label(ctx, key, i * cellW + cellW / 2, 1);
  });
});
// Animation strip: banner, campfire, ginseng over time.
const y0 = cellH * 3;
ground(ctx, 0, y0, W, 50, "grass");
const animated = ["banner", "campfire", "ginseng", "herb"] as const;
animated.forEach((key, r) => {
  for (let f = 0; f < 6; f++) {
    const x = 12 + r * 6 * 14 + f * 14;
    drawProp(ctx, key, x, y0 + 44, f * (key === "banner" ? 160 : key === "campfire" ? 90 : 300));
  }
});
console.log("props drawn");
