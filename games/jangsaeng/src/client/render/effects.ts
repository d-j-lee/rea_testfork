// Combat and world effects in world pixels, drawn in pixel style (integer
// positions, 1 world px squares) so they sit naturally on the pixel art.
//
// Positions: character-anchored effects (slash, thrust, shout, heal, levelup,
// dust, splash) take the character's ground point and lift themselves to the
// right height; the others (spark, smoke, fire, explosion) take the exact
// world point. Projectiles (arrow, bullet, cannonball) fly from (x, y) to
// (tx, ty) — pass ground points; they travel at chest height and land on
// the ground for cannonballs.
//
// Cost: particles and floating texts live in fixed pools (no per-frame
// allocation); spawning beyond the cap recycles the oldest particle.

import type { Dir, EffectKind } from "../../shared/sprites.ts";
import {
  CHEST,
  drawParticle,
  END_EXPLODE,
  END_NONE,
  END_SPARK,
  Particle,
  SPARK_COLORS,
  T_ARC,
  T_ARROW,
  T_BALL,
  T_FLAME,
  T_FLASH,
  T_PILLAR,
  T_PIXEL,
  T_PLUS,
  T_PUFF,
  T_RING,
  T_STREAK,
  T_TRACER,
} from "./effect-particles.ts";
import { drawFloatText, FloatText, renderFloatText } from "./float-text.ts";
import { glyphRows } from "./pixel-font.ts";

const MAX_PARTICLES = 400;
const MAX_EMITTERS = 48;
const MAX_TEXTS = 64;

class Emitter {
  active = false;
  kind = 0;
  x = 0;
  y = 0;
  w = 0;
  age = 0;
  life = 0;
  acc = 0;
  rate = 0;
}

const E_FIRE = 0;
const E_LEVEL = 1;

const DIR_ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export interface SpawnOptions {
  dir?: Dir;
  /** Facing angle in radians (overrides dir). */
  angle?: number;
  tx?: number;
  ty?: number;
  color?: string;
  size?: number;
  durationMs?: number;
}

export interface FloatTextOptions {
  color?: string;
  /** Pixel scale of the glyphs (1 = 3 × 5 px digits). */
  size?: number;
  crit?: boolean;
  durationMs?: number;
}

export class EffectSystem {
  readonly #particles: Particle[] = [];
  readonly #emitters: Emitter[] = [];
  readonly #texts: FloatText[] = [];
  #cursor = 0;
  #seq = 0;
  #live = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) this.#particles.push(new Particle());
    for (let i = 0; i < MAX_EMITTERS; i++) this.#emitters.push(new Emitter());
    for (let i = 0; i < MAX_TEXTS; i++) this.#texts.push(new FloatText());
  }

  /** Live particle count (texts and emitters excluded). */
  get count(): number {
    return this.#live;
  }

  /** Removes every effect. */
  clear(): void {
    for (const p of this.#particles) p.active = false;
    for (const e of this.#emitters) e.active = false;
    for (const t of this.#texts) t.active = false;
    this.#live = 0;
  }

  spawn(kind: EffectKind, x: number, y: number, opts?: SpawnOptions): void {
    const angle = opts?.angle ?? (opts?.dir ? DIR_ANGLE[opts.dir] : 0);
    const size = opts?.size ?? 1;
    switch (kind) {
      case "slash":
        return this.#slash(x, y, angle, size, opts?.color);
      case "thrust":
        return this.#thrust(x, y, angle, size, opts?.color);
      case "arrow":
        return this.#projectile(T_ARROW, x, y, opts, 240, 0.12, END_SPARK);
      case "bullet":
        this.#muzzle(x, y, opts);
        return this.#projectile(T_TRACER, x, y, opts, 900, 0, END_SPARK);
      case "cannonball":
        this.#smokePuffs(x, y - 6, 4, 1.2);
        return this.#projectile(T_BALL, x, y, opts, 170, 0.35, END_EXPLODE);
      case "fire":
        return this.#emit(E_FIRE, x, y, 6 * size, opts?.durationMs ?? 4000, 26 * size);
      case "smoke":
        return this.#smokePuffs(x, y, Math.round(6 * size), size);
      case "spark":
        return this.#spark(x, y, size, opts?.color);
      case "heal":
        return this.#heal(x, y, size, opts?.color);
      case "levelup":
        return this.#levelUp(x, y, opts?.color);
      case "dust":
        return this.#dust(x, y, size, opts?.color);
      case "splash":
        return this.#splash(x, y, size);
      case "explosion":
        return this.#explosion(x, y, size);
      case "shout":
        return this.#shout(x, y, size, opts?.color);
    }
  }

  floatText(text: string, x: number, y: number, opts?: FloatTextOptions): void {
    let slot: FloatText | undefined;
    let oldest: FloatText | undefined;
    for (const t of this.#texts) {
      if (!t.active) {
        slot = t;
        break;
      }
      if (!oldest || t.age > oldest.age) oldest = t;
    }
    slot ??= oldest;
    if (!slot) return;
    const crit = opts?.crit ?? false;
    slot.active = true;
    slot.age = 0;
    slot.life = opts?.durationMs ?? (crit ? 1100 : 850);
    slot.crit = crit;
    slot.size = opts?.size ?? (crit ? 2 : 1);
    slot.color = opts?.color ?? (crit ? "#ffd84a" : "#ffffff");
    slot.outline = crit ? "#5a1010" : "#1b1418";
    slot.text = text;
    slot.x = Math.round(x + (Math.random() * 6 - 3));
    slot.y = Math.round(y);
    slot.vector = !glyphRows(text);
    if (!slot.vector) renderFloatText(slot);
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    for (const e of this.#emitters) {
      if (!e.active) continue;
      e.age += dtMs;
      if (e.age >= e.life) {
        e.active = false;
        continue;
      }
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (e.kind === E_FIRE) this.#flame(e);
        else this.#levelSpark(e);
      }
    }
    let live = 0;
    for (const p of this.#particles) {
      if (!p.active) continue;
      p.age += dtMs;
      if (p.age >= p.life) {
        p.active = false;
        this.#onEnd(p);
        continue;
      }
      live++;
      if (p.type === T_ARROW || p.type === T_TRACER || p.type === T_BALL) {
        const k = p.age / p.life;
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.z = CHEST * (p.type === T_BALL ? 1 - k : 1) + p.arc * 4 * k * (1 - k);
        continue;
      }
      if (p.drag) {
        const f = Math.max(0, 1 - p.drag * dt);
        p.vx *= f;
        p.vy *= f;
        p.vz *= f;
      }
      p.vz -= p.gz * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.gz > 0 && p.z < 0) {
        p.z = 0;
        p.vz = -p.vz * 0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      p.size += p.grow * dt;
    }
    this.#live = live;
    for (const t of this.#texts) {
      if (!t.active) continue;
      t.age += dtMs;
      if (t.age >= t.life) t.active = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, timeMs: number): void {
    const prevAlpha = ctx.globalAlpha;
    for (const p of this.#particles) if (p.active) drawParticle(ctx, p, timeMs);
    ctx.globalAlpha = prevAlpha;
    for (const t of this.#texts) if (t.active) drawFloatText(ctx, t);
    ctx.globalAlpha = prevAlpha;
  }

  // ------------------------------------------------------------ pool --

  #take(): Particle {
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const i = (this.#cursor + n) % MAX_PARTICLES;
      const p = this.#particles[i] as Particle;
      if (!p.active) {
        this.#cursor = (i + 1) % MAX_PARTICLES;
        return this.#reset(p);
      }
    }
    // Full: recycle the oldest.
    let oldest = this.#particles[0] as Particle;
    for (const p of this.#particles) if (p.seq < oldest.seq) oldest = p;
    return this.#reset(oldest);
  }

  #reset(p: Particle): Particle {
    p.active = true;
    p.type = T_PIXEL;
    p.x = p.y = p.z = 0;
    p.vx = p.vy = p.vz = 0;
    p.gz = 0;
    p.drag = 0;
    p.age = 0;
    p.life = 500;
    p.size = 1;
    p.grow = 0;
    p.angle = 0;
    p.arc = 0;
    p.end = END_NONE;
    p.seq = ++this.#seq;
    return p;
  }

  #emit(kind: number, x: number, y: number, w: number, life: number, rate: number): void {
    let slot: Emitter | undefined;
    for (const e of this.#emitters) if (!e.active) {
      slot = e;
      break;
    }
    if (!slot) return;
    slot.active = true;
    slot.kind = kind;
    slot.x = x;
    slot.y = y;
    slot.w = w;
    slot.age = 0;
    slot.life = life;
    slot.acc = 0;
    slot.rate = rate;
  }

  #onEnd(p: Particle): void {
    switch (p.end) {
      case END_SPARK:
        this.#spark(p.tx, p.ty - CHEST, 0.6, undefined);
        break;
      case END_EXPLODE:
        this.#explosion(p.tx, p.ty, 1);
        break;
    }
  }

  // -------------------------------------------------------- spawners --

  #slash(x: number, y: number, angle: number, size: number, color?: string): void {
    const p = this.#take();
    p.type = T_ARC;
    p.x = x + Math.cos(angle) * 4;
    p.y = y - CHEST + Math.sin(angle) * 2;
    p.angle = angle;
    p.size = 13 * size;
    p.life = 200;
    p.color = color ?? "#ffffff";
    p.color2 = "#a8d8ff";
    for (let i = 0; i < 4; i++) {
      const a = angle + (Math.random() - 0.5) * 1.6;
      const s = this.#take();
      s.x = x + Math.cos(a) * 12 * size;
      s.y = y - CHEST + Math.sin(a) * 8 * size;
      s.vx = Math.cos(a) * 60;
      s.vy = Math.sin(a) * 40;
      s.drag = 4;
      s.life = 160 + Math.random() * 120;
      s.color = "#e8f6ff";
    }
  }

  #thrust(x: number, y: number, angle: number, size: number, color?: string): void {
    const p = this.#take();
    p.type = T_STREAK;
    p.x = x;
    p.y = y - CHEST + 2;
    p.angle = angle;
    p.size = 18 * size;
    p.life = 160;
    p.color = color ?? "#ffffff";
    p.color2 = "#b8dcff";
    for (let i = -1; i <= 1; i += 2) {
      const s = this.#take();
      s.type = T_STREAK;
      s.x = x + Math.cos(angle + Math.PI / 2) * i * 3;
      s.y = y - CHEST + 2 + Math.sin(angle + Math.PI / 2) * i * 2;
      s.angle = angle;
      s.size = 10 * size;
      s.life = 120;
      s.color = "#d8ecff";
      s.color2 = "#d8ecff";
    }
  }

  #projectile(
    type: number,
    x: number,
    y: number,
    opts: SpawnOptions | undefined,
    speed: number,
    arc: number,
    end: number,
  ): void {
    const tx = opts?.tx ?? x + Math.cos(opts?.angle ?? 0) * 80;
    const ty = opts?.ty ?? y + Math.sin(opts?.angle ?? 0) * 80;
    const dist = Math.hypot(tx - x, ty - y);
    const p = this.#take();
    p.type = type;
    p.sx = p.x = x;
    p.sy = p.y = y;
    p.tx = tx;
    p.ty = ty;
    p.z = CHEST;
    p.arc = dist * arc;
    p.life = opts?.durationMs ?? Math.max(60, (dist / speed) * 1000);
    p.angle = Math.atan2(ty - y, tx - x);
    p.end = end;
    p.color = opts?.color ?? (type === T_TRACER ? "#fff3a0" : "#2a2523");
  }

  #muzzle(x: number, y: number, opts: SpawnOptions | undefined): void {
    const tx = opts?.tx ?? x + 10;
    const ty = opts?.ty ?? y;
    const a = Math.atan2(ty - y, tx - x);
    const mx = x + Math.cos(a) * 9;
    const my = y + Math.sin(a) * 5;
    const f = this.#take();
    f.type = T_FLASH;
    f.x = mx;
    f.y = my;
    f.z = CHEST + 1;
    f.size = 3;
    f.life = 90;
    f.color = "#fff6d0";
    f.color2 = "#ffb040";
    for (let i = 0; i < 4; i++) {
      const s = this.#take();
      s.type = T_PUFF;
      s.x = mx + Math.cos(a) * i * 2;
      s.y = my + Math.sin(a) * i;
      s.z = CHEST + 1;
      s.vx = Math.cos(a) * (20 - i * 4) + (Math.random() - 0.5) * 8;
      s.vy = Math.sin(a) * (12 - i * 2);
      s.vz = 6 + Math.random() * 6;
      s.drag = 2;
      s.size = 1.5;
      s.grow = 3;
      s.life = 600 + Math.random() * 300;
      s.color = "#d8d4cc";
    }
  }

  #smokePuffs(x: number, y: number, n: number, size: number): void {
    for (let i = 0; i < n; i++) {
      const s = this.#take();
      s.type = T_PUFF;
      s.x = x + (Math.random() - 0.5) * 8 * size;
      s.y = y + (Math.random() - 0.5) * 4 * size;
      s.z = Math.random() * 4;
      s.vx = (Math.random() - 0.5) * 12;
      s.vz = 8 + Math.random() * 12;
      s.drag = 1;
      s.size = 2 * size + Math.random();
      s.grow = 3 * size;
      s.life = 800 + Math.random() * 600;
      s.color = i % 3 === 0 ? "#6f6b66" : i % 3 === 1 ? "#8a8680" : "#a8a49c";
    }
  }

  #spark(x: number, y: number, size: number, color?: string): void {
    const f = this.#take();
    f.type = T_FLASH;
    f.x = x;
    f.y = y;
    f.size = 3 * size + 1;
    f.life = 90;
    f.color = "#ffffff";
    f.color2 = color ?? "#ffe08a";
    const n = Math.round(7 * size) + 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 50 + Math.random() * 70 * size;
      const s = this.#take();
      s.x = x;
      s.y = y;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v * 0.7;
      s.drag = 6;
      s.life = 160 + Math.random() * 160;
      s.color = color && i % 2 ? color : (SPARK_COLORS[i % 3] as string);
    }
  }

  #heal(x: number, y: number, size: number, color?: string): void {
    const ring = this.#take();
    ring.type = T_RING;
    ring.x = x;
    ring.y = y;
    ring.size = 4;
    ring.grow = 30;
    ring.life = 500;
    ring.color = color ?? "#9be38f";
    for (let i = 0; i < Math.round(7 * size); i++) {
      const s = this.#take();
      s.type = i % 3 === 0 ? T_PLUS : T_PIXEL;
      s.x = x + (Math.random() - 0.5) * 14;
      s.y = y + (Math.random() - 0.5) * 3;
      s.z = Math.random() * 10;
      s.vz = 18 + Math.random() * 14;
      s.life = 600 + Math.random() * 400;
      s.color = i % 2 ? "#e8ffe0" : (color ?? "#7fdc6a");
    }
  }

  #levelUp(x: number, y: number, color?: string): void {
    const gold = color ?? "#ffd84a";
    const pillar = this.#take();
    pillar.type = T_PILLAR;
    pillar.x = x;
    pillar.y = y;
    pillar.size = 10;
    pillar.life = 1100;
    pillar.color = "#fff3b0";
    for (let i = 0; i < 3; i++) {
      const r = this.#take();
      r.type = T_RING;
      r.x = x;
      r.y = y;
      r.z = i * 2;
      r.vz = 14 + i * 6;
      r.size = 3;
      r.grow = 22 + i * 4;
      r.life = 700 + i * 180;
      r.age = -i * 160;
      r.color = gold;
    }
    this.#emit(E_LEVEL, x, y, 12, 900, 30);
  }

  #levelSpark(e: Emitter): void {
    const s = this.#take();
    s.type = Math.random() < 0.25 ? T_PLUS : T_PIXEL;
    s.x = e.x + (Math.random() - 0.5) * e.w * 2;
    s.y = e.y + (Math.random() - 0.5) * 3;
    s.z = Math.random() * 6;
    s.vz = 30 + Math.random() * 30;
    s.life = 500 + Math.random() * 400;
    s.color = Math.random() < 0.5 ? "#fff6c0" : "#ffd84a";
  }

  #flame(e: Emitter): void {
    const s = this.#take();
    s.type = T_FLAME;
    s.x = e.x + (Math.random() - 0.5) * e.w * 2;
    s.y = e.y + (Math.random() - 0.5) * 2;
    s.z = Math.random() * 3;
    s.vx = (Math.random() - 0.5) * 6;
    s.vz = 16 + Math.random() * 18;
    s.size = 2 + Math.random() * 1.5;
    s.grow = -1.6;
    s.life = 450 + Math.random() * 350;
    if (Math.random() < 0.12) {
      // Rising smoke above the flames.
      s.type = T_PUFF;
      s.z = 10 + Math.random() * 6;
      s.vz = 14;
      s.size = 2;
      s.grow = 3;
      s.life = 1200;
      s.color = "#5a5452";
    } else if (Math.random() < 0.1) {
      s.type = T_PIXEL;
      s.vz = 30 + Math.random() * 20;
      s.vx = (Math.random() - 0.5) * 20;
      s.color = "#ffcf6a";
    }
  }

  #dust(x: number, y: number, size: number, color?: string): void {
    const c = color ?? "#cdb894";
    for (let i = 0; i < Math.round(4 * size); i++) {
      const s = this.#take();
      s.type = T_PUFF;
      s.x = x + (i % 2 ? 3 : -3);
      s.y = y;
      s.vx = (i % 2 ? 1 : -1) * (10 + Math.random() * 10);
      s.vz = 4 + Math.random() * 4;
      s.drag = 4;
      s.size = 1 + Math.random() * 0.6;
      s.grow = 2;
      s.life = 320 + Math.random() * 160;
      s.color = c;
    }
  }

  #splash(x: number, y: number, size: number): void {
    const ring = this.#take();
    ring.type = T_RING;
    ring.x = x;
    ring.y = y;
    ring.size = 2;
    ring.grow = 22 * size;
    ring.life = 500;
    ring.color = "#d8ecf2";
    for (let i = 0; i < Math.round(9 * size); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = this.#take();
      s.x = x;
      s.y = y;
      s.vx = Math.cos(a) * (14 + Math.random() * 16);
      s.vy = Math.sin(a) * 8;
      s.vz = 30 + Math.random() * 25;
      s.gz = 140;
      s.life = 420 + Math.random() * 200;
      s.color = i % 3 ? "#bfe4f2" : "#ffffff";
    }
  }

  #explosion(x: number, y: number, size: number): void {
    const f = this.#take();
    f.type = T_FLASH;
    f.x = x;
    f.y = y;
    f.z = 3;
    f.size = 9 * size;
    f.life = 140;
    f.color = "#fffbe6";
    f.color2 = "#ffd84a";
    const ring = this.#take();
    ring.type = T_RING;
    ring.x = x;
    ring.y = y;
    ring.size = 4;
    ring.grow = 70 * size;
    ring.life = 260;
    ring.color = "#fff3c0";
    for (let i = 0; i < Math.round(14 * size); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 14 + Math.random() * 30 * size;
      const s = this.#take();
      s.type = T_FLAME;
      s.x = x + Math.cos(a) * 2;
      s.y = y + Math.sin(a);
      s.z = 2 + Math.random() * 4;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v * 0.5;
      s.vz = 10 + Math.random() * 20;
      s.drag = 3;
      s.size = 2.5 + Math.random() * 2 * size;
      s.grow = -1.5;
      s.life = 380 + Math.random() * 300;
    }
    for (let i = 0; i < Math.round(10 * size); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = this.#take();
      s.x = x;
      s.y = y;
      s.z = 2;
      s.vx = Math.cos(a) * (30 + Math.random() * 40);
      s.vy = Math.sin(a) * 20;
      s.vz = 40 + Math.random() * 50;
      s.gz = 160;
      s.life = 600 + Math.random() * 300;
      s.color = i % 2 ? "#5e3a22" : "#3a3434";
    }
    this.#smokePuffs(x, y - 4, Math.round(6 * size), 1.4 * size);
  }

  #shout(x: number, y: number, size: number, color?: string): void {
    const c = color ?? "#ffe08a";
    for (let i = 0; i < 2; i++) {
      const r = this.#take();
      r.type = T_RING;
      r.x = x;
      r.y = y;
      r.z = 2;
      r.size = 5;
      r.grow = 60 * size;
      r.life = 420;
      r.age = -i * 120;
      r.color = i ? "#ffffff" : c;
    }
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      const s = this.#take();
      s.type = T_STREAK;
      s.x = x + Math.cos(a) * 9;
      s.y = y - 21 + Math.sin(a) * 4;
      s.angle = a;
      s.size = 5;
      s.vx = Math.cos(a) * 30;
      s.vy = Math.sin(a) * 30;
      s.life = 260;
      s.color = c;
      s.color2 = "#ffffff";
    }
  }

  // ---------------------------------------------------------- drawing --
}
