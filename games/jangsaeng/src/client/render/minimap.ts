// Minimap: one cell per tile (optionally scaled), relief-shaded land, rivers,
// roads, city walls and era-aware site markers; plus marker helpers for the
// HUD to draw the player, party, enemies and quest targets on top.

import { siteAt, structuresAt, type GameMap } from "../../shared/map/generate.ts";
import type { SiteKind } from "../../shared/map/geo.ts";
import { Tile, type TileId } from "../../shared/map/tiles.ts";
import { TILE_PX } from "../../shared/sprites.ts";
import { TEAM_COLORS } from "./palette.ts";
import { Raster, hex, mixRgba, scaleRgba, type Rgba } from "./raster.ts";

const TILE_COLOURS: Readonly<Record<TileId, string>> = {
  [Tile.DeepSea]: "#1d4570",
  [Tile.Sea]: "#2a6394",
  [Tile.Shallow]: "#4689b5",
  [Tile.Sand]: "#d4c08f",
  [Tile.Grass]: "#6a9548",
  [Tile.Meadow]: "#84a855",
  [Tile.Forest]: "#335f3a",
  [Tile.Hill]: "#7c8a4e",
  [Tile.Mountain]: "#706b5d",
  [Tile.Peak]: "#a29d90",
  [Tile.River]: "#5aa6cf",
  [Tile.Road]: "#cdb07c",
  [Tile.Bridge]: "#a87a4a",
  [Tile.Paddy]: "#a2bb5c",
  [Tile.Snow]: "#e8eef2",
  [Tile.Marsh]: "#86795f",
  [Tile.TownGround]: "#cbb791",
  [Tile.Plaza]: "#e0d8c6",
  [Tile.Ford]: "#79b9d0",
  [Tile.Deck]: "#8a5a35",
};

export const MINIMAP_SITE_COLOURS: Readonly<Record<SiteKind, string>> = {
  capital: "#c8322e",
  city: "#e2b23a",
  town: "#f3ecdc",
  fortress: "#5a5650",
  port: "#2b5a8c",
  battlefield: "#e04a3a",
  village: "#c9a35a",
  frontier: "#7b4e86",
};

const OUTLINE = hex("#1d1a19");

/**
 * Renders the whole map, `pixelsPerTile` device pixels per tile (integer ≥ 1).
 * Deterministic; cache the result per (map, year, scale).
 */
export function renderMinimap(map: GameMap, year: number, pixelsPerTile = 1): HTMLCanvasElement {
  const p = Math.max(1, Math.round(pixelsPerTile));
  const W = map.width;
  const H = map.height;
  const r = new Raster(W * p, H * p);
  const colours = new Map<TileId, Rgba>();
  const colourOf = (t: TileId) => {
    let c = colours.get(t);
    if (c === undefined) {
      c = hex(TILE_COLOURS[t]);
      colours.set(t, c);
    }
    return c;
  };
  const elev = (x: number, y: number) =>
    map.elevation[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] as number;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = map.tiles[y * W + x] as TileId;
      let c = colourOf(t);
      const water = t === Tile.DeepSea || t === Tile.Sea || t === Tile.Shallow;
      if (!water && t !== Tile.River) {
        // Relief shading lit from the north-west.
        const shade = (elev(x + 1, y) - elev(x - 1, y) + elev(x, y + 1) - elev(x, y - 1)) * 0.004;
        c = scaleRgba(c, Math.max(0.72, Math.min(1.22, 1 + shade)));
      }
      r.rect(x * p, y * p, p, p, c);
    }
  // City walls in this era.
  const wall = hex("#4a4741");
  for (const s of structuresAt(map, year)) {
    if (s.kind === "wall") r.rect(s.x * p, s.y * p, p, p, mixRgba(wall, hex("#8c8a84"), p > 1 ? 0 : 0.4));
  }
  // Site markers by era-dependent kind.
  for (const site of map.sites) {
    const kind = siteAt(site, year).kind;
    const c = hex(MINIMAP_SITE_COLOURS[kind]);
    const cx = site.x * p + Math.floor(p / 2);
    const cy = site.y * p + Math.floor(p / 2);
    const size = (kind === "capital" ? 3 : kind === "village" ? 1 : 2) * Math.max(1, Math.ceil(p / 2));
    if (kind === "battlefield") {
      for (let k = -size; k <= size; k++) {
        r.set(cx + k, cy + k, c);
        r.set(cx + k, cy - k, c);
      }
      continue;
    }
    const x0 = cx - Math.floor(size / 2);
    const y0 = cy - Math.floor(size / 2);
    r.rect(x0 - 1, y0 - 1, size + 2, size + 2, OUTLINE);
    r.rect(x0, y0, size, size, c);
  }
  return r.toSurface();
}

/** Converts world pixels to minimap pixels. */
export function minimapPoint(worldX: number, worldY: number, pixelsPerTile = 1): { x: number; y: number } {
  return { x: (worldX / TILE_PX) * pixelsPerTile, y: (worldY / TILE_PX) * pixelsPerTile };
}

export type MinimapMarkerKind = keyof typeof TEAM_COLORS | "quest";

/**
 * Draws a marker at minimap pixel (x, y) in the context's current transform:
 * the player as a pulsing ring with a facing tick, others as small dots, and
 * quest targets as a gold diamond.
 */
export function drawMinimapMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: MinimapMarkerKind,
  opts: { timeMs?: number; size?: number; facing?: number } = {},
): void {
  const size = opts.size ?? 2;
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.save();
  if (kind === "quest") {
    const pulse = 1 + Math.round((Math.sin((opts.timeMs ?? 0) / 260) + 1) / 2);
    ctx.fillStyle = "#1d1a19";
    ctx.beginPath();
    ctx.moveTo(px, py - size - pulse - 1);
    ctx.lineTo(px + size + pulse + 1, py);
    ctx.lineTo(px, py + size + pulse + 1);
    ctx.lineTo(px - size - pulse - 1, py);
    ctx.fill();
    ctx.fillStyle = "#ffd65a";
    ctx.beginPath();
    ctx.moveTo(px, py - size - pulse);
    ctx.lineTo(px + size + pulse, py);
    ctx.lineTo(px, py + size + pulse);
    ctx.lineTo(px - size - pulse, py);
    ctx.fill();
  } else if (kind === "self") {
    const ring = size + 2 + ((opts.timeMs ?? 0) / 120) % 4;
    ctx.strokeStyle = "rgba(255,224,138,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px - ring + 0.5, py - ring + 0.5, ring * 2, ring * 2);
    ctx.fillStyle = "#1d1a19";
    ctx.fillRect(px - size - 1, py - size - 1, size * 2 + 3, size * 2 + 3);
    ctx.fillStyle = TEAM_COLORS.self;
    ctx.fillRect(px - size, py - size, size * 2 + 1, size * 2 + 1);
    if (opts.facing !== undefined) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(px + Math.round(Math.cos(opts.facing) * (size + 2)), py + Math.round(Math.sin(opts.facing) * (size + 2)), 1, 1);
    }
  } else {
    ctx.fillStyle = "#1d1a19";
    ctx.fillRect(px - size, py - size, size * 2 + 1, size * 2 + 1);
    ctx.fillStyle = TEAM_COLORS[kind];
    ctx.fillRect(px - size + 1, py - size + 1, size * 2 - 1, size * 2 - 1);
  }
  ctx.restore();
}
