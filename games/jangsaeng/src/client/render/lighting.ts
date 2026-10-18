// Screen-space atmosphere drawn after the world: time-of-day grading (dawn,
// day, dusk, night with a cool vignette) and weather overlays (rain, snow,
// fog, war smoke). Particles are a pure function of timeMs, batched into a
// single path per layer, so the pass stays cheap and needs no state; fog and
// smoke are composed small and stretched in one blit (cloudLayerFor).

import { hash01 } from "./raster.ts";

export type Weather = "clear" | "rain" | "snow" | "fog" | "smoke";

export interface AtmosphereOptions {
  /** Hour of day, 0–24 (fractions allowed). */
  hour: number;
  weather?: Weather;
  timeMs: number;
  /** Overall strength, 0–1 (default 1). */
  intensity?: number;
  /** Device pixels per world pixel; particles snap to this grid (default 1). */
  pixelScale?: number;
}

interface Grade {
  /** Multiply colour (255 = unchanged). */
  mul: readonly [number, number, number];
  /** Additive glow colour and alpha. */
  glow: readonly [number, number, number, number];
  vignette: number;
}

const KEYS: readonly (readonly [number, Grade])[] = [
  [0, { mul: [72, 86, 142], glow: [40, 60, 120, 0.05], vignette: 0.55 }],
  [4, { mul: [82, 96, 150], glow: [40, 60, 120, 0.05], vignette: 0.5 }],
  [5.5, { mul: [186, 150, 168], glow: [255, 150, 120, 0.1], vignette: 0.3 }],
  [7, { mul: [255, 232, 212], glow: [255, 196, 150, 0.06], vignette: 0.14 }],
  [9, { mul: [255, 252, 246], glow: [0, 0, 0, 0], vignette: 0.08 }],
  [16, { mul: [255, 250, 240], glow: [0, 0, 0, 0], vignette: 0.08 }],
  [17.5, { mul: [255, 222, 184], glow: [255, 170, 90, 0.08], vignette: 0.16 }],
  [19, { mul: [222, 162, 142], glow: [255, 130, 90, 0.1], vignette: 0.3 }],
  [20.5, { mul: [104, 102, 160], glow: [60, 60, 140, 0.06], vignette: 0.45 }],
  [24, { mul: [72, 86, 142], glow: [40, 60, 120, 0.05], vignette: 0.55 }],
];

function gradeAt(hour: number): Grade {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < KEYS.length; i++) {
    const [h1, b] = KEYS[i] as readonly [number, Grade];
    const [h0, a] = KEYS[i - 1] as readonly [number, Grade];
    if (h > h1) continue;
    const t = (h - h0) / (h1 - h0 || 1);
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
      mul: [lerp(a.mul[0], b.mul[0]), lerp(a.mul[1], b.mul[1]), lerp(a.mul[2], b.mul[2])],
      glow: [lerp(a.glow[0], b.glow[0]), lerp(a.glow[1], b.glow[1]), lerp(a.glow[2], b.glow[2]), lerp(a.glow[3], b.glow[3])],
      vignette: lerp(a.vignette, b.vignette),
    };
  }
  return (KEYS[0] as readonly [number, Grade])[1];
}

/** Night/darkness factor 0 (day) … 1 (deep night) for other systems (lamps, windows). */
export function darknessAt(hour: number): number {
  const g = gradeAt(hour);
  return Math.max(0, Math.min(1, 1 - (g.mul[0] + g.mul[1] + g.mul[2]) / 765) * 1.6);
}

let fogTexture: HTMLCanvasElement | null = null;

/** Low-resolution soft cloud texture (stretched with smoothing for fog/smoke). */
function fog(): HTMLCanvasElement {
  if (fogTexture) return fogTexture;
  const W = 96;
  const H = 54;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  const image = ctx.createImageData(W, H);
  // Tileable value noise, three octaves.
  const value = (x: number, y: number, cell: number, seed: number) => {
    const nx = W / cell;
    const ny = H / cell;
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => hash01(((i % nx) + nx) % nx, ((j % ny) + ny) % ny, seed);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = value(x, y, 24, 3) * 0.55 + value(x, y, 12, 5) * 0.3 + value(x, y, 6, 7) * 0.15;
      const a = Math.max(0, Math.min(1, (v - 0.38) * 2.2));
      const i = (y * W + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(image, 0, 0);
  fogTexture = canvas;
  return canvas;
}

let vignetteLayer: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Small radial vignette (alpha only), stretched over the screen when drawn. */
function vignetteCanvas(width: number, height: number, strength: number): HTMLCanvasElement {
  const key = `${Math.round(width / 16)}x${Math.round(height / 16)}:${Math.round(strength * 40)}`;
  if (vignetteLayer?.key === key) return vignetteLayer.canvas;
  const w = Math.max(2, Math.ceil(width / 16));
  const h = Math.max(2, Math.ceil(height / 16));
  const canvas = vignetteLayer?.canvas ?? document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.58);
  grad.addColorStop(0, "rgba(8,10,24,0)");
  grad.addColorStop(1, `rgba(8,10,24,${Math.min(0.9, strength).toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  vignetteLayer = { key, canvas };
  return canvas;
}

let tinted: { key: string; canvas: HTMLCanvasElement } | null = null;

function tintedFog(color: string): HTMLCanvasElement {
  if (tinted?.key === color) return tinted.canvas;
  const src = fog();
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  tinted = { key: color, canvas };
  return canvas;
}

/**
 * Fog and smoke are soft at any resolution, so they are composed on a small
 * scratch layer (1/CLOUD_DOWN of the screen each way) together with the
 * vignette, and reach the screen in one stretched blit. Drawing the cloud
 * textures (and their tint) at full size cost several full-screen smoothed
 * draws a frame and halved the frame rate on software rendering.
 */
const CLOUD_DOWN = 8;
let cloudScratch: CanvasRenderingContext2D | null = null;

/** The scratch layer sized for a width × height screen, cleared. */
function cloudLayerFor(width: number, height: number): CanvasRenderingContext2D {
  const w = Math.max(2, Math.ceil(width / CLOUD_DOWN));
  const h = Math.max(2, Math.ceil(height / CLOUD_DOWN));
  if (!cloudScratch) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("2D canvas is unavailable");
    cloudScratch = ctx;
  }
  const canvas = cloudScratch.canvas;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  } else cloudScratch.clearRect(0, 0, w, h);
  return cloudScratch;
}

/** Draws a scrolling, wrapping cloud layer across a width × height target. */
function cloudLayer(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement, width: number, height: number, ox: number, oy: number, scale: number, alpha: number) {
  const tw = texture.width * scale;
  const th = texture.height * scale;
  const sx = ((ox % tw) + tw) % tw;
  const sy = ((oy % th) + th) % th;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  for (let y = -sy; y < height; y += th) for (let x = -sx; x < width; x += tw) ctx.drawImage(texture, x, y, tw, th);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
}

export function drawAtmosphere(ctx: CanvasRenderingContext2D, width: number, height: number, opts: AtmosphereOptions): void {
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? 1));
  const px = Math.max(1, Math.round(opts.pixelScale ?? 1));
  const t = opts.timeMs;
  const weather = opts.weather ?? "clear";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const grade = gradeAt(opts.hour);
  const k = (v: number) => Math.round(255 + (v - 255) * intensity);
  // Weather darkens and cools the light before the time-of-day grade.
  const wmul = weather === "rain" ? [196, 204, 214] : weather === "smoke" ? [214, 196, 176] : weather === "fog" ? [232, 234, 236] : weather === "snow" ? [236, 240, 246] : [255, 255, 255];
  const mr = (grade.mul[0] * (wmul[0] as number)) / 255;
  const mg = (grade.mul[1] * (wmul[1] as number)) / 255;
  const mb = (grade.mul[2] * (wmul[2] as number)) / 255;
  if (mr < 254 || mg < 254 || mb < 254) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgb(${k(mr)},${k(mg)},${k(mb)})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (grade.glow[3] > 0.02) {
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(${grade.glow[0] | 0},${grade.glow[1] | 0},${grade.glow[2] | 0},${grade.glow[3] * intensity})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = "source-over";
  // Vignette: only where it is noticeable (dusk, night, fog, smoke).
  const v = grade.vignette * intensity + (weather === "fog" || weather === "smoke" ? 0.08 : 0);
  // Weather layers. Fog and smoke: tint, clouds and vignette on the small
  // scratch layer (coordinates divided by CLOUD_DOWN), then one blit.
  const area = width * height;
  if (weather === "fog" || weather === "smoke") {
    const layer = cloudLayerFor(width, height);
    const lw = layer.canvas.width;
    const lh = layer.canvas.height;
    const d = CLOUD_DOWN;
    if (weather === "fog") {
      layer.fillStyle = `rgba(214,220,224,${0.22 * intensity})`;
      layer.fillRect(0, 0, lw, lh);
      const tex = fog();
      const scale = Math.max(width / 40, height / 22) / d;
      cloudLayer(layer, tex, lw, lh, (t * 0.012 * px) / d, (t * 0.002 * px) / d, scale, 0.45 * intensity);
      cloudLayer(layer, tex, lw, lh, (-t * 0.02 * px + 300) / d, 120 / d, scale * 0.6, 0.3 * intensity);
    } else {
      const tex = tintedFog("#4a4038");
      const scale = Math.max(width / 36, height / 20) / d;
      cloudLayer(layer, tex, lw, lh, (t * 0.03 * px) / d, (-t * 0.01 * px) / d, scale, 0.32 * intensity);
    }
    if (v > 0.12) {
      layer.imageSmoothingEnabled = true;
      layer.drawImage(vignetteCanvas(width, height, v), 0, 0, lw, lh);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer.canvas, 0, 0, lw, lh, 0, 0, lw * d, lh * d);
    ctx.imageSmoothingEnabled = false;
  }
  if (weather === "smoke") {
    // Rising embers.
    ctx.fillStyle = `rgba(255,150,60,${0.85 * intensity})`;
    ctx.beginPath();
    const embers = Math.round((area / 26000) * intensity);
    for (let i = 0; i < embers; i++) {
      const speed = 0.02 + hash01(i, 2, 41) * 0.03;
      const life = (t * speed * 0.02 + hash01(i, 3, 41)) % 1;
      const x = hash01(i, 1, 41) * width + Math.sin(t * 0.002 + i) * 12;
      const y = height * (1 - life);
      if (hash01(i, 4, 41) < 0.5 && life > 0.7) continue;
      ctx.rect(Math.round(x / px) * px, Math.round(y / px) * px, px, px);
    }
    ctx.fill();
  } else if (weather === "rain") {
    const drops = Math.round((area / 2400) * intensity);
    const len = 9;
    const vx = -0.12;
    const vy = 1.1;
    // Each drop: a short slanted run of pixel rects (one batched fill).
    ctx.fillStyle = "rgba(200,216,236,0.5)";
    ctx.beginPath();
    for (let i = 0; i < drops; i++) {
      const speed = 0.8 + hash01(i, 2, 17) * 0.4;
      const span = width + 60;
      const tall = height + len * px;
      const x = (((hash01(i, 1, 17) * span + t * vx * speed * px * 0.6) % span) + span) % span - 30;
      const y = (((hash01(i, 3, 17) * tall + t * vy * speed * px * 0.6) % tall) + tall) % tall - len * px;
      const sx = Math.round(x / px) * px;
      const sy = Math.round(y / px) * px;
      const seg = Math.ceil(len / 3) * px;
      ctx.rect(sx, sy, px, seg);
      ctx.rect(sx - px, sy + seg, px, seg);
      ctx.rect(sx - px, sy + seg * 2, px, Math.max(px, seg - px));
    }
    ctx.fill();
    // Splashes on the ground.
    ctx.fillStyle = "rgba(210,224,240,0.5)";
    ctx.beginPath();
    const splashes = Math.round((area / 24000) * intensity);
    for (let i = 0; i < splashes; i++) {
      const cycle = (t / 380 + hash01(i, 5, 19)) % 1;
      const gen = Math.floor(t / 380 + hash01(i, 5, 19));
      const x = Math.round((hash01(i, gen, 21) * width) / px) * px;
      const y = Math.round((hash01(i, gen, 23) * height) / px) * px;
      const r = cycle < 0.5 ? px : 2 * px;
      ctx.rect(x - r, y, px, px);
      ctx.rect(x + r, y, px, px);
      if (cycle < 0.5) ctx.rect(x, y - px, px, px);
    }
    ctx.fill();
  } else if (weather === "snow") {
    const flakes = Math.round((area / 4200) * intensity);
    ctx.fillStyle = "rgba(250,252,255,0.9)";
    ctx.beginPath();
    for (let i = 0; i < flakes; i++) {
      const speed = 0.018 + hash01(i, 2, 29) * 0.025;
      const big = hash01(i, 4, 29) < 0.25;
      const y = (((hash01(i, 3, 29) * (height + 20) + t * speed * px) % (height + 20)) + height + 20) % (height + 20) - 10;
      const x = ((hash01(i, 1, 29) * width + Math.sin(t * 0.0012 + i * 1.7) * 10 * px + t * 0.004 * px) % width + width) % width;
      const s = big ? 2 * px : px;
      ctx.rect(Math.round(x / px) * px, Math.round(y / px) * px, s, s);
    }
    ctx.fill();
  }
  // Fog and smoke drew theirs with the cloud layer.
  if (v > 0.12 && weather !== "fog" && weather !== "smoke") {
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(vignetteCanvas(width, height, v), 0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
  }
  ctx.restore();
}
