// Terrain materials and the per-chunk "region": the pixel material grid
// (organic edges by bilinear voting between tile centres, rivers/roads/plazas
// stamped as wobbling capsules) plus chamfer distances to land, sea and river.
// A region extends MARGIN px beyond its chunk so neighbouring chunks agree on
// every pixel that can affect them.

import type { GameMap } from "../../shared/map/generate.ts";
import { tileToLonLat } from "../../shared/map/generate.ts";
import { Tile, type TileId } from "../../shared/map/tiles.ts";
import { TILE_PX } from "../../shared/sprites.ts";
import { noiseTexture, type NoiseTexture } from "./raster.ts";

export const CHUNK_TILES = 16;
export const CHUNK_PX = CHUNK_TILES * TILE_PX;
/** Region margin (px) computed around a chunk so edges, distances and
 * overhanging decorations agree with neighbouring chunks. */
export const MARGIN = 48;
export const REGION = CHUNK_PX + MARGIN * 2;

// Pixel materials. Water materials come first (< LAND).
export const M = {
  Deep: 0,
  Sea: 1,
  Shallow: 2,
  River: 3,
  Ford: 4,
  Sand: 5,
  Grass: 6,
  Meadow: 7,
  Forest: 8,
  Hill: 9,
  Mountain: 10,
  Peak: 11,
  Snow: 12,
  Marsh: 13,
  Road: 14,
  Town: 15,
  Plaza: 16,
  Paddy: 17,
  Deck: 18,
} as const;
export type Mat = (typeof M)[keyof typeof M];
export const LAND = 5;

export const TILE_MAT: Readonly<Record<TileId, Mat>> = {
  [Tile.DeepSea]: M.Deep,
  [Tile.Sea]: M.Sea,
  [Tile.Shallow]: M.Shallow,
  [Tile.Sand]: M.Sand,
  [Tile.Grass]: M.Grass,
  [Tile.Meadow]: M.Meadow,
  [Tile.Forest]: M.Forest,
  [Tile.Hill]: M.Hill,
  [Tile.Mountain]: M.Mountain,
  [Tile.Peak]: M.Peak,
  [Tile.River]: M.River,
  [Tile.Road]: M.Grass,
  [Tile.Bridge]: M.River,
  [Tile.Paddy]: M.Paddy,
  [Tile.Snow]: M.Snow,
  [Tile.Marsh]: M.Marsh,
  [Tile.TownGround]: M.Town,
  [Tile.Plaza]: M.Plaza,
  [Tile.Ford]: M.Ford,
  [Tile.Deck]: M.Deck,
};

/** Materials whose borders wobble organically into each other. */
export const ORGANIC = new Uint8Array(19);
for (const m of [M.Deep, M.Sea, M.Shallow, M.River, M.Sand, M.Grass, M.Meadow, M.Forest, M.Hill, M.Mountain, M.Peak, M.Snow, M.Marsh, M.Town])
  ORGANIC[m] = 1;
export const isSeaMat = (m: number) => m <= M.Shallow;
export const isRiverMat = (m: number) => m === M.River || m === M.Ford;
/** Natural land a road capsule may be painted over. */
export const ROADABLE = new Uint8Array(19);
for (const m of [M.Sand, M.Grass, M.Meadow, M.Forest, M.Hill, M.Mountain, M.Snow, M.Marsh]) ROADABLE[m] = 1;

export const isRiverTile = (t: number) => t === Tile.River || t === Tile.Bridge || t === Tile.Ford;
export const isRoadTile = (t: number) => t === Tile.Road || t === Tile.Bridge;
export const roadLinks = (t: number) => t === Tile.Road || t === Tile.Bridge || t === Tile.TownGround || t === Tile.Plaza;

/** Per-map precomputation shared by every chunk and season. */
export class TerrainSource {
  readonly map: GameMap;
  readonly width: number;
  readonly height: number;
  /** Base material per tile (roads replaced by the land they cross). */
  readonly mat: Uint8Array;
  /** Hillshade per tile centre in [-1, 1]. */
  readonly shade: Float32Array;
  /** Smoothed elevation per tile centre. */
  readonly elev: Float32Array;
  /** Water depth class per tile centre: 0 deep … 1 land. */
  readonly depth: Float32Array;
  /** Winter snow propensity per tile (latitude + altitude), 0..~1.5. */
  readonly snow: Float32Array;
  /** Plaza tiles of villages: a packed-earth yard (마당) instead of pavers. */
  readonly earthPlazas: Set<number>;
  readonly noiseA: NoiseTexture;
  readonly noiseB: NoiseTexture;
  readonly noiseLow: NoiseTexture;
  readonly noiseMid: NoiseTexture;

  constructor(map: GameMap) {
    this.map = map;
    const W = (this.width = map.width);
    const H = (this.height = map.height);
    this.noiseA = noiseTexture(128, [16, 8], 11);
    this.noiseB = noiseTexture(128, [16, 8], 23);
    this.noiseLow = noiseTexture(256, [64, 32, 16], 37);
    this.noiseMid = noiseTexture(128, [8, 4], 53);
    this.earthPlazas = new Set(
      map.sites.filter((site) => site.kind === "village" || site.kind === "frontier").map((site) => site.y * W + site.x),
    );
    this.mat = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = map.tiles[y * W + x] as TileId;
        this.mat[y * W + x] = t === Tile.Road ? this.#roadFill(x, y) : TILE_MAT[t];
      }
    for (const i of this.earthPlazas) if (map.tiles[i] === Tile.Plaza) this.mat[i] = M.Town;
    // Smoothed elevation and hillshade (light from the north-west).
    const raw = map.elevation;
    this.elev = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(W - 1, Math.max(0, x + dx));
            const yy = Math.min(H - 1, Math.max(0, y + dy));
            const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
            sum += (raw[yy * W + xx] as number) * w;
            weight += w;
          }
        this.elev[y * W + x] = sum / weight;
      }
    this.shade = new Float32Array(W * H);
    const e = (x: number, y: number) =>
      this.elev[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] as number;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const gx = (e(x + 1, y) - e(x - 1, y)) / 2;
        const gy = (e(x, y + 1) - e(x, y - 1)) / 2;
        this.shade[y * W + x] = Math.max(-1, Math.min(1, (gx + gy) * 0.026));
      }
    this.depth = new Float32Array(W * H);
    this.snow = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const [, lat] = tileToLonLat(0, y + 0.5);
      const latSnow = Math.max(0.12, Math.min(1, (lat - 35.1) / 2.4));
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const t = map.tiles[i] as TileId;
        this.depth[i] =
          t === Tile.DeepSea ? 0 : t === Tile.Sea ? 0.4 : t === Tile.Shallow ? 0.72 : t === Tile.River || t === Tile.Ford || t === Tile.Bridge ? 0.85 : 1;
        this.snow[i] = latSnow + ((raw[i] as number) / 255) * 0.7;
      }
    }
  }

  #roadFill(x: number, y: number): Mat {
    const counts = new Uint8Array(19);
    let best: Mat = M.Grass;
    let bestCount = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.tileAt(x + dx, y + dy);
        if (t === Tile.Road || t === Tile.Bridge) continue;
        const m = TILE_MAT[t];
        if (!ORGANIC[m] || m < LAND || m === M.Town) continue;
        const c = ++counts[m]!;
        if (c > bestCount || (c === bestCount && m === M.Grass)) {
          best = m;
          bestCount = c;
        }
      }
    return best === M.Forest || best === M.Peak ? M.Grass : best;
  }

  tileAt(x: number, y: number): TileId {
    const xx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const yy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    if (x < 0 || x >= this.width) return Tile.DeepSea;
    return this.map.tiles[yy * this.width + xx] as TileId;
  }

  matAt(x: number, y: number): Mat {
    if (x < 0 || x >= this.width) return M.Deep;
    const yy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return this.mat[yy * this.width + x] as Mat;
  }

  /** Bilinear samples of a per-tile-centre field along one pixel row. */
  sampleRow(field: Float32Array, wy: number, wx0: number, out: Float32Array): void {
    const W = this.width;
    const H = this.height;
    const fy = (wy + 0.5) / TILE_PX - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const row0 = (y0 < 0 ? 0 : y0 >= H ? H - 1 : y0) * W;
    const row1 = (y0 + 1 < 0 ? 0 : y0 + 1 >= H ? H - 1 : y0 + 1) * W;
    for (let i = 0; i < out.length; i++) {
      const fx = (wx0 + i + 0.5) / TILE_PX - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const cx0 = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0;
      const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= W ? W - 1 : x0 + 1;
      const a = field[row0 + cx0] as number;
      const top = a + ((field[row0 + cx1] as number) - a) * tx;
      const c = field[row1 + cx0] as number;
      const bottom = c + ((field[row1 + cx1] as number) - c) * tx;
      out[i] = top + (bottom - top) * ty;
    }
  }

  /** Bilinear sample of a per-tile-centre field at world pixel (wx, wy). */
  sample(field: Float32Array, wx: number, wy: number): number {
    const fx = (wx + 0.5) / TILE_PX - 0.5;
    const fy = (wy + 0.5) / TILE_PX - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const W = this.width;
    const H = this.height;
    const cx0 = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0;
    const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= W ? W - 1 : x0 + 1;
    const cy0 = y0 < 0 ? 0 : y0 >= H ? H - 1 : y0;
    const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= H ? H - 1 : y0 + 1;
    const a = field[cy0 * W + cx0] as number;
    const b = field[cy0 * W + cx1] as number;
    const c = field[cy1 * W + cx0] as number;
    const d = field[cy1 * W + cx1] as number;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
}

export interface Region {
  readonly ox: number;
  readonly oy: number;
  readonly mat: Uint8Array;
  /** Road centreline distance × 16 (255 = none). */
  readonly roadDist: Uint8Array;
  /** Chamfer distances ×3 (capped). */
  readonly dLand: Uint8Array;
  readonly dSea: Uint8Array;
  readonly dRiver: Uint8Array;
  /** Whether any hill/mountain/peak/snow pixel exists (contours needed). */
  readonly relief: boolean;
}

const DIST_CAP = 60;

/** Material class bits for distance seeds. */
const CLASS_LAND = 1;
const CLASS_SEA = 2;
const CLASS_RIVER = 4;
const MAT_CLASS = new Uint8Array(19);
for (let m = 0; m < 19; m++) MAT_CLASS[m] = m >= LAND ? CLASS_LAND : isSeaMat(m) ? CLASS_SEA : CLASS_RIVER;

/**
 * Chamfer (3–4) distance, ×3 and capped at DIST_CAP, to the nearest pixel
 * whose class has `bit` set. Skipped (filled) when no pixel or every pixel has it.
 */
function distanceField(classes: Uint8Array, bit: number, out: Uint8Array): void {
  const N = REGION;
  const C = DIST_CAP;
  let seeds = 0;
  for (let i = 0; i < classes.length; i++) {
    const seed = ((classes[i] as number) & bit) !== 0;
    out[i] = seed ? 0 : C;
    if (seed) seeds++;
  }
  if (seeds === 0 || seeds === classes.length) return;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      let v = out[i] as number;
      if (v === 0) continue;
      if (x > 0) {
        const w = (out[i - 1] as number) + 3;
        if (w < v) v = w;
      }
      if (y > 0) {
        const up = i - N;
        let w = (out[up] as number) + 3;
        if (w < v) v = w;
        if (x > 0) {
          w = (out[up - 1] as number) + 4;
          if (w < v) v = w;
        }
        if (x < N - 1) {
          w = (out[up + 1] as number) + 4;
          if (w < v) v = w;
        }
      }
      out[i] = v;
    }
  }
  for (let y = N - 1; y >= 0; y--) {
    const row = y * N;
    for (let x = N - 1; x >= 0; x--) {
      const i = row + x;
      let v = out[i] as number;
      if (v === 0) continue;
      if (x < N - 1) {
        const w = (out[i + 1] as number) + 3;
        if (w < v) v = w;
      }
      if (y < N - 1) {
        const down = i + N;
        let w = (out[down] as number) + 3;
        if (w < v) v = w;
        if (x < N - 1) {
          w = (out[down + 1] as number) + 4;
          if (w < v) v = w;
        }
        if (x > 0) {
          w = (out[down - 1] as number) + 4;
          if (w < v) v = w;
        }
      }
      out[i] = v;
    }
  }
}

/** Bilinear-weighted vote between four corner materials (crisp ones abstain). */
function vote(own: number, a: number, b: number, c: number, d: number, u: number, v: number): number {
  const wa = ORGANIC[a] ? (1 - u) * (1 - v) : 0;
  const wb = ORGANIC[b] ? u * (1 - v) : 0;
  const wc = ORGANIC[c] ? (1 - u) * v : 0;
  const wd = ORGANIC[d] ? u * v : 0;
  let best = own;
  let bestWeight = (a === own ? wa : 0) + (b === own ? wb : 0) + (c === own ? wc : 0) + (d === own ? wd : 0) + 1e-4;
  let w = wa + (b === a ? wb : 0) + (c === a ? wc : 0) + (d === a ? wd : 0);
  if (a !== own && w > bestWeight) {
    best = a;
    bestWeight = w;
  }
  w = wb + (c === b ? wc : 0) + (d === b ? wd : 0) + (a === b ? wa : 0);
  if (b !== best && w > bestWeight) {
    best = b;
    bestWeight = w;
  }
  w = wc + (d === c ? wd : 0) + (a === c ? wa : 0) + (b === c ? wb : 0);
  if (c !== best && w > bestWeight) {
    best = c;
    bestWeight = w;
  }
  w = wd + (a === d ? wa : 0) + (b === d ? wb : 0) + (c === d ? wc : 0);
  if (d !== best && w > bestWeight) best = d;
  return best;
}

export function* buildRegion(src: TerrainSource, cx: number, cy: number): Generator<void, Region, void> {
  const ox = cx * CHUNK_PX - MARGIN;
  const oy = cy * CHUNK_PX - MARGIN;
  const N = REGION;
  const mat = new Uint8Array(N * N);
  // Organic materials vote with bilinear weights from the four nearest tile
  // centres (sampled at a noise-displaced position): staircase tile edges
  // become smooth, wobbling coasts and margins. Crisp materials (paddies,
  // plazas, decks) keep their exact tile footprint.
  const amp2 = 9;
  // Local tile grid (one tile of padding) and per-cell "all four corners
  // equal" flags, so most pixels resolve with two lookups.
  const gx0 = Math.floor(ox / TILE_PX) - 1;
  const gy0 = Math.floor(oy / TILE_PX) - 1;
  const GW = Math.ceil(N / TILE_PX) + 3;
  const grid = new Uint8Array(GW * GW);
  for (let j = 0; j < GW; j++) for (let i = 0; i < GW; i++) grid[j * GW + i] = src.matAt(gx0 + i, gy0 + j);
  const uniform = new Uint8Array(GW * GW).fill(255);
  for (let j = 0; j < GW - 1; j++)
    for (let i = 0; i < GW - 1; i++) {
      const k = j * GW + i;
      const a = grid[k] as number;
      if (a === grid[k + 1] && a === grid[k + GW] && a === grid[k + GW + 1]) uniform[k] = a;
    }
  const nA = src.noiseA.data;
  const nB = src.noiseB.data;
  // Process tile blocks; a tile whose 3×3 neighbourhood is one material can
  // only resolve to that material (displacement < half a tile), so it is filled.
  const rx0 = ox - gx0 * TILE_PX;
  const ry0 = oy - gy0 * TILE_PX;
  for (let j = 1; j < GW - 1; j++) {
    const py0 = Math.max(0, j * TILE_PX - ry0);
    const py1 = Math.min(N, (j + 1) * TILE_PX - ry0);
    if (py1 <= py0) continue;
    for (let i = 1; i < GW - 1; i++) {
      const px0 = Math.max(0, i * TILE_PX - rx0);
      const px1 = Math.min(N, (i + 1) * TILE_PX - rx0);
      if (px1 <= px0) continue;
      const own = grid[j * GW + i] as number;
      let same = true;
      for (let dj = -1; dj <= 1 && same; dj++)
        for (let di = -1; di <= 1; di++)
          if (grid[(j + dj) * GW + i + di] !== own) {
            same = false;
            break;
          }
      if (same || !ORGANIC[own]) {
        for (let ry = py0; ry < py1; ry++) mat.fill(own, ry * N + px0, ry * N + px1);
        continue;
      }
      for (let ry = py0; ry < py1; ry++) {
        const wy = oy + ry;
        const nrow = (wy & 127) << 7;
        const base = ry * N;
        for (let rx = px0; rx < px1; rx++) {
          const wx = ox + rx;
          const ni = nrow | (wx & 127);
          const fx = (wx + 0.5 + ((nA[ni] as number) - 0.5) * amp2) / TILE_PX - 0.5 - gx0;
          const fy = (wy + 0.5 + ((nB[ni] as number) - 0.5) * amp2) / TILE_PX - 0.5 - gy0;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const ci = y0 * GW + x0;
          const uni = uniform[ci] as number;
          if (uni !== 255) {
            mat[base + rx] = ORGANIC[uni] ? uni : own;
            continue;
          }
          mat[base + rx] = vote(own, grid[ci] as number, grid[ci + 1] as number, grid[ci + GW] as number, grid[ci + GW + 1] as number, fx - x0, fy - y0);
        }
      }
    }
  }
  yield;
  const roadDist = new Uint8Array(N * N).fill(255);
  const tx0 = Math.floor(ox / TILE_PX) - 2;
  const ty0 = Math.floor(oy / TILE_PX) - 2;
  const tx1 = Math.floor((ox + N) / TILE_PX) + 2;
  const ty1 = Math.floor((oy + N) / TILE_PX) + 2;
  const capsule = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    radius: number,
    wobble: number,
    paint: (i: number, d: number) => void,
  ) => {
    const pad = radius + wobble + 1;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - pad - ox));
    const maxX = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + pad - ox));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - pad - oy));
    const maxY = Math.min(N - 1, Math.ceil(Math.max(ay, by) + pad - oy));
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    for (let ry = minY; ry <= maxY; ry++)
      for (let rx = minX; rx <= maxX; rx++) {
        const px = ox + rx + 0.5;
        const py = oy + ry + 0.5;
        const u = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        const ex = ax + vx * u - px;
        const ey = ay + vy * u - py;
        const d = Math.sqrt(ex * ex + ey * ey);
        const wx = ox + rx;
        const wy = oy + ry;
        const r = radius + ((src.noiseMid.data[((wy & 127) << 7) | (wx & 127)] as number) - 0.5) * 2 * wobble;
        if (d <= r) paint(ry * N + rx, d);
      }
  };
  const centre = (t: number) => t * TILE_PX + TILE_PX / 2;
  /** Links to E/S neighbours and to diagonal ones (always for rivers, whose
   * staircase steps then fill into a smooth channel; otherwise only when no
   * orthogonal path exists). Each unordered pair is emitted once. */
  const links = (x: number, y: number, ok: (t: number) => boolean, emit: (bx: number, by: number) => void, allDiagonals = false) => {
    const e = ok(src.tileAt(x + 1, y));
    const s = ok(src.tileAt(x, y + 1));
    const w = ok(src.tileAt(x - 1, y));
    if (e) emit(x + 1, y);
    if (s) emit(x, y + 1);
    if ((allDiagonals || (!e && !s)) && ok(src.tileAt(x + 1, y + 1))) emit(x + 1, y + 1);
    if ((allDiagonals || (!w && !s)) && ok(src.tileAt(x - 1, y + 1))) emit(x - 1, y + 1);
  };
  // Rivers: continuous channels between river tile centres.
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const t = src.tileAt(x, y);
      if (!isRiverTile(t)) continue;
      const ford = t === Tile.Ford;
      const paint = (i: number) => {
        const m = mat[i] as number;
        if (m >= LAND && m !== M.Deck && m !== M.Plaza) mat[i] = ford ? M.Ford : M.River;
      };
      capsule(centre(x), centre(y), centre(x), centre(y), 6.5, 1.5, paint);
      links(x, y, isRiverTile, (bx, by) => capsule(centre(x), centre(y), centre(bx), centre(by), 6.5, 1.5, paint), true);
    }
  // Plazas: a round paved square around each plaza tile.
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      if (src.tileAt(x, y) !== Tile.Plaza) continue;
      const earth = x >= 0 && x < src.width && src.earthPlazas.has(y * src.width + x);
      capsule(centre(x), centre(y), centre(x), centre(y), earth ? 9 : 13, 1, (i, d) => {
        const m = mat[i] as number;
        if (earth) {
          // Village yard: street-coloured packed earth.
          if (m === M.Town) roadDist[i] = Math.min(roadDist[i] as number, Math.round(d * 6));
        } else if (m === M.Town || m === M.Plaza) {
          mat[i] = M.Plaza;
          roadDist[i] = Math.min(roadDist[i] as number, Math.round(d * 16));
        }
      });
    }
  // Streets: packed-earth avenues from each plaza out to the town edges
  // (where the walls leave their gates), drawn as road-coloured town ground.
  for (let y = ty0 - 12; y <= ty1 + 12; y++)
    for (let x = tx0 - 12; x <= tx1 + 12; x++) {
      if (src.tileAt(x, y) !== Tile.Plaza) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        let k = 1;
        while (k < 10) {
          const t = src.tileAt(x + dx * k, y + dy * k);
          if (t !== Tile.TownGround && t !== Tile.Plaza && t !== Tile.Bridge) break;
          k++;
        }
        const ex = centre(x + dx * (k - 1)) + dx * 8;
        const ey = centre(y + dy * (k - 1)) + dy * 8;
        if (Math.max(ex, centre(x)) < ox - 8 || Math.min(ex, centre(x)) > ox + N + 8) continue;
        if (Math.max(ey, centre(y)) < oy - 8 || Math.min(ey, centre(y)) > oy + N + 8) continue;
        capsule(centre(x), centre(y), ex, ey, 3.8, 0.8, (i, d) => {
          if (mat[i] === M.Town) roadDist[i] = Math.min(roadDist[i] as number, Math.round(d * 16));
        });
      }
    }
  // Roads: dirt paths between road tiles, entering towns and bridges.
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const t = src.tileAt(x, y);
      if (!isRoadTile(t)) continue;
      const paint = (i: number, d: number) => {
        const m = mat[i] as number;
        if (ROADABLE[m]) mat[i] = M.Road;
        if (mat[i] === M.Road) roadDist[i] = Math.min(roadDist[i] as number, Math.round(d * 16));
      };
      capsule(centre(x), centre(y), centre(x), centre(y), 4.6, 1, paint);
      links(x, y, roadLinks, (bx, by) => capsule(centre(x), centre(y), centre(bx), centre(by), 4.6, 1, paint));
    }
  yield;
  const dLand = new Uint8Array(N * N);
  const dSea = new Uint8Array(N * N);
  const dRiver = new Uint8Array(N * N);
  const classes = new Uint8Array(N * N);
  let relief = false;
  for (let i = 0; i < mat.length; i++) {
    const m = mat[i] as number;
    classes[i] = MAT_CLASS[m] as number;
    if (m >= M.Hill && m <= M.Snow) relief = true;
  }
  distanceField(classes, CLASS_LAND, dLand);
  yield;
  distanceField(classes, CLASS_SEA, dSea);
  distanceField(classes, CLASS_RIVER, dRiver);
  return { ox, oy, mat, roadDist, dLand, dSea, dRiver, relief };
}

