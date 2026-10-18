// Structures as depth-sorted drawables. Sprites are cached per (kind,
// variant class, season); walls auto-connect to neighbouring wall tiles and
// put 여장 parapets on the town's outer side; passages through walls get
// 홍예 arches and 문루 gate towers. sortY is the footprint's bottom edge.

import { structuresAt, type GameMap, type Site, type Structure, type StructureKind } from "../../shared/map/generate.ts";
import { TILE_PX } from "../../shared/sprites.ts";
import type { Surface } from "./pixel.ts";
import {
  chogaHouse,
  gateArch,
  gateTower,
  giwaHouse,
  palace,
  palaceRuin,
  pavilion,
  wallTile,
  type StructureSprite,
} from "./structure-art.ts";
import { beacon, flagCloth, flagPole, greatTree, jangseung, market, pagoda, ship, smokePuffs, tent, well } from "./structure-props.ts";
import type { Season } from "./terrain-art.ts";
import type { Drawable } from "./types.ts";

export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A drawable with world-space bounds for culling. */
export interface StructureDrawable extends Drawable {
  readonly structure: Structure | null;
  readonly bounds: WorldRect;
}

type Art = (variant: number, season: Season) => StructureSprite;

/** Art builders and how many distinct variant classes each kind has. */
const ART: Readonly<Record<Exclude<StructureKind, "wall" | "tent">, readonly [Art, number]>> = {
  giwa_house: [giwaHouse, 64],
  choga_house: [chogaHouse, 64],
  palace: [palace, 1],
  palace_ruin: [palaceRuin, 1],
  pavilion: [pavilion, 2],
  market: [market, 16],
  beacon: [beacon, 2],
  ship: [ship, 6],
  jangseung: [jangseung, 6],
  great_tree: [greatTree, 2],
  pagoda: [pagoda, 1],
  well: [well, 2],
  flag: [flagPole, 1],
};

const SMOKE_PERIOD = 3200;

/** Conservative culling margins (world px) around a footprint before its sprite exists. */
const REACH = { left: 24, right: 24, up: 72, down: 10 } as const;

/** A sprite built on first use, then memoised in the layer's cache. */
type SpriteRef = () => StructureSprite;

export class StructureLayer {
  readonly map: GameMap;
  readonly #sites: Map<string, Site>;
  readonly #sprites = new Map<string, StructureSprite>();
  readonly #cloth = new Map<number, readonly Surface[]>();
  #year = 1450;
  #season: Season = "summer";
  #drawables: StructureDrawable[] = [];
  #pending: { bounds: WorldRect; ref: SpriteRef; key: string }[] = [];
  #dirty = true;

  constructor(map: GameMap) {
    this.map = map;
    this.#sites = new Map(map.sites.map((site) => [site.id, site]));
  }

  setYear(year: number): void {
    if (year === this.#year) return;
    this.#year = year;
    this.#dirty = true;
  }

  setSeason(season: Season): void {
    if (season === this.#season) return;
    this.#season = season;
    this.#dirty = true;
  }

  /** Drawables whose sprites may intersect the world rectangle. */
  visible(view: WorldRect, _timeMs: number): Drawable[] {
    if (this.#dirty) this.#rebuild();
    const out: Drawable[] = [];
    for (const d of this.#drawables) {
      const b = d.bounds;
      if (b.x1 < view.x0 || b.y1 < view.y0 || b.x0 > view.x1 || b.y0 > view.y1) continue;
      out.push(d);
    }
    return out;
  }

  /** Every drawable for the current year and season (tests, tools). */
  all(): readonly StructureDrawable[] {
    if (this.#dirty) this.#rebuild();
    return this.#drawables;
  }

  /**
   * Builds up to `budget` not-yet-built sprites near the view, so walking into
   * a town does not stall a frame on sprite generation. Returns how many.
   */
  prewarm(view: WorldRect, budget: number): number {
    if (this.#dirty) this.#rebuild();
    let built = 0;
    for (let i = 0; i < this.#pending.length && built < budget; i++) {
      const p = this.#pending[i] as { bounds: WorldRect; ref: SpriteRef; key: string };
      if (this.#sprites.has(p.key)) {
        this.#pending.splice(i--, 1);
        continue;
      }
      const b = p.bounds;
      if (b.x1 < view.x0 || b.y1 < view.y0 || b.x0 > view.x1 || b.y0 > view.y1) continue;
      p.ref();
      this.#pending.splice(i--, 1);
      built++;
    }
    return built;
  }

  #ref(key: string, build: () => StructureSprite): SpriteRef {
    let memo: StructureSprite | undefined;
    return () => {
      if (memo) return memo;
      memo = this.#sprites.get(key);
      if (!memo) {
        memo = build();
        this.#sprites.set(key, memo);
      }
      return memo;
    };
  }

  #rebuild(): void {
    this.#dirty = false;
    const season = this.#season;
    const active = structuresAt(this.map, this.#year);
    const W = this.map.width;
    const walls = new Map<number, Structure>();
    for (const s of active) if (s.kind === "wall") walls.set(s.y * W + s.x, s);
    const wallAt = (x: number, y: number) => x >= 0 && y >= 0 && x < W && walls.has(y * W + x);
    const out: StructureDrawable[] = [];
    this.#pending = [];
    const track = (d: StructureDrawable, key: string, ref: SpriteRef) => {
      out.push(d);
      if (!this.#sprites.has(key)) this.#pending.push({ bounds: d.bounds, ref, key });
    };
    for (const s of active) {
      const wx = s.x * TILE_PX;
      const wy = s.y * TILE_PX;
      const sortY = (s.y + s.h) * TILE_PX;
      if (s.kind === "wall") {
        this.#wall(s, wallAt, track);
        continue;
      }
      let key: string;
      let ref: SpriteRef;
      if (s.kind === "tent") {
        key = `tent:${s.variant % 2}:${s.w}x${s.h}:${season}`;
        ref = this.#ref(key, () => tent(s.variant, season, s.w, s.h));
      } else {
        const [art, classes] = ART[s.kind];
        const variant = s.variant % classes;
        key = `${s.kind}:${variant}:${season}`;
        ref = this.#ref(key, () => art(variant, season));
      }
      const bounds = footprintBounds(s.x, s.y, s.w, s.h);
      switch (s.kind) {
        case "beacon":
          track(beaconDrawable(s, ref, wx, wy, sortY, bounds), key, ref);
          break;
        case "ship":
          track(shipDrawable(s, ref, wx, wy, sortY, bounds), key, ref);
          break;
        case "flag": {
          let cloth = this.#cloth.get(s.variant % 5);
          if (!cloth) {
            cloth = flagCloth(s.variant % 5);
            this.#cloth.set(s.variant % 5, cloth);
          }
          track(flagDrawable(s, ref, cloth, wx, wy, sortY, bounds), key, ref);
          break;
        }
        default:
          track(staticDrawable(s, ref, wx, wy, sortY, bounds), key, ref);
      }
    }
    this.#drawables = out;
  }

  #wall(
    s: Structure,
    wallAt: (x: number, y: number) => boolean,
    track: (d: StructureDrawable, key: string, ref: SpriteRef) => void,
  ): void {
    const season = this.#season;
    const site = s.siteId ? this.#sites.get(s.siteId) : undefined;
    const rect = site?.rect;
    const shape = {
      n: wallAt(s.x, s.y - 1),
      e: wallAt(s.x + 1, s.y),
      s: wallAt(s.x, s.y + 1),
      w: wallAt(s.x - 1, s.y),
      outN: rect ? s.y === rect.y : false,
      outS: rect ? s.y === rect.y + rect.h - 1 : false,
      outW: rect ? s.x === rect.x : false,
      outE: rect ? s.x === rect.x + rect.w - 1 : false,
      snow: season === "winter",
      seed: s.variant & 3,
    };
    const key = `wall:${[shape.n, shape.e, shape.s, shape.w, shape.outN, shape.outE, shape.outS, shape.outW]
      .map((v) => (v ? 1 : 0))
      .join("")}:${shape.seed}:${season}`;
    const ref = this.#ref(key, () => wallTile(shape));
    const wx = s.x * TILE_PX;
    const wy = s.y * TILE_PX;
    const sortY = (s.y + 1) * TILE_PX;
    track(staticDrawable(s, ref, wx, wy, sortY, footprintBounds(s.x, s.y, 1, 1)), key, ref);
    if (!rect) return;
    // Gates: a passage of 1–3 tiles in a wall line between two wall tiles.
    if ((shape.outN || shape.outS) && !shape.e) {
      for (let k = 2; k <= 4; k++) {
        if (s.x + k >= rect.x + rect.w) break;
        if (!wallAt(s.x + k, s.y)) continue;
        const span = k - 1;
        const archKey = `arch:${span}:${season}`;
        const archRef = this.#ref(archKey, () => gateArch(span, season, 3));
        const towerKey = `gate:h${span}:${s.variant & 1}:${season}`;
        const towerRef = this.#ref(towerKey, () => gateTower(span, true, season, s.variant & 1));
        const gx = (s.x + 1) * TILE_PX;
        const bounds = footprintBounds(s.x, s.y, span + 2, 1);
        track(staticDrawable(null, archRef, gx, wy, sortY + 0.25, bounds), archKey, archRef);
        track(staticDrawable(null, towerRef, gx, wy, sortY + 0.5, bounds), towerKey, towerRef);
        break;
      }
    }
    if ((shape.outW || shape.outE) && !shape.s) {
      for (let k = 2; k <= 4; k++) {
        if (s.y + k >= rect.y + rect.h) break;
        if (!wallAt(s.x, s.y + k)) continue;
        const towerKey = `gate:v:${s.variant & 1}:${season}`;
        const towerRef = this.#ref(towerKey, () => gateTower(1, false, season, s.variant & 1));
        const gy = (s.y + 1) * TILE_PX;
        track(staticDrawable(null, towerRef, wx, gy, (s.y + k) * TILE_PX - 0.5, footprintBounds(s.x, s.y + 1, 1, k - 1)), towerKey, towerRef);
        break;
      }
    }
  }
}

function footprintBounds(x: number, y: number, w: number, h: number): WorldRect {
  return {
    x0: x * TILE_PX - REACH.left,
    y0: y * TILE_PX - REACH.up,
    x1: (x + w) * TILE_PX + REACH.right,
    y1: (y + h) * TILE_PX + REACH.down,
  };
}

function staticDrawable(
  structure: Structure | null,
  ref: SpriteRef,
  wx: number,
  wy: number,
  sortY: number,
  bounds: WorldRect,
): StructureDrawable {
  return {
    structure,
    sortY,
    bounds,
    draw(ctx) {
      const sprite = ref();
      ctx.drawImage(sprite.surface, wx + sprite.ox, wy + sprite.oy);
    },
  };
}

function beaconDrawable(structure: Structure, ref: SpriteRef, wx: number, wy: number, sortY: number, bounds: WorldRect): StructureDrawable {
  const mouthX = wx + 8;
  const mouthY = wy - 16;
  const phase = (structure.variant / 255) * SMOKE_PERIOD;
  return {
    structure,
    sortY,
    bounds,
    draw(ctx, timeMs) {
      const sprite = ref();
      ctx.drawImage(sprite.surface, wx + sprite.ox, wy + sprite.oy);
      // Flicker at the mouth, then a column of rising, drifting puffs.
      const t = timeMs + phase;
      ctx.fillStyle = Math.floor(t / 120) % 3 === 0 ? "#f0a040" : "#e06a2a";
      ctx.fillRect(mouthX - 1, mouthY + 1, 2, 1);
      const puffs = smokePuffs();
      const prev = ctx.globalAlpha;
      for (let k = 0; k < 6; k++) {
        const u = (((t / SMOKE_PERIOD + k / 6) % 1) + 1) % 1;
        const rise = u * 34;
        const drift = Math.sin(u * 5 + k) * 1.5 + u * 7;
        const puff = puffs[Math.min(puffs.length - 1, Math.floor(u * puffs.length))] as Surface;
        ctx.globalAlpha = prev * (u < 0.1 ? u * 8 : 1 - (u - 0.1) * 1.05) * 0.85;
        ctx.drawImage(puff, Math.round(mouthX + drift - puff.width / 2), Math.round(mouthY - rise - puff.height / 2));
      }
      ctx.globalAlpha = prev;
    },
  };
}

function shipDrawable(structure: Structure, ref: SpriteRef, wx: number, wy: number, sortY: number, bounds: WorldRect): StructureDrawable {
  const phase = (structure.variant / 255) * Math.PI * 2;
  return {
    structure,
    sortY,
    bounds,
    draw(ctx, timeMs) {
      const sprite = ref();
      const bob = Math.sin(timeMs / 700 + phase) > 0.35 ? 1 : 0;
      ctx.drawImage(sprite.surface, wx + sprite.ox, wy + sprite.oy + bob);
    },
  };
}

function flagDrawable(
  structure: Structure,
  ref: SpriteRef,
  cloth: readonly Surface[],
  wx: number,
  wy: number,
  sortY: number,
  bounds: WorldRect,
): StructureDrawable {
  const phase = structure.variant * 37;
  return {
    structure,
    sortY,
    bounds,
    draw(ctx, timeMs) {
      const sprite = ref();
      const x = wx + sprite.ox;
      const y = wy + sprite.oy;
      ctx.drawImage(sprite.surface, x, y);
      const frame = cloth[Math.floor((timeMs + phase) / 150) % cloth.length] as Surface;
      ctx.drawImage(frame, x + 5, y);
    },
  };
}

const layers = new WeakMap<GameMap, StructureLayer>();

/**
 * Visible structures for a map, era and season as depth-sortable drawables
 * (sortY = bottom edge of the footprint in world px). Uses a cached layer per
 * map; WorldRenderer.structureDrawables is the usual entry point.
 */
export function visibleStructures(map: GameMap, year: number, season: Season, view: WorldRect, timeMs: number): Drawable[] {
  let layer = layers.get(map);
  if (!layer) {
    layer = new StructureLayer(map);
    layers.set(map, layer);
  }
  layer.setYear(year);
  layer.setSeason(season);
  return layer.visible(view, timeMs);
}
