// Movement against the tile grid. Simulation units are tiles (float); one
// tile is TILE_PX world pixels on screen. Bodies are axis-aligned squares of
// half-size `radius`, resolved one axis at a time so they slide along walls.
import { TILE_INFO, type TileId } from "../map/tiles.ts";

export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  /** 1 = blocked. */
  readonly blocked: Uint8Array;
  readonly tiles: Uint8Array;
}

export interface Body {
  x: number;
  y: number;
  radius: number;
}

export function isBlocked(
  grid: CollisionGrid,
  tx: number,
  ty: number,
): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.blocked[ty * grid.width + tx] === 1;
}

/** Terrain speed multiplier under a point (1 when off-grid or unknown). */
export function terrainSpeed(
  grid: CollisionGrid,
  x: number,
  y: number,
): number {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return 1;
  const info = TILE_INFO[grid.tiles[ty * grid.width + tx] as TileId];
  return info && info.speed > 0 ? info.speed : 1;
}

function overlapsBlocked(
  grid: CollisionGrid,
  x: number,
  y: number,
  r: number,
): boolean {
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r - 1e-6);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r - 1e-6);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) if (isBlocked(grid, tx, ty)) return true;
  return false;
}

/**
 * Moves `body` by (dx, dy) tiles, sliding along blocked tiles. Large moves are
 * split into sub-steps so fast bodies cannot tunnel through one-tile walls.
 * Returns true when any axis was obstructed.
 */
export function moveBody(
  grid: CollisionGrid,
  body: Body,
  dx: number,
  dy: number,
): boolean {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25),
  );
  const sx = dx / steps;
  const sy = dy / steps;
  let hit = false;
  for (let step = 0; step < steps; step++) {
    if (sx !== 0) {
      const nx = body.x + sx;
      if (!overlapsBlocked(grid, nx, body.y, body.radius)) body.x = nx;
      else {
        hit = true;
        // Snap flush against the obstacle.
        body.x =
          sx > 0
            ? Math.floor(body.x + body.radius + sx) - body.radius - 1e-4
            : Math.floor(body.x - body.radius + sx) + 1 + body.radius + 1e-4;
        if (overlapsBlocked(grid, body.x, body.y, body.radius))
          body.x = nx - sx;
      }
    }
    if (sy !== 0) {
      const ny = body.y + sy;
      if (!overlapsBlocked(grid, body.x, ny, body.radius)) body.y = ny;
      else {
        hit = true;
        body.y =
          sy > 0
            ? Math.floor(body.y + body.radius + sy) - body.radius - 1e-4
            : Math.floor(body.y - body.radius + sy) + 1 + body.radius + 1e-4;
        if (overlapsBlocked(grid, body.x, body.y, body.radius))
          body.y = ny - sy;
      }
    }
  }
  return hit;
}

interface Components {
  /** Component id per tile (−1 when blocked). */
  readonly labels: Int32Array;
  /** Tile count per component id. */
  readonly sizes: readonly number[];
}

const componentCache = new WeakMap<Uint8Array, Components>();

/** Walkable connected components (4-neighbour), cached per blocked grid. */
export function components(grid: CollisionGrid): Components {
  const cached = componentCache.get(grid.blocked);
  if (cached) return cached;
  const { width, height, blocked } = grid;
  const labels = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < labels.length; start++) {
    if (blocked[start] || labels[start] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const i = queue[head++] as number;
      const x = i % width;
      const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const j of neighbours) {
        if (j < 0 || j >= labels.length || blocked[j] || labels[j] !== -1) continue;
        labels[j] = id;
        queue[tail++] = j;
      }
    }
    sizes.push(tail);
  }
  const result = { labels, sizes };
  componentCache.set(grid.blocked, result);
  return result;
}

/** Size of the walkable region containing tile (tx, ty); 0 when blocked. */
export function regionSize(grid: CollisionGrid, tx: number, ty: number): number {
  if (isBlocked(grid, tx, ty)) return 0;
  const { labels, sizes } = components(grid);
  return sizes[labels[ty * grid.width + tx] as number] ?? 0;
}

/**
 * Nearest unblocked tile centre to (x, y), searching outward in rings. With
 * `minRegion`, tiles in walkable pockets smaller than that are skipped, so
 * placements never land on an unreachable scrap of land between rivers.
 */
export function nearestFree(
  grid: CollisionGrid,
  x: number,
  y: number,
  maxRadius = 12,
  minRegion = 0,
): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const ok = (tx: number, ty: number) =>
    !isBlocked(grid, tx, ty) && (minRegion <= 0 || regionSize(grid, tx, ty) >= minRegion);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(cx + dx, cy + dy)) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
      }
  }
  return null;
}

/** True when a straight segment between two points crosses no blocked tile. */
export function lineOfSight(
  grid: CollisionGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const distance = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(distance / 0.4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (
      isBlocked(
        grid,
        Math.floor(ax + (bx - ax) * t),
        Math.floor(ay + (by - ay) * t),
      )
    )
      return false;
  }
  return true;
}
