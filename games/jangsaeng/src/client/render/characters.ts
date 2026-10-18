// Character sprites: paper-doll humanoids (humanoid.ts + costumes.ts) and
// quadrupeds (beasts.ts), compiled lazily per frame into cropped surfaces.
//
// Conventions
// - (x, y) passed to drawCharacter is the world-pixel ground point under the
//   feet (centre). Humanoid bodies are 16 × 24 px with the head overlapping
//   the tile above; weapons, plumes and flags may extend beyond that box.
// - Left-facing frames are mirrors of right-facing ones.
// - animTimeMs is time since the animation started. idle/walk loop; attack,
//   shoot, cast, hurt and dead play once and hold their last frame
//   (see animDurationMs). Offset idle time per entity to desynchronise.

import {
  CHARACTER_SPRITES,
  type Anim,
  type BodyVariant,
  type CharacterSprite,
  type Dir,
} from "../../shared/sprites.ts";
import { BEAST_FRAMES, renderBeast, type BeastKind } from "./beasts.ts";
import { weaponClassOf, type CostumeSpec, type WeaponClass } from "./costume-types.ts";
import { COSTUMES } from "./costumes.ts";
import { ANCHOR_X, ANCHOR_Y, measureHeight, renderHumanoid, resolveCostume } from "./humanoid.ts";
import type { View } from "./humanoid-head.ts";
import { ANIM_FRAMES, ANIM_LOOPS } from "./humanoid-pose.ts";
import { createSurface, mirrorSurface, SurfaceCache, type Surface } from "./pixel.ts";
import type { PixGrid } from "./pixgrid.ts";

type CharacterDef =
  | { kind: "humanoid"; costume: CostumeSpec; shadow: number }
  | { kind: "beast"; beast: BeastKind; shadow: number };

const humanoid = (key: keyof typeof COSTUMES): CharacterDef => {
  const costume = COSTUMES[key];
  const build = costume.build ?? "normal";
  return { kind: "humanoid", costume, shadow: build === "large" ? 14 : build === "child" ? 9 : 12 };
};

/** Registry: every CharacterSprite must be drawable (enforced by the type). */
const DEFS: Record<CharacterSprite, CharacterDef> = {
  hero_youth: humanoid("hero_youth"),
  hero_goryeo_officer: humanoid("hero_goryeo_officer"),
  hero_joseon_general: humanoid("hero_joseon_general"),
  hero_official: humanoid("hero_official"),
  hero_disguise: humanoid("hero_disguise"),
  hero_hermit: humanoid("hero_hermit"),
  hero_modern: humanoid("hero_modern"),
  hero_righteous: humanoid("hero_righteous"),
  king_goryeo: humanoid("king_goryeo"),
  king_joseon: humanoid("king_joseon"),
  emperor_korea: humanoid("emperor_korea"),
  queen: humanoid("queen"),
  prince: humanoid("prince"),
  official_red: humanoid("official_red"),
  official_blue: humanoid("official_blue"),
  official_green: humanoid("official_green"),
  scholar: humanoid("scholar"),
  commoner_m: humanoid("commoner_m"),
  commoner_f: humanoid("commoner_f"),
  farmer: humanoid("farmer"),
  merchant: humanoid("merchant"),
  innkeeper: humanoid("innkeeper"),
  monk: humanoid("monk"),
  elder: humanoid("elder"),
  child: humanoid("child"),
  messenger: humanoid("messenger"),
  physician: humanoid("physician"),
  reformer: humanoid("reformer"),
  western_envoy: humanoid("western_envoy"),
  japanese_envoy: humanoid("japanese_envoy"),
  qing_envoy: humanoid("qing_envoy"),
  general_goryeo: humanoid("general_goryeo"),
  general_joseon: humanoid("general_joseon"),
  admiral: humanoid("admiral"),
  soldier_goryeo: humanoid("soldier_goryeo"),
  soldier_joseon: humanoid("soldier_joseon"),
  archer_joseon: humanoid("archer_joseon"),
  navy_joseon: humanoid("navy_joseon"),
  monk_soldier: humanoid("monk_soldier"),
  musketeer_joseon: humanoid("musketeer_joseon"),
  righteous_army: humanoid("righteous_army"),
  donghak_peasant: humanoid("donghak_peasant"),
  soldier_empire: humanoid("soldier_empire"),
  ming_soldier: humanoid("ming_soldier"),
  wokou: humanoid("wokou"),
  wokou_captain: humanoid("wokou_captain"),
  red_turban: humanoid("red_turban"),
  jurchen: humanoid("jurchen"),
  jurchen_chief: humanoid("jurchen_chief"),
  japanese_ashigaru: humanoid("japanese_ashigaru"),
  japanese_samurai: humanoid("japanese_samurai"),
  japanese_general: humanoid("japanese_general"),
  qing_soldier: humanoid("qing_soldier"),
  qing_general: humanoid("qing_general"),
  bandit: humanoid("bandit"),
  rebel: humanoid("rebel"),
  assassin: humanoid("assassin"),
  french_marine: humanoid("french_marine"),
  us_marine: humanoid("us_marine"),
  japanese_modern: humanoid("japanese_modern"),
  ronin: humanoid("ronin"),
  tiger: { kind: "beast", beast: "tiger", shadow: 22 },
  wolf: { kind: "beast", beast: "wolf", shadow: 16 },
  boar: { kind: "beast", beast: "boar", shadow: 17 },
  bear: { kind: "beast", beast: "bear", shadow: 19 },
};

const ANIMS: readonly Anim[] = ["idle", "walk", "attack", "shoot", "cast", "hurt", "dead"];
const DIRS: readonly Dir[] = ["down", "up", "left", "right"];
const KEY_INDEX = new Map<CharacterSprite, number>(CHARACTER_SPRITES.map((k, i) => [k, i]));

function framesOf(def: CharacterDef, anim: Anim): readonly number[] {
  return def.kind === "beast" ? BEAST_FRAMES[anim] : ANIM_FRAMES[anim];
}

/** Total length of one play of an animation (ms) for a sprite. */
export function animDurationMs(key: CharacterSprite, anim: Anim): number {
  return framesOf(DEFS[key], anim).reduce((a, b) => a + b, 0);
}

/** Whether an animation loops (idle, walk) or holds its last frame. */
export function animLoops(anim: Anim): boolean {
  return ANIM_LOOPS[anim];
}

function frameIndex(durations: readonly number[], anim: Anim, t: number): number {
  let total = 0;
  for (const d of durations) total += d;
  let time = t < 0 ? 0 : t;
  if (ANIM_LOOPS[anim]) time %= total;
  else if (time >= total) return durations.length - 1;
  for (let i = 0; i < durations.length; i++) {
    time -= durations[i] as number;
    if (time < 0) return i;
  }
  return durations.length - 1;
}

export function supportsVariant(key: CharacterSprite): boolean {
  const def = DEFS[key];
  return def.kind === "humanoid" && !!def.costume.female;
}

export function characterWeapon(key: CharacterSprite): WeaponClass {
  const def = DEFS[key];
  return def.kind === "beast" ? "claw" : weaponClassOf(def.costume.weapon);
}

const heights = new Map<CharacterSprite, number>();

/** Pixels from the ground point to the top of the sprite (hat included). */
export function characterHeight(key: CharacterSprite): number {
  let h = heights.get(key);
  if (h === undefined) {
    const def = DEFS[key];
    // Head/hat top in the idle pose; back items (flags, banners) and raised
    // weapons are ignored so name plates hug the head consistently.
    h =
      def.kind === "beast"
        ? Math.max(...(["down", "up", "right"] as const).map((v) => measureHeight(renderBeast(def.beast, v, "idle", 0))))
        : measureHeight(renderHumanoid({ ...def.costume, back: undefined, weapon: "none" }, "down", "idle", 0, 0));
    heights.set(key, h);
  }
  return h;
}

interface Frame {
  surface: Surface;
  /** Offset from the ground point to the surface's top-left. */
  dx: number;
  dy: number;
}

const surfaces = new SurfaceCache();
const frames = new Map<number, Frame>();

function cropToFrame(grid: PixGrid, cacheKey: string): Frame {
  const b = grid.bounds() ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const surface = surfaces.get(cacheKey, () => grid.toSurface(b));
  return { surface, dx: b.x0 - ANCHOR_X, dy: b.y0 - ANCHOR_Y };
}

function buildFrame(
  key: CharacterSprite,
  variant: BodyVariant,
  dir: Dir,
  anim: Anim,
  index: number,
): Frame {
  const name = `${key}|${variant}|${dir}|${anim}|${index}`;
  if (dir === "left") {
    const right = getFrame(key, variant, "right", anim, index);
    const surface = surfaces.get(name, () => mirrorSurface(right.surface));
    // Mirror about the ground point: x → -x.
    return { surface, dx: -(right.dx + right.surface.width), dy: right.dy };
  }
  const def = DEFS[key];
  const view = dir as View;
  const grid =
    def.kind === "beast"
      ? renderBeast(def.beast, view, anim, index)
      : renderHumanoid(resolveCostume(def.costume, variant), view, anim, index, index);
  return cropToFrame(grid, name);
}

function getFrame(
  key: CharacterSprite,
  variant: BodyVariant,
  dir: Dir,
  anim: Anim,
  index: number,
): Frame {
  const id =
    (((((KEY_INDEX.get(key) ?? 0) * 2 + (variant === "f" ? 1 : 0)) * 4 + DIRS.indexOf(dir)) * 8 +
      ANIMS.indexOf(anim)) *
      8) +
    index;
  let frame = frames.get(id);
  if (!frame) {
    frame = buildFrame(key, variant, dir, anim, index);
    frames.set(id, frame);
  }
  return frame;
}

function variantOf(key: CharacterSprite, requested: BodyVariant | undefined): BodyVariant {
  const def = DEFS[key];
  if (def.kind !== "humanoid") return "m";
  const base = def.costume.defaultVariant ?? "m";
  if (!def.costume.female) return "m";
  return requested ?? base;
}

// Shadows and flash scratch -------------------------------------------------

const shadows = new Map<number, Surface>();

function shadowSurface(width: number): Surface {
  let s = shadows.get(width);
  if (!s) {
    const h = width >= 16 ? 5 : 4;
    s = createSurface(width, h);
    const ctx = s.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "rgba(20, 14, 20, 0.28)";
      for (let y = 0; y < h; y++) {
        const t = (y + 0.5 - h / 2) / (h / 2);
        const half = Math.round((width / 2) * Math.sqrt(Math.max(0, 1 - t * t)));
        ctx.fillRect(width / 2 - half, y, half * 2, 1);
      }
    }
    shadows.set(width, s);
  }
  return s;
}

let flashCanvas: Surface | null = null;
let flashCtx: CanvasRenderingContext2D | null = null;

function flashOf(frame: Frame, color: string): Surface | null {
  const w = frame.surface.width;
  const h = frame.surface.height;
  if (!flashCanvas || flashCanvas.width < w || flashCanvas.height < h) {
    flashCanvas = createSurface(Math.max(w, 64), Math.max(h, 64));
    flashCtx = flashCanvas.getContext("2d");
  }
  const ctx = flashCtx;
  if (!ctx) return null;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w + 1, h + 1);
  ctx.drawImage(frame.surface, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return flashCanvas;
}

export interface DrawCharacterOptions {
  variant?: BodyVariant;
  /** Solid tint drawn over the sprite (hit flash); may be translucent. */
  flash?: string;
  alpha?: number;
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  key: CharacterSprite,
  x: number,
  y: number,
  dir: Dir,
  anim: Anim,
  animTimeMs: number,
  opts?: DrawCharacterOptions,
): void {
  const def = DEFS[key];
  const variant = variantOf(key, opts?.variant);
  const index = frameIndex(framesOf(def, anim), anim, animTimeMs);
  const frame = getFrame(key, variant, dir, anim, index);
  const gx = Math.round(x);
  const gy = Math.round(y);
  const alpha = opts?.alpha ?? 1;
  const prevAlpha = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;
  const lying = anim === "dead" && index === framesOf(def, anim).length - 1;
  const sw = lying ? def.shadow + 8 : def.shadow;
  const shadow = shadowSurface(sw);
  ctx.drawImage(shadow, gx - (sw >> 1), gy - (shadow.height >> 1) - (lying ? 3 : 0));
  ctx.drawImage(frame.surface, gx + frame.dx, gy + frame.dy);
  if (opts?.flash) {
    const tint = flashOf(frame, opts.flash);
    if (tint)
      ctx.drawImage(
        tint,
        0,
        0,
        frame.surface.width,
        frame.surface.height,
        gx + frame.dx,
        gy + frame.dy,
        frame.surface.width,
        frame.surface.height,
      );
  }
  if (alpha !== 1) ctx.globalAlpha = prevAlpha;
}

/** Number of compiled frame surfaces (for diagnostics). */
export function characterCacheSize(): number {
  return surfaces.size;
}

/** Total pixels held by compiled frames (×4 bytes for the backing store). */
export function characterCachePixels(): number {
  let n = 0;
  for (const f of frames.values()) n += f.surface.width * f.surface.height;
  return n;
}

/** Pre-builds every frame of a sprite (e.g. during a loading screen). */
export function warmCharacter(key: CharacterSprite, variant?: BodyVariant): void {
  const v = variantOf(key, variant);
  const def = DEFS[key];
  for (const dir of DIRS)
    for (const anim of ANIMS)
      for (let i = 0; i < framesOf(def, anim).length; i++) getFrame(key, v, dir, anim, i);
}
