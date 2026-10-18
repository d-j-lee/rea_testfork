// Scene composition for one frame: ground, depth-sorted structures +
// characters + props, atmosphere, then the readable layer (telegraphs,
// arena ring, effects, name plates, markers) and screen-space cues.

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
import { drawAtmosphere, type AtmosphereOptions } from "../render/lighting.ts";
import { drawEmote, drawHpBar, drawNamePlate, drawSelectionRing } from "../render/overlays.ts";
import { TEAM_COLORS } from "../render/palette.ts";
import { drawProp, propHeight } from "../render/props.ts";
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
import type { EntityStore, EntityTrack } from "./snapshots.ts";

const DISSOLVE_MS = 450;
const DISSOLVE_BOSS_MS = 620;
const HIT_FLASH = "rgba(255,255,255,0.72)";
/** Precomputed ink tints (avoid building colour strings per frame). */
const INK_TINTS: readonly string[] = Array.from({ length: 11 }, (_, i) => `rgba(29,26,25,${(i / 10).toFixed(2)})`);
const VIEW_MARGIN = 40;

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

class EntityView implements Drawable {
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

const teamColor = (tm: Team): string => TEAM_COLORS[tm] ?? TEAM_COLORS.npc;

export class Scene {
  readonly world: WorldRenderer;
  readonly effects = new EffectSystem();
  readonly seals = new SealStamps();
  readonly ink = new InkDissolve();
  readonly vignette = new HurtVignette();
  readonly #views = new Map<number, EntityView>();
  readonly #drawables: Drawable[] = [];
  readonly #visible: EntityView[] = [];
  readonly #atmosphere: AtmosphereOptions = { hour: 12, weather: "clear", timeMs: 0, pixelScale: 1 };
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
    for (const d of this.world.structureDrawables(cam, t)) list.push(d);
    for (const v of this.#visible) list.push(v);
    list.sort(this.#byDepth);
    for (const d of list) d.draw(ctx, t);
    // X-ray: when a roof or wall hides the player, show them through it.
    if (selfView?.visible && selfView.character && this.#occluded(selfView, list)) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * 0.45;
      selfView.draw(ctx, t);
      ctx.globalAlpha = prev;
    }
    this.ink.update(f.visualDt);
    this.ink.draw(ctx, t);

    // ── Atmosphere (screen space) ───────────────────────────────────────
    const chapter = f.chapter;
    const atmo = this.#atmosphere;
    atmo.hour = chapter?.hour ?? 12;
    atmo.weather = chapter?.weather ?? "clear";
    atmo.timeMs = t;
    atmo.pixelScale = cam.scale;
    drawAtmosphere(ctx, cam.width, cam.height, atmo);

    // ── Readable layer (world space, above the grade) ───────────────────
    applyCamera(ctx, cam);
    const battle = f.self?.battle;
    if (battle) drawBattleRing(ctx, battle, view, f.now);
    f.fx.drawTelegraphs(ctx, f.now);
    for (const v of this.#visible) if (v.track.down && v.character) drawDownedRing(ctx, v.wx, v.wy, f.now);
    this.effects.update(f.visualDt);
    this.effects.draw(ctx, t);
    this.#drawPlates(ctx, f, t);
    this.seals.update(f.visualDt);
    this.seals.draw(ctx);
    const objectives = f.self?.objectives;
    if (objectives)
      for (const o of objectives)
        if (objectiveVisible(o)) drawObjectiveMarker(ctx, o, f.now, this.#anchorTop(o.x as number, o.y as number));

    // ── Screen-space cues ───────────────────────────────────────────────
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (objectives) for (const o of objectives) if (objectiveVisible(o)) drawObjectiveArrow(ctx, f.rig, o, f.unit, f.now);
    this.vignette.draw(ctx, cam.width, cam.height, f.now);
  }

  /** True when a structure drawn after `v` overlaps its sprite box. */
  #occluded(v: EntityView, list: readonly Drawable[]): boolean {
    const x0 = v.wx - 7;
    const x1 = v.wx + 7;
    const y1 = v.wy - 2;
    const y0 = v.wy - 22;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i] as Drawable & { bounds?: { x0: number; y0: number; x1: number; y1: number } };
      if (d.sortY <= v.sortY) break;
      const b = d.bounds;
      if (b && b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0) return true;
    }
    return false;
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

  #drawPlates(ctx: CanvasRenderingContext2D, f: SceneFrame, t: number): void {
    const s = f.rig.camera.scale;
    const mult = s >= 5 ? 2 : 1;
    const selfId = f.store.selfId;
    for (const v of this.#visible) {
      const track = v.track;
      const snap = track.snap;
      if (v.dissolve > 0.15 || v.alpha < 0.5) continue;
      if (v.prop) {
        if (track.mk) drawEmote(ctx, track.mk, v.wx, v.wy - propHeight(v.prop) - 2, t);
        continue;
      }
      if (!v.character) continue;
      const lying = v.lying;
      const tm = snap.tm;
      const isSelf = track.id === selfId;
      const boss = tm === "boss";
      let y = v.wy - (lying ? 10 : characterHeight(v.character)) - 1;
      v.top = y;
      if (track.down) y -= 18 / s; // above the 사경 label
      const hp = Math.max(0, Math.min(100, track.hp));
      const showHp = !isSelf && !lying && (boss || tm === "enemy" || hp < 100);
      if (showHp) {
        drawHpBar(ctx, v.wx, y - 3, hp / 100, { width: boss ? 26 : 14, color: boss ? "#e0503a" : undefined });
        y -= 5;
      }
      if (snap.n) {
        const small = !boss && tm !== "self" && tm !== "player";
        const title = snap.title ?? (snap.hist ? "역사 인물" : undefined);
        drawNamePlate(ctx, snap.n, v.wx, y, { color: teamColor(tm), title, level: snap.lvl, small });
        y -= (((small ? 11 : 12) + 6 + (title ? 13 : 0)) * mult) / s;
      }
      if (track.mk) {
        drawEmote(ctx, track.mk, v.wx, y - 1, t);
        y -= 14;
      }
      v.top = y;
    }
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

  /** Canvas position of an entity (for the player-screen contract). */
  screenOf(id: number, rig: CameraRig): { x: number; y: number } | null {
    const v = this.#views.get(id);
    if (!v) return null;
    return { x: rig.screenX(v.wx), y: rig.screenY(v.wy - 12) };
  }
}
