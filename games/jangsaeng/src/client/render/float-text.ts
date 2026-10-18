// Floating combat text: pixel-font numbers pre-rendered into pooled canvases
// at spawn, with a vector fallback for glyphs the pixel font lacks (Korean).

import { createSurface, type Surface } from "./pixel.ts";
import { FONT_H, glyphRows } from "./pixel-font.ts";

export class FloatText {
  active = false;
  surface: Surface | null = null;
  w = 0;
  h = 0;
  /** Vector-rendered text (glyphs the pixel font lacks). */
  vector = false;
  text = "";
  color = "#ffffff";
  outline = "#1b1418";
  size = 1;
  x = 0;
  y = 0;
  age = 0;
  life = 900;
  crit = false;
}

/** Drop-shadow offsets (world px): keeps 1 px counters open in the tiny font. */
const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, -1],
];

export function renderFloatText(t: FloatText): void {
  const rows = glyphRows(t.text);
  if (!rows) return;
  const s = t.size;
  const w = (rows[0]?.length ?? 0) * s + 2 * s;
  const h = FONT_H * s + 2 * s;
  let surface = t.surface;
  if (!surface || surface.width < w || surface.height < h)
    surface = t.surface = createSurface(Math.max(w, 72), Math.max(h, 18));
  const ctx = surface.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, surface.width, surface.height);
  t.w = w;
  t.h = h;
  const fill = (color: string, ox: number, oy: number) => {
    ctx.fillStyle = color;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] as string;
      for (let c = 0; c < row.length; c++)
        if (row[c] === "#") ctx.fillRect(s + c * s + ox, s + r * s + oy, s, s);
    }
  };
  for (const [ox, oy] of OUTLINE_OFFSETS) fill(t.outline, ox, oy);
  fill(t.color, 0, 0);
  if (t.crit) {
    // Bright top highlight row on crit glyphs.
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "#fff8d8";
    ctx.fillRect(0, s, w, s);
    ctx.globalCompositeOperation = "source-over";
  }
}

export function drawFloatText(ctx: CanvasRenderingContext2D, t: FloatText): void {
  const k = t.age / t.life;
  // Pop, then ease upward and fade.
  const pop = t.age < 110 ? 1 + (1 - t.age / 110) * (t.crit ? 0.5 : 0.35) : 1;
  const rise = 4 + 14 * (1 - (1 - k) * (1 - k));
  const alpha = k > 0.65 ? (1 - k) / 0.35 : 1;
  ctx.globalAlpha = alpha;
  const cx = t.x;
  const cy = Math.round(t.y - rise);
  if (!t.vector && t.surface) {
    const w = Math.round(t.w * pop);
    const h = Math.round(t.h * pop);
    ctx.drawImage(t.surface, 0, 0, t.w, t.h, cx - (w >> 1), cy - h, w, h);
    return;
  }
  // Vector fallback: crisp device-pixel text via the current transform.
  const m = ctx.getTransform();
  const scale = Math.max(1, Math.abs(m.a));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const px = Math.round(m.a * cx + m.c * cy + m.e);
  const py = Math.round(m.b * cx + m.d * cy + m.f);
  const size = Math.round((t.crit ? 16 : 12) * Math.max(1, scale / 3) * pop);
  ctx.font = `bold ${size}px Galmuri11, 'Noto Sans KR', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, Math.round(size / 4));
  ctx.strokeStyle = t.outline;
  ctx.strokeText(t.text, px, py);
  ctx.fillStyle = t.color;
  ctx.fillText(t.text, px, py);
  ctx.restore();
}
