// Terrain colour pass: per-pixel colour for every material from seasonal
// ramps with ordered dithering, hillshade, contour ledges, coast/bank edges,
// winter snow cover and frozen river edges.

import { Tile } from "../../shared/map/tiles.ts";
import { TILE_PX } from "../../shared/sprites.ts";
import { Raster, bayer, hash01, hash3, mixRgba, pickRamp, type Rgba } from "./raster.ts";
import type { TerrainPalette } from "./terrain-art.ts";
import { CHUNK_PX, LAND, M, MARGIN, REGION, type Region, type TerrainSource } from "./terrain-region.ts";

const BAND = 26;

export interface Relief {
  /** Contour band index per pixel (interior + a few rows below). */
  readonly bands: Int16Array;
  /** Bilinear elevation per pixel (same layout). */
  readonly elevRows: Float32Array;
}

export function prepareRelief(src: TerrainSource, region: Region): Relief {
  const { ox, oy } = region;
  const bands = new Int16Array(CHUNK_PX * (CHUNK_PX + 6));
  const elevRows = new Float32Array(CHUNK_PX * (CHUNK_PX + 6));
  for (let y = 0; y < (region.relief ? CHUNK_PX + 6 : 0); y++) {
    const wy = oy + MARGIN + y;
    const row = elevRows.subarray(y * CHUNK_PX, (y + 1) * CHUNK_PX);
    src.sampleRow(src.elev, wy, ox + MARGIN, row);
    for (let x = 0; x < CHUNK_PX; x++) {
      const wx = ox + MARGIN + x;
      const wob = ((src.noiseMid.data[((wy & 127) << 7) | (wx & 127)] as number) - 0.5) * 14;
      bands[y * CHUNK_PX + x] = Math.floor(((row[x] as number) + wob) / BAND);
    }
  }
  return { bands, elevRows };
}

/** Colours chunk rows [y0, y1) into `out`. */
export function colourPass(src: TerrainSource, region: Region, relief: Relief, pal: TerrainPalette, out: Raster, y0: number, y1: number): void {
  const N = REGION;
  const { mat, dLand, dSea, dRiver, roadDist, ox, oy } = region;
  const { bands, elevRows } = relief;
  const bandAt = (x: number, y: number) => bands[y * CHUNK_PX + x] as number;
  const winter = pal.season === "winter";
  const W = src.width;
  const shadeRow = new Float32Array(CHUNK_PX);
  const data = out.data;
  for (let y = y0; y < y1; y++) {
    const wy = oy + MARGIN + y;
    const ty = Math.floor(wy / TILE_PX);
    const ly = wy - ty * TILE_PX;
    src.sampleRow(src.shade, wy, ox + MARGIN, shadeRow);
    for (let x = 0; x < CHUNK_PX; x++) {
      const wx = ox + MARGIN + x;
      const tx = Math.floor(wx / TILE_PX);
      const lx = wx - tx * TILE_PX;
      const ri = (y + MARGIN) * N + (x + MARGIN);
      const m = mat[ri] as number;
      const n1 = src.noiseLow.data[((wy & 255) << 8) | (wx & 255)] as number;
      const n2 = src.noiseMid.data[((wy & 127) << 7) | (wx & 127)] as number;
      const h = hash01(wx, wy, 7);
      const dither = bayer(wx, wy);
      const shade = shadeRow[x] as number;
      const tileIndex = Math.max(0, Math.min(src.height - 1, ty)) * W + Math.max(0, Math.min(W - 1, tx));
      const snowBase = winter ? (src.snow[tileIndex] as number) : 0;
      let c: Rgba;
      if (m < LAND) {
        c = waterColour(src, pal, m, wx, wy, dLand[ri] as number, dSea[ri] as number, n1, n2, h, dither, snowBase);
      } else {
        const ds = (dSea[ri] as number) / 3;
        const dr = (dRiver[ri] as number) / 3;
        let v = 0.5 + shade * 0.36 + (n1 - 0.5) * 0.36 + (n2 - 0.5) * 0.26;
        let snowable = true;
        let relief = 0;
        switch (m) {
          case M.Sand: {
            v = 0.55 + (n2 - 0.5) * 0.3 + shade * 0.2 + (h - 0.5) * 0.12;
            c = pickRamp(pal.sand, v, dither * 0.6);
            if (ds <= 1.4) c = pal.wetSand;
            else if (ds <= 2.4 && dither > -0.1) c = mixRgba(pal.wetSand, c, 0.5);
            break;
          }
          case M.Grass:
          case M.Meadow:
          case M.Forest: {
            const colors = m === M.Grass ? pal.grass : m === M.Meadow ? pal.meadow : pal.forestFloor;
            if (h < 0.03) v += 0.22;
            else if (h > 0.975) v -= 0.22;
            c = pickRamp(colors, v, dither * 0.55);
            if (ds <= 1.4) c = mixRgba(pal.sand[2] as Rgba, c, 0.35);
            else if (ds <= 2.4 && dither > 0) c = pal.sand[1] as Rgba;
            if (dr <= 1.4) c = pal.bank;
            else if (dr <= 2.4) c = mixRgba(c, pal.bank, 0.5);
            break;
          }
          case M.Hill:
          case M.Mountain:
          case M.Peak:
          case M.Snow: {
            const e = (elevRows[y * CHUNK_PX + x] as number) / 255;
            v = 0.5 + shade * 0.55 + (n1 - 0.5) * 0.25 + (n2 - 0.5) * 0.3;
            let colors = m === M.Hill ? pal.hill : pal.scrub;
            if (m === M.Mountain) {
              const rocky = (e - 0.58) * 2.6 + (n2 - 0.5) * 1.6 + (n1 - 0.5) * 0.6;
              if (rocky > 0.32) colors = pal.rock;
            } else if (m === M.Peak) {
              colors = pal.rock;
              const snowLine = winter ? 0.7 : pal.season === "summer" ? 1.1 : pal.season === "autumn" ? 0.94 : 0.9;
              if (e + (n2 - 0.5) * 0.12 + (n1 - 0.5) * 0.08 > snowLine) colors = pal.snow;
            } else if (m === M.Snow) {
              const patch = pal.season === "summer" ? n2 + (n1 - 0.5) * 0.6 : n2 + 0.35;
              colors = patch > 0.55 ? pal.snow : pal.scrub;
            }
            // Contour ledges: a lit rim above, a shaded cliff face below.
            const b0 = bandAt(x, y);
            if (b0 > bandAt(x, y + 1)) relief = 0.3;
            else if (y > 0 && bandAt(x, y - 1) > b0) relief = -0.5;
            else if (y > 1 && bandAt(x, y - 2) > b0) relief = -0.34;
            else if (bandAt(x, y + 1) > b0) relief = -0.2;
            v += relief;
            if (h < 0.012) v -= 0.22;
            c = pickRamp(colors, v, dither * 0.5);
            if (dr <= 1.4) c = mixRgba(c, pal.bank, 0.6);
            break;
          }
          case M.Marsh: {
            const puddle = n2 + (n1 - 0.5) * 0.5;
            if (puddle > 0.64) c = pickRamp(pal.puddle, 0.4 + (puddle - 0.64) * 3 + dither * 0.2, 0);
            else {
              v = 0.5 + (n1 - 0.5) * 0.4 + (n2 - 0.5) * 0.35 + (puddle > 0.6 ? -0.35 : 0);
              c = pickRamp(pal.marsh, v, dither * 0.5);
            }
            if (ds <= 1.4) c = mixRgba(c, pal.puddle[1] as Rgba, 0.4);
            snowable = puddle < 0.6;
            break;
          }
          case M.Road: {
            const d = (roadDist[ri] as number) / 16;
            v = 0.56 + (n2 - 0.5) * 0.3 + (h - 0.5) * 0.16;
            if (d > 3.6) v -= 0.2;
            else if (d > 1.5 && d < 2.5) v -= 0.18;
            c = pickRamp(pal.road, v, dither * 0.4);
            if (winter && snowBase + (n1 - 0.5) * 0.5 > 0.85 && d < 3.4) c = mixRgba(c, pal.snow[2] as Rgba, 0.55);
            snowable = false;
            break;
          }
          case M.Town: {
            const street = (roadDist[ri] as number) / 16;
            if (street < 4.6) {
              v = 0.6 + (n2 - 0.5) * 0.25 + (h - 0.5) * 0.14;
              if (street > 3.4) v -= 0.16;
              else if (street > 1.4 && street < 2.3) v -= 0.14;
              c = pickRamp(pal.road, v, dither * 0.4);
              break;
            }
            v = 0.5 + (n1 - 0.5) * 0.4 + (n2 - 0.5) * 0.2 + shade * 0.2;
            if (h < 0.035) v -= 0.25;
            c = pickRamp(pal.town, v, dither * 0.45);
            // Worn grass in quiet corners of town.
            const green = n1 + (n2 - 0.5) * 0.5;
            if (green > 0.7 + dither * 0.06) c = pickRamp(pal.grass, 0.25 + (n2 - 0.5) * 0.4, dither * 0.5);
            else if (green > 0.67 && dither > 0.2) c = pal.grass[1] as Rgba;
            if (dr <= 1.4) c = pal.bank;
            break;
          }
          case M.Plaza:
            c = plazaColour(pal, wx, wy, (roadDist[ri] as number) / 16);
            snowable = false;
            break;
          case M.Paddy:
            c = paddyColour(src, pal, tx, ty, lx, ly, n2, h, dither);
            break;
          case M.Deck:
            c = deckColour(pal, wx, wy);
            snowable = false;
            break;
          default:
            c = pal.grass[2] as Rgba;
        }
        if (winter && snowable) {
          const s = snowBase + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.25 + (m >= M.Mountain && m <= M.Snow ? 0.35 : 0);
          if (s > 0.62 + dither * 0.12) {
            const level = 0.5 + shade * 0.5 + relief * 0.9 + (n2 - 0.5) * 0.22 + (n1 - 0.5) * 0.2 + (h < 0.03 ? -0.2 : 0);
            c = pickRamp(pal.snow, level, dither * 0.5);
          }
        }
      }
      data[y * CHUNK_PX + x] = c;
    }
  }
}

function waterColour(
  src: TerrainSource,
  pal: TerrainPalette,
  m: number,
  wx: number,
  wy: number,
  dLand3: number,
  dSea3: number,
  n1: number,
  n2: number,
  h: number,
  dither: number,
  snow: number,
): Rgba {
  const dl = dLand3 / 3;
  if (m === M.River || m === M.Ford) {
    // Frozen margins: wider the further north (snow propensity), with cracks.
    if (snow > 0.85 && dl <= 2.2 + (snow - 0.85) * 6 + (n2 - 0.5) * 3) {
      if (h < 0.05) return pal.ice[0] as Rgba;
      return pickRamp(pal.ice, 0.55 + (n1 - 0.5) * 0.8 + (dl < 1.5 ? 0.3 : 0), dither * 0.3);
    }
    let v = m === M.Ford ? 0.85 : 0.2 + Math.max(0, 4.5 - dl) * 0.17 + (n2 - 0.5) * 0.15;
    // River mouths fade into the sea colour.
    if (dSea3 / 3 < 6 && dSea3 > 0) v = Math.max(v, 0.6);
    if (dl <= 1.2) return mixRgba(pal.river[4] as Rgba, pal.foamDim, 0.35);
    if (m === M.Ford && h < 0.18) return pal.sand[1] as Rgba;
    return pickRamp(pal.river, v, dither * 0.8);
  }
  let v = src.sample(src.depth, wx, wy) + (n1 - 0.5) * 0.16;
  v = Math.max(v, 1 - dl / 10);
  if (m === M.Deep) v = Math.min(v, 0.5);
  let c = pickRamp(pal.water, Math.min(0.999, v * 0.999), dither * 0.95);
  if (dl <= 1.2) c = h < 0.12 ? pal.foamDim : pal.foam;
  else if (dl <= 2.2 && n2 > 0.5) c = pal.foamDim;
  else if (m === M.Deep && h < 0.002) c = pal.water[3] as Rgba;
  return c;
}

function plazaColour(pal: TerrainPalette, wx: number, wy: number, d: number): Rgba {
  // Kerb ring of darker stones around the square.
  if (d > 11.2 && d < 15) return d > 12.4 ? pal.plazaSeam : (pal.plaza[1] as Rgba);
  const row = Math.floor(wy / 8);
  const off = (row & 1) * 4;
  const col = Math.floor((wx + off) / 8);
  const lx = (wx + off) & 7;
  const ly = wy & 7;
  if (lx === 0 || ly === 0) return pal.plazaSeam;
  let tone = 1 + (hash3(col, row, 3) % 3);
  if (ly === 7) tone -= 1;
  else if (ly === 1 && lx > 1) tone = Math.min(3, tone + 1);
  if (hash01(wx, wy, 9) < 0.04) tone = Math.max(0, tone - 1);
  return pal.plaza[tone] as Rgba;
}

function deckColour(pal: TerrainPalette, wx: number, wy: number): Rgba {
  const row = Math.floor(wy / 4);
  const ly = wy & 3;
  if (ly === 3) return pal.deckSeam;
  const offset = hash3(row, 0, 5) % 32;
  const seg = Math.floor((wx + offset) / 32);
  const lx = (wx + offset) & 31;
  if (lx === 0) return pal.deckSeam;
  if ((lx === 2 || lx === 29) && ly === 1) return pal.deckSeam;
  let tone = 1 + (hash3(row, seg, 6) % 3);
  if (ly === 0) tone = Math.min(3, tone + 1);
  if (hash01(wx, wy, 8) < 0.05) tone -= 1;
  return pal.deck[tone] as Rgba;
}

function paddyColour(
  src: TerrainSource,
  pal: TerrainPalette,
  tx: number,
  ty: number,
  lx: number,
  ly: number,
  n2: number,
  h: number,
  dither: number,
): Rgba {
  const paddy = (x: number, y: number) => src.tileAt(x, y) === Tile.Paddy;
  // Some neighbouring fields merge into longer strips.
  const mergeLeft = paddy(tx - 1, ty) && hash01(tx >> 1, ty, 17) < 0.5 && (tx & 1) === 1;
  const mergeRight = paddy(tx + 1, ty) && hash01((tx + 1) >> 1, ty, 17) < 0.5 && (tx & 1) === 0;
  const bund =
    ly === 0 ||
    (lx === 0 && !mergeLeft) ||
    (ly === 15 && !paddy(tx, ty + 1)) ||
    (lx === 15 && !paddy(tx + 1, ty) && !mergeRight);
  if (bund) return pickRamp(pal.bund, ly === 0 ? 0.75 : 0.45 + n2 * 0.2, dither * 0.4);
  const shadowed = ly === 1 || (lx === 1 && !mergeLeft);
  switch (pal.season) {
    case "spring": {
      if (lx % 3 === 2 && ly % 3 === 2) return pal.rice[shadowed ? 0 : 1] as Rgba;
      const v = 0.35 + (n2 - 0.5) * 0.6 + (h < 0.03 ? 0.4 : 0) - (shadowed ? 0.35 : 0);
      return pickRamp(pal.paddyWater, v, dither * 0.6);
    }
    case "summer": {
      if (lx % 3 === 0) return shadowed ? (pal.paddyWater[0] as Rgba) : (pal.rice[0] as Rgba);
      const v = 0.5 + (n2 - 0.5) * 0.4 + (h - 0.5) * 0.3 - (shadowed ? 0.4 : 0);
      return pickRamp(pal.rice, v, dither * 0.5);
    }
    case "autumn": {
      if (lx % 3 === 0) return pal.rice[0] as Rgba;
      const v = 0.55 + (n2 - 0.5) * 0.4 + (h > 0.9 ? 0.3 : 0) - (shadowed ? 0.4 : 0) - (ly % 4 === 0 ? 0.15 : 0);
      return pickRamp(pal.rice, v, dither * 0.5);
    }
    default: {
      if (lx % 3 === 2 && ly % 3 === 2) return pal.rice[0] as Rgba;
      const v = 0.5 + (n2 - 0.5) * 0.5 - (shadowed ? 0.3 : 0);
      return pickRamp(pal.rice, v, dither * 0.5);
    }
  }
}

