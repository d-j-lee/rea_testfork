// Procedural terrain: every tile of the generated map is rendered at pixel
// level into chunk canvases. Natural materials meet along noise-displaced
// organic edges (coasts, banks, forest margins); roads and rivers are stamped
// as wobbling capsules between tile centres so they read as continuous paths;
// relief comes from hillshading and contour ledges; decorations (pines,
// tufts, rocks, crags) are placed per tile from coordinate hashes and drawn in
// depth order, overlapping neighbouring tiles and chunks seamlessly.
//
// A chunk is CHUNK_TILES² tiles. Building one is pure and deterministic for
// (map, chunk, season); the world renderer caches and evicts them. Modules:
// terrain-region (materials, distances), terrain-colour (pixels),
// terrain-decor (placement), terrain-art / terrain-props (sprites, palettes).

import type { Surface } from "./pixel.ts";
import { context2d } from "./pixel.ts";
import { Raster, hash01, withAlpha } from "./raster.ts";
import { terrainPalette, type Season, type TerrainPalette } from "./terrain-art.ts";
import { colourPass, prepareRelief } from "./terrain-colour.ts";
import { placeDecor, type DecorItem } from "./terrain-decor.ts";
import { CHUNK_PX, LAND, M, MARGIN, REGION, buildRegion, isSeaMat, type Region, type TerrainSource } from "./terrain-region.ts";

export { CHUNK_PX, CHUNK_TILES, TerrainSource } from "./terrain-region.ts";

export interface TerrainChunk {
  readonly cx: number;
  readonly cy: number;
  readonly season: Season;
  /** Opaque CHUNK_PX² ground art. */
  readonly ground: Surface;
  /** Transparent surf ring around coasts, faded in and out per frame. */
  readonly foam: Surface | null;
  /** Ripple spawn points: [x, y, kind, phase, period] × count (world px). */
  readonly ripples: Float32Array;
  readonly rippleCount: number;
  /** Milliseconds spent building (for profiling). */
  readonly buildMs: number;
}

export const RIPPLE_STRIDE = 5;
export const RIPPLE_WAVE = 0;
export const RIPPLE_RIVER = 1;
export const RIPPLE_GLINT = 2;

/** Phase timings (ms) of the most recent chunk build, for profiling tools. */
export const lastBuildProfile = { region: 0, colour: 0, decor: 0, water: 0 };

/**
 * Chunk build as resumable steps (region → colour → decorations → water), so
 * prefetching can spread one chunk over several frames. Each `next()` runs
 * one phase; the final result is the chunk.
 */
export function* terrainChunkJob(src: TerrainSource, cx: number, cy: number, season: Season): Generator<void, TerrainChunk, void> {
  let spent = 0;
  let t = performance.now();
  const lap = () => {
    const now = performance.now();
    const d = now - t;
    spent += d;
    t = now;
    return d;
  };
  const pal = terrainPalette(season);
  // Region: vote, stamps, distance fields (each its own step).
  const regionSteps = buildRegion(src, cx, cy);
  let regionStep = regionSteps.next();
  let regionMs = lap();
  while (!regionStep.done) {
    yield;
    t = performance.now();
    regionStep = regionSteps.next();
    regionMs += lap();
  }
  const region = regionStep.value;
  lastBuildProfile.region = regionMs;
  const relief = prepareRelief(src, region);
  let colourMs = lap();
  const raster = new Raster(CHUNK_PX, CHUNK_PX);
  for (let y = 0; y < CHUNK_PX; y += 64) {
    yield;
    t = performance.now();
    colourPass(src, region, relief, pal, raster, y, y + 64);
    colourMs += lap();
  }
  yield;
  t = performance.now();
  const ground = raster.toSurface();
  lastBuildProfile.colour = colourMs + lap();
  yield;
  t = performance.now();
  const ctx = context2d(ground);
  const items: DecorItem[] = [];
  placeDecor(src, region, pal, items);
  items.sort((a, b) => a.y - b.y || a.x - b.x || a.order - b.order);
  const x0 = cx * CHUNK_PX;
  const y0 = cy * CHUNK_PX;
  for (const item of items)
    if (item.shadow) ctx.drawImage(item.shadow.surface, item.x - x0 + item.shadow.ox + 1, item.y - y0 + item.shadow.oy);
  for (const item of items) ctx.drawImage(item.sprite.surface, item.x - x0 + item.sprite.ox, item.y - y0 + item.sprite.oy);
  lastBuildProfile.decor = lap();
  yield;
  t = performance.now();
  const foam = buildFoam(region, pal);
  const ripples = buildRipples(region);
  lastBuildProfile.water = lap();
  return { cx, cy, season, ground, foam, ripples: ripples.points, rippleCount: ripples.count, buildMs: spent };
}

/** Builds one chunk of ground art synchronously. */
export function buildTerrainChunk(src: TerrainSource, cx: number, cy: number, season: Season): TerrainChunk {
  const job = terrainChunkJob(src, cx, cy, season);
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}

function buildFoam(region: Region, pal: TerrainPalette): Surface | null {
  const N = REGION;
  const { mat, dLand } = region;
  let raster: Raster | null = null;
  const bright = withAlpha(pal.foam, 230);
  const dim = withAlpha(pal.foamDim, 150);
  for (let y = 0; y < CHUNK_PX; y++)
    for (let x = 0; x < CHUNK_PX; x++) {
      const ri = (y + MARGIN) * N + (x + MARGIN);
      const m = mat[ri] as number;
      if (!isSeaMat(m)) continue;
      const d = (dLand[ri] as number) / 3;
      if (d < 1.5 || d > 4.6) continue;
      const wx = region.ox + MARGIN + x;
      const wy = region.oy + MARGIN + y;
      const gap = hash01(wx >> 1, wy >> 1, 4);
      let c = 0;
      if (d <= 2.6) c = gap < 0.2 ? 0 : bright;
      else if (d <= 3.6) c = gap < 0.55 ? 0 : dim;
      else c = gap < 0.85 ? 0 : dim;
      if (!c) continue;
      raster ??= new Raster(CHUNK_PX, CHUNK_PX);
      raster.data[y * CHUNK_PX + x] = c;
    }
  return raster ? raster.toSurface() : null;
}

function buildRipples(region: Region): { points: Float32Array; count: number } {
  const N = REGION;
  const { mat, dLand, ox, oy } = region;
  const step = 12;
  const out: number[] = [];
  for (let gy = 0; gy < CHUNK_PX; gy += step)
    for (let gx = 0; gx < CHUNK_PX; gx += step) {
      const wx0 = ox + MARGIN + gx;
      const wy0 = oy + MARGIN + gy;
      const r = (k: number) => hash01(wx0, wy0, k);
      const x = gx + Math.floor(r(1) * (step - 4));
      const y = gy + Math.floor(r(2) * (step - 2));
      const ri = (y + MARGIN) * N + (x + MARGIN);
      const m = mat[ri] as number;
      if (m >= LAND) continue;
      const d = (dLand[ri] as number) / 3;
      const river = m === M.River;
      if (m === M.Ford) continue;
      if (river ? d < 3 : d < 5) continue;
      const density = river ? 0.45 : m === M.Deep ? 0.22 : m === M.Sea ? 0.32 : 0.4;
      if (r(3) > density) continue;
      const kind = river ? RIPPLE_RIVER : r(4) < 0.12 ? RIPPLE_GLINT : RIPPLE_WAVE;
      const wx = ox + MARGIN + x - (kind === RIPPLE_GLINT ? 1 : river ? 2 : 3);
      const wy = oy + MARGIN + y - 1;
      out.push(wx, wy, kind, r(5), kind === RIPPLE_GLINT ? 5200 + r(6) * 4000 : 2600 + r(6) * 1800);
    }
  return { points: Float32Array.from(out), count: out.length / RIPPLE_STRIDE };
}

