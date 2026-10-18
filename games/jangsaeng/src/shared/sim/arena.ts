// Battle arena geometry, the one owner of where a battle is fought: the ring
// centre for a site, the ring's main walkable component, and the spots on it
// where participants enter and enemies spawn.
import type { BattleDef } from "../content/schema.ts";
import { MIN_REGION } from "./entities.ts";
import { isBlocked, regionSize, type CollisionGrid } from "./physics.ts";

/**
 * The ground a battle is fought on: a ring around (x, y) and the walkable
 * tiles of its main component, the connected part of the ring the centre
 * stands in. Participants are held on those tiles and every spawn lands on
 * them, so nobody starts in, or is trapped in, a walled pocket of the ring.
 */
export interface Arena {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Grid width, for tile indices. */
  readonly width: number;
  /** Tile indices (y·width + x) of the main component. */
  readonly tiles: ReadonlySet<number>;
  /** Walkable tiles inside the ring: the main component plus any pockets. */
  readonly walkable: number;
}

/** The main component holds at least this share of the ring's walkable tiles… */
export const ARENA_COVERAGE = 0.55;
/** …and at least this share of the ring's area, so the fight has room. */
export const ARENA_ROOM = 0.3;

export const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** True when the arena's main component is the ring's ground (see ARENA_*). */
export function arenaFits(arena: Arena): boolean {
  const room = Math.PI * arena.radius * arena.radius;
  return arena.tiles.size >= ARENA_COVERAGE * arena.walkable && arena.tiles.size >= ARENA_ROOM * room;
}

/** True when tile (x, y) lies in a walkable 2×2 block: room to pass, not a one-tile gap in a wall. */
function clear(grid: CollisionGrid, x: number, y: number): boolean {
  const free = (dx: number, dy: number) => !isBlocked(grid, x + dx, y + dy);
  if (!free(0, 0)) return false;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)
    if (free(sx, 0) && free(0, sy) && free(sx, sy)) return true;
  return false;
}

/**
 * The ring around tile centre (cx, cy): its main component is the clear
 * ground connected to the centre plus the walkable tiles at its edge. A
 * pocket joined only through a one-tile gap is not part of it — fighters
 * steer rather than path-find, and would jam in the gap.
 */
function ringAt(grid: CollisionGrid, cx: number, cy: number, radius: number): Arena {
  const { width } = grid;
  const r = Math.ceil(radius);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const open = (x: number, y: number) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius && !isBlocked(grid, x, y);
  let walkable = 0;
  for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) if (open(x, y)) walkable++;
  const tiles = new Set<number>();
  if (open(x0, y0) && clear(grid, x0, y0)) {
    const core = [y0 * width + x0];
    tiles.add(y0 * width + x0);
    for (let k = 0; k < core.length; k++) {
      const i = core[k] as number;
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const j = (y + dy) * width + x + dx;
        if (tiles.has(j) || !open(x + dx, y + dy)) continue;
        tiles.add(j);
        // Edge tiles join the ground; only clear tiles carry it further.
        if (clear(grid, x + dx, y + dy)) core.push(j);
      }
    }
  }
  return { x: cx, y: cy, radius, width, tiles, walkable };
}

/**
 * Resolves where a battle ring around (x, y) is fought: the nearest tile
 * centre within max(4, radius) tiles whose ring fits (arenaFits), standing in
 * a walkable region of at least MIN_REGION tiles. Falls back to the candidate
 * with the largest main component; null when no walkable tile is near.
 */
export function resolveArena(grid: CollisionGrid, x: number, y: number, radius: number): Arena | null {
  const reach = Math.max(4, Math.ceil(radius));
  const candidates: { tx: number; ty: number; d: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const tx = Math.floor(x) + dx;
      const ty = Math.floor(y) + dy;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d > reach || isBlocked(grid, tx, ty) || regionSize(grid, tx, ty) < MIN_REGION) continue;
      candidates.push({ tx, ty, d });
    }
  candidates.sort((m, n) => m.d - n.d || m.ty - n.ty || m.tx - n.tx);
  let best: Arena | null = null;
  for (const c of candidates) {
    const arena = ringAt(grid, c.tx + 0.5, c.ty + 0.5, radius);
    if (arenaFits(arena)) return arena;
    if (!best || arena.tiles.size > best.tiles.size) best = arena;
  }
  return best;
}

/** The arena of a battle at its site (site centre + offset). */
export function battleArena(grid: CollisionGrid, site: { x: number; y: number }, def: Pick<BattleDef, "offset" | "radius">): Arena | null {
  const [dx, dy] = def.offset ?? [0, 0];
  return resolveArena(grid, site.x + 0.5 + dx, site.y + 0.5 + dy, def.radius);
}

/** True when (x, y) is on a main-component tile, whether or not inside the radius. */
export const onArenaTile = (arena: Arena, x: number, y: number): boolean =>
  arena.tiles.has(Math.floor(y) * arena.width + Math.floor(x));

/** True when (x, y) is on a tile whose centre lies inside the ring. */
export const inRing = (arena: Arena, x: number, y: number): boolean =>
  Math.hypot(Math.floor(x) + 0.5 - arena.x, Math.floor(y) + 0.5 - arena.y) <= arena.radius;

/** True when (x, y) stands inside the ring on the arena's main component. */
export function onArena(arena: Arena, x: number, y: number): boolean {
  return onArenaTile(arena, x, y) && Math.hypot(x - arena.x, y - arena.y) <= arena.radius;
}

const centreOf = (arena: Arena, i: number) => ({ x: (i % arena.width) + 0.5, y: Math.floor(i / arena.width) + 0.5 });

/** Centre of the arena tile nearest to (x, y). */
export function arenaSpot(arena: Arena, x: number, y: number): { x: number; y: number } {
  if (onArena(arena, x, y)) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
  let best = { x: arena.x, y: arena.y };
  let bestD = Infinity;
  for (const i of arena.tiles) {
    const p = centreOf(arena, i);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

type Point = { x: number; y: number };

/** Score penalty for a spawn tile within reach of someone already fighting. */
const crowding = (p: Point, avoid: readonly Point[]) => avoid.reduce((s, q) => s + (Math.hypot(p.x - q.x, p.y - q.y) < 4 ? 6 : 0), 0);

/** The arena tile with the lowest score (null when the arena has no tiles left). */
function bestTile(arena: Arena, score: (p: Point) => number, used?: ReadonlySet<number>): number {
  let best = -1;
  let bestScore = Infinity;
  for (const i of arena.tiles) {
    if (used?.has(i)) continue;
    const s = score(centreOf(arena, i));
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/** Where a boss enters: 40% of the way to the rim on the enemy side, clear of the people already there. */
export function bossSpot(arena: Arena, angle: number, avoid: readonly Point[]): Point {
  const r = arena.radius * 0.4;
  const gx = arena.x + Math.cos(angle) * r;
  const gy = arena.y + Math.sin(angle) * r;
  const best = bestTile(arena, (p) => Math.hypot(p.x - gx, p.y - gy) + crowding(p, avoid));
  return best < 0 ? { x: arena.x, y: arena.y } : centreOf(arena, best);
}

const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * An unused arena tile on the rim toward `angle`: the outermost ground in
 * that direction, searched along the arc when the rim there is water or
 * wall, and kept away from the people already fighting so a wave is seen
 * walking in. Marks the tile used.
 */
export function rimSpot(arena: Arena, angle: number, avoid: readonly Point[], used: Set<number>): Point {
  const best = bestTile(arena, (p) => {
    const d = Math.hypot(p.x - arena.x, p.y - arena.y);
    return angleGap(Math.atan2(p.y - arena.y, p.x - arena.x), angle) * 2 + (1 - d / arena.radius) * 3 + crowding(p, avoid);
  }, used);
  if (best < 0) return { x: arena.x, y: arena.y };
  used.add(best);
  return centreOf(arena, best);
}
