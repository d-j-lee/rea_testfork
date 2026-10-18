// Battle arena geometry, the one owner of where a battle is fought: the ring
// centre for a site, the ring's main walkable component, and the spots on it
// where participants enter and revive and enemies spawn or board.
import type { BattleDef } from "../content/schema.ts";
import { TILE_INFO, Tile, type TileId } from "../map/tiles.ts";
import { MIN_REGION } from "./entities.ts";
import { isBlocked, lineOfSight, regionSize, type CollisionGrid } from "./physics.ts";

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
  /** Main-component tiles with a straight, unblocked line to the centre. */
  readonly inSight: ReadonlySet<number>;
  /** A deck battle's arena: centred on a ship's deck and fought mostly on decks (see DECK_*). */
  readonly naval: boolean;
  /** Main-component Deck tiles. */
  readonly deck: ReadonlySet<number>;
  /** Deck tiles at a hull's edge, beside open water: where boarders climb aboard. */
  readonly hull: ReadonlySet<number>;
}

/** The main component holds at least this share of the ring's walkable tiles… */
const ARENA_COVERAGE = 0.55;
/** …and at least this share of the ring's area, so the fight has room. */
const ARENA_ROOM = 0.3;
/** A deck arena holds a couple of hulls of deck… */
export const DECK_MIN = 12;
/** …and decks make up at least this share of its ground (in place of ARENA_ROOM: the fleet is the room). */
export const DECK_SHARE = 0.5;

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

type Ring = Omit<Arena, "inSight" | "hull">;

/** True when the ring is battle ground (see ARENA_* and, for deck battles, DECK_*). */
function fits(ring: Ring): boolean {
  const n = ring.tiles.size;
  if (n < ARENA_COVERAGE * ring.walkable) return false;
  if (ring.naval) return ring.deck.size >= DECK_MIN && ring.deck.size >= DECK_SHARE * n;
  return n >= ARENA_ROOM * Math.PI * ring.radius * ring.radius;
}

/** True when the arena is its battle's ground (see ARENA_* and DECK_*). */
export const arenaFits = (arena: Arena): boolean => fits(arena);

/** True when tile (x, y) lies in a walkable 2×2 block: room to pass, not a one-tile gap in a wall. */
function clear(grid: CollisionGrid, x: number, y: number): boolean {
  const free = (dx: number, dy: number) => !isBlocked(grid, x + dx, y + dy);
  if (!free(0, 0)) return false;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)
    if (free(sx, 0) && free(0, sy) && free(sx, sy)) return true;
  return false;
}

const isDeck = (grid: CollisionGrid, i: number) => grid.tiles[i] === Tile.Deck;

/**
 * The ring around tile centre (cx, cy): its main component is the clear
 * ground connected to the centre plus the walkable tiles at its edge. A
 * pocket joined only through a one-tile gap is not part of it — fighters
 * steer rather than path-find, and would jam in the gap.
 */
function ringAt(grid: CollisionGrid, cx: number, cy: number, radius: number, naval: boolean): Ring {
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
  const deck = new Set([...tiles].filter((i) => isDeck(grid, i)));
  return { x: cx, y: cy, radius, width, tiles, walkable, naval, deck };
}

/**
 * Resolves where a battle ring around (x, y) is fought: the nearest tile
 * centre within max(4, radius) tiles whose ring fits, standing in a walkable
 * region of at least MIN_REGION tiles. A deck battle (`naval`) is centred on
 * a Deck tile when one is in reach. When nothing fits it falls back to the
 * candidate with the largest main component, or for a deck battle the one
 * with the largest deck share; null when no walkable tile is near.
 */
function resolveArena(grid: CollisionGrid, x: number, y: number, radius: number, naval: boolean): Arena | null {
  const reach = Math.max(4, Math.ceil(radius));
  const candidates: { tx: number; ty: number; d: number; deck: boolean }[] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const tx = Math.floor(x) + dx;
      const ty = Math.floor(y) + dy;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d > reach || isBlocked(grid, tx, ty) || regionSize(grid, tx, ty) < MIN_REGION) continue;
      candidates.push({ tx, ty, d, deck: isDeck(grid, ty * grid.width + tx) });
    }
  candidates.sort((m, n) => m.d - n.d || m.ty - n.ty || m.tx - n.tx);
  const onDeck = naval ? candidates.filter((c) => c.deck) : [];
  const share = (ring: Ring) => ring.deck.size / Math.max(1, ring.tiles.size);
  let best: Ring | null = null;
  for (const c of onDeck.length > 0 ? onDeck : candidates) {
    const ring = ringAt(grid, c.tx + 0.5, c.ty + 0.5, radius, naval);
    if (fits(ring)) return finish(grid, ring);
    if (!best || (naval ? share(ring) > share(best) : ring.tiles.size > best.tiles.size)) best = ring;
  }
  return best && finish(grid, best);
}

function finish(grid: CollisionGrid, ring: Ring): Arena {
  const inSight = new Set<number>();
  const hull = new Set<number>();
  for (const i of ring.tiles) {
    const x = i % ring.width;
    const y = (i - x) / ring.width;
    if (lineOfSight(grid, x + 0.5, y + 0.5, ring.x, ring.y)) inSight.add(i);
    if (ring.deck.has(i) && NEIGHBOURS.some(([dx, dy]) => {
      const j = (y + dy) * ring.width + x + dx;
      return !isDeck(grid, j) && TILE_INFO[grid.tiles[j] as TileId]?.water === true;
    })) hull.add(i);
  }
  return { ...ring, inSight, hull };
}

/** The arena of a battle at its site (site centre + offset); deck battles are fought on decks. */
export function battleArena(grid: CollisionGrid, site: { x: number; y: number }, def: Pick<BattleDef, "offset" | "radius" | "kind">): Arena | null {
  const [dx, dy] = def.offset ?? [0, 0];
  return resolveArena(grid, site.x + 0.5 + dx, site.y + 0.5 + dy, def.radius, def.kind === "deck");
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

/** True when (x, y) stands on one of the arena's decks. */
export const onDeck = (arena: Arena, x: number, y: number): boolean =>
  arena.deck.has(Math.floor(y) * arena.width + Math.floor(x));

const centreOf = (arena: Arena, i: number) => ({ x: (i % arena.width) + 0.5, y: Math.floor(i / arena.width) + 0.5 });

/** Centre of the tile among `tiles` nearest to (x, y); the arena centre when there are none. */
function nearestOf(arena: Arena, tiles: ReadonlySet<number>, x: number, y: number): Point {
  let best = { x: arena.x, y: arena.y };
  let bestD = Infinity;
  for (const i of tiles) {
    const p = centreOf(arena, i);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Centre of the arena tile nearest to (x, y). */
export function arenaSpot(arena: Arena, x: number, y: number): Point {
  if (onArena(arena, x, y)) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
  return nearestOf(arena, arena.tiles, x, y);
}

/** Centre of the deck tile nearest to (x, y), where a deck battle's starter stands; arenaSpot without decks. */
export function deckSpot(arena: Arena, x: number, y: number): Point {
  if (arena.deck.size === 0) return arenaSpot(arena, x, y);
  if (onDeck(arena, x, y) && onArena(arena, x, y)) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
  return nearestOf(arena, arena.deck, x, y);
}

type Point = { x: number; y: number };

/** Score penalty for a spawn tile within reach of someone already fighting. */
const crowding = (p: Point, avoid: readonly Point[]) => avoid.reduce((s, q) => s + (Math.hypot(p.x - q.x, p.y - q.y) < 4 ? 6 : 0), 0);

/** Score penalty for a spawn tile behind a wall from the centre: fighters steer, they do not path-find. */
const hidden = (arena: Arena, p: Point) => (arena.inSight.has(Math.floor(p.y) * arena.width + Math.floor(p.x)) ? 0 : 5);

/** The tile among `tiles` with the lowest score (-1 when none is left). */
function bestTile(arena: Arena, tiles: ReadonlySet<number>, score: (p: Point) => number, used?: ReadonlySet<number>): number {
  let best = -1;
  let bestScore = Infinity;
  for (const i of tiles) {
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
  const best = bestTile(arena, arena.tiles, (p) => Math.hypot(p.x - gx, p.y - gy) + crowding(p, avoid) + hidden(arena, p));
  return best < 0 ? { x: arena.x, y: arena.y } : centreOf(arena, best);
}

const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * An unused arena tile on the rim toward `angle`: the outermost ground in
 * that direction, searched along the arc when the rim there is water or
 * wall, and kept away from the people in `avoid` (a wave is seen walking in;
 * a revived fighter stands clear of the enemies). Marks the tile used.
 */
export function rimSpot(arena: Arena, angle: number, avoid: readonly Point[], used: Set<number>): Point {
  const best = bestTile(arena, arena.tiles, (p) => {
    const d = Math.hypot(p.x - arena.x, p.y - arena.y);
    return angleGap(Math.atan2(p.y - arena.y, p.x - arena.x), angle) * 2 + (1 - d / arena.radius) * 3 + crowding(p, avoid) + hidden(arena, p);
  }, used);
  if (best < 0) return { x: arena.x, y: arena.y };
  used.add(best);
  return centreOf(arena, best);
}

/**
 * An unused deck tile where a boarder climbs aboard toward `angle`: a hull
 * edge first, away from the people in `avoid`. Marks the tile used; null
 * once every deck tile is taken (the wave then lands on the rim).
 */
export function boardingSpot(arena: Arena, angle: number, avoid: readonly Point[], used: Set<number>): Point | null {
  const best = bestTile(arena, arena.deck, (p) => {
    const i = Math.floor(p.y) * arena.width + Math.floor(p.x);
    return angleGap(Math.atan2(p.y - arena.y, p.x - arena.x), angle) + (arena.hull.has(i) ? 0 : 3) + crowding(p, avoid);
  }, used);
  if (best < 0) return null;
  used.add(best);
  return centreOf(arena, best);
}
