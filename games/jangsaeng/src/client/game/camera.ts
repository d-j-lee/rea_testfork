// Camera rig: integer device scale from the viewport, smooth follow with a
// short look-ahead toward facing/aim, and directional screen shake. Works in
// world pixels; applyCamera (render/world.ts) does the final pixel snapping.

import type { Camera } from "../render/types.ts";

/** Per-frame (60 Hz) follow factor; scaled for the real frame time. */
const FOLLOW_PER_FRAME = 0.15;
const LOOK_AHEAD_PX = 16;
/** Per-frame shake decay at 60 Hz. */
const SHAKE_DECAY = 0.85;
const SHAKE_MAX = 6;
const FRAME_MS = 1000 / 60;

/** World→CSS scale for a viewport: ≈ min(w, h) / 220, clamped 2..4, plus zoom. */
export function cssScaleFor(cssW: number, cssH: number, zoom: number): number {
  const base = Math.min(4, Math.max(2, Math.round(Math.min(cssW, cssH) / 220)));
  return Math.min(6, Math.max(1, base + zoom));
}

export class CameraRig {
  readonly camera: Camera = { x: 0, y: 0, scale: 3, width: 1, height: 1 };
  #fx = 0;
  #fy = 0;
  #lookX = 0;
  #lookY = 0;
  #placed = false;
  #shake = 0;
  #shakeX = 0;
  #shakeY = 0;
  #shakeT = 0;

  get placed(): boolean {
    return this.#placed;
  }

  resize(width: number, height: number, scale: number): void {
    this.camera.width = width;
    this.camera.height = height;
    this.camera.scale = scale;
  }

  /** Jumps to a point (spawn, teleport, chapter change). */
  snapTo(x: number, y: number): void {
    this.#fx = x;
    this.#fy = y;
    this.#lookX = 0;
    this.#lookY = 0;
    this.#placed = true;
    this.camera.x = x;
    this.camera.y = y;
  }

  unplace(): void {
    this.#placed = false;
  }

  /**
   * Follows a world point. (dirX, dirY) is a unit-ish facing/aim vector
   * for the look-ahead; pass zeros for none.
   */
  follow(x: number, y: number, dirX: number, dirY: number, dtMs: number): void {
    if (!this.#placed) {
      this.snapTo(x, y);
      return;
    }
    const k = 1 - Math.pow(1 - FOLLOW_PER_FRAME, Math.min(dtMs, 100) / FRAME_MS);
    const len = Math.hypot(dirX, dirY);
    const lx = len > 1e-3 ? (dirX / len) * LOOK_AHEAD_PX : 0;
    const ly = len > 1e-3 ? (dirY / len) * LOOK_AHEAD_PX : 0;
    // The look-ahead eases on its own so turning does not whip the view.
    const kl = k * 0.5;
    this.#lookX += (lx - this.#lookX) * kl;
    this.#lookY += (ly - this.#lookY) * kl;
    this.#fx += (x + this.#lookX - this.#fx) * k;
    this.#fy += (y + this.#lookY - this.#fy) * k;
  }

  /** Adds shake (world px); (dirX, dirY) biases it toward the hit direction. */
  addShake(power: number, dirX = 0, dirY = 0): void {
    if (!(power > 0)) return;
    const p = Math.min(SHAKE_MAX, power);
    if (p >= this.#shake * 0.6) {
      const len = Math.hypot(dirX, dirY);
      this.#shakeX = len > 1e-3 ? dirX / len : 0;
      this.#shakeY = len > 1e-3 ? dirY / len : 0;
      this.#shakeT = 0;
    }
    this.#shake = Math.min(SHAKE_MAX, Math.max(this.#shake, p));
  }

  /** Advances shake and writes the final camera centre. */
  update(dtMs: number): void {
    let ox = 0;
    let oy = 0;
    if (this.#shake > 0.05) {
      this.#shakeT += dtMs;
      const a = this.#shake;
      // Directional kick that rings out, plus a little noise across it.
      const ring = Math.cos(this.#shakeT * 0.055);
      const n1 = Math.sin(this.#shakeT * 0.131 + 1.7);
      const n2 = Math.sin(this.#shakeT * 0.097 + 4.1);
      if (this.#shakeX || this.#shakeY) {
        ox = this.#shakeX * a * ring * 0.8 + n1 * a * 0.3;
        oy = this.#shakeY * a * ring * 0.8 + n2 * a * 0.3;
      } else {
        ox = n1 * a;
        oy = n2 * a;
      }
      this.#shake *= Math.pow(SHAKE_DECAY, Math.min(dtMs, 100) / FRAME_MS);
    } else this.#shake = 0;
    this.camera.x = this.#fx + ox;
    this.camera.y = this.#fy + oy;
  }

  /** Canvas pixel x of a world x (matches applyCamera's rounding). */
  screenX(wx: number): number {
    const s = this.camera.scale;
    return wx * s + Math.round(this.camera.width / 2 - this.camera.x * s);
  }

  screenY(wy: number): number {
    const s = this.camera.scale;
    return wy * s + Math.round(this.camera.height / 2 - this.camera.y * s);
  }
}
