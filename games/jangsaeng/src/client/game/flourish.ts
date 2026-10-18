// Game-feel flourishes owned by the client core, all pooled (no per-frame
// allocation): red seal-stamp (낙관) crit numbers, 수묵 ink-dissolve deaths
// for enemies, and the red edge flash when the player is hurt.

import { glyphRows, FONT_H } from "../render/pixel-font.ts";
import { hash01 } from "../render/raster.ts";

const OUTLINE = "#1b1418";
const SEAL = "#b8312f";
const SEAL_DARK = "#7c1d1b";
const SEAL_LIGHT = "#d4493d";
const PAPER = "#f6ecd4";
const INK = "#1d1a19";
const INK_SOFT = "#3a3330";

// ── Seal-stamp crit numbers ────────────────────────────────────────────────

class Seal {
  active = false;
  x = 0;
  y = 0;
  age = 0;
  life = 1100;
  w = 0;
  h = 0;
  surface: HTMLCanvasElement | null = null;
}

const SEAL_POOL = 24;

/**
 * A small seal: one-pixel digits on a red block about as tall as a crit
 * number, so a burst of crits in a melee never buries the name plates (which
 * are drawn over the seals).
 */
function paintSeal(seal: Seal, rows: readonly string[], seed: number): void {
  const pad = 2;
  const cols = rows[0]?.length ?? 0;
  const iw = cols + pad * 2;
  const ih = FONT_H + pad * 2;
  const w = iw + 2;
  const h = ih + 2;
  let surface = seal.surface;
  if (!surface || surface.width < w || surface.height < h) {
    surface = document.createElement("canvas");
    surface.width = Math.max(w, 48);
    surface.height = Math.max(h, 20);
    seal.surface = surface;
  }
  const ctx = surface.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, surface.width, surface.height);
  // Outline, then a chipped-corner red block.
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(1, 0, iw, h);
  ctx.fillRect(0, 1, w, ih);
  ctx.fillStyle = SEAL;
  ctx.fillRect(1, 1, iw, ih);
  ctx.fillStyle = SEAL_DARK;
  ctx.fillRect(1, ih, iw, 1);
  ctx.fillRect(iw, 1, 1, ih);
  // Inner rim in a lighter red, broken here and there like a hand-pressed
  // stamp (kept off the digits so the number stays the loudest thing).
  ctx.fillStyle = SEAL_LIGHT;
  for (let x = 2; x < iw; x++) {
    if (hash01(x, 1, seed) > 0.22) ctx.fillRect(x, 2, 1, 1);
    if (hash01(x, 2, seed) > 0.22) ctx.fillRect(x, ih - 1, 1, 1);
  }
  for (let y = 3; y < ih - 1; y++) {
    if (hash01(3, y, seed) > 0.22) ctx.fillRect(2, y, 1, 1);
    if (hash01(4, y, seed) > 0.22) ctx.fillRect(iw - 1, y, 1, 1);
  }
  // Digits in paper colour (白文印).
  ctx.fillStyle = PAPER;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as string;
    for (let c = 0; c < row.length; c++) if (row[c] === "#") ctx.fillRect(1 + pad + c, 1 + pad + r, 1, 1);
  }
  seal.w = w;
  seal.h = h;
}

export class SealStamps {
  readonly #pool: Seal[] = [];
  #seed = 1;

  constructor() {
    for (let i = 0; i < SEAL_POOL; i++) this.#pool.push(new Seal());
  }

  /** Spawns a seal above (x, y) world px; false when the text cannot be stamped. */
  spawn(text: string, x: number, y: number): boolean {
    const rows = glyphRows(text);
    if (!rows || text.length > 6) return false;
    let slot: Seal | undefined;
    let oldest: Seal | undefined;
    for (const s of this.#pool) {
      if (!s.active) {
        slot = s;
        break;
      }
      if (!oldest || s.age > oldest.age) oldest = s;
    }
    slot ??= oldest;
    if (!slot) return false;
    paintSeal(slot, rows, this.#seed++);
    slot.active = true;
    slot.age = 0;
    slot.x = Math.round(x + (hash01(this.#seed, 3, 5) * 8 - 4));
    slot.y = Math.round(y);
    return true;
  }

  update(dtMs: number): void {
    for (const s of this.#pool) {
      if (!s.active) continue;
      s.age += dtMs;
      if (s.age >= s.life) s.active = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const prev = ctx.globalAlpha;
    for (const s of this.#pool) {
      if (!s.active || !s.surface) continue;
      const k = s.age / s.life;
      // Slam down (a little oversized → 1), settle, drift up a little, fade.
      const pop = s.age < 90 ? 1.35 - (s.age / 90) * 0.35 : s.age < 150 ? 1 - ((150 - s.age) / 60) * 0.06 : 1;
      const rise = 2 + 8 * (1 - (1 - k) * (1 - k));
      ctx.globalAlpha = prev * (k > 0.7 ? (1 - k) / 0.3 : 1);
      const w = Math.round(s.w * pop);
      const h = Math.round(s.h * pop);
      ctx.drawImage(s.surface, 0, 0, s.w, s.h, s.x - (w >> 1), Math.round(s.y - rise) - h, w, h);
    }
    ctx.globalAlpha = prev;
  }
}

// ── Ink dissolve ───────────────────────────────────────────────────────────

class Blot {
  active = false;
  paper = false;
  flat = false;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r0 = 0;
  r1 = 0;
  age = 0;
  delay = 0;
  life = 500;
  dark = false;
}

const BLOT_POOL = 220;

export class InkDissolve {
  readonly #pool: Blot[] = [];
  #cursor = 0;
  #seed = 11;

  constructor() {
    for (let i = 0; i < BLOT_POOL; i++) this.#pool.push(new Blot());
  }

  #take(): Blot {
    const b = this.#pool[this.#cursor] as Blot;
    this.#cursor = (this.#cursor + 1) % BLOT_POOL;
    b.active = true;
    b.age = 0;
    return b;
  }

  /** Ink bleeds out of a body standing at ground point (x, y), `height` px tall. */
  spawn(x: number, y: number, height: number, boss: boolean): void {
    const n = boss ? 22 : 11;
    const spread = boss ? 11 : 6;
    const seed = this.#seed++;
    const r = (i: number, j: number) => hash01(i, j, seed);
    for (let i = 0; i < n; i++) {
      const b = this.#take();
      b.paper = false;
      b.flat = false;
      b.dark = r(i, 1) < 0.6;
      b.x = x + (r(i, 2) * 2 - 1) * spread;
      b.y = y - r(i, 3) * height * 0.9;
      const out = Math.sign(b.x - x) || 1;
      b.vx = out * (4 + r(i, 4) * 10);
      b.vy = 6 + r(i, 5) * 10;
      b.r0 = 1;
      b.r1 = (boss ? 3 : 2) + r(i, 6) * (boss ? 4 : 2.5);
      b.delay = r(i, 7) * 160;
      b.life = 380 + r(i, 8) * (boss ? 320 : 200);
    }
    // Ink pooling on the ground like a brush pressed into 한지.
    const pools = boss ? 5 : 3;
    for (let i = 0; i < pools; i++) {
      const b = this.#take();
      b.paper = false;
      b.flat = true;
      b.dark = true;
      b.x = x + (r(i, 11) * 2 - 1) * spread * 0.8;
      b.y = y - 1 + r(i, 12) * 2;
      b.vx = 0;
      b.vy = 0;
      b.r0 = 2;
      b.r1 = (boss ? 8 : 5) + r(i, 13) * 3;
      b.delay = 60 + r(i, 14) * 120;
      b.life = boss ? 900 : 650;
    }
    if (!boss) return;
    for (let i = 0; i < 12; i++) {
      const b = this.#take();
      b.paper = true;
      b.flat = false;
      b.dark = r(i, 21) < 0.5;
      b.x = x + (r(i, 22) * 2 - 1) * spread;
      b.y = y - height * (0.3 + r(i, 23) * 0.6);
      b.vx = (r(i, 24) * 2 - 1) * 28;
      b.vy = -18 - r(i, 25) * 26;
      b.r0 = 0;
      b.r1 = 0;
      b.delay = r(i, 26) * 200;
      b.life = 700 + r(i, 27) * 400;
    }
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    for (const b of this.#pool) {
      if (!b.active) continue;
      b.age += dtMs;
      if (b.age < b.delay) continue;
      if (b.age >= b.delay + b.life) {
        b.active = false;
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.paper) {
        b.vy += 22 * dt; // scraps float up, then slowly settle
        b.vx *= 1 - 1.2 * dt;
      } else {
        b.vx *= 1 - 3 * dt;
        b.vy *= 1 - 3 * dt;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, timeMs: number): void {
    const prev = ctx.globalAlpha;
    for (const b of this.#pool) {
      if (!b.active || b.age < b.delay) continue;
      const k = (b.age - b.delay) / b.life;
      const cx = Math.round(b.x);
      const cy = Math.round(b.y);
      if (b.paper) {
        ctx.globalAlpha = prev * (k > 0.6 ? (1 - k) / 0.4 : 1);
        const flip = Math.floor((timeMs + b.delay * 7) / 120) % 2 === 0;
        ctx.fillStyle = OUTLINE;
        ctx.fillRect(cx - 1, cy - 1, flip ? 4 : 3, flip ? 3 : 4);
        ctx.fillStyle = b.dark ? "#e3d6b8" : PAPER;
        ctx.fillRect(cx, cy, flip ? 2 : 1, flip ? 1 : 2);
        continue;
      }
      const ease = 1 - (1 - k) * (1 - k);
      const r = b.r0 + (b.r1 - b.r0) * ease;
      ctx.globalAlpha = prev * (b.flat ? 0.55 : 0.85) * Math.pow(1 - k, 1.3);
      ctx.fillStyle = b.dark ? INK : INK_SOFT;
      const ry = b.flat ? r * 0.45 : r;
      const rows = Math.max(0, Math.ceil(ry));
      for (let dy = -rows; dy <= rows; dy++) {
        const t = ry > 0 ? dy / ry : 0;
        const half = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)));
        if (half <= 0 && dy !== 0) continue;
        ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
      }
    }
    ctx.globalAlpha = prev;
  }
}

/** Ink tint strength (0..1) of a dissolving sprite at progress k. */
export function dissolveTint(k: number): number {
  return Math.min(1, Math.max(0, k) * 2.2) * 0.9;
}

/** Sprite alpha of a dissolving sprite at progress k (darken first, then fade). */
export function dissolveAlpha(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  const fade = c < 0.35 ? 0 : (c - 0.35) / 0.65;
  return 1 - fade * fade * (3 - 2 * fade);
}

// ── Hurt vignette ──────────────────────────────────────────────────────────

export class HurtVignette {
  #at = Number.NEGATIVE_INFINITY;
  #strength = 0;
  #texture: HTMLCanvasElement | null = null;

  trigger(now: number, strength: number): void {
    this.#at = now;
    this.#strength = Math.min(1, Math.max(this.#strength * 0.5, strength));
  }

  #tex(): HTMLCanvasElement | null {
    if (this.#texture) return this.#texture;
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const g = c.getContext("2d");
    if (!g) return null;
    const grad = g.createRadialGradient(80, 45, 28, 80, 45, 96);
    grad.addColorStop(0, "rgba(160,18,18,0)");
    grad.addColorStop(0.55, "rgba(170,20,18,0.35)");
    grad.addColorStop(1, "rgba(120,8,8,0.95)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 160, 90);
    this.#texture = c;
    return c;
  }

  /** Screen-space pass (identity transform). */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, now: number): void {
    const k = (now - this.#at) / 420;
    if (k >= 1 || k < 0) return;
    const tex = this.#tex();
    if (!tex) return;
    const a = this.#strength * (1 - k) * (1 - k);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tex, 0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = prev;
  }
}
