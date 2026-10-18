// Ground-level wooden props baked into terrain chunks: plank bridges over
// rivers and the bulwarks/hull sides of moored-fleet decks (Tile.Deck).
// Plank seams align to the world 4 px grid so adjacent tiles join seamlessly.

import { Raster, hex, withAlpha } from "./raster.ts";
import type { Sprite } from "./terrain-art.ts";

const TIMBER = {
  light: hex("#a87f53"),
  mid: hex("#8e6943"),
  dark: hex("#6d4c2f"),
  seam: hex("#4a321e"),
  rail: hex("#5b3d25"),
  railTop: hex("#b9935f"),
  beam: hex("#4f3520"),
  shadow: withAlpha(hex("#0c1a26"), 96),
  snow: hex("#e9f0f4"),
};

const toSprite = (r: Raster, ox: number, oy: number): Sprite => ({ surface: r.toSurface(), ox, oy, w: r.width, h: r.height });

const bridgeCache = new Map<string, Sprite>();

export interface BridgeShape {
  /** Water on each side: rails there; open (walkable) sides have none. */
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  /** Plank seams run north–south (walkway runs east–west). */
  seamsVertical: boolean;
  snowy: boolean;
  /** Granite slab bridge (inside towns) instead of timber. */
  stone: boolean;
}

const STONE = {
  light: hex("#b3ada1"),
  mid: hex("#9d978b"),
  dark: hex("#878175"),
  seam: hex("#5c5852"),
  rail: hex("#7d786e"),
  railTop: hex("#cdc8bb"),
  beam: hex("#5f5a52"),
  shadow: TIMBER.shadow,
  snow: TIMBER.snow,
};
const WOOD = TIMBER;

/** Plank deck covering one Bridge tile, anchored at the tile's left edge, vertical centre. */
export function bridgeSprite(shape: BridgeShape): Sprite {
  const { n, e, s, w, seamsVertical, snowy, stone } = shape;
  const key = [n, e, s, w, seamsVertical, snowy, stone].map((v) => (v ? 1 : 0)).join("");
  const WOOD = stone ? STONE : TIMBER;
  const cached = bridgeCache.get(key);
  if (cached) return cached;
  const r = new Raster(16, 19);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const along = seamsVertical ? x : y;
      const across = seamsVertical ? y : x;
      const width = stone ? 8 : 4;
      const seam = along % width === width - 1 || (stone && across % 8 === ((along >> 3) & 1) * 4);
      const plank = Math.floor(along / width);
      let tone = [WOOD.light, WOOD.mid, WOOD.mid, WOOD.dark][(plank * 3 + (across >> 3)) & 3]!;
      if (along % width === 0) tone = WOOD.light;
      r.set(x, y, seam ? WOOD.seam : tone);
      if (snowy && ((x * 7 + y * 3) % 11 === 0 || (x * 5 + y) % 13 === 0)) r.set(x, y, WOOD.snow);
    }
  // Rails on water sides: a bar on posts every four pixels.
  const railH = (y: number) => {
    for (let x = 0; x < 16; x++) {
      r.set(x, y, WOOD.railTop);
      if (x % 4 === 1) {
        r.set(x, y + 1, WOOD.rail);
        r.set(x, y + 2, WOOD.beam);
      }
    }
  };
  const railV = (x: number, inner: number) => {
    for (let y = 0; y < 16; y++) {
      r.set(x, y, y % 4 === 1 ? WOOD.railTop : WOOD.rail);
      r.set(inner, y, y % 4 === 1 ? WOOD.beam : r.get(inner, y));
    }
  };
  if (n) railH(0);
  if (w) railV(0, 1);
  if (e) railV(15, 14);
  if (s) {
    railH(12);
    for (let x = 0; x < 16; x++) {
      r.set(x, 15, WOOD.beam);
      r.set(x, 16, WOOD.seam);
      r.set(x, 17, WOOD.shadow);
      if (x % 2 === 0) r.set(x, 18, WOOD.shadow);
    }
  }
  const sprite = toSprite(r, 0, -8);
  bridgeCache.set(key, sprite);
  return sprite;
}

export interface DeckEdges {
  readonly north: Sprite;
  readonly south: Sprite;
  readonly west: Sprite;
  readonly east: Sprite;
  readonly props: readonly Sprite[];
  /** Pointed prow extending west of a deck row, square stern east of it. */
  readonly bow: Sprite;
  readonly stern: Sprite;
  /** Two-row versions: hulls are two tiles wide. */
  readonly bow2: Sprite;
  readonly stern2: Sprite;
  /** Seam between two hulls lashed together. */
  readonly gap: Sprite;
}

let deckEdges: DeckEdges | null = null;

export function deckEdgeSprites(): DeckEdges {
  if (deckEdges) return deckEdges;
  const north = new Raster(16, 5);
  for (let x = 0; x < 16; x++) {
    north.set(x, 0, WOOD.railTop);
    north.set(x, 1, WOOD.mid);
    north.set(x, 2, x % 4 === 1 ? WOOD.seam : WOOD.dark);
    north.set(x, 3, WOOD.dark);
    north.set(x, 4, WOOD.seam);
  }
  const south = new Raster(16, 11);
  for (let x = 0; x < 16; x++) {
    south.set(x, 0, WOOD.railTop);
    south.set(x, 1, WOOD.mid);
    for (let y = 2; y <= 7; y++) south.set(x, y, y === 4 ? WOOD.mid : y % 2 ? WOOD.beam : WOOD.dark);
    if (x % 8 === 3) for (let y = 2; y <= 7; y++) south.set(x, y, WOOD.seam);
    south.set(x, 8, WOOD.seam);
    south.set(x, 9, withAlpha(hex("#e6f2f3"), x % 3 === 0 ? 120 : 210));
    south.set(x, 10, withAlpha(hex("#a6d0dc"), x % 2 ? 140 : 0));
  }
  const side = (outerX: number) => {
    const r = new Raster(3, 16);
    for (let y = 0; y < 16; y++) {
      r.set(outerX === 0 ? 1 : 1, y, WOOD.railTop);
      r.set(outerX === 0 ? 2 : 0, y, WOOD.mid);
      r.set(outerX, y, WOOD.seam);
    }
    return r;
  };
  const barrel = new Raster(6, 7);
  barrel.rect(1, 0, 4, 1, WOOD.railTop);
  barrel.rect(0, 1, 6, 5, WOOD.mid);
  barrel.rect(0, 2, 6, 1, WOOD.seam);
  barrel.rect(0, 4, 6, 1, WOOD.seam);
  barrel.rect(1, 6, 4, 1, WOOD.beam);
  barrel.set(1, 1, WOOD.light);
  const coil = new Raster(6, 4);
  const rope = hex("#c8b27a");
  const ropeDark = hex("#8f7a4a");
  coil.rect(1, 0, 4, 1, rope);
  coil.rect(0, 1, 6, 2, rope);
  coil.rect(1, 3, 4, 1, ropeDark);
  coil.rect(2, 1, 2, 1, ropeDark);
  const gun = new Raster(8, 4);
  const iron = hex("#3a3a3c");
  const ironHi = hex("#6a6a6e");
  gun.rect(0, 1, 7, 2, iron);
  gun.rect(0, 1, 6, 1, ironHi);
  gun.rect(6, 0, 2, 4, iron);
  gun.rect(1, 3, 2, 1, WOOD.beam);
  gun.rect(4, 3, 2, 1, WOOD.beam);
  const bowOf = (height: number) => {
    const len = height > 16 ? 14 : 9;
    const mid = height / 2;
    const r = new Raster(len + 1, height + 8);
    for (let x = 0; x <= len; x++) {
      const half = 1 + (x / len) * (mid - 1);
      const y0 = Math.round(mid - half);
      const y1 = Math.round(mid + half) - 1;
      for (let y = y0; y <= y1; y++) {
        const edge = y === y0 || y === y1 || x === 0;
        r.set(x, y, edge ? WOOD.railTop : (y & 3) === 3 ? WOOD.seam : WOOD.mid);
      }
      const hullTop = y1 + 1;
      const depth = Math.round(2 + (x / len) * 4);
      for (let y = hullTop; y < hullTop + depth; y++) r.set(x, y, y % 2 ? WOOD.beam : WOOD.dark);
      r.set(x, hullTop + depth, withAlpha(hex("#e6f2f3"), 200));
    }
    return toSprite(r, -(len + 1), -mid);
  };
  const sternOf = (height: number) => {
    const r = new Raster(4, height + 8);
    for (let y = 0; y < height + 6; y++) {
      r.set(0, y, y < height ? WOOD.railTop : WOOD.beam);
      r.set(1, y, y < height ? WOOD.dark : WOOD.seam);
      if (y > 2 && y < height - 2) r.set(2, y, WOOD.beam);
    }
    r.vline(3, Math.round(height * 0.6), height + 4, WOOD.rail);
    r.set(0, height + 6, withAlpha(hex("#e6f2f3"), 200));
    r.set(1, height + 6, withAlpha(hex("#e6f2f3"), 160));
    return toSprite(r, 0, -height / 2);
  };
  // The narrow channel between two hulls lashed side by side.
  const gap = new Raster(16, 4);
  for (let x = 0; x < 16; x++) {
    gap.set(x, 0, WOOD.railTop);
    gap.set(x, 1, WOOD.beam);
    gap.set(x, 2, hex("#1d3b52"));
    gap.set(x, 3, WOOD.railTop);
  }
  deckEdges = {
    bow: bowOf(16),
    bow2: bowOf(32),
    stern: sternOf(16),
    stern2: sternOf(32),
    gap: toSprite(gap, -8, -2),
    north: toSprite(north, -8, -1),
    south: toSprite(south, -8, -2),
    west: toSprite(side(0), 0, -8),
    east: toSprite(side(2), -3, -8),
    props: [toSprite(barrel, -3, -6), toSprite(coil, -3, -3), toSprite(gun, -4, -3)],
  };
  return deckEdges;
}
