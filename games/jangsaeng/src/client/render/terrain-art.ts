// Seasonal terrain palettes and procedural decoration sprites (pines,
// broadleaf trees, shrubs, tufts, flowers, reeds, boulders, crags, mounds,
// water ripples). Sprites are generated once per season and cached; every
// variation derives from fixed seeds so the art never changes between runs.

import type { Surface } from "./pixel.ts";
import {
  Raster,
  alpha,
  bayer,
  hash01,
  hex,
  mixRgba,
  paintBlobs,
  ramp,
  withAlpha,
  type Blob,
  type Rgba,
} from "./raster.ts";

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

export interface TerrainPalette {
  readonly season: Season;
  readonly grass: readonly Rgba[];
  readonly meadow: readonly Rgba[];
  readonly forestFloor: readonly Rgba[];
  readonly hill: readonly Rgba[];
  readonly scrub: readonly Rgba[];
  readonly rock: readonly Rgba[];
  readonly snow: readonly Rgba[];
  readonly sand: readonly Rgba[];
  readonly wetSand: Rgba;
  readonly marsh: readonly Rgba[];
  readonly puddle: readonly Rgba[];
  readonly road: readonly Rgba[];
  readonly town: readonly Rgba[];
  readonly plaza: readonly Rgba[];
  readonly plazaSeam: Rgba;
  readonly paddyWater: readonly Rgba[];
  readonly rice: readonly Rgba[];
  readonly bund: readonly Rgba[];
  /** Deep → near-shore. */
  readonly water: readonly Rgba[];
  readonly river: readonly Rgba[];
  readonly foam: Rgba;
  readonly foamDim: Rgba;
  readonly ice: readonly Rgba[];
  readonly deck: readonly Rgba[];
  readonly deckSeam: Rgba;
  readonly bank: Rgba;
  /** Flower colours scattered on grass and meadows. */
  readonly flowers: readonly Rgba[];
  /** 0..1 how flowery grassland is. */
  readonly bloom: number;
}

const WATER = ramp("#1b426b", "#1f4b77", "#275a89", "#2d6595", "#3373a1", "#3d83ad", "#4a93b8", "#5ba3c1", "#6fb2c8");
const RIVER = ramp("#3a7898", "#4385a3", "#4f92ad", "#5d9fb6", "#6eadbf");
const ROCK = ramp("#4a4741", "#5d5951", "#726d64", "#888379", "#a19c90");
const SNOW = ramp("#9dadbf", "#b6c4d2", "#cbd6e0", "#dde5ec", "#eef3f7");
const SAND = ramp("#b59d70", "#c4ad80", "#d1bc8f", "#dcc99d", "#e6d6ae");
const ROAD = ramp("#8a7050", "#987d5a", "#a68a65", "#b39771", "#bfa47e");
const TOWN = ramp("#968265", "#a38f70", "#af9b7b", "#bba887");
const PLAZA = ramp("#7c7870", "#8d8880", "#9e998f", "#aeaa9f");
const DECK = ramp("#6a482a", "#7a5532", "#8a6239", "#976e42");

const BASE = {
  rock: ROCK,
  snow: SNOW,
  sand: SAND,
  wetSand: hex("#a8936a"),
  marsh: ramp("#5a5345", "#675f4f", "#756c5a", "#837966", "#918772"),
  puddle: ramp("#5f747d", "#71878f", "#8aa1a7"),
  road: ROAD,
  town: TOWN,
  plaza: PLAZA,
  plazaSeam: hex("#605c56"),
  water: WATER,
  river: RIVER,
  foam: hex("#e6f2f3"),
  foamDim: hex("#a6d0dc"),
  ice: ramp("#a9c4d2", "#c4d8e2", "#dfeaf0"),
  deck: DECK,
  deckSeam: hex("#4a301c"),
};

const PALETTES: Readonly<Record<Season, TerrainPalette>> = {
  spring: {
    ...BASE,
    season: "spring",
    grass: ramp("#4a773b", "#568442", "#629049", "#6f9c50", "#7ea85a"),
    meadow: ramp("#62893f", "#709646", "#7ea24f", "#8dae59", "#9dba67"),
    forestFloor: ramp("#2a4528", "#31502e", "#3a5b34", "#44673b"),
    hill: ramp("#5a7640", "#668246", "#738e4d", "#809a55", "#8ea65f"),
    scrub: ramp("#425f37", "#4d6b3d", "#597744", "#65834b", "#728f53"),
    bank: hex("#5b6a3a"),
    paddyWater: ramp("#6893a0", "#7aa4ae", "#93bcc2"),
    rice: ramp("#5e8e3c", "#6c9c44", "#7ca94e", "#8db65a"),
    bund: ramp("#667a40", "#76894a", "#879855"),
    flowers: ramp("#e07aa6", "#f0c9d6", "#e8c547", "#f4f0e4", "#c95b8b"),
    bloom: 1,
  },
  summer: {
    ...BASE,
    season: "summer",
    grass: ramp("#44713a", "#507e3f", "#5c8a45", "#68964c", "#77a255"),
    meadow: ramp("#5d843f", "#6a9145", "#789d4d", "#86a957", "#95b564"),
    forestFloor: ramp("#243e26", "#2b482b", "#335331", "#3c5e37"),
    hill: ramp("#546e3c", "#607a42", "#6c8648", "#79924f", "#869e59"),
    scrub: ramp("#3c5833", "#466439", "#517040", "#5c7b46", "#68874e"),
    bank: hex("#4f6436"),
    paddyWater: ramp("#5b8a92", "#6a99a0", "#7eacb1"),
    rice: ramp("#46792f", "#538737", "#629540", "#72a24a"),
    bund: ramp("#5f7340", "#6f8249", "#7f9153"),
    flowers: ramp("#f2efe4", "#e8c547", "#c9d6f0", "#f2efe4"),
    bloom: 0.45,
  },
  autumn: {
    ...BASE,
    season: "autumn",
    grass: ramp("#62683a", "#6f7440", "#7c7f47", "#898a4f", "#979659"),
    meadow: ramp("#7a7340", "#887f46", "#968b4e", "#a39757", "#b0a462"),
    forestFloor: ramp("#3a3a24", "#45432a", "#504c30", "#5b5636"),
    hill: ramp("#6c6a3e", "#787544", "#85804b", "#918b53", "#9e975d"),
    scrub: ramp("#55543a", "#615e40", "#6d6946", "#79744d", "#857f55"),
    bank: hex("#5f5a36"),
    paddyWater: ramp("#7f8a6a", "#8f9a76", "#a3ad86"),
    rice: ramp("#a2832f", "#b69536", "#c8a841", "#d8ba52"),
    bund: ramp("#77703f", "#857d46", "#948b50"),
    flowers: ramp("#c9a6d8", "#e8c547", "#f2efe4", "#d98a3a"),
    bloom: 0.35,
  },
  winter: {
    ...BASE,
    season: "winter",
    grass: ramp("#5f6146", "#6b6c4d", "#777755", "#83825d", "#8f8d67"),
    meadow: ramp("#6d6a4b", "#797552", "#85805a", "#918b63", "#9d966d"),
    forestFloor: ramp("#34392b", "#3c4231", "#454b37", "#4e543d"),
    hill: ramp("#636246", "#6e6c4d", "#7a7754", "#86825c", "#928d65"),
    scrub: ramp("#4c5039", "#575a3f", "#626445", "#6d6e4c", "#797854"),
    bank: hex("#585a40"),
    paddyWater: ramp("#7c7a62", "#8a876d", "#9a9679"),
    rice: ramp("#7d6c45", "#8b7a4f", "#99885a", "#a79665"),
    bund: ramp("#6a6648", "#76714f", "#827c57"),
    flowers: ramp("#f2efe4"),
    bloom: 0,
    water: ramp("#1c3f63", "#20476d", "#28557f", "#2e5f8a", "#346c96", "#3e7ba2", "#4b8aad", "#5c99b7", "#70a8bf"),
  },
};

export const terrainPalette = (season: Season): TerrainPalette => PALETTES[season];

// ---------------------------------------------------------------------------
// Decoration sprites

export interface Sprite {
  readonly surface: Surface;
  /** Offset from the anchor (ground contact point) to the sprite's top-left. */
  readonly ox: number;
  readonly oy: number;
  readonly w: number;
  readonly h: number;
}

export interface DecorSet {
  readonly pines: readonly Sprite[];
  readonly smallPines: readonly Sprite[];
  readonly broadleaf: readonly Sprite[];
  readonly blossom: readonly Sprite[];
  readonly shrubs: readonly Sprite[];
  readonly azalea: readonly Sprite[];
  readonly tufts: readonly Sprite[];
  readonly flowers: readonly Sprite[];
  readonly reeds: readonly Sprite[];
  readonly pebbles: readonly Sprite[];
  readonly boulders: readonly Sprite[];
  readonly crags: readonly Sprite[];
  readonly outcrops: readonly Sprite[];
  readonly mounds: readonly Sprite[];
  readonly treeShadow: Sprite;
  readonly smallShadow: Sprite;
  readonly stones: readonly Sprite[];
}

const sprite = (r: Raster, ox: number, oy: number): Sprite => ({
  surface: r.toSurface(),
  ox,
  oy,
  w: r.width,
  h: r.height,
});

const PINE = ramp("#13261a", "#1b3423", "#24432b", "#2f5535", "#3d6a40", "#52804b");
const PINE_SPRING = ramp("#14281a", "#1d3824", "#27482d", "#335c37", "#437244", "#5d8c4f");
const PINE_WINTER = ramp("#111f17", "#17291d", "#1f3624", "#29452d", "#365736", "#466a40");
const TRUNK = hex("#7b4a31");
const TRUNK_DARK = hex("#4f2e20");
const OUTLINE_GREEN = hex("#162a1c");

const BROADLEAF: Readonly<Record<Season, readonly (readonly Rgba[])[]>> = {
  spring: [
    ramp("#244824", "#33612f", "#477a3c", "#5d904a", "#79a75c"),
    ramp("#284e26", "#396831", "#4e823f", "#67994e", "#83b062"),
  ],
  summer: [
    ramp("#1a3620", "#254b2b", "#325e35", "#43723f", "#57864b"),
    ramp("#1c3a21", "#29502e", "#386438", "#4a7943", "#5e8d50"),
  ],
  autumn: [
    ramp("#4a1a16", "#6e2620", "#93352a", "#b54d32", "#cf6f3e"),
    ramp("#5c3414", "#80491a", "#a36222", "#c17d2e", "#d89a40"),
    ramp("#5e4f18", "#85701f", "#a98e2a", "#c6aa3a", "#dcc256"),
    ramp("#3e3a1c", "#5a5524", "#76702e", "#918a3a", "#aaa24a"),
  ],
  winter: [ramp("#3a2e26", "#4d3e32", "#5f4d3e", "#73604c", "#86725b")],
};

const SNOW_CAP = hex("#eef3f6");
const SNOW_SHADE = hex("#c3d0db");
const SNOW_LIGHT = hex("#dfe7ed");

/** Adds snow on upward-facing edges of a sprite. */
function snowify(r: Raster, depth: number, seed: number): void {
  const src = r.data.slice();
  const w = r.width;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < w; x++) {
      if (alpha(src[y * w + x] as number) === 0) continue;
      let open = -1;
      for (let k = 1; k <= depth; k++) {
        const yy = y - k;
        if (yy < 0 || alpha(src[yy * w + x] as number) === 0) {
          open = k;
          break;
        }
      }
      if (open < 0) continue;
      if (open === depth && hash01(x, y, seed) < 0.45) continue;
      r.set(x, y, open === 1 ? SNOW_CAP : SNOW_SHADE);
    }
}

function pine(seed: number, scale: number, season: Season, snow: boolean): Sprite {
  const W = Math.round(18 * scale) + 2;
  const H = Math.round(22 * scale) + 2;
  const r = new Raster(W, H);
  const cx = W / 2;
  const base = H - 1;
  const j = (k: number) => (hash01(seed, k, 77) - 0.5) * 2;
  const trunkTop = base - Math.round(6 * scale);
  // Trunk with a slight lean.
  const lean = j(9) > 0 ? 1 : 0;
  for (let y = trunkTop; y <= base; y++) {
    const x = Math.round(cx - 1 + (y < base - 2 ? lean : 0));
    r.set(x, y, TRUNK);
    r.set(x + 1, y, TRUNK_DARK);
  }
  const s = scale;
  const blobs: Blob[] = [
    { cx: cx + j(1) * 1.5 * s, cy: base - 8.5 * s, rx: 7.6 * s, ry: 3.6 * s, z: 0 },
    { cx: cx + j(2) * 2 * s - 1.5 * s, cy: base - 10.5 * s, rx: 4.4 * s, ry: 2.6 * s, z: 0.15 },
    { cx: cx + j(3) * 1.5 * s + 1.5 * s, cy: base - 12.5 * s, rx: 6 * s, ry: 3.1 * s, z: 0.3 },
    { cx: cx + j(4) * 1.2 * s - 0.5 * s, cy: base - 16 * s, rx: 4.2 * s, ry: 2.6 * s, z: 0.5 },
  ];
  if (scale >= 0.9) blobs.push({ cx: cx + j(5) * 2 * s - 3 * s, cy: base - 14.5 * s, rx: 2.6 * s, ry: 1.8 * s, z: 0.4 });
  const colors = season === "winter" ? PINE_WINTER : season === "spring" ? PINE_SPRING : PINE;
  paintBlobs(r, blobs, { ramp: colors, seed, texture: 0.11, dither: 0.4, bias: 0.0 });
  r.outline(OUTLINE_GREEN, { top: false });
  if (snow) snowify(r, 2, seed);
  return sprite(r, -Math.round(cx), -base);
}

function broadleaf(seed: number, scale: number, colors: readonly Rgba[], snow: boolean): Sprite {
  const W = Math.round(18 * scale) + 2;
  const H = Math.round(21 * scale) + 2;
  const r = new Raster(W, H);
  const cx = W / 2;
  const base = H - 1;
  const j = (k: number) => (hash01(seed, k, 91) - 0.5) * 2;
  for (let y = base - Math.round(7 * scale); y <= base; y++) {
    r.set(Math.round(cx - 1), y, TRUNK);
    r.set(Math.round(cx), y, TRUNK_DARK);
  }
  const s = scale;
  const crownY = base - 11 * s;
  const blobs: Blob[] = [
    { cx: cx, cy: crownY, rx: 7.4 * s, ry: 6 * s, z: 0 },
    { cx: cx - 4 * s + j(1) * s, cy: crownY - 3.5 * s, rx: 3.6 * s, ry: 3 * s, z: 0.05 },
    { cx: cx + 3 * s + j(2) * s, cy: crownY - 4.5 * s, rx: 3.8 * s, ry: 3 * s, z: 0.05 },
    { cx: cx + 5 * s, cy: crownY + 1 * s + j(3) * s, rx: 3.2 * s, ry: 2.8 * s, z: 0.02 },
    { cx: cx - 5 * s, cy: crownY + 1.5 * s, rx: 3 * s, ry: 2.6 * s, z: 0.02 },
  ];
  paintBlobs(r, blobs, { ramp: colors, seed, texture: 0.1, dither: 0.4, creases: false, bias: -0.03 });
  r.outline(mixRgba(colors[0] as Rgba, hex("#000000"), 0.45), { top: false });
  if (snow) snowify(r, 2, seed);
  return sprite(r, -Math.round(cx), -base);
}

/** Bare winter tree: a trunk with layered branching twigs. */
function bareTree(seed: number, scale: number, snowy: boolean): Sprite {
  const W = Math.round(18 * scale) + 2;
  const H = Math.round(21 * scale) + 2;
  const r = new Raster(W, H);
  const cx = Math.round(W / 2);
  const base = H - 1;
  const bark = hex("#4e3d31");
  const twig = hex("#6f5d4e");
  const fine = withAlpha(hex("#8a7867"), 170);
  const branch = (x: number, y: number, angle: number, length: number, depth: number, k: number) => {
    const x1 = x + Math.cos(angle) * length;
    const y1 = y + Math.sin(angle) * length;
    r.line(x, y, x1, y1, depth >= 3 ? bark : depth >= 1 ? twig : fine);
    if (depth <= 0) return;
    const spread = 0.38 + hash01(seed, k, 3) * 0.32;
    branch(x1, y1, angle - spread, length * 0.72, depth - 1, k * 2 + 1);
    branch(x1, y1, angle + spread * 0.9, length * 0.7, depth - 1, k * 2 + 2);
    if (depth === 2) branch(x1, y1, angle + (hash01(seed, k, 4) - 0.5) * 0.4, length * 0.6, 0, k * 3);
  };
  r.vline(cx, base - 7 * scale, base, bark);
  r.vline(cx - 1, base - 5 * scale, base, hex("#3d2f25"));
  const top = base - 7 * scale;
  branch(cx, top, -Math.PI / 2 - 0.5, 4.5 * scale, 3, 1);
  branch(cx, top, -Math.PI / 2 + 0.45, 4.8 * scale, 3, 2);
  branch(cx, top + 2, -Math.PI / 2 + (hash01(seed, 1, 5) - 0.5) * 0.3, 6 * scale, 4, 3);
  if (snowy) snowify(r, 1, seed);
  return sprite(r, -cx, -base);
}

function shrub(seed: number, colors: readonly Rgba[], snow: boolean, size = 1): Sprite {
  const W = Math.round(10 * size) + 2;
  const H = Math.round(7 * size) + 2;
  const r = new Raster(W, H);
  const j = (k: number) => (hash01(seed, k, 13) - 0.5) * 2;
  const base = H - 1;
  paintBlobs(
    r,
    [
      { cx: W / 2 + j(1), cy: base - 2.6 * size, rx: 3.6 * size, ry: 2.6 * size },
      { cx: W / 2 - 2.2 * size, cy: base - 2 * size, rx: 2.6 * size, ry: 2 * size },
      { cx: W / 2 + 2.4 * size, cy: base - 2.2 * size + j(2) * 0.5, rx: 2.6 * size, ry: 2 * size },
    ],
    { ramp: colors, seed, texture: 0.15, creases: false },
  );
  r.outline(mixRgba(colors[0] as Rgba, hex("#000000"), 0.4), { top: false });
  if (snow) snowify(r, 1, seed);
  return sprite(r, -Math.round(W / 2), -base);
}

function fromRows(rows: readonly string[], colors: Readonly<Record<string, Rgba>>, ax: number, ay: number): Sprite {
  const r = new Raster(Math.max(...rows.map((row) => row.length)), rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x] as string];
      if (c !== undefined) r.set(x, y, c);
    }
  });
  return sprite(r, -ax, -ay);
}

const TUFT_ROWS: readonly (readonly string[])[] = [
  [".l...", "ld.l.", ".dld.", "..d.."],
  ["..l..", "l.dl.", "dldd.", ".dd.."],
  ["l..l", "dl.d", ".dd."],
  [".l.", "ldl", ".d."],
];

function boulder(seed: number, size: number, snow: boolean): Sprite {
  const W = Math.round(9 * size) + 2;
  const H = Math.round(7 * size) + 2;
  const r = new Raster(W, H);
  const base = H - 1;
  const j = (k: number) => (hash01(seed, k, 21) - 0.5) * 2;
  paintBlobs(
    r,
    [
      { cx: W / 2, cy: base - 2.8 * size, rx: 3.8 * size, ry: 2.8 * size },
      { cx: W / 2 + 2 * size * j(1), cy: base - 3.6 * size, rx: 2.4 * size, ry: 2 * size, z: 0.1 },
    ],
    { ramp: ROCK, seed, texture: 0.1, bias: 0.05, creases: false, dither: 0.25 },
  );
  // Crack.
  const cx = Math.round(W / 2 + j(3) * size);
  r.tint(cx, base - 2, ROCK[0] as Rgba);
  r.tint(cx + 1, base - 3, ROCK[1] as Rgba);
  r.outline(hex("#2c2a26"), { top: false });
  if (snow) snowify(r, 2, seed);
  return sprite(r, -Math.round(W / 2), -base);
}

interface RockBlock {
  x0: number;
  x1: number;
  /** Top of the lit top face. */
  top: number;
  /** Top-face depth and front-face height. */
  th: number;
  fh: number;
}

/**
 * Angular rock outcrop in 3/4 view: blocks with a lit top face and a shaded
 * front face, cracks, and (optionally) snow lying on the top faces.
 */
function outcrop(seed: number, blocks: readonly RockBlock[], snowTop: boolean): Sprite {
  let W = 0;
  let H = 0;
  for (const b of blocks) {
    W = Math.max(W, b.x1 + 2);
    H = Math.max(H, b.top + b.th + b.fh + 2);
  }
  const r = new Raster(W, H);
  const sorted = [...blocks].sort((a, b) => a.top + a.th + a.fh - (b.top + b.th + b.fh));
  sorted.forEach((b, k) => {
    const width = b.x1 - b.x0;
    for (let x = b.x0; x <= b.x1; x++) {
      const fromL = x - b.x0;
      const fromR = b.x1 - x;
      const chamfer = Math.max(0, 2 - Math.min(fromL, fromR));
      const jt = Math.floor(hash01(x, k, seed) * 2);
      const top = b.top + chamfer + jt;
      const faceTop = b.top + b.th + (chamfer > 1 ? 1 : 0);
      const bottom = b.top + b.th + b.fh - (chamfer > 0 ? 1 : 0) - (hash01(x, k + 9, seed) < 0.3 ? 1 : 0);
      const crack = hash01(x, k + 5, seed) < 0.16 && fromL > 1 && fromR > 1;
      for (let y = top; y <= bottom; y++) {
        let c: Rgba;
        if (y < faceTop) {
          const rim = y === faceTop - 1;
          if (snowTop) c = (rim ? SNOW_CAP : hash01(x, y, seed + 3) < 0.2 ? SNOW_SHADE : (SNOW_LIGHT as Rgba));
          else c = (rim ? ROCK[4] : hash01(x, y, seed + 3) < 0.25 ? ROCK[2] : ROCK[3]) as Rgba;
          if (y === top && fromL < width * 0.3 && !snowTop) c = ROCK[4] as Rgba;
        } else {
          const t = (y - faceTop) / Math.max(1, bottom - faceTop);
          let level = fromL < 2 ? 2 : fromR < 2 ? 0 : 1;
          if (t > 0.75) level = Math.max(0, level - 1);
          if (crack && y > faceTop) level = 0;
          if (snowTop && y === faceTop) c = SNOW_SHADE;
          else c = ROCK[level] as Rgba;
        }
        r.set(x, y, c);
      }
    }
  });
  r.outline(hex("#26241f"), { top: false });
  let bottom = 0;
  for (const b of blocks) bottom = Math.max(bottom, b.top + b.th + b.fh);
  return sprite(r, -Math.round(W / 2), -bottom);
}

function peakOutcrop(seed: number, snowTop: boolean): Sprite {
  const j = (k: number, span: number) => Math.floor(hash01(seed, k, 31) * span);
  return outcrop(
    seed,
    [
      { x0: 3 + j(1, 3), x1: 16 + j(2, 4), top: 0 + j(3, 3), th: 4 + j(4, 2), fh: 9 + j(5, 4) },
      { x0: 0, x1: 9 + j(6, 3), top: 8 + j(7, 2), th: 3, fh: 6 + j(8, 2) },
      { x0: 11 + j(9, 2), x1: 20 + j(10, 3), top: 9 + j(11, 2), th: 3 + j(12, 2), fh: 5 + j(13, 2) },
    ],
    snowTop,
  );
}

function smallOutcrop(seed: number, snowTop: boolean): Sprite {
  const j = (k: number, span: number) => Math.floor(hash01(seed, k, 37) * span);
  return outcrop(
    seed,
    [
      { x0: 2, x1: 9 + j(1, 3), top: 0, th: 3, fh: 4 + j(2, 2) },
      { x0: 0, x1: 5 + j(3, 2), top: 3, th: 2, fh: 3 },
    ],
    snowTop,
  );
}

/** A grassy rise drawn only as light and shade so the ground shows through. */
function mound(seed: number, colors: readonly Rgba[], snow: boolean): Sprite {
  const W = 20;
  const H = 10;
  const r = new Raster(W, H);
  const rx = 8.5 + hash01(seed, 1, 41) * 1.5;
  const ry = 4.2;
  const cx = W / 2;
  const cy = H - 2;
  const hi = withAlpha(snow ? SNOW_CAP : (colors[4] as Rgba), 150);
  const lo = withAlpha(snow ? SNOW_SHADE : (colors[0] as Rgba), 170);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const q = dx * dx + dy * dy;
      if (q > 1 || y > cy) continue;
      const light = -dx * 0.55 - dy * 0.75;
      if (light > 0.45 && q > 0.25 && bayer(x, y) < 0.25) r.set(x, y, hi);
      else if (light < -0.15 && q > 0.45 && bayer(x, y) < 0.3) r.set(x, y, lo);
    }
  return sprite(r, -Math.round(cx), -(H - 1));
}

function shadowSprite(rx: number, ry: number, strength: number): Sprite {
  const W = Math.ceil(rx * 2) + 2;
  const H = Math.ceil(ry * 2) + 2;
  const r = new Raster(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / rx;
      const dy = (y + 0.5 - H / 2) / ry;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const a = q < 0.55 ? strength : strength * 0.6;
      if (q >= 0.55 && bayer(x, y) > 0.15) continue;
      r.set(x, y, withAlpha(hex("#10180f"), Math.round(a * 255)));
    }
  return sprite(r, -Math.round(W / 2), -Math.round(H / 2));
}

const decorCache = new Map<string, DecorSet>();

/**
 * Decoration sprites for a season; `snowy` adds snow caps (winter in the
 * snowy north). Built once per (season, snowy) and cached.
 */
export function decorSet(season: Season, snowy: boolean): DecorSet {
  const key = `${season}:${snowy ? 1 : 0}`;
  let set = decorCache.get(key);
  if (set) return set;
  const pal = PALETTES[season];
  const winter = season === "winter";
  const snow = winter && snowy;
  const pines = [0, 1, 2, 3, 4, 5].map((k) => pine(100 + k, k < 3 ? 1 : 0.86, season, snow));
  const smallPines = [0, 1, 2].map((k) => pine(200 + k, 0.62, season, snow));
  const leafColors = BROADLEAF[season];
  const broadleaf_ = winter
    ? [0, 1, 2].map((k) => bareTree(300 + k, k === 2 ? 0.8 : 1, snow))
    : [0, 1, 2, 3, 4, 5].map((k) =>
        broadleaf(300 + k, k < 3 ? 1 : 0.82, leafColors[k % leafColors.length] as readonly Rgba[], false),
      );
  const blossom =
    season === "spring"
      ? [0, 1, 2].map((k) => broadleaf(400 + k, k === 2 ? 0.8 : 0.95, ramp("#8f6f78", "#c193a1", "#dfb2bf", "#efcdd6", "#fbe9ee"), false))
      : broadleaf_;
  const shrubColors =
    season === "autumn" ? (BROADLEAF.autumn[3] as readonly Rgba[]) : winter ? pal.scrub : (BROADLEAF[season][0] as readonly Rgba[]);
  const shrubs = [0, 1, 2, 3].map((k) => shrub(500 + k, shrubColors, snow, k === 3 ? 0.8 : 1));
  const azaleaColors =
    season === "spring"
      ? ramp("#6e2a4a", "#9b3a62", "#c4507e", "#de76a0", "#efa2c0")
      : season === "autumn"
        ? (BROADLEAF.autumn[0] as readonly Rgba[])
        : shrubColors;
  const azalea = [0, 1, 2].map((k) => shrub(600 + k, azaleaColors, snow, 0.9));
  const tuftColors = {
    l: pal.grass[4] as Rgba,
    d: pal.grass[0] as Rgba,
  };
  const tufts = TUFT_ROWS.map((rows) => fromRows(rows, tuftColors, 2, rows.length - 1));
  const flowers = pal.flowers.map((c, k) =>
    fromRows(k % 2 ? [".p.", "pcp", ".g."] : ["p.", ".g"], { p: c, c: hex("#f4e08a"), g: pal.grass[1] as Rgba }, 1, 2),
  );
  const reedTop = season === "autumn" || winter ? hex("#d8c9a0") : hex("#a3a86a");
  const reedStem = season === "autumn" || winter ? hex("#9a8a5a") : hex("#61733d");
  const reeds = [0, 1, 2].map((k) =>
    fromRows(
      k === 0
        ? ["t..t.", "t.tt.", "s.s.t", "s.ss.", "ssss.", ".ss.."]
        : k === 1
          ? [".t..", "tt.t", "s.ts", "ssss", ".ss."]
          : ["..t..", ".tt.t", ".s.s.", "s.ss.", ".sss."],
      { t: reedTop, s: reedStem },
      2,
      k === 1 ? 4 : 5,
    ),
  );
  const pebbleColors = { a: ROCK[3] as Rgba, b: ROCK[1] as Rgba, c: ROCK[4] as Rgba };
  const pebbles = [
    fromRows(["ca", "ab"], pebbleColors, 1, 1),
    fromRows([".c.", "cab", ".b."], pebbleColors, 1, 2),
    fromRows(["c..a", "b..b"], pebbleColors, 2, 1),
  ];
  const stones = [0, 1, 2, 3].map((k) =>
    fromRows(
      k % 2 ? [".cca.", "caaab", ".bbb."] : [".cc.", "caab", ".bb."],
      { a: ROCK[3] as Rgba, b: ROCK[1] as Rgba, c: ROCK[4] as Rgba },
      2,
      2,
    ),
  );
  const boulders = [0, 1, 2, 3].map((k) => boulder(700 + k, k < 2 ? 1 : 0.75, snow));
  const crags = [0, 1, 2, 3, 4, 5].map((k) => peakOutcrop(800 + k, winter || (season === "spring" && k % 3 === 0)));
  const outcrops = [0, 1, 2].map((k) => smallOutcrop(850 + k, snow));
  const moundColors = pal.hill;
  const mounds = [0, 1].map((k) => mound(900 + k, moundColors, snow));
  set = {
    pines,
    smallPines,
    broadleaf: broadleaf_,
    blossom,
    shrubs,
    azalea,
    tufts,
    flowers,
    reeds,
    pebbles,
    boulders,
    crags,
    outcrops,
    mounds,
    treeShadow: shadowSprite(6.5, 2.8, 0.3),
    smallShadow: shadowSprite(4, 1.8, 0.26),
    stones,
  };
  decorCache.set(key, set);
  return set;
}

// ---------------------------------------------------------------------------
// Water animation sprites

export interface RippleSet {
  /** Wavelet frames: grow, crest, fade. */
  readonly wave: readonly Surface[];
  /** River ripple frames (smaller, greener highlight). */
  readonly river: readonly Surface[];
  /** Sun glint frames. */
  readonly glint: readonly Surface[];
}

let ripples: RippleSet | null = null;

export function rippleSet(): RippleSet {
  if (ripples) return ripples;
  const hi = hex("#8cc3d6");
  const top = hex("#c9e6ee");
  const lo = hex("#5a9cbc");
  const rows = (lines: readonly string[]) => fromRows(lines, { h: hi, t: top, l: lo }, 0, 0).surface;
  const wave = [
    rows(["......", "..ll..", "......"]),
    rows(["......", ".hhhh.", "l....l"]),
    rows(["..tt..", ".h..h.", "l....l"]),
    rows(["..hh..", "l....l", "......"]),
    rows(["......", ".l..l.", "......"]),
  ];
  const rhi = hex("#9ccbd8");
  const river = [
    fromRows(["....", ".ll.", "...."], { l: rhi }, 0, 0).surface,
    fromRows(["....", "lhhl", "...."], { l: hex("#6fadc3"), h: rhi }, 0, 0).surface,
    fromRows([".hh.", "l..l", "...."], { l: hex("#6fadc3"), h: rhi }, 0, 0).surface,
  ];
  const g = hex("#f4fbff");
  const glint = [
    fromRows(["...", ".g.", "..."], { g }, 0, 0).surface,
    fromRows([".g.", "ggg", ".g."], { g }, 0, 0).surface,
    fromRows(["...", ".g.", "..."], { g }, 0, 0).surface,
  ];
  ripples = { wave, river, glint };
  return ripples;
}
