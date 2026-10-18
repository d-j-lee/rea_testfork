// Walk cycles at a large scale: rows = sprites, columns = frames (side view).
import type { CharacterSprite, Dir } from "../../src/shared/sprites.ts";
import { drawCharacter } from "../../src/client/render/characters.ts";
import { context2d } from "../../src/client/render/pixel.ts";
import { ground } from "./sheet-lib.ts";

const cfg = globalThis as { WALK_KEYS?: CharacterSprite[]; WALK_DIR?: Dir };
const keys = cfg.WALK_KEYS ?? ["commoner_m", "official_red", "commoner_f", "tiger"];
const dir = cfg.WALK_DIR ?? "right";
const S = 5;
const canvas = document.getElementById("preview") as HTMLCanvasElement;
canvas.width = 8 * 36 * S;
canvas.height = keys.length * 36 * S;
const ctx = context2d(canvas);
ctx.setTransform(S, 0, 0, S, 0, 0);
ground(ctx, 0, 0, 8 * 36, keys.length * 36, "grass");
keys.forEach((k, r) => {
  for (let f = 0; f < 8; f++) {
    const anim = f < 4 ? "walk" : "hurt";
    const t = f < 4 ? f * 130 + 1 : (f - 4) * 120 + 1;
    drawCharacter(ctx, k, 18 + f * 36, 30 + r * 36, dir, anim, t);
  }
});
console.log("walk drawn");
