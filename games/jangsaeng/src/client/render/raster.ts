// World-art toolkit: a packed-RGBA software raster for procedural terrain and
// architecture, deterministic hashing, tileable value noise, ordered dither
// and a small "blob" shader for foliage/rock volumes. Everything here is
// deterministic so cached art is identical across sessions and machines.

import { createSurface, type Surface } from "./pixel.ts";

/** Packed colour as stored in a little-endian ImageData Uint32 view (ABGR). */
export type Rgba = number;

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  const R = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const G = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const B = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  const A = a < 0 ? 0 : a > 255 ? 255 : a | 0;
  return LITTLE_ENDIAN
    ? ((A << 24) | (B << 16) | (G << 8) | R) >>> 0
    : ((R << 24) | (G << 16) | (B << 8) | A) >>> 0;
}

export const red = (c: Rgba): number => (LITTLE_ENDIAN ? c & 255 : c >>> 24);
export const green = (c: Rgba): number => (LITTLE_ENDIAN ? (c >>> 8) & 255 : (c >>> 16) & 255);
export const blue = (c: Rgba): number => (LITTLE_ENDIAN ? (c >>> 16) & 255 : (c >>> 8) & 255);
export const alpha = (c: Rgba): number => (LITTLE_ENDIAN ? c >>> 24 : c & 255);

const hexCache = new Map<string, Rgba>();

/** "#rgb" / "#rrggbb" / "#rrggbbaa" → packed colour (memoised). */
export function hex(value: string): Rgba {
  let packed = hexCache.get(value);
  if (packed !== undefined) return packed;
  let h = value.startsWith("#") ? value.slice(1) : value;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = Number.parseInt(h.slice(0, 6), 16);
  const a = h.length >= 8 ? Number.parseInt(h.slice(6, 8), 16) : 255;
  packed = Number.isNaN(n) ? rgba(255, 0, 255) : rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
  hexCache.set(value, packed);
  return packed;
}

export const ramp = (...values: string[]): Rgba[] => values.map(hex);

/** Linear blend of two packed colours (alpha blended too). */
export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return rgba(
    red(a) + (red(b) - red(a)) * t,
    green(a) + (green(b) - green(a)) * t,
    blue(a) + (blue(b) - blue(a)) * t,
    alpha(a) + (alpha(b) - alpha(a)) * t,
  );
}

export function scaleRgba(c: Rgba, f: number): Rgba {
  return rgba(red(c) * f, green(c) * f, blue(c) * f, alpha(c));
}

export function withAlpha(c: Rgba, a: number): Rgba {
  return rgba(red(c), green(c), blue(c), a);
}

export function cssOf(c: Rgba): string {
  return `rgba(${red(c)},${green(c)},${blue(c)},${(alpha(c) / 255).toFixed(3)})`;
}

/** Composites `top` over `bottom` (straight alpha). */
export function over(bottom: Rgba, top: Rgba): Rgba {
  const ta = alpha(top) / 255;
  if (ta >= 1) return top;
  if (ta <= 0) return bottom;
  const ba = alpha(bottom) / 255;
  const oa = ta + ba * (1 - ta);
  if (oa <= 0) return 0;
  const f = (t: number, b: number) => (t * ta + b * ba * (1 - ta)) / oa;
  return rgba(f(red(top), red(bottom)), f(green(top), green(bottom)), f(blue(top), blue(bottom)), oa * 255);
}

// ---------------------------------------------------------------------------
// Hashing and ordered dither

/** 32-bit integer hash of up to three integers. */
export function hash3(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash in [0, 1). */
export const hash01 = (x: number, y: number, s = 0): number => hash3(x, y, s) / 4294967296;

const BAYER_RAW = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 4×4 Bayer thresholds centred on zero, in (-0.5, 0.5). */
export const BAYER4 = Float32Array.from(BAYER_RAW, (v) => (v + 0.5) / 16 - 0.5);
export const bayer = (x: number, y: number): number => BAYER4[((y & 3) << 2) | (x & 3)] as number;

/** Picks a ramp entry for value v∈[0,1] with ordered dithering of strength d. */
export function pickRamp(colors: readonly Rgba[], v: number, dither: number): Rgba {
  const n = colors.length;
  let i = Math.floor(v * n + dither);
  if (i < 0) i = 0;
  else if (i >= n) i = n - 1;
  return colors[i] as Rgba;
}

// ---------------------------------------------------------------------------
// Tileable value noise (precomputed textures → O(1) sampling)

export interface NoiseTexture {
  readonly size: number;
  readonly mask: number;
  readonly data: Float32Array;
}

/** fBm of tileable value noise; `size` must be a power of two divisible by every cell. */
export function noiseTexture(size: number, cells: readonly number[], seed: number): NoiseTexture {
  const data = new Float32Array(size * size);
  let total = 0;
  cells.forEach((cell, octave) => {
    const weight = 1 / (octave + 1);
    total += weight;
    const n = size / cell;
    const lattice = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) lattice[j * n + i] = hash01(i, j, seed + octave * 7919);
    for (let y = 0; y < size; y++) {
      const gy = y / cell;
      const iy = Math.floor(gy);
      const fy0 = gy - iy;
      const fy = fy0 * fy0 * (3 - 2 * fy0);
      const y0 = iy % n;
      const y1 = (iy + 1) % n;
      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const ix = Math.floor(gx);
        const fx0 = gx - ix;
        const fx = fx0 * fx0 * (3 - 2 * fx0);
        const x0 = ix % n;
        const x1 = (ix + 1) % n;
        const a = lattice[y0 * n + x0] as number;
        const b = lattice[y0 * n + x1] as number;
        const c = lattice[y1 * n + x0] as number;
        const d = lattice[y1 * n + x1] as number;
        const v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
        data[y * size + x] = (data[y * size + x] as number) + v * weight;
      }
    }
  });
  for (let i = 0; i < data.length; i++) data[i] = (data[i] as number) / total;
  return { size, mask: size - 1, data };
}

export const sampleNoise = (texture: NoiseTexture, x: number, y: number): number =>
  texture.data[((y & texture.mask) * texture.size) + (x & texture.mask)] as number;

// ---------------------------------------------------------------------------
// Raster

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint32Array<ArrayBuffer>;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.data = new Uint32Array(this.width * this.height);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Rgba {
    x |= 0;
    y |= 0;
    return this.inside(x, y) ? (this.data[y * this.width + x] as number) : 0;
  }

  set(x: number, y: number, c: Rgba): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.inside(x, y)) this.data[y * this.width + x] = c;
  }

  /** Alpha-composites c over the existing pixel. */
  blend(x: number, y: number, c: Rgba): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y)) return;
    const i = y * this.width + x;
    this.data[i] = over(this.data[i] as number, c);
  }

  /** Sets only pixels that are already opaque-ish (paint within a shape). */
  tint(x: number, y: number, c: Rgba): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y)) return;
    const i = y * this.width + x;
    if (alpha(this.data[i] as number) > 0) this.data[i] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: Rgba): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) this.data.fill(c, yy * this.width + x0, yy * this.width + x1);
  }

  blendRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = Math.floor(y); yy < y + h; yy++)
      for (let xx = Math.floor(x); xx < x + w; xx++) this.blend(xx, yy, c);
  }

  hline(x0: number, x1: number, y: number, c: Rgba): void {
    for (let x = Math.floor(Math.min(x0, x1)); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: Rgba): void {
    for (let y = Math.floor(Math.min(y0, y1)); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
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

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgba, blend = false): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) blend ? this.blend(x, y, c) : this.set(x, y, c);
      }
  }

  /** Draws another raster on top (straight-alpha composite). */
  stamp(src: Raster, dx: number, dy: number, mirror = false): void {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const c = src.data[y * src.width + (mirror ? src.width - 1 - x : x)] as number;
        if (alpha(c) === 0) continue;
        if (alpha(c) === 255) this.set(dx + x, dy + y, c);
        else this.blend(dx + x, dy + y, c);
      }
  }

  /** Adds an outline of colour c around opaque pixels (4-neighbourhood). */
  outline(c: Rgba, sides: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean } = {}): void {
    const { top = true, bottom = true, left = true, right = true } = sides;
    const src = this.data.slice();
    const w = this.width;
    const solid = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < this.height && alpha(src[y * w + x] as number) > 127;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < w; x++) {
        if (solid(x, y)) continue;
        if (
          (top && solid(x, y + 1)) ||
          (bottom && solid(x, y - 1)) ||
          (left && solid(x + 1, y)) ||
          (right && solid(x - 1, y))
        )
          this.data[y * w + x] = c;
      }
  }

  mirrored(): Raster {
    const out = new Raster(this.width, this.height);
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        out.data[y * this.width + x] = this.data[y * this.width + (this.width - 1 - x)] as number;
    return out;
  }

  toSurface(): Surface {
    const surface = createSurface(this.width, this.height);
    const ctx = surface.getContext("2d");
    if (!ctx) throw new Error("2D canvas is unavailable");
    const bytes = new Uint8ClampedArray(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    ctx.putImageData(new ImageData(bytes, this.width, this.height), 0, 0);
    return surface;
  }
}

// ---------------------------------------------------------------------------
// Blob shading: unions of ellipsoids lit from the upper left, quantised to a
// ramp. Used for tree canopies, shrubs, boulders and hill mounds.

export interface Blob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Depth bias: larger blobs sit in front of overlapping ones. */
  z?: number;
}

export interface BlobOptions {
  /** Dark → light; index 0 is used for crease/rim pixels. */
  ramp: readonly Rgba[];
  /** Brightness bias added to the lighting term. */
  bias?: number;
  /** Strength of per-pixel leafy texture (0..0.3). */
  texture?: number;
  seed?: number;
  /** Dither strength between ramp steps. */
  dither?: number;
  /** Darken the lower rim of each blob where it overlaps another. */
  creases?: boolean;
}

const LIGHT = (() => {
  const v = [-0.55, -0.7, 0.62];
  const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
  return v.map((c) => c / l) as [number, number, number];
})();

export function paintBlobs(r: Raster, blobs: readonly Blob[], opts: BlobOptions): void {
  const { ramp: colors, bias = 0, texture = 0.12, seed = 1, dither = 0.35, creases = true } = opts;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of blobs) {
    minX = Math.min(minX, b.cx - b.rx);
    maxX = Math.max(maxX, b.cx + b.rx);
    minY = Math.min(minY, b.cy - b.ry);
    maxY = Math.max(maxY, b.cy + b.ry);
  }
  const front = (x: number, y: number): { index: number; h: number; nx: number; ny: number } | null => {
    let best: { index: number; h: number; nx: number; ny: number } | null = null;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i] as Blob;
      const dx = (x + 0.5 - b.cx) / b.rx;
      const dy = (y + 0.5 - b.cy) / b.ry;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const h = Math.sqrt(1 - q) + (b.z ?? 0) + b.ry * 0.02 + (b.cy * 0.01);
      if (!best || h > best.h) best = { index: i, h, nx: dx, ny: dy };
    }
    return best;
  };
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++)
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      const hit = front(x, y);
      if (!hit) continue;
      const nz = Math.sqrt(Math.max(0, 1 - hit.nx * hit.nx - hit.ny * hit.ny));
      let light = hit.nx * LIGHT[0] + hit.ny * LIGHT[1] + nz * LIGHT[2];
      light = 0.5 + light * 0.55 + bias;
      light += (hash01(x, y, seed) - 0.5) * texture * 2;
      let v = light;
      if (creases) {
        const above = front(x, y - 1);
        if (above && above.index !== hit.index && blobs[above.index] && (blobs[above.index] as Blob).cy < (blobs[hit.index] as Blob).cy)
          v = Math.min(v, 0.12);
      }
      const c = pickRamp(colors, Math.max(0, Math.min(0.999, v)), bayer(x, y) * dither);
      r.set(x, y, c);
    }
}
