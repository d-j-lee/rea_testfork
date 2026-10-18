// Front-view lineup of selected sprites at a large scale for side-by-side
// faction comparison. LINEUP / LINEUP_DIR may be preset by a wrapper.
import type { CharacterSprite, Dir } from "../../src/shared/sprites.ts";
import { drawCharacter } from "../../src/client/render/characters.ts";
import { context2d } from "../../src/client/render/pixel.ts";
import { ground } from "./sheet-lib.ts";

const cfg = globalThis as { LINEUP?: CharacterSprite[]; LINEUP_DIR?: Dir; LINEUP_SCALE?: number };
const keys = cfg.LINEUP ?? [
  "soldier_empire", "hero_modern", "japanese_modern", "french_marine", "us_marine",
  "reformer", "western_envoy", "japanese_envoy", "qing_envoy",
];
const S = cfg.LINEUP_SCALE ?? 5;
const canvas = document.getElementById("preview") as HTMLCanvasElement;
canvas.width = keys.length * 24 * S;
canvas.height = 40 * S;
const ctx = context2d(canvas);
ctx.setTransform(S, 0, 0, S, 0, 0);
ground(ctx, 0, 0, keys.length * 24, 40, "town");
keys.forEach((k, i) => drawCharacter(ctx, k, 12 + i * 24, 34, cfg.LINEUP_DIR ?? "down", "idle", 0));
console.log("lineup", keys.length);
