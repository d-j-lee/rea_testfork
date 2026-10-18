// Shared helpers for sprite contact sheets rendered by scripts/preview.mjs.
import { context2d } from "../../src/client/render/pixel.ts";

export const SCALE = 3;

export function setup(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.getElementById("preview") as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  return ctx;
}

const GROUNDS = {
  grass: ["#6b9a4a", "#628f43", "#76a552"],
  sand: ["#e3cf9c", "#d6c08a", "#ead8aa"],
  town: ["#c4a476", "#b39465", "#cdb082"],
  snow: ["#eef2f4", "#dfe6ea", "#f6f8f9"],
} as const;

/** Ground patch in world px (call with the world transform set). */
export function ground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: keyof typeof GROUNDS = "grass",
): void {
  const [base, dark, light] = GROUNDS[kind];
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  let seed = 7 + x * 13 + y * 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < (w * h) / 18; i++) {
    ctx.fillStyle = rnd() < 0.5 ? dark : light;
    ctx.fillRect(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1);
  }
}

export function world(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  wx: number,
  wy: number,
  color = "#f3ecdc",
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = "11px 'Noto Sans KR', Unifont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#111";
  ctx.strokeText(text, Math.round(wx * SCALE), Math.round(wy * SCALE));
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(wx * SCALE), Math.round(wy * SCALE));
  ctx.restore();
}
