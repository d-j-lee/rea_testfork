// FX routing: host FxEvents (tiles) are delayed to line up with the
// interpolated entities, then fanned out to the effect system (px), the
// seal-stamp crits, telegraph decals, camera shake, hitstop and positional
// sound. Telegraphs are drawn here as translucent red shapes that fill up
// over their warning time.

import { EFFECT_KINDS, TILE_PX, type EffectKind } from "../../shared/sprites.ts";
import type { FxEvent } from "../../shared/types.ts";
import { SFX_NAMES, type AudioEngine, type SfxName } from "../audio/types.ts";
import type { EffectSystem } from "../render/effects.ts";
import type { CameraRig } from "./camera.ts";
import type { SealStamps } from "./flourish.ts";

const EFFECTS = new Set<string>(EFFECT_KINDS);
const SFX = new Set<string>(SFX_NAMES);
const QUEUE_MAX = 512;
const TELE_MAX = 32;
/** Lift from a target's ground point to where its damage number starts. */
const TEXT_LIFT = 20;
const HITSTOP_MAX = 160;

const SHAPE_LINE = 0;
const SHAPE_CIRCLE = 1;
const SHAPE_CONE = 2;

class Tele {
  active = false;
  shape = SHAPE_CIRCLE;
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  r = 0;
  angle = 0;
  spread = 0;
  start = 0;
  ms = 600;
}

export interface FxSinks {
  effects: EffectSystem;
  seals: SealStamps;
  audio: AudioEngine;
  rig: CameraRig;
  hitstop(ms: number): void;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export class FxRouter {
  readonly #sinks: FxSinks;
  readonly #due: number[] = [];
  readonly #events: FxEvent[] = [];
  #head = 0;
  readonly #teles: Tele[] = [];

  constructor(sinks: FxSinks) {
    this.#sinks = sinks;
    for (let i = 0; i < TELE_MAX; i++) this.#teles.push(new Tele());
  }

  clear(): void {
    this.#due.length = 0;
    this.#events.length = 0;
    this.#head = 0;
    for (const t of this.#teles) t.active = false;
  }

  /** Queues events to fire at client time `due`. */
  push(events: readonly FxEvent[], due: number): void {
    if (typeof document !== "undefined" && document.hidden) return; // nobody is watching
    for (const ev of events) {
      if (!ev || typeof ev.k !== "string") continue;
      if (this.#due.length - this.#head >= QUEUE_MAX) this.#head++; // drop the oldest
      this.#due.push(due);
      this.#events.push(ev);
    }
  }

  update(now: number): void {
    while (this.#head < this.#due.length && (this.#due[this.#head] as number) <= now) {
      const ev = this.#events[this.#head] as FxEvent;
      this.#head++;
      try {
        this.#fire(ev, now);
      } catch (error) {
        console.warn("[fx] bad event", ev, error);
      }
    }
    if (this.#head > 64 && this.#head * 2 > this.#due.length) {
      this.#due.splice(0, this.#head);
      this.#events.splice(0, this.#head);
      this.#head = 0;
    }
    for (const t of this.#teles) if (t.active && now > t.start + t.ms + 140) t.active = false;
  }

  #fire(ev: FxEvent, now: number): void {
    const s = this.#sinks;
    const x = num(ev.x) * TILE_PX;
    const y = num(ev.y) * TILE_PX;
    switch (ev.k) {
      case "text": {
        const text = typeof ev.text === "string" ? ev.text.slice(0, 24) : "";
        if (!text) return;
        if (ev.crit && s.seals.spawn(text, x, y - TEXT_LIFT)) return;
        s.effects.floatText(text, x, y - TEXT_LIFT, { color: ev.color, crit: ev.crit });
        return;
      }
      case "sfx": {
        if (typeof ev.sfx === "string" && SFX.has(ev.sfx)) this.#sound(ev.sfx as SfxName, x, y);
        return;
      }
      case "telegraph":
        return this.#telegraph(ev, now);
      case "shake": {
        let dx = 0;
        let dy = 0;
        if (ev.angle !== undefined) {
          dx = Math.cos(num(ev.angle));
          dy = Math.sin(num(ev.angle));
        } else if (ev.tx !== undefined && ev.ty !== undefined) {
          dx = num(ev.tx) * TILE_PX - x;
          dy = num(ev.ty) * TILE_PX - y;
        }
        s.rig.addShake(num(ev.power, 2), dx, dy);
        return;
      }
      case "hitstop":
        s.hitstop(Math.min(HITSTOP_MAX, Math.max(0, num(ev.power, 60))));
        return;
      default:
        if (!EFFECTS.has(ev.k)) return;
        s.effects.spawn(ev.k as EffectKind, x, y, {
          dir: ev.d,
          angle: ev.angle,
          tx: ev.tx !== undefined ? num(ev.tx) * TILE_PX : undefined,
          ty: ev.ty !== undefined ? num(ev.ty) * TILE_PX : undefined,
          color: ev.color,
        });
    }
  }

  /** Stereo position from the screen, quieter the further off-screen. */
  #sound(name: SfxName, x: number, y: number): void {
    const { rig, audio } = this.#sinks;
    const cam = rig.camera;
    const sx = rig.screenX(x);
    const pan = Math.max(-1, Math.min(1, (sx / Math.max(1, cam.width)) * 2 - 1)) * 0.85;
    const half = cam.width / cam.scale / 2;
    const d = Math.hypot(x - cam.x, y - cam.y);
    const gain = d <= half ? 1 : Math.max(0.12, 1 - (d - half) / (half * 1.6));
    audio.sfx(name, { pan, gain });
  }

  #telegraph(ev: FxEvent, now: number): void {
    const tg = ev.tg;
    if (!tg) return;
    let slot: Tele | undefined;
    for (const t of this.#teles) if (!t.active) {
      slot = t;
      break;
    }
    if (!slot) return;
    slot.active = true;
    slot.start = now;
    slot.ms = Math.min(5000, Math.max(120, num(tg.ms, 600)));
    slot.x = num(tg.x) * TILE_PX;
    slot.y = num(tg.y) * TILE_PX;
    if (tg.shape === "line") {
      slot.shape = SHAPE_LINE;
      slot.tx = num(tg.tx) * TILE_PX;
      slot.ty = num(tg.ty) * TILE_PX;
    } else if (tg.shape === "circle") {
      slot.shape = SHAPE_CIRCLE;
      slot.r = Math.min(40, Math.max(0.25, num(tg.r, 1))) * TILE_PX;
    } else {
      slot.shape = SHAPE_CONE;
      slot.r = Math.min(40, Math.max(0.25, num(tg.r, 2))) * TILE_PX;
      slot.angle = num(tg.angle);
      // Spread is the full opening in radians (degrees tolerated).
      const spread = num(tg.spread, Math.PI / 2);
      slot.spread = spread > Math.PI * 2 + 0.01 ? (spread * Math.PI) / 180 : spread;
    }
  }

  /** Ground decals; call in world space before the depth-sorted pass. */
  drawTelegraphs(ctx: CanvasRenderingContext2D, now: number): void {
    const prev = ctx.globalAlpha;
    for (const t of this.#teles) {
      if (!t.active) continue;
      const age = now - t.start;
      const k = Math.min(1, Math.max(0, age / t.ms));
      const flash = age > t.ms ? 1 - (age - t.ms) / 140 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(age / 70);
      ctx.globalAlpha = prev;
      if (t.shape === SHAPE_CIRCLE) {
        const cx = Math.round(t.x);
        const cy = Math.round(t.y);
        ctx.fillStyle = "rgba(170,24,20,0.16)";
        disc(ctx, cx, cy, t.r);
        ctx.fillStyle = `rgba(222,40,28,${0.22 + 0.12 * k})`;
        disc(ctx, cx, cy, t.r * k);
        ctx.fillStyle = `rgba(255,110,84,${0.55 + 0.35 * pulse})`;
        ring(ctx, cx, cy, t.r);
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,230,200,${0.55 * flash})`;
          disc(ctx, cx, cy, t.r);
        }
      } else if (t.shape === SHAPE_CONE) {
        const a0 = t.angle - t.spread / 2;
        const a1 = t.angle + t.spread / 2;
        wedge(ctx, t.x, t.y, t.r, a0, a1, "rgba(170,24,20,0.16)");
        wedge(ctx, t.x, t.y, t.r * k, a0, a1, `rgba(222,40,28,${0.22 + 0.12 * k})`);
        ctx.strokeStyle = `rgba(255,110,84,${0.55 + 0.35 * pulse})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.arc(t.x, t.y, t.r, a0, a1);
        ctx.closePath();
        ctx.stroke();
        if (flash > 0) wedge(ctx, t.x, t.y, t.r, a0, a1, `rgba(255,230,200,${0.55 * flash})`);
      } else {
        const dx = t.tx - t.x;
        const dy = t.ty - t.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const w = 6;
        band(ctx, t.x, t.y, dx, dy, len, w, 1, "rgba(170,24,20,0.18)");
        band(ctx, t.x, t.y, dx, dy, len, w, k, `rgba(222,40,28,${0.24 + 0.12 * k})`);
        ctx.strokeStyle = `rgba(255,110,84,${0.55 + 0.35 * pulse})`;
        ctx.lineWidth = 1;
        bandPath(ctx, t.x, t.y, dx, dy, len, w, 1);
        ctx.stroke();
        if (flash > 0) band(ctx, t.x, t.y, dx, dy, len, w, 1, `rgba(255,230,200,${0.55 * flash})`);
      }
    }
    ctx.globalAlpha = prev;
  }
}

/** Pixel-crisp filled disc (one batched path of row spans). */
export function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  if (r < 0.5) return;
  const rr = Math.round(r);
  ctx.beginPath();
  for (let dy = -rr; dy <= rr; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ctx.rect(cx - half, cy + dy, half * 2 + 1, 1);
  }
  ctx.fill();
}

/** Pixel-crisp 1px circle outline. */
export function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const rr = Math.round(r);
  const halfAt = (dy: number) => (Math.abs(dy) > rr ? -1 : Math.round(Math.sqrt(Math.max(0, r * r - dy * dy))));
  ctx.beginPath();
  for (let dy = -rr; dy <= rr; dy++) {
    const h = halfAt(dy);
    // Cover what the narrower neighbour row leaves open, so there are no gaps.
    const inner = Math.max(0, Math.min(h, Math.min(halfAt(dy - 1), halfAt(dy + 1)) + 1));
    const span = Math.max(1, h - inner + 1);
    ctx.rect(cx + h - span + 1, cy + dy, span, 1);
    ctx.rect(cx - h, cy + dy, span, 1);
  }
  ctx.fill();
}

function wedge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, fill: string): void {
  if (r < 0.5) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, a0, a1);
  ctx.closePath();
  ctx.fill();
}

function bandPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  len: number,
  w: number,
  k: number,
): void {
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * w;
  const ny = ux * w;
  const ex = x + dx * k;
  const ey = y + dy * k;
  ctx.beginPath();
  ctx.moveTo(x + nx, y + ny);
  ctx.lineTo(ex + nx, ey + ny);
  ctx.lineTo(ex - nx, ey - ny);
  ctx.lineTo(x - nx, y - ny);
  ctx.closePath();
}

function band(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  len: number,
  w: number,
  k: number,
  fill: string,
): void {
  if (k <= 0) return;
  bandPath(ctx, x, y, dx, dy, len, w, k);
  ctx.fillStyle = fill;
  ctx.fill();
}
