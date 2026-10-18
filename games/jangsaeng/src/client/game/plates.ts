// Overhead overlays with declutter: HP bars, name plates and emotes. Plates
// are placed by priority (self, players, bosses, story NPCs, allies, NPCs,
// enemies); a plate that would overlap one already placed is nudged up (at
// most twice), and enemy plates that still collide are dropped (their HP
// bars stay). Enemy plates also hide when far away or in a crowd.

import type { CharacterSprite, PropSprite } from "../../shared/sprites.ts";
import type { Team } from "../../shared/types.ts";
import { characterHeight } from "../render/characters.ts";
import {
  drawEmote,
  drawHpBar,
  drawNamePlate,
  measureNamePlate,
  type NamePlateOptions,
} from "../render/overlays.ts";
import { TEAM_COLORS } from "../render/palette.ts";
import { propHeight } from "../render/props.ts";
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
const MAX_NUDGES = 2;
const HP_BOSS = { width: 26, color: "#e0503a" } as const;
const HP_NORMAL = { width: 14 } as const;

const PRIORITY: Readonly<Record<Team, number>> = { self: 0, player: 1, boss: 2, ally: 4, npc: 5, enemy: 6 };

class Slot {
  v: PlateSubject | null = null;
  prio = 0;
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
  return measureNamePlate(slot.name, opts, mult);
}


export class PlateLayer {
  readonly #slots: Slot[] = [];
  readonly #order: Slot[] = [];
  readonly #opts: NamePlateOptions = { color: TEAM_COLORS.npc };
  readonly #byPriority = (a: Slot, b: Slot) => a.prio - b.prio || a.dist - b.dist;

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
    for (const v of views)
      if (v.character && !v.lying && v.track.snap.tm === "enemy" && v.dissolve < 0) enemies++;
    const crowded = enemies > ENEMY_CROWD;
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
      const tm = snap.tm;
      const isSelf = track.id === selfId;
      const boss = tm === "boss";
      const s = this.#slot(n++);
      s.v = v;
      s.prio = isSelf ? 0 : (PRIORITY[tm] ?? 5) - (tm === "npc" && (track.mk || snap.hist) ? 2 : 0);
      s.dist = self ? Math.hypot(track.x - self.x, track.y - self.y) : 0;
      let y = v.wy - (v.lying ? 10 : characterHeight(v.character)) - 1;
      if (track.down) y -= 18 / scale; // above the 사경 label
      const hp = Math.max(0, Math.min(100, track.hp));
      s.showHp = !isSelf && !v.lying && (boss || tm === "enemy" || hp < 100);
      if (s.showHp) {
        s.hpY = y - 3;
        y -= 5;
      }
      s.base = y;
      s.plate = !!snap.n && !(tm === "enemy" && (crowded || s.dist > ENEMY_PLATE_TILES));
      if (s.plate) {
        s.name = snap.n ?? "";
        s.title = snap.title ?? (snap.hist ? "역사 인물" : undefined);
        s.small = !boss && tm !== "self" && tm !== "player";
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
    order.sort(this.#byPriority);
    // Place plates in priority order.
    for (let i = 0; i < order.length; i++) {
      const s = order[i] as Slot;
      if (!s.plate) continue;
      for (let nudge = 0; ; nudge++) {
        const hit = this.#overlap(s, i);
        if (!hit) break;
        if (nudge >= MAX_NUDGES) {
          if (s.prio >= PRIORITY.enemy) s.plate = false;
          break;
        }
        const dy = s.y1 - hit.y0 + 0.5;
        s.y0 -= dy;
        s.y1 -= dy;
      }
    }
    // Draw back to front so higher-priority overlays end up on top.
    const o = this.#opts;
    o.pixelRatio = unit;
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i] as Slot;
      const v = s.v as PlateSubject;
      const track = v.track;
      const snap = track.snap;
      if (s.showHp) {
        const boss = snap.tm === "boss";
        drawHpBar(ctx, v.wx, s.hpY, Math.max(0, Math.min(100, track.hp)) / 100, boss ? HP_BOSS : HP_NORMAL);
      }
      let top = s.base;
      if (s.plate) {
        o.color = TEAM_COLORS[snap.tm] ?? TEAM_COLORS.npc;
        o.title = s.title;
        o.level = snap.lvl;
        o.small = s.small;
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

  /** First already-placed plate (index < upto) overlapping slot `s`. */
  #overlap(s: Slot, upto: number): Slot | null {
    const order = this.#order;
    for (let j = 0; j < upto; j++) {
      const o = order[j] as Slot;
      if (!o.plate) continue;
      if (o.x0 < s.x1 && o.x1 > s.x0 && o.y0 < s.y1 && o.y1 > s.y0) return o;
    }
    return null;
  }
}
