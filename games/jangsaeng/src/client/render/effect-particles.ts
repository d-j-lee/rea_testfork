// Particle record, render types and pixel-style drawing for EffectSystem.

/** Chest height above the ground point for character-anchored effects. */
export const CHEST = 10;

// Particle render types.
export const T_PIXEL = 0;
export const T_PUFF = 1;
export const T_ARC = 2;
export const T_STREAK = 3;
export const T_ARROW = 4;
export const T_TRACER = 5;
export const T_BALL = 6;
export const T_RING = 7;
export const T_PILLAR = 8;
export const T_PLUS = 9;
export const T_FLASH = 10;
export const T_FLAME = 11;

// Actions when a particle expires.
export const END_NONE = 0;
export const END_SPARK = 1;
export const END_EXPLODE = 2;

const FLAME_COLORS = ["#fff6d0", "#ffd84a", "#f8a03a", "#e05a2a", "#a8382f", "#6a5a58"];
export const SPARK_COLORS = ["#ffffff", "#fff3a0", "#ffd84a"];

export class Particle {
  active = false;
  type = T_PIXEL;
  x = 0;
  y = 0;
  /** Height above the ground point (drawn at y - z). */
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  gz = 0;
  drag = 0;
  age = 0;
  life = 1;
  size = 1;
  grow = 0;
  color = "#ffffff";
  color2 = "#ffffff";
  angle = 0;
  /** Projectile start / target and arc height. */
  sx = 0;
  sy = 0;
  tx = 0;
  ty = 0;
  arc = 0;
  end = END_NONE;
  seq = 0;
}

export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, timeMs: number): void {
  if (p.age < 0) return;
  const k = p.age / p.life;
  const x = Math.round(p.x);
  const y = Math.round(p.y - p.z);
  switch (p.type) {
    case T_PIXEL: {
      ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
      ctx.fillStyle = p.color;
      const s = p.size >= 2 ? 2 : 1;
      ctx.fillRect(x, y, s, s);
      return;
    }
    case T_PLUS:
      ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
      return;
    case T_PUFF: {
      ctx.globalAlpha = (1 - k) * 0.75;
      ctx.fillStyle = p.color;
      disc(ctx, x, y, Math.max(1, Math.round(p.size)));
      return;
    }
    case T_FLAME: {
      const c = Math.min(FLAME_COLORS.length - 1, Math.floor(k * FLAME_COLORS.length));
      ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.fillStyle = FLAME_COLORS[c] as string;
      const r = Math.max(0, Math.round(p.size - 1));
      if (r === 0) ctx.fillRect(x, y, 1, 1);
      else disc(ctx, x, y, r);
      return;
    }
    case T_FLASH: {
      ctx.globalAlpha = 1 - k * 0.5;
      const r = Math.max(1, Math.round(p.size * (1 - k * 0.6)));
      ctx.fillStyle = p.color2;
      disc(ctx, x, y, r);
      ctx.fillStyle = p.color;
      disc(ctx, x, y, Math.max(0, r - 2));
      return;
    }
    case T_RING: {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.color;
      const r = p.size;
      ring(ctx, x, y, r, r * 0.5);
      if (r > 6) ring(ctx, x, y, r - 1, (r - 1) * 0.5);
      return;
    }
    case T_PILLAR: {
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const w = Math.max(2, Math.round(p.size * (1 - k * 0.7)));
      const h = 34 + Math.round(k * 10);
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = p.color;
      ctx.fillRect(x - w, y - h, w * 2, h);
      ctx.globalAlpha = a * 0.6;
      ctx.fillRect(x - (w >> 1), y - h - 4, w, h + 4);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 1, y - h - 6, 2, h + 6);
      return;
    }
    case T_ARC:
      return drawArc(ctx, p, k);
    case T_STREAK: {
      ctx.globalAlpha = 1 - k;
      const reach = p.size * (0.4 + 0.6 * Math.min(1, k * 2.5));
      const dx = Math.cos(p.angle);
      const dy = Math.sin(p.angle) * 0.7;
      const start = reach * 0.35;
      ctx.fillStyle = p.color2;
      for (let t = start; t < reach - 2; t += 1) ctx.fillRect(Math.round(p.x + dx * t), Math.round(p.y + dy * t), 1, 1);
      ctx.fillStyle = p.color;
      for (let t = reach - 2; t <= reach; t += 1)
        ctx.fillRect(Math.round(p.x + dx * t), Math.round(p.y + dy * t), 1, 1);
      return;
    }
    case T_ARROW: {
      ctx.globalAlpha = 1;
      // Screen-space heading including the arc (y is drawn at y - z).
      const a = Math.atan2(p.ty - p.sy - p.arc * 4 * (1 - 2 * k), p.tx - p.sx);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.fillStyle = "rgba(20,14,20,0.25)";
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y), 4, 1);
      ctx.fillStyle = "#c9a35a";
      for (let t = -3; t <= 2; t++) ctx.fillRect(Math.round(x + dx * t), Math.round(y + dy * t), 1, 1);
      ctx.fillStyle = "#e8eef4";
      ctx.fillRect(Math.round(x + dx * 3), Math.round(y + dy * 3), 1, 1);
      ctx.fillStyle = "#f4f1e8";
      ctx.fillRect(Math.round(x - dx * 4), Math.round(y - dy * 4), 1, 1);
      ctx.fillStyle = "#c8402e";
      ctx.fillRect(Math.round(x - dx * 4 - dy), Math.round(y - dy * 4 + dx), 1, 1);
      return;
    }
    case T_TRACER: {
      ctx.globalAlpha = 1;
      const dx = Math.cos(p.angle);
      const dy = Math.sin(p.angle);
      ctx.fillStyle = "#ffb040";
      for (let t = -7; t < -2; t++) ctx.fillRect(Math.round(x + dx * t), Math.round(y + dy * t), 1, 1);
      ctx.fillStyle = p.color;
      for (let t = -2; t <= 0; t++) ctx.fillRect(Math.round(x + dx * t), Math.round(y + dy * t), 1, 1);
      return;
    }
    case T_BALL: {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#140e14";
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y), 4, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#26211f";
      ctx.fillRect(x - 1, y - 2, 3, 4);
      ctx.fillRect(x - 2, y - 1, 5, 2);
      ctx.fillStyle = "#6c727b";
      ctx.fillRect(x - 1, y - 1, 1, 1);
      if ((timeMs >> 5) % 2 === 0) {
        ctx.fillStyle = "#ffb040";
        ctx.fillRect(x + 2, y - 3, 1, 1);
      }
      return;
    }
  }
}


/** Filled pixel disc. */
function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  if (r <= 0) {
    ctx.fillRect(cx, cy, 1, 1);
    return;
  }
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

/** Pixel ellipse outline (ground-plane rings use ry = rx / 2). */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  const n = Math.max(12, Math.round(Math.PI * (rx + ry)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
  }
}

/** Sword sweep: a bright crescent swinging through ~150° with a fading trail. */
function drawArc(ctx: CanvasRenderingContext2D, p: Particle, k: number): void {
  const sweep = 2.7;
  const start = p.angle - sweep / 2;
  const swing = Math.min(1, k * 1.8);
  const lead = start + sweep * swing;
  const fade = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
  const r = p.size;
  const steps = Math.max(10, Math.round(r * sweep));
  for (let i = 0; i <= steps; i++) {
    const a = start + (sweep * i) / steps;
    if (a > lead) break;
    // 0 at the trailing end, 1 at the blade edge.
    const t = (a - start) / Math.max(0.001, lead - start);
    const thick = t > 0.75 ? 3 : t > 0.35 ? 2 : 1;
    const cos = Math.cos(a);
    const sin = Math.sin(a) * 0.75;
    ctx.globalAlpha = fade * (0.35 + 0.65 * t);
    for (let j = 0; j < thick; j++) {
      ctx.fillStyle = j === 0 ? p.color : p.color2;
      ctx.fillRect(Math.round(p.x + cos * (r - j)), Math.round(p.y + sin * (r - j)), 1, 1);
    }
  }
}
