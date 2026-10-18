// Terrain decoration placement: per-tile, hash-seeded trees, tufts, flowers,
// shrubs, rocks, crags, reeds, stepping stones, bridges and fleet-deck edges.
// Items carry their anchor (ground contact) and are drawn in depth order.

import { Tile } from "../../shared/map/tiles.ts";
import { TILE_PX } from "../../shared/sprites.ts";
import { hash01 } from "./raster.ts";
import { decorSet, type DecorSet, type Sprite, type TerrainPalette } from "./terrain-art.ts";
import { bridgeSprite, deckEdgeSprites } from "./terrain-props.ts";
import { CHUNK_TILES, LAND, M, MARGIN, REGION, TILE_MAT, isRiverTile, type Region, type TerrainSource } from "./terrain-region.ts";

export interface DecorItem {
  x: number;
  y: number;
  sprite: Sprite;
  shadow?: Sprite | undefined;
  order: number;
}

export function placeDecor(src: TerrainSource, region: Region, pal: TerrainPalette, items: DecorItem[]): void {
  const N = REGION;
  const { mat, ox, oy, dSea, dRiver, dLand } = region;
  const season = pal.season;
  const winter = season === "winter";
  const tx0 = Math.floor((ox + MARGIN) / TILE_PX) - 2;
  const ty0 = Math.floor((oy + MARGIN) / TILE_PX) - 1;
  const tx1 = tx0 + CHUNK_TILES + 3;
  const ty1 = ty0 + CHUNK_TILES + 3;
  const W = src.width;
  const regionIndex = (wx: number, wy: number) => {
    const rx = wx - ox;
    const ry = wy - oy;
    return rx >= 0 && ry >= 0 && rx < N && ry < N ? ry * N + rx : -1;
  };
  const matHere = (wx: number, wy: number) => {
    const i = regionIndex(wx, wy);
    return i < 0 ? -1 : (mat[i] as number);
  };
  const clearOfWater = (wx: number, wy: number, d: number) => {
    const i = regionIndex(wx, wy);
    return i >= 0 && (dSea[i] as number) > d * 3 && (dRiver[i] as number) > d * 3;
  };
  let order = 0;
  const add = (x: number, y: number, sprite: Sprite, shadow?: Sprite) => items.push({ x, y, sprite, shadow, order: order++ });
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || tx >= W || ty < 0 || ty >= src.height) continue;
      const t = src.tileAt(tx, ty);
      const i = ty * W + tx;
      const snowy = winter && (src.snow[i] as number) > 0.62;
      const set: DecorSet = decorSet(season, snowy);
      const bx = tx * TILE_PX;
      const by = ty * TILE_PX;
      const r = (k: number) => hash01(tx, ty, k);
      const pick = <T>(list: readonly T[], k: number): T => list[Math.floor(r(k) * list.length) % list.length] as T;
      const at = (k: number, lo = 2, hi = 14) => [bx + lo + Math.floor(r(k) * (hi - lo)), by + lo + Math.floor(r(k + 1) * (hi - lo))] as const;
      const placeIf = (k: number, want: number, sprite: Sprite, shadow?: Sprite, clear = 0) => {
        const [x, y] = at(k);
        if (matHere(x, y) === want && (clear === 0 || clearOfWater(x, y, clear))) add(x, y, sprite, shadow);
      };
      switch (t) {
        case Tile.Forest: {
          const broadShare = 0.22 + Math.max(0, (ty - 160) / 160) * 0.2;
          const spots = [
            [3, 5],
            [11, 4],
            [7, 10],
            [14, 12],
            [3, 15],
            [10, 16],
          ] as const;
          spots.forEach(([sx, sy], k) => {
            if (r(40 + k) < 0.12) return;
            const x = bx + sx + Math.floor((r(50 + k) - 0.5) * 4);
            const y = by + sy + Math.floor((r(60 + k) - 0.5) * 3);
            const m = matHere(x, y);
            if (m !== M.Forest || !clearOfWater(x, y, 2)) return;
            const broad = r(70 + k) < broadShare;
            const tree = broad
              ? season === "spring" && r(80 + k) < 0.3
                ? pick(set.blossom, 90 + k)
                : pick(set.broadleaf, 90 + k)
              : pick(set.pines, 90 + k);
            add(x, y, tree, set.treeShadow);
          });
          break;
        }
        case Tile.Grass:
        case Tile.Meadow: {
          const want = t === Tile.Grass ? M.Grass : M.Meadow;
          const tufts = t === Tile.Meadow ? 3 : 2;
          for (let k = 0; k < tufts; k++) if (r(10 + k) < 0.45) placeIf(12 + k * 2, want, pick(set.tufts, 30 + k));
          const flowers = pal.bloom * (t === Tile.Meadow ? 1 : 0.55);
          for (let k = 0; k < 3; k++) if (r(20 + k) < flowers * 0.6) placeIf(22 + k * 2, want, pick(set.flowers, 34 + k));
          if (r(5) < 0.045) placeIf(6, want, pick(season === "spring" && r(7) < 0.4 ? set.azalea : set.shrubs, 8), set.smallShadow, 2);
          else if (r(5) > 0.982) {
            const lone = r(9) < 0.5 ? pick(set.broadleaf, 3) : pick(set.pines, 3);
            placeIf(6, want, lone, set.treeShadow, 2);
          } else if (r(5) > 0.95) placeIf(6, want, pick(set.pebbles, 4));
          break;
        }
        case Tile.Hill: {
          if (r(1) < 0.6) placeIf(2, M.Hill, pick(set.mounds, 3));
          if (r(4) < 0.32) placeIf(5, M.Hill, pick(season === "spring" && r(6) < 0.6 ? set.azalea : set.shrubs, 7), set.smallShadow, 2);
          if (r(8) < 0.14) placeIf(9, M.Hill, pick(set.pines, 10), set.treeShadow, 2);
          if (r(11) < 0.5) placeIf(12, M.Hill, pick(set.tufts, 13));
          break;
        }
        case Tile.Mountain: {
          if (r(1) < 0.5) placeIf(2, M.Mountain, r(3) < 0.4 ? pick(set.smallPines, 4) : pick(set.pines, 4), set.smallShadow, 2);
          if (r(5) < 0.3) placeIf(6, M.Mountain, pick(set.pines, 7), set.treeShadow, 2);
          if (r(8) < 0.18) placeIf(9, M.Mountain, pick(set.boulders, 10), set.smallShadow);
          else if (r(8) < 0.4) placeIf(9, M.Mountain, pick(set.outcrops, 10));
          if (r(11) < 0.25) placeIf(12, M.Mountain, pick(season === "spring" && r(14) < 0.6 ? set.azalea : set.shrubs, 13), set.smallShadow, 2);
          break;
        }
        case Tile.Peak: {
          const crest = Math.max(0, Math.min(1, ((src.map.elevation[i] as number) / 255 - 0.8) / 0.2));
          if (r(1) < 0.08 + crest * 0.3) {
            const [x, y] = at(2, 4, 13);
            if (matHere(x, y) === M.Peak) add(x, y + 3, pick(set.crags, 3));
          } else if (r(1) > 0.82) placeIf(2, M.Peak, pick(set.outcrops, 3));
          if (r(4) < 0.3) placeIf(5, M.Peak, pick(set.boulders, 6), set.smallShadow);
          break;
        }
        case Tile.Snow: {
          if (r(1) < 0.16) placeIf(2, M.Snow, pick(set.smallPines, 3), set.smallShadow, 2);
          if (r(4) < 0.2) placeIf(5, M.Snow, pick(set.boulders, 6), set.smallShadow);
          break;
        }
        case Tile.Sand: {
          if (r(1) < 0.1) placeIf(2, M.Sand, pick(set.pebbles, 3));
          if (r(4) < 0.18) {
            const [x, y] = at(5);
            if (matHere(x, y) === M.Sand && clearOfWater(x, y, 5)) add(x, y, pick(set.tufts, 6));
          }
          break;
        }
        case Tile.Marsh: {
          for (let k = 0; k < 2; k++)
            if (r(1 + k) < 0.4) {
              const [x, y] = at(3 + k * 2);
              const i2 = regionIndex(x, y);
              if (i2 >= 0 && mat[i2] === M.Marsh && (dLand[i2] as number) === 0) add(x, y, pick(set.reeds, 7 + k));
            }
          break;
        }
        case Tile.TownGround: {
          if (r(1) < 0.07) placeIf(2, M.Town, pick(set.pebbles, 3));
          if (r(4) < 0.06) placeIf(5, M.Town, pick(set.tufts, 6));
          break;
        }
        case Tile.Road: {
          if (r(1) < 0.12) placeIf(2, M.Road, pick(set.pebbles, 3));
          break;
        }
        case Tile.Ford: {
          const horizontal = !isRiverTile(src.tileAt(tx - 1, ty)) || !isRiverTile(src.tileAt(tx + 1, ty));
          for (let k = 0; k < 4; k++) {
            const x = bx + (horizontal ? 2 + k * 4 : 7 + (k & 1) * 2);
            const y = by + (horizontal ? 8 + (k & 1) * 2 : 3 + k * 4);
            add(x, y, pick(set.stones, k));
          }
          break;
        }
        case Tile.Bridge: {
          const water = (x: number, y: number) => {
            const n = src.tileAt(x, y);
            return n === Tile.River || n === Tile.Ford || n === Tile.Shallow || n === Tile.Sea || n === Tile.DeepSea;
          };
          const bridge = (x: number, y: number) => src.tileAt(x, y) === Tile.Bridge;
          const n = water(tx, ty - 1);
          const e = water(tx + 1, ty);
          const s = water(tx, ty + 1);
          const w = water(tx - 1, ty);
          // Planks run across the direction of travel; a run of bridge tiles
          // along a river (towns stamped over it) becomes a boardwalk.
          const seamsVertical =
            n || s ? !(e || w) || (n && s) : e || w ? false : bridge(tx, ty - 1) || bridge(tx, ty + 1);
          const townish = (x: number, y: number) => {
            const t2 = src.tileAt(x, y);
            return t2 === Tile.TownGround || t2 === Tile.Plaza;
          };
          const stone = townish(tx - 1, ty) || townish(tx + 1, ty) || townish(tx, ty - 1) || townish(tx, ty + 1);
          add(bx, by + 8, bridgeSprite({ n, e, s, w, seamsVertical, snowy, stone }));
          break;
        }
        case Tile.Deck: {
          // The fleet is a row of hulls two tiles wide, lashed side by side.
          const deck = (x: number, y: number) => src.tileAt(x, y) === Tile.Deck;
          const water = (x: number, y: number) => TILE_MAT[src.tileAt(x, y)] < LAND;
          const edges = deckEdgeSprites();
          const upper = (ty & 1) === 0;
          const pairRow = upper ? ty + 1 : ty - 1;
          const paired = deck(tx, pairRow);
          if (!deck(tx, ty - 1)) add(bx + 8, by, edges.north);
          if (!deck(tx, ty + 1)) add(bx + 8, by + 16, edges.south);
          else if (!upper) add(bx + 8, by + 16, edges.gap);
          if (!deck(tx - 1, ty)) {
            add(bx, by + 8, edges.west);
            if (water(tx - 1, ty)) {
              if (!paired) add(bx, by + 8, edges.bow);
              else if (upper && !deck(tx - 1, pairRow) && water(tx - 1, pairRow)) add(bx, by + 16, edges.bow2);
            }
          }
          if (!deck(tx + 1, ty)) {
            add(bx + 16, by + 8, edges.east);
            if (water(tx + 1, ty)) {
              if (!paired) add(bx + 16, by + 8, edges.stern);
              else if (upper && !deck(tx + 1, pairRow) && water(tx + 1, pairRow)) add(bx + 16, by + 16, edges.stern2);
            }
          }
          if (r(1) < 0.14) add(bx + 4 + Math.floor(r(2) * 8), by + 6 + Math.floor(r(3) * 6), pick(edges.props, 4));
          break;
        }
        default:
          break;
      }
    }
}

