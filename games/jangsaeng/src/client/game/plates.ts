// Overhead overlays with declutter: HP bars, name plates and emotes. Who a
// plate belongs to and how plates are placed is plate-layout.ts; this layer
// measures, applies the visibility rules and draws. Enemy plates hide when
// far away or in a crowd; companion and ally titles hide when the party is
// large. The player's own plate wears a gold frame, and simulated companions
// carry the ◇ mark here as in chat.

import type { CharacterSprite, PropSprite } from "../../shared/sprites.ts";
import { characterHeight } from "../render/characters.ts";
import {
  drawEmote,
  drawHpBar,
  drawNamePlate,
  measureNamePlate,
  type NamePlateOptions,
} from "../render/overlays.ts";
import { COMPANION_COLOR, SELF_FRAME, TEAM_COLORS } from "../render/palette.ts";
import { propHeight } from "../render/props.ts";
import { botName } from "../ui/labels.ts";
import {
  byPlacement,
  isParty,
  PARTY_TITLES_MAX,
  placePlates,
  plateRole,
  type PlateBox,
  type PlateRole,
} from "./plate-layout.ts";
import type { EntityTrack } from "./snapshots.ts";

/** What the plate layer needs from a scene entity view. */
export interface PlateSubject {
  readonly track: EntityTrack;
  readonly character: CharacterSprite | null;
  readonly prop: PropSprite | null;
  readonly wx: number;
  readonly wy: number;
  readonly dissolve: number;
  readonly alpha: number;
  readonly lying: boolean;
  /** Written: world y of the top of the overlay stack. */
  top: number;
}

/** Enemy plates hide beyond this distance from the player (tiles)… */
const ENEMY_PLATE_TILES = 10;
/** …or when more living enemies than this are on screen. */
const ENEMY_CROWD = 8;
const HP_BOSS = { width: 26, color: "#e0503a" } as const;
const HP_NORMAL = { width: 14 } as const;

class Slot implements PlateBox {
  v: PlateSubject | null = null;
  role: PlateRole = "npc";
  dist = 0;
  showHp = false;
  hpY = 0;
  plate = false;
  name = "";
  title: string | undefined = undefined;
  small = false;
  // Plate rectangle (world px); y1 is the plate's bottom.
  x0 = 0;
  x1 = 0;
  y0 = 0;
  y1 = 0;
  /** Top of the stack below the plate (head or HP bar). */
  base = 0;
}

/** Plate size in canvas px at text scale `mult` (layout owned by overlays.ts). */
function plateSize(slot: Slot, level: number | undefined, mult: number): { w: number; h: number } {
  const opts: Parameters<typeof measureNamePlate>[1] = { small: slot.small };
  if (slot.title !== undefined) opts.title = slot.title;
  if (level !== undefined) opts.level = level;
  if (slot.role === "self") opts.frame = SELF_FRAME;
  return measureNamePlate(slot.name, opts, mult);
}

export class PlateLayer {
  readonly #slots: Slot[] = [];
  readonly #order: Slot[] = [];
  readonly #opts: NamePlateOptions = { color: TEAM_COLORS.npc };

  #slot(i: number): Slot {
    let s = this.#slots[i];
    if (!s) {
      s = new Slot();
      this.#slots.push(s);
    }
    return s;
  }

  /**
   * Draws overlays for `views` (world transform set). `self` is the player's
   * tile position for distance rules; `scale` world→canvas px; `unit`
   * canvas px per CSS px.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    views: readonly PlateSubject[],
    selfId: number,
    self: { x: number; y: number } | null,
    scale: number,
    unit: number,
    timeMs: number,
  ): void {
    const mult = Math.max(1, Math.round(unit));
    let enemies = 0;
    let party = 0;
    for (const v of views) {
      if (!v.character || v.lying || v.dissolve >= 0) continue;
      const role = plateRole(v.track.snap, v.track.mk, v.track.id === selfId);
      if (role === "enemy") enemies++;
      else if (isParty(role)) party++;
    }
    const crowded = enemies > ENEMY_CROWD;
    const partyTitles = party <= PARTY_TITLES_MAX;
    const order = this.#order;
    order.length = 0;
    let n = 0;
    for (const v of views) {
      const track = v.track;
      if (v.dissolve > 0.15 || v.alpha < 0.5) {
        v.top = v.wy - 30;
        continue;
      }
      if (v.prop) {
        v.top = v.wy - propHeight(v.prop) - 2;
        if (track.mk) drawEmote(ctx, track.mk, v.wx, v.top, timeMs);
        continue;
      }
      if (!v.character) continue;
      const snap = track.snap;
      const role = plateRole(snap, track.mk, track.id === selfId);
      const isSelf = role === "self";
      const boss = role === "boss";
      const s = this.#slot(n++);
      s.v = v;
      s.role = role;
      s.dist = self ? Math.hypot(track.x - self.x, track.y - self.y) : 0;
      let y = v.wy - (v.lying ? 10 : characterHeight(v.character)) - 1;
      if (track.down) y -= 18 / scale; // above the 사경 label
      const hp = Math.max(0, Math.min(100, track.hp));
      s.showHp = !isSelf && !v.lying && (boss || role === "enemy" || hp < 100);
      if (s.showHp) {
        s.hpY = y - 3;
        y -= 5;
      }
      s.base = y;
      s.plate = !!snap.n && !(role === "enemy" && (crowded || s.dist > ENEMY_PLATE_TILES));
      if (s.plate) {
        s.name = role === "companion" ? botName(snap.n ?? "") : (snap.n ?? "");
        s.title = isParty(role) && !partyTitles ? undefined : (snap.title ?? (snap.hist ? "역사 인물" : undefined));
        s.small = role !== "self" && role !== "player" && !boss;
        const size = plateSize(s, snap.lvl, mult);
        const w = size.w / scale;
        const h = size.h / scale;
        s.x0 = v.wx - w / 2;
        s.x1 = v.wx + w / 2;
        s.y1 = y;
        s.y0 = y - h;
      }
      order.push(s);
    }
    order.sort(byPlacement);
    placePlates(order);
    // Draw back to front so higher-priority overlays end up on top.
    const o = this.#opts;
    o.pixelRatio = unit;
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i] as Slot;
      const v = s.v as PlateSubject;
      const track = v.track;
      const snap = track.snap;
      if (s.showHp)
        drawHpBar(ctx, v.wx, s.hpY, Math.max(0, Math.min(100, track.hp)) / 100, s.role === "boss" ? HP_BOSS : HP_NORMAL);
      let top = s.base;
      if (s.plate) {
        o.color = s.role === "companion" ? COMPANION_COLOR : (TEAM_COLORS[snap.tm] ?? TEAM_COLORS.npc);
        o.title = s.title;
        o.level = snap.lvl;
        o.small = s.small;
        o.frame = s.role === "self" ? SELF_FRAME : undefined;
        drawNamePlate(ctx, s.name, v.wx, s.y1, o);
        top = s.y0;
      }
      if (track.mk) {
        drawEmote(ctx, track.mk, v.wx, top - 1, timeMs);
        top -= 14;
      }
      v.top = top;
      s.v = null;
    }
  }
}
