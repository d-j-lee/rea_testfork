// World renderer: ground chunks (cached, LRU-evicted; missing visible chunks
// build synchronously, neighbours ahead of the camera are prefetched in small
// time slices on idle frames; a season change swaps chunks in progressively),
// animated water (ripples, glints, surf) drawn per frame for visible chunks
// only, and depth-sorted structure drawables.

import type { GameMap } from "../../shared/map/generate.ts";
import { rippleSet, type Season } from "./terrain-art.ts";
import {
  CHUNK_PX,
  CHUNK_TILES,
  RIPPLE_GLINT,
  RIPPLE_RIVER,
  RIPPLE_STRIDE,
  TerrainSource,
  buildTerrainChunk,
  terrainChunkJob,
  type TerrainChunk,
} from "./terrain.ts";
import { StructureLayer } from "./structures.ts";
import type { Camera, Drawable } from "./types.ts";

export type { Season } from "./terrain-art.ts";

/**
 * Sets the world→device transform with an integer scale and integer device
 * translation, so pixel art never resamples or blurs.
 */
export function applyCamera(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const s = Math.max(1, Math.round(camera.scale));
  const tx = Math.round(camera.width / 2 - camera.x * s);
  const ty = Math.round(camera.height / 2 - camera.y * s);
  ctx.setTransform(s, 0, 0, s, tx, ty);
  ctx.imageSmoothingEnabled = false;
}

/** Visible world-pixel rectangle of a camera. */
export function worldViewOf(camera: Camera): { x0: number; y0: number; x1: number; y1: number } {
  const s = Math.max(1, Math.round(camera.scale));
  const tx = Math.round(camera.width / 2 - camera.x * s);
  const ty = Math.round(camera.height / 2 - camera.y * s);
  return { x0: -tx / s, y0: -ty / s, x1: (camera.width - tx) / s, y1: (camera.height - ty) / s };
}

export interface WorldRendererOptions {
  /** Maximum cached ground chunks (each CHUNK_PX² ≈ 256 KiB). */
  maxChunks?: number;
  /**
   * Prefetch build steps run per idle frame (a chunk takes about ten steps of
   * 0.5–4 ms each on desktop; 0 disables prefetching).
   */
  prefetchPerFrame?: number;
}

export interface WorldRenderStats {
  cachedChunks: number;
  builtLastFrame: number;
  buildMsLastFrame: number;
  totalBuilt: number;
  ripplesDrawn: number;
}

/** Chunks this far outside the map are still drawn (sea / clamped land). */
const OUTSIDE = 2;

export class WorldRenderer {
  readonly map: GameMap;
  readonly source: TerrainSource;
  #season: Season = "summer";
  #year = 1450;
  readonly #chunks = new Map<number, TerrainChunk>();
  readonly #maxChunks: number;
  readonly #prefetch: number;
  readonly #structures: StructureLayer;
  #lastCentre: { x: number; y: number } | null = null;
  /** Smoothed camera velocity (world px per frame) steering prefetch. */
  #velocity = { x: 0, y: 0 };
  #job: { key: number; cx: number; cy: number; season: Season; steps: Generator<void, TerrainChunk, void> } | null = null;
  readonly #stats: WorldRenderStats = {
    cachedChunks: 0,
    builtLastFrame: 0,
    buildMsLastFrame: 0,
    totalBuilt: 0,
    ripplesDrawn: 0,
  };

  constructor(map: GameMap, options: WorldRendererOptions = {}) {
    this.map = map;
    this.source = new TerrainSource(map);
    this.#maxChunks = Math.max(8, options.maxChunks ?? 64);
    this.#prefetch = Math.max(0, options.prefetchPerFrame ?? 1);
    this.#structures = new StructureLayer(map);
    this.#structures.setYear(this.#year);
    this.#structures.setSeason(this.#season);
  }

  get season(): Season {
    return this.#season;
  }

  get year(): number {
    return this.#year;
  }

  /** Era for structures (walls, palace ruins). Terrain does not depend on it. */
  setYear(year: number): void {
    if (year === this.#year) return;
    this.#year = year;
    this.#structures.setYear(year);
  }

  /**
   * Season palette. By default cached chunks of the old season stay on screen
   * and are rebuilt progressively (visible ones first, a few build steps per
   * frame), so changing season never stalls a frame; `immediate` drops them.
   */
  setSeason(season: Season, options: { immediate?: boolean } = {}): void {
    if (season === this.#season) return;
    this.#season = season;
    if (options.immediate) this.#chunks.clear();
    this.#job = null;
    this.#structures.setSeason(season);
  }

  get stats(): Readonly<WorldRenderStats> {
    this.#stats.cachedChunks = this.#chunks.size;
    return this.#stats;
  }

  #key = (cx: number, cy: number) => (cy + 64) * 1024 + (cx + 64);

  /**
   * Cached chunk (LRU-touched). Missing chunks are built synchronously;
   * stale (other-season) chunks are returned as they are unless `fresh`.
   */
  #chunk(cx: number, cy: number, fresh: boolean): TerrainChunk {
    const key = this.#key(cx, cy);
    let chunk = this.#chunks.get(key);
    if (chunk && (!fresh || chunk.season === this.#season)) {
      this.#chunks.delete(key);
      this.#chunks.set(key, chunk);
      return chunk;
    }
    if (this.#job?.key === key) {
      // Finish the prefetch already in progress for this chunk.
      let step = this.#job.steps.next();
      while (!step.done) step = this.#job.steps.next();
      chunk = step.value;
      this.#job = null;
    } else chunk = buildTerrainChunk(this.source, cx, cy, this.#season);
    this.#chunks.set(key, chunk);
    this.#stats.builtLastFrame++;
    this.#stats.buildMsLastFrame += chunk.buildMs;
    this.#stats.totalBuilt++;
    return chunk;
  }

  #inRange(cx: number, cy: number): boolean {
    const cw = Math.ceil(this.map.width / CHUNK_TILES);
    const ch = Math.ceil(this.map.height / CHUNK_TILES);
    return cx >= -OUTSIDE && cy >= -OUTSIDE && cx < cw + OUTSIDE && cy < ch + OUTSIDE;
  }

  #evict(keep: Set<number>): void {
    for (const key of this.#chunks.keys()) {
      if (this.#chunks.size <= this.#maxChunks) break;
      if (!keep.has(key)) this.#chunks.delete(key);
    }
  }

  /** Builds every chunk the camera sees (loading screens, previews). */
  warm(camera: Camera): void {
    const range = this.#chunkRange(camera, 1);
    for (let cy = range.y0; cy <= range.y1; cy++)
      for (let cx = range.x0; cx <= range.x1; cx++) if (this.#inRange(cx, cy)) this.#chunk(cx, cy, true);
  }

  #stale(cx: number, cy: number): boolean {
    const chunk = this.#chunks.get(this.#key(cx, cy));
    return !chunk || chunk.season !== this.#season;
  }

  #chunkRange(camera: Camera, margin: number) {
    const view = worldViewOf(camera);
    return {
      view,
      x0: Math.floor(view.x0 / CHUNK_PX) - margin,
      y0: Math.floor(view.y0 / CHUNK_PX) - margin,
      x1: Math.floor((view.x1 - 1) / CHUNK_PX) + margin,
      y1: Math.floor((view.y1 - 1) / CHUNK_PX) + margin,
    };
  }

  /** Draws terrain and animated water. Call after applyCamera(ctx, camera). */
  drawGround(ctx: CanvasRenderingContext2D, camera: Camera, timeMs: number): void {
    this.#stats.builtLastFrame = 0;
    this.#stats.buildMsLastFrame = 0;
    this.#stats.ripplesDrawn = 0;
    ctx.imageSmoothingEnabled = false;
    if (this.#lastCentre) {
      const dx = camera.x - this.#lastCentre.x;
      const dy = camera.y - this.#lastCentre.y;
      const jump = Math.abs(dx) > CHUNK_PX || Math.abs(dy) > CHUNK_PX;
      this.#velocity.x = jump ? 0 : this.#velocity.x * 0.8 + dx * 0.2;
      this.#velocity.y = jump ? 0 : this.#velocity.y * 0.8 + dy * 0.2;
    }
    this.#lastCentre = { x: camera.x, y: camera.y };
    const { view, x0, y0, x1, y1 } = this.#chunkRange(camera, 0);
    const keep = new Set<number>();
    const visible: TerrainChunk[] = [];
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.#inRange(cx, cy)) continue;
        const chunk = this.#chunk(cx, cy, false);
        keep.add(this.#key(cx, cy));
        visible.push(chunk);
        ctx.drawImage(chunk.ground, cx * CHUNK_PX, cy * CHUNK_PX);
      }
    // Surf breathes in and out along every coast.
    const surf = 0.5 + 0.5 * Math.sin((timeMs / 2600) * Math.PI * 2);
    ctx.globalAlpha = 0.25 + surf * 0.6;
    for (const chunk of visible) if (chunk.foam) ctx.drawImage(chunk.foam, chunk.cx * CHUNK_PX, chunk.cy * CHUNK_PX);
    ctx.globalAlpha = 1;
    this.#drawRipples(ctx, visible, view, timeMs);
    // Idle frames advance one prefetch job by a phase at a time (nearest
    // missing chunk around the view), then pre-generate structure sprites.
    if (this.#stats.builtLastFrame === 0 && this.#prefetch > 0) this.#prefetchStep(x0, y0, x1, y1, view, keep);
    this.#evict(keep);
  }

  #prefetchStep(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    view: { x0: number; y0: number; x1: number; y1: number },
    keep: Set<number>,
  ): void {
    for (let cy = y0 - 1; cy <= y1 + 1; cy++)
      for (let cx = x0 - 1; cx <= x1 + 1; cx++) if (this.#inRange(cx, cy)) keep.add(this.#key(cx, cy));
    if (!this.#job) {
      // Nearest missing chunk, measured from a point ahead of the camera;
      // while moving, chunks behind the direction of travel are skipped.
      let best: { cx: number; cy: number; d: number } | null = null;
      const vx = this.#velocity.x;
      const vy = this.#velocity.y;
      const speed = Math.hypot(vx, vy);
      const moving = speed > 0.25;
      const mx = (x0 + x1) / 2 + (moving ? (vx / speed) * 1.5 : 0);
      const my = (y0 + y1) / 2 + (moving ? (vy / speed) * 1.5 : 0);
      for (let cy = y0 - 1; cy <= y1 + 1; cy++)
        for (let cx = x0 - 1; cx <= x1 + 1; cx++) {
          if (!this.#inRange(cx, cy) || !this.#stale(cx, cy)) continue;
          const visible = cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
          if (visible) {
            // Stale visible chunks (after a season change) come first.
            const d = -1000 + (cx - mx) ** 2 + (cy - my) ** 2;
            if (!best || d < best.d) best = { cx, cy, d };
            continue;
          }
          if (moving) {
            const outX = cx < x0 ? -1 : cx > x1 ? 1 : 0;
            const outY = cy < y0 ? -1 : cy > y1 ? 1 : 0;
            if (outX * vx + outY * vy < 0 || (outX !== 0 && outX * vx <= 0 && outY === 0) || (outY !== 0 && outY * vy <= 0 && outX === 0)) continue;
          }
          const d = (cx - mx) ** 2 + (cy - my) ** 2;
          if (!best || d < best.d) best = { cx, cy, d };
        }
      if (best) {
        const { cx, cy } = best;
        this.#job = { key: this.#key(cx, cy), cx, cy, season: this.#season, steps: terrainChunkJob(this.source, cx, cy, this.#season) };
      }
    }
    if (this.#job) {
      const job = this.#job;
      const urgent = job.cx >= x0 && job.cx <= x1 && job.cy >= y0 && job.cy <= y1;
      for (let k = 0; k < (urgent ? Math.max(2, this.#prefetch) : this.#prefetch) && this.#job; k++) {
        const step = this.#job.steps.next();
        if (step.done) {
          this.#chunks.set(this.#job.key, step.value);
          this.#stats.totalBuilt++;
          this.#job = null;
        }
      }
      return;
    }
    const margin = CHUNK_PX / 2;
    this.#structures.prewarm({ x0: view.x0 - margin, y0: view.y0 - margin, x1: view.x1 + margin, y1: view.y1 + margin }, 2);
  }

  #drawRipples(
    ctx: CanvasRenderingContext2D,
    chunks: readonly TerrainChunk[],
    view: { x0: number; y0: number; x1: number; y1: number },
    timeMs: number,
  ): void {
    const set = rippleSet();
    let drawn = 0;
    for (const chunk of chunks) {
      const p = chunk.ripples;
      for (let i = 0; i < chunk.rippleCount; i++) {
        const o = i * RIPPLE_STRIDE;
        const x = p[o] as number;
        const y = p[o + 1] as number;
        if (x < view.x0 - 8 || y < view.y0 - 4 || x > view.x1 || y > view.y1) continue;
        const kind = p[o + 2] as number;
        const phase = p[o + 3] as number;
        const period = p[o + 4] as number;
        const u = (timeMs / period + phase) % 1;
        let frame: HTMLCanvasElement | undefined;
        let dx = 0;
        if (kind === RIPPLE_GLINT) {
          if (u < 0.07) frame = set.glint[Math.floor((u / 0.07) * set.glint.length)];
        } else if (kind === RIPPLE_RIVER) {
          if (u < 0.42) frame = set.river[Math.floor((u / 0.42) * set.river.length)];
        } else if (u < 0.5) {
          frame = set.wave[Math.floor((u / 0.5) * set.wave.length)];
          dx = Math.floor(u * 4);
        }
        if (!frame) continue;
        ctx.drawImage(frame, x + dx, y);
        drawn++;
      }
    }
    this.#stats.ripplesDrawn = drawn;
  }

  /** Visible structures as depth-sortable drawables (merge with characters). */
  structureDrawables(camera: Camera, timeMs: number): Drawable[] {
    return this.#structures.visible(worldViewOf(camera), timeMs);
  }
}

export { CHUNK_PX, CHUNK_TILES };
