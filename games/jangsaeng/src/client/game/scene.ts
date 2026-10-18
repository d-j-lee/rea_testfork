// Scene composition for one frame: ground, depth-sorted structures +
// characters + props (structures over a fighter fade), atmosphere, then the
// readable layer (telegraphs, arena ring, effects, crit seals, name plates,
// markers) and screen-space cues.

import type { GameMap } from "../../shared/map/generate.ts";
import {
  isCharacterSprite,
  isPropSprite,
  TILE_PX,
  type CharacterSprite,
  type PropSprite,
} from "../../shared/sprites.ts";
import type { ChapterView, SelfView, Team } from "../../shared/types.ts";
import { characterHeight, drawCharacter, type DrawCharacterOptions } from "../render/characters.ts";
import { EffectSystem } from "../render/effects.ts";
import { drawAtmosphere, type AtmosphereOptions, type Weather } from "../render/lighting.ts";
import { drawSelectionRing } from "../render/overlays.ts";
import { TEAM_COLORS } from "../render/palette.ts";
import { drawProp } from "../render/props.ts";
import type { StructureDrawable } from "../render/structures.ts";
import type { Drawable } from "../render/types.ts";
import { applyCamera, worldViewOf, WorldRenderer } from "../render/world.ts";
import type { CameraRig } from "./camera.ts";
import { dissolveAlpha, dissolveTint, HurtVignette, InkDissolve, SealStamps } from "./flourish.ts";
import type { FxRouter } from "./fx.ts";
import {
  drawBattleRing,
  drawDownedRing,
  drawObjectiveArrow,
  drawObjectiveMarker,
  objectiveVisible,
} from "./markers.ts";
import { PlateLayer, type PlateSubject } from "./plates.ts";
import type { EntityStore, EntityTrack } from "./snapshots.ts";

const DISSOLVE_MS = 450;
const DISSOLVE_BOSS_MS = 620;
const HIT_FLASH = "rgba(255,255,255,0.72)";
/** Precomputed ink tints (avoid building colour strings per frame). */
const INK_TINTS: readonly string[] = Array.from({ length: 11 }, (_, i) => `rgba(29,26,25,${(i / 10).toFixed(2)})`);
const VIEW_MARGIN = 40;
/** A battle's sky reaches this many tiles beyond its ring (about half a screen)… */
const BATTLE_SKY = 12;
/** …thinning out over the last this many tiles of that reach… */
const SKY_EDGE = 6;
/** …and it takes this long (ms) to turn the sky in or out, as a battle starts or ends. */
const SKY_FADE_MS = 1500;
/** A roof, gate or wall drawn over someone standing behind it fades to this… */
const COVER_ALPHA = 0.3;
/** …over this long (ms), and comes back as they step out. */
const COVER_FADE_MS = 180;
/** Whom structures give way to: everyone who plays or fights (villagers may walk behind houses). */
const REVEALED: ReadonlySet<Team> = new Set<Team>(["self", "player", "ally", "enemy", "boss"]);

/** What the atmosphere pass draws: an hour of the day and a weather. */
interface Sky {
  hour: number;
  weather: Weather;
}

/**
 * The hour `k` of the way from `from` to `to`, the short way round the clock;
 * half a day apart, the way through the night (a dusk chapter darkens into a
 * dawn battle, and brightens back the same way).
 */
function mixHour(from: number, to: number, k: number): number {
  let d = (((to - from) % 24) + 24) % 24;
  if (d > 12 || (d === 12 && (from + 6) % 24 >= 6 && (from + 6) % 24 < 18)) d -= 24;
  return (((from + d * k) % 24) + 24) % 24;
}

/**
 * Draws the sky `mix` (0–1) of the way from `base` (the chapter's) to
 * `battle` (a battle's own) into `atmo`'s pass: the hour mixes the short way
 * round, and two weathers cross-fade — the light of the mixed hour once,
 * then each weather's layers at its share (drawn at noon, whose grade is
 * close to neutral).
 */
function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, atmo: AtmosphereOptions, base: Sky, battle: Sky | null, mix: number): void {
  const k = battle ? Math.max(0, Math.min(1, mix)) : 0;
  const sky = battle && k >= 1 ? battle : base;
  atmo.intensity = 1;
  atmo.hour = battle && k > 0 && k < 1 ? mixHour(base.hour, battle.hour, k) : sky.hour;
  if (!battle || k <= 0 || k >= 1 || battle.weather === base.weather) {
    atmo.weather = sky.weather;
    drawAtmosphere(ctx, width, height, atmo);
    return;
  }
  atmo.weather = "clear";
  drawAtmosphere(ctx, width, height, atmo);
  atmo.hour = 12;
  for (const [weather, share] of [[base.weather, 1 - k], [battle.weather, k]] as const) {
    atmo.weather = weather;
    atmo.intensity = share;
    drawAtmosphere(ctx, width, height, atmo);
  }
  atmo.intensity = 1;
}

export interface SceneFrame {
  /** Real client time (ms). */
  now: number;
  /** Hitstop-adjusted time for animation (ms). */
  visualNow: number;
  visualDt: number;
  store: EntityStore;
  rig: CameraRig;
  fx: FxRouter;
  self: SelfView | null;
  chapter: ChapterView | null;
  /** Canvas pixels per CSS pixel. */
  unit: number;
}

class EntityView implements Drawable, PlateSubject {
  sortY = 0;
  readonly track: EntityTrack;
  #spriteOf = "";
  character: CharacterSprite | null = null;
  prop: PropSprite | null = null;
  wx = 0;
  wy = 0;
  visible = false;
  /** Death dissolve progress (enemies only), -1 when alive. */
  dissolve = -1;
  inked = false;
  scale = 1;
  readonly opts: DrawCharacterOptions = {};
  flash: string | undefined = undefined;
  alpha = 1;
  /** World y of the top of the overlay stack (plates, bars) this frame. */
  top = 0;

  constructor(track: EntityTrack) {
    this.track = track;
  }

  resolve(): void {
    const s = this.track.snap.s;
    if (s === this.#spriteOf) return;
    this.#spriteOf = s;
    this.character = isCharacterSprite(s) ? s : null;
    this.prop = !this.character && isPropSprite(s) ? s : null;
  }

  get lying(): boolean {
    return this.track.down || this.track.anim === "dead";
  }

  draw(ctx: CanvasRenderingContext2D, timeMs: number): void {
    const t = this.track;
    // Sub-world-pixel placement on the device grid: smooth motion while
    // the sprite itself stays on whole pixels.
    const ix = Math.round(this.wx);
    const iy = Math.round(this.wy);
    const dx = this.wx - ix;
    const dy = this.wy - iy;
    if (dx || dy) ctx.translate(dx, dy);
    if (this.prop) {
      const prev = ctx.globalAlpha;
      if (this.alpha < 1) ctx.globalAlpha = prev * this.alpha;
      drawProp(ctx, this.prop, ix, iy, timeMs);
      ctx.globalAlpha = prev;
    } else if (this.character) {
      const o = this.opts;
      o.variant = t.snap.v;
      o.flash = this.flash;
      o.alpha = this.alpha;
      const anim = t.down ? "dead" : t.anim;
      const animTime = t.down ? 1e6 : t.animTime;
      drawCharacter(ctx, this.character, ix, iy, t.dir, anim, animTime, o);
    }
    if (dx || dy) ctx.translate(-dx, -dy);
  }
}

export class Scene {
  readonly world: WorldRenderer;
  readonly effects = new EffectSystem();
  readonly seals = new SealStamps();
  readonly ink = new InkDissolve();
  readonly vignette = new HurtVignette();
  readonly #views = new Map<number, EntityView>();
  readonly #drawables: Drawable[] = [];
  readonly #visible: EntityView[] = [];
  readonly #plates = new PlateLayer();
  readonly #atmosphere: AtmosphereOptions = { hour: 12, weather: "clear", timeMs: 0, pixelScale: 1 };
  /** The last battle's own sky (kept while it fades out after the battle ends) and how much of it shows, 0–1. */
  #battleSky: Sky | null = null;
  #skyMix = 0;
  /** Alpha of each visible structure fading over someone (absent = opaque); two maps swapped per frame. */
  #covers = new Map<Drawable, number>();
  #coversNext = new Map<Drawable, number>();
  /** Revealed characters' sprite boxes this frame: x0, y0, x1, y1, sortY. */
  readonly #boxes: number[] = [];
  #byDepth = (a: Drawable, b: Drawable) => a.sortY - b.sortY;

  constructor(map: GameMap) {
    this.world = new WorldRenderer(map);
  }

  clear(): void {
    this.#views.clear();
    this.effects.clear();
  }

  draw(ctx: CanvasRenderingContext2D, f: SceneFrame): void {
    const cam = f.rig.camera;
    const t = f.visualNow;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1f4a75";
    ctx.fillRect(0, 0, cam.width, cam.height);

    // ── World ────────────────────────────────────────────────────────────
    applyCamera(ctx, cam);
    const view = worldViewOf(cam);
    this.world.drawGround(ctx, cam, t);
    this.#prepareViews(f, view);
    const selfView = this.#views.get(f.store.selfId);
    if (selfView?.visible && !selfView.lying) drawSelectionRing(ctx, selfView.wx, selfView.wy, TEAM_COLORS.self, t);
    const list = this.#drawables;
    list.length = 0;
    const structures = this.world.structureDrawables(cam, t);
    this.#fadeCovers(structures, f.visualDt);
    for (const d of structures) list.push(d);
    for (const v of this.#visible) list.push(v);
    list.sort(this.#byDepth);
    const covers = this.#covers;
    for (const d of list) {
      const alpha = covers.get(d);
      if (alpha === undefined) d.draw(ctx, t);
      else {
        const prev = ctx.globalAlpha;
        ctx.globalAlpha = prev * alpha;
        d.draw(ctx, t);
        ctx.globalAlpha = prev;
      }
    }
    this.ink.update(f.visualDt);
    this.ink.draw(ctx, t);

    // ── Atmosphere (screen space) ───────────────────────────────────────
    this.#drawSky(ctx, f, t);

    // ── Readable layer (world space, above the grade) ───────────────────
    applyCamera(ctx, cam);
    const battle = f.self?.battle;
    if (battle) drawBattleRing(ctx, battle, view, f.now);
    f.fx.drawTelegraphs(ctx, f.now);
    for (const v of this.#visible) if (v.track.down && v.character) drawDownedRing(ctx, v.wx, v.wy, f.now, f.unit);
    this.effects.update(f.visualDt);
    this.effects.draw(ctx, t);
    // Crit seals under the name plates: a melee's crits never hide who is who.
    this.seals.update(f.visualDt);
    this.seals.draw(ctx);
    const self = f.store.self;
    this.#plates.draw(ctx, this.#visible, f.store.selfId, self ?? null, cam.scale, f.unit, t);
    const objectives = f.self?.objectives;
    if (objectives)
      for (const o of objectives)
        if (objectiveVisible(o)) drawObjectiveMarker(ctx, o, f.now, this.#anchorTop(o.x as number, o.y as number));

    // ── Screen-space cues ───────────────────────────────────────────────
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (objectives) for (const o of objectives) if (objectiveVisible(o)) drawObjectiveArrow(ctx, f.rig, o, f.unit, f.now);
    this.vignette.draw(ctx, cam.width, cam.height, f.now);
  }

  /**
   * The chapter's sky, or a running battle's own (칠천량's burning dawn) over
   * its arena and the view around it. The battle's sky thins out over the
   * last SKY_EDGE tiles of its reach and turns in and out over SKY_FADE_MS,
   * so neither walking off nor a battle starting or ending switches it at once.
   */
  #drawSky(ctx: CanvasRenderingContext2D, f: SceneFrame, timeMs: number): void {
    const cam = f.rig.camera;
    const base: Sky = { hour: f.chapter?.hour ?? 12, weather: f.chapter?.weather ?? "clear" };
    const ring = f.self?.battle;
    let reach = 0;
    if (ring) {
      this.#battleSky = { hour: ring.hour ?? base.hour, weather: ring.weather ?? base.weather };
      const tiles = Math.hypot(cam.x - ring.x * TILE_PX, cam.y - ring.y * TILE_PX) / TILE_PX;
      reach = Math.max(0, Math.min(1, (ring.radius + BATTLE_SKY - tiles) / SKY_EDGE));
    }
    const step = f.visualDt / SKY_FADE_MS;
    this.#skyMix += Math.max(-step, Math.min(step, reach - this.#skyMix));
    if (this.#skyMix <= 0) this.#battleSky = null;
    const atmo = this.#atmosphere;
    atmo.timeMs = timeMs;
    atmo.pixelScale = cam.scale;
    drawSky(ctx, cam.width, cam.height, atmo, base, this.#battleSky, this.#skyMix);
  }

  /**
   * Structures drawn after someone who plays or fights (they stand behind or
   * under it) and over their sprite fade out, so a roof, gate tower or wall
   * never hides a fight; they come back as the person steps out. Only the
   * covering pieces fade: a wall run opens a window, not the whole town.
   */
  #fadeCovers(structures: readonly StructureDrawable[], dtMs: number): void {
    const boxes = this.#boxes;
    boxes.length = 0;
    for (const v of this.#visible) {
      if (!v.character || v.dissolve >= 0 || !REVEALED.has(v.track.snap.tm)) continue;
      boxes.push(v.wx - 6, v.wy - characterHeight(v.character), v.wx + 6, v.wy - 2, v.sortY);
    }
    const prev = this.#covers;
    const next = this.#coversNext;
    next.clear();
    const step = (dtMs / COVER_FADE_MS) * (1 - COVER_ALPHA);
    for (const d of structures) {
      let covering = false;
      if (boxes.length) {
        const r = d.cover();
        for (let i = 0; i < boxes.length; i += 5) {
          if (d.sortY <= (boxes[i + 4] as number)) continue;
          if (r.x0 < (boxes[i + 2] as number) && r.x1 > (boxes[i] as number) && r.y0 < (boxes[i + 3] as number) && r.y1 > (boxes[i + 1] as number)) {
            covering = true;
            break;
          }
        }
      }
      const was = prev.get(d) ?? 1;
      const alpha = covering ? Math.max(COVER_ALPHA, was - step) : Math.min(1, was + step);
      if (alpha < 1) next.set(d, alpha);
    }
    // Structures that left the view drop out with the swap.
    this.#covers = next;
    this.#coversNext = prev;
  }

  #prepareViews(f: SceneFrame, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const visible = this.#visible;
    visible.length = 0;
    const s = f.rig.camera.scale;
    const x0 = view.x0 - VIEW_MARGIN;
    const x1 = view.x1 + VIEW_MARGIN;
    const y0 = view.y0 - VIEW_MARGIN;
    const y1 = view.y1 + VIEW_MARGIN * 1.5;
    for (const track of f.store.list) {
      let v = this.#views.get(track.id);
      if (!v || v.track !== track) {
        v = new EntityView(track);
        this.#views.set(track.id, v);
      }
      v.resolve();
      v.wx = Math.round(track.x * TILE_PX * s) / s;
      v.wy = Math.round(track.y * TILE_PX * s) / s;
      v.scale = s;
      v.top = v.wy - 30;
      v.visible = v.wx >= x0 && v.wx <= x1 && v.wy >= y0 && v.wy <= y1 && (v.character !== null || v.prop !== null);
      // Enemy deaths dissolve into ink; others just lie down.
      const tm = track.snap.tm;
      const hostile = tm === "enemy" || tm === "boss";
      if (hostile && track.anim === "dead" && !track.down && v.character) {
        const ms = tm === "boss" ? DISSOLVE_BOSS_MS : DISSOLVE_MS;
        v.dissolve = track.animTime / ms;
        if (!v.inked) {
          v.inked = true;
          if (track.animTime < 250 && v.visible)
            this.ink.spawn(v.wx, v.wy, characterHeight(v.character), tm === "boss");
        }
      } else {
        v.dissolve = -1;
        v.inked = false;
      }
      let alpha = track.alpha;
      v.flash = f.now < track.flashUntil ? HIT_FLASH : undefined;
      if (v.dissolve >= 0) {
        alpha *= dissolveAlpha(v.dissolve);
        v.flash = INK_TINTS[Math.min(10, Math.round(dissolveTint(v.dissolve) * 10))];
      }
      v.alpha = alpha;
      if (!v.visible || alpha <= 0.01) continue;
      v.sortY = v.wy;
      visible.push(v);
    }
    if (this.#views.size > f.store.list.length + 16)
      for (const [id, v] of this.#views) if (f.store.tracks.get(id) !== v.track) this.#views.delete(id);
  }

  /** Overlay top of the visible character standing on a tile point, if any. */
  #anchorTop(x: number, y: number): number | null {
    let best: EntityView | null = null;
    let bestD = 1.2 * 1.2;
    for (const v of this.#visible) {
      if (!v.character) continue;
      const dx = v.track.x - x;
      const dy = v.track.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best ? best.top : null;
  }
}
