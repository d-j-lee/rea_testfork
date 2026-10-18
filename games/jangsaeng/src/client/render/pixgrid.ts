// Software pixel buffer used to author procedural sprites (characters, props).
// Parts are drawn with integer primitives into a packed RGBA grid, outlined,
// then converted to a canvas Surface once and cached by the caller. Nothing
// here touches the DOM except `toSurface`, so geometry (heights, bounds) can
// be measured without a canvas.

import { createSurface, type Surface } from "./pixel.ts";

/** Packed colour, little-endian ABGR as stored in ImageData; 0 = empty. */
export type Px = number;

const parsed = new Map<string, Px>();

/** Parses "#rgb" / "#rrggbb" into a packed opaque colour (memoised). */
export function px(hex: string): Px {
  let value = parsed.get(hex);
  if (value === undefined) {
    const [r, g, b] = hexRgb(hex);
    value = (255 << 24) | (b << 16) | (g << 8) | r;
    value >>>= 0;
    parsed.set(hex, value);
  }
  return value;
}

export function hexRgb(hex: string): [number, number, number] {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [255, 0, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix of two hex colours; t = 0 → a, 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

const SHADOW_HUE = "#241a33";
const LIGHT_HUE = "#fff3d6";

/** Hue-shifted shade: cool purple shadows, warm highlights. */
export function darker(hex: string, t = 0.32): string {
  return mix(hex, SHADOW_HUE, t);
}
export function lighter(hex: string, t = 0.3): string {
  return mix(hex, LIGHT_HUE, t);
}

export class PixGrid {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;
  /** Drawing origin offset applied by every primitive. */
  ox = 0;
  oy = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint32Array(w * h);
  }

  at(x: number, y: number): Px {
    const gx = x + this.ox;
    const gy = y + this.oy;
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return 0;
    return this.data[gy * this.w + gx] as number;
  }

  set(x: number, y: number, c: Px): void {
    const gx = (x + this.ox) | 0;
    const gy = (y + this.oy) | 0;
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return;
    this.data[gy * this.w + gx] = c;
  }

  /** Sets only where something is already drawn (shading, patterns). */
  tint(x: number, y: number, c: Px): void {
    if (this.at(x, y) !== 0) this.set(x, y, c);
  }

  clear(x: number, y: number): void {
    this.set(x, y, 0);
  }

  rect(x: number, y: number, w: number, h: number, c: Px): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Inclusive horizontal span. */
  hline(x0: number, x1: number, y: number, c: Px): void {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    for (let x = a; x <= b; x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: Px): void {
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    for (let y = a; y <= b; y++) this.set(x, y, c);
  }

  /** Bresenham line, inclusive of both ends. */
  line(x0: number, y0: number, x1: number, y1: number, c: Px): void {
    this.walk(x0, y0, x1, y1, (x, y) => this.set(x, y, c));
  }

  walk(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (x: number, y: number, i: number) => void,
  ): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let i = 0;
    for (;;) {
      visit(x0, y0, i++);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Filled ellipse inside the box [x, x+w) × [y, y+h). */
  ellipse(x: number, y: number, w: number, h: number, c: Px): void {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    for (let j = 0; j < h; j++) {
      const py = y + j + 0.5;
      const t = (py - cy) / ry;
      const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
      const x0 = Math.round(cx - half);
      const x1 = Math.round(cx + half) - 1;
      if (x1 >= x0) this.hline(x0, x1, y + j, c);
    }
  }

  /** Stamps character rows; '.' / ' ' / unknown keys are skipped. */
  stamp(
    rows: readonly string[],
    pal: Readonly<Record<string, Px>>,
    x: number,
    y: number,
    mirror = false,
  ): void {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j] as string;
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[mirror ? row.length - 1 - i : i] as string];
        if (c) this.set(x + i, y + j, c);
      }
    }
  }

  /** Copies another grid onto this one (opaque pixels only). */
  blit(src: PixGrid, x: number, y: number): void {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const c = src.data[j * src.w + i] as number;
        if (c) this.set(x + i, y + j, c);
      }
  }

  /**
   * Adds a 1px outline on empty pixels touching opaque ones (4-neighbour).
   * `soft` blends the outline toward the neighbouring colour (sel-out).
   */
  outline(color: string, soft = 0): void {
    const { w, h, data } = this;
    const out = new Uint32Array(data);
    const base = hexRgb(color);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (data[y * w + x]) continue;
        let n = 0;
        if (x > 0 && data[y * w + x - 1]) n = data[y * w + x - 1] as number;
        else if (x < w - 1 && data[y * w + x + 1])
          n = data[y * w + x + 1] as number;
        else if (y > 0 && data[(y - 1) * w + x])
          n = data[(y - 1) * w + x] as number;
        else if (y < h - 1 && data[(y + 1) * w + x])
          n = data[(y + 1) * w + x] as number;
        if (!n) continue;
        if (soft > 0) {
          const r = n & 255;
          const g = (n >> 8) & 255;
          const b = (n >> 16) & 255;
          const mr = Math.round(base[0] + (r - base[0]) * soft);
          const mg = Math.round(base[1] + (g - base[1]) * soft);
          const mb = Math.round(base[2] + (b - base[2]) * soft);
          out[y * w + x] = ((255 << 24) | (mb << 16) | (mg << 8) | mr) >>> 0;
        } else out[y * w + x] = px(color);
      }
    data.set(out);
  }

  /** Rotated copy: ccw turns the top edge to the left. */
  rotated(ccw: boolean): PixGrid {
    const g = new PixGrid(this.h, this.w);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.data[y * this.w + x] as number;
        if (!c) continue;
        const nx = ccw ? y : this.h - 1 - y;
        const ny = ccw ? this.w - 1 - x : x;
        g.data[ny * g.w + nx] = c;
      }
    return g;
  }

  /** Topmost / bottom-most opaque rows and left/right columns, or null. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.data[y * this.w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  /** Canvas of the whole grid, or of the inclusive crop rectangle. */
  toSurface(crop?: { x0: number; y0: number; x1: number; y1: number }): Surface {
    const x0 = crop?.x0 ?? 0;
    const y0 = crop?.y0 ?? 0;
    const w = crop ? crop.x1 - crop.x0 + 1 : this.w;
    const h = crop ? crop.y1 - crop.y0 + 1 : this.h;
    const surface = createSurface(w, h);
    const ctx = surface.getContext("2d");
    if (!ctx) throw new Error("2D canvas is unavailable");
    const image = ctx.createImageData(w, h);
    const out = new Uint32Array(image.data.buffer);
    for (let y = 0; y < h; y++)
      out.set(this.data.subarray((y + y0) * this.w + x0, (y + y0) * this.w + x0 + w), y * w);
    ctx.putImageData(image, 0, 0);
    return surface;
  }
}
