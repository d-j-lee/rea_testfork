// Pixel-art portraits and sprite previews drawn with the game's own character
// renderer, so the UI shows exactly the sprite the world will show.
import type { Anim, BodyVariant, CharacterSprite, Dir } from "../../shared/sprites.ts";
import { isCharacterSprite } from "../../shared/sprites.ts";
import { drawCharacter } from "../render/characters.ts";
import { h, prefersReducedMotion } from "./dom.ts";

export interface SpriteOptions {
  variant?: BodyVariant;
  /** Logical (sprite-pixel) viewport. */
  w: number;
  h: number;
  /** Ground point in the logical viewport. */
  footX?: number;
  footY: number;
  scale: number;
  dir?: Dir;
  anim?: Anim;
  animate?: boolean;
  class?: string;
}

export interface SpriteView {
  canvas: HTMLCanvasElement;
  set(key: CharacterSprite, variant?: BodyVariant): void;
}

export function spriteView(key: CharacterSprite | string | undefined, opts: SpriteOptions): SpriteView {
  const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const canvas = h("canvas", { class: `sprite ${opts.class ?? ""}`, "aria-hidden": "true" });
  canvas.width = opts.w * opts.scale * dpr;
  canvas.height = opts.h * opts.scale * dpr;
  canvas.style.width = `${opts.w * opts.scale}px`;
  canvas.style.height = `${opts.h * opts.scale}px`;
  const ctx = canvas.getContext("2d");
  let sprite: CharacterSprite | null = key && isCharacterSprite(key) ? key : null;
  let variant = opts.variant;
  const start = performance.now();
  let raf = 0;
  const draw = (now: number) => {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(opts.scale * dpr, 0, 0, opts.scale * dpr, 0, 0);
    try {
      drawCharacter(ctx, sprite, opts.footX ?? opts.w / 2, opts.footY, opts.dir ?? "down", opts.anim ?? "idle", now - start, {
        variant,
      });
    } catch {
      /* unknown sprite: leave the frame empty */
    }
  };
  const loop = (now: number) => {
    raf = 0;
    if (!canvas.isConnected) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (opts.animate && !prefersReducedMotion()) {
      if (!raf) raf = requestAnimationFrame(loop);
    } else {
      // Drawn once the canvas is attached (first frame after insertion).
      requestAnimationFrame((now) => draw(now));
    }
  };
  kick();
  return {
    canvas,
    set(next, nextVariant) {
      sprite = next;
      variant = nextVariant;
      if (raf) return;
      kick();
    },
  };
}

/** Head-and-shoulders portrait for dialogs and the character sheet. */
export function portrait(key: CharacterSprite | string | undefined, variant?: BodyVariant, scale = 3): HTMLCanvasElement {
  return spriteView(key, { variant, w: 20, h: 20, footY: 30, scale, class: "portrait" }).canvas;
}
