// Procedural Korean architecture in 3/4 view: curved 기와 hip roofs with
// upturned 처마, 초가 thatch, plastered facades between timber posts,
// granite 기단 platforms, 단청 palace halls, 누각 pavilions, ruins and 성곽
// walls with 여장 parapets. Every sprite is generated once per (kind,
// variant class, season) and cached by the structure layer.

import type { Surface } from "./pixel.ts";
import { Raster, bayer, hash01, hex, pickRamp, ramp, withAlpha, type Rgba } from "./raster.ts";
import { NATURE } from "./palette.ts";
import type { Season } from "./terrain-art.ts";

export interface StructureSprite {
  readonly surface: Surface;
  /** Offset (world px) from the footprint's top-left to the sprite's top-left. */
  readonly ox: number;
  readonly oy: number;
}

export const finish = (r: Raster, ox: number, oy: number): StructureSprite => ({ surface: r.toSurface(), ox, oy });

// ---------------------------------------------------------------------------
// Shared colours

export const ARCH = {
  giwa: [
    ramp("#1f242b", "#2b313a", "#373e48", "#454d58", "#56606b", "#6c7681"),
    ramp("#22262a", "#2f3439", "#3c4248", "#4b5259", "#5d656c", "#747c83"),
  ],
  palaceRoof: ramp("#1d2229", "#283039", "#343d48", "#424c58", "#535e6b", "#6a7582"),
  ridge: hex("#d9d5cb"),
  ridgeDark: hex("#8d8a84"),
  plaster: hex(NATURE.plaster),
  plasterShade: hex("#c9bfa9"),
  post: hex(NATURE.timber),
  postLight: hex("#8d5d38"),
  postDark: hex("#47291a"),
  paper: hex("#efe5cc"),
  paperShade: hex("#d6c9aa"),
  lattice: hex("#7b5536"),
  door: hex("#5a3a24"),
  dancheongGreen: hex(NATURE.dancheongGreen),
  dancheongGreenDark: hex("#245c47"),
  dancheongRed: hex(NATURE.dancheongRed),
  dancheongRedDark: hex("#74211d"),
  dancheongBlue: hex("#2f5f94"),
  dancheongYellow: hex("#e0b448"),
  stone: ramp("#4f4d48", "#6a675f", "#848077", "#9e998e", "#b8b3a6", "#cfcabd"),
  mortar: hex("#3d3b37"),
  thatch: ramp("#6b4f24", "#87672f", "#a3803c", "#bb974b", "#cfac5d", "#dfc177"),
  mud: ramp("#7e6346", "#977a57", "#ae9068", "#c1a47a"),
  snow: ramp("#aebdcb", "#c7d3de", "#dce5ec", "#eef3f6", "#fafcfd"),
  shadow: withAlpha(hex("#101418"), 80),
  char: ramp("#16110e", "#271c16", "#3a2a1f"),
} as const;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Primitives

export interface RoofOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ridge inset from each side at the top row. */
  inset: number;
  /** How far the eave corners rise (처마 곡선). */
  curve: number;
  tiles: readonly Rgba[];
  snow: boolean;
  seed: number;
  /** Width of the visible hip faces at the eave. */
  side?: number;
  /** White mortar ridge (palaces, gates) instead of a tiled one. */
  whiteRidge?: boolean;
  /** 단청 rafter ends under the eave. */
  dancheong?: boolean;
  /** Small 잡상 figurines along the hips. */
  figurines?: boolean;
}

/** Korean 기와 hip-and-gable roof seen from the front and above. */
export function paintGiwaRoof(r: Raster, o: RoofOptions): void {
  const { x, y, w, h, inset, curve, tiles, snow, seed } = o;
  const side = o.side ?? 3;
  const cx = x + (w - 1) / 2;
  const eaveRow = (xx: number) => y + h - 1 - Math.round(curve * Math.pow(Math.abs(xx - cx) / (w / 2), 2.3));
  const snowDepth = (xx: number) => Math.round(h * 0.55 + (hash01(xx, 0, seed) - 0.5) * 3);
  for (let xx = x; xx < x + w; xx++) {
    const bottom = eaveRow(xx);
    for (let yy = y; yy <= bottom; yy++) {
      const rel = yy - y;
      const t = rel / Math.max(1, h - 1);
      const tt = clamp(rel / Math.max(1, h - 1 - curve * 0.6), 0, 1);
      const reach = 1 - tt * tt;
      const xl = x + inset * reach;
      const xr = x + w - 1 - inset * reach;
      if (xx < Math.floor(xl) || xx > Math.ceil(xr)) continue;
      const hip = side * t;
      const leftHip = xx < xl + hip;
      const rightHip = xx > xr - hip;
      const groove = (xx - x) % 3 === 0;
      let v: number;
      if (yy === bottom) {
        // Row of round end tiles (막새) along the eave.
        v = (xx + (leftHip || rightHip ? 1 : 0)) % 2 === 0 ? 0.9 : 0.3;
      } else if (leftHip) v = 0.66 + (hash01(xx, yy, seed) - 0.5) * 0.1 - (groove ? 0.12 : 0);
      else if (rightHip) v = 0.18 + (groove ? -0.08 : 0.04);
      else {
        v = 0.4 + Math.pow(t, 1.6) * 0.32 + (hash01(xx, yy, seed) - 0.5) * 0.06;
        if (groove) v -= 0.26;
        if (rel % 4 === 3) v -= 0.06;
      }
      let c = pickRamp(tiles, clamp(v, 0, 0.999), bayer(xx, yy) * 0.25);
      if (snow && yy !== bottom && rel < snowDepth(xx) + (leftHip ? 1 : 0)) {
        const s = groove || rightHip ? (ARCH.snow[1] as Rgba) : rel < 2 ? (ARCH.snow[4] as Rgba) : (ARCH.snow[3] as Rgba);
        c = rel === snowDepth(xx) - 1 && hash01(xx, 3, seed) < 0.5 ? (ARCH.snow[1] as Rgba) : s;
      }
      r.set(xx, yy, c);
    }
    // Shadow under the eave.
    r.blend(xx, bottom + 1, withAlpha(hex("#0d0f12"), 150));
    r.blend(xx, bottom + 2, withAlpha(hex("#0d0f12"), 80));
    if (o.dancheong) {
      r.set(xx, bottom + 1, xx % 2 === 0 ? ARCH.dancheongGreen : ARCH.dancheongGreenDark);
      if (xx % 4 === 1) r.set(xx, bottom + 1, ARCH.dancheongRed);
    }
  }
  // Ridge (용마루) with upturned ends.
  const r0 = Math.round(x + inset) - 1;
  const r1 = Math.round(x + w - 1 - inset) + 1;
  const ridgeTop = o.whiteRidge ? ARCH.ridge : (tiles[4] as Rgba);
  const ridgeMid = o.whiteRidge ? ARCH.ridgeDark : (tiles[1] as Rgba);
  for (let xx = r0; xx <= r1; xx++) {
    r.set(xx, y, snow ? (ARCH.snow[4] as Rgba) : ridgeTop);
    r.set(xx, y + 1, ridgeMid);
  }
  for (const [ex, dir] of [
    [r0, -1],
    [r1, 1],
  ] as const) {
    r.set(ex + dir, y - 1, tiles[1] as Rgba);
    r.set(ex + dir, y, tiles[0] as Rgba);
    r.set(ex, y - 1, tiles[2] as Rgba);
  }
  if (o.figurines) {
    for (const dir of [-1, 1]) {
      for (let k = 1; k <= 3; k++) {
        const rel = Math.round(((h - 1 - curve) * k) / 5);
        const tt = clamp(rel / Math.max(1, h - 1 - curve * 0.6), 0, 1);
        const reach = 1 - tt * tt;
        const xx = Math.round(dir < 0 ? x + inset * reach + 1 : x + w - 2 - inset * reach);
        r.set(xx, y + rel - 1, tiles[0] as Rgba);
      }
    }
  }
}

/** Rounded 초가 thatch roof with rope lattice and a twisted straw ridge. */
export function paintThatchRoof(r: Raster, x: number, y: number, w: number, h: number, snow: boolean, seed: number): void {
  const cx = x + (w - 1) / 2;
  const T = ARCH.thatch;
  for (let xx = x; xx < x + w; xx++) {
    const nx = (xx - cx) / (w / 2);
    const shoulder = Math.max(0, Math.abs(nx) - 0.3) / 0.7;
    const top = y + Math.round(h * 0.72 * Math.pow(shoulder, 1.7));
    const bottom = y + h - 1 - Math.round(Math.pow(Math.abs(nx), 4) * 1.5);
    for (let yy = top; yy <= bottom; yy++) {
      const ny = (yy - y) / h;
      const light = -nx * 0.45 + (0.45 - ny) * 0.45;
      let v = 0.52 + light * 0.5 + (hash01(xx, yy >> 1, seed) - 0.5) * 0.14;
      // Straw strokes and a diamond rope net (새끼줄).
      if ((xx * 3 + yy * 7) % 13 === 0) v -= 0.14;
      if ((xx + yy) % 7 === 0 || (xx - yy + 70) % 7 === 0) v -= 0.1;
      if (yy >= bottom - 1) v = yy === bottom ? ((xx & 1) === 0 ? 0.12 : 0.3) : 0.36;
      let c = pickRamp(T, clamp(v, 0, 0.999), bayer(xx, yy) * 0.3);
      if (snow && yy < y + Math.round(h * 0.62) + (hash01(xx, 1, seed) < 0.4 ? 1 : 0) && yy < bottom - 1)
        c = light > 0.05 ? (ARCH.snow[4] as Rgba) : light > -0.15 ? (ARCH.snow[3] as Rgba) : (ARCH.snow[1] as Rgba);
      r.set(xx, yy, c);
    }
    r.blend(xx, bottom + 1, withAlpha(hex("#0d0f12"), 140));
  }
  // Ridge (용마름): a twisted straw roll along the top.
  const ridgeY = y + 1;
  for (let xx = Math.round(x + w * 0.24); xx <= Math.round(x + w * 0.76); xx++) {
    if (snow) {
      r.set(xx, ridgeY, ARCH.snow[4] as Rgba);
      continue;
    }
    r.set(xx, ridgeY - 1, (xx & 1) === 0 ? (T[4] as Rgba) : (T[2] as Rgba));
    r.set(xx, ridgeY, (xx & 1) === 0 ? (T[2] as Rgba) : (T[1] as Rgba));
  }
}

/** Granite platform: lit top rows and a coursed front face. */
export function paintStoneBase(r: Raster, x: number, y: number, w: number, topH: number, faceH: number, seed: number, cracked = false): void {
  const S = ARCH.stone;
  for (let yy = y; yy < y + topH; yy++)
    for (let xx = x; xx < x + w; xx++) {
      let c = S[yy === y ? 5 : 4] as Rgba;
      if (cracked && hash01(xx, yy, seed) < 0.12) c = S[2] as Rgba;
      else if (hash01(xx, yy, seed + 1) < 0.08) c = S[3] as Rgba;
      r.set(xx, yy, c);
    }
  const fy = y + topH;
  for (let yy = fy; yy < fy + faceH; yy++) {
    const course = Math.floor((yy - fy) / 3);
    const ly = (yy - fy) % 3;
    for (let xx = x; xx < x + w; xx++) {
      const off = (course & 1) * 3 + (hash3i(course, seed) % 2);
      const block = Math.floor((xx - x + off) / 6);
      const lx = (xx - x + off) % 6;
      let c: Rgba;
      if (ly === 2 || lx === 0) c = ARCH.mortar;
      else {
        let level = 2 + (hash01(block, course, seed) < 0.4 ? 1 : 0);
        if (ly === 0) level++;
        if (xx === x) level = 4;
        if (xx === x + w - 1) level = 1;
        c = S[clamp(level, 0, 5)] as Rgba;
      }
      if (cracked && hash01(xx, yy, seed + 2) < 0.05) c = S[1] as Rgba;
      r.set(xx, yy, c);
    }
  }
  for (let xx = x; xx < x + w; xx++) r.blend(xx, fy + faceH, ARCH.shadow);
}

const hash3i = (a: number, b: number) => Math.floor(hash01(a, b, 99) * 1000);

export interface FacadeOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  bays: number;
  /** Bay index that holds the door (-1: none). */
  door: number;
  palace?: boolean;
  mud?: boolean;
  seed: number;
}

/** Front wall: timber posts, plaster (or mud) infill, lattice doors and windows. */
export function paintFacade(r: Raster, o: FacadeOptions): void {
  const { x, y, w, h, bays, door, seed } = o;
  const wall = o.mud ? (ARCH.mud[2] as Rgba) : ARCH.plaster;
  const wallShade = o.mud ? (ARCH.mud[1] as Rgba) : ARCH.plasterShade;
  const post = o.palace ? ARCH.dancheongRed : ARCH.post;
  const postDark = o.palace ? ARCH.dancheongRedDark : ARCH.postDark;
  r.rect(x, y, w, h, wall);
  for (let xx = x; xx < x + w; xx++) {
    r.set(xx, y, o.palace ? ARCH.dancheongGreen : ARCH.postDark);
    r.set(xx, y + 1, o.palace ? (xx % 3 === 0 ? ARCH.dancheongBlue : ARCH.dancheongGreenDark) : wallShade);
    r.set(xx, y + h - 1, o.mud ? (ARCH.mud[0] as Rgba) : ARCH.post);
    if (o.mud && hash01(xx, y, seed) < 0.3) r.set(xx, y + h - 2, ARCH.mud[1] as Rgba);
  }
  const bayW = w / bays;
  for (let b = 0; b < bays; b++) {
    const bx = Math.round(x + b * bayW);
    const ex = Math.round(x + (b + 1) * bayW);
    const inner0 = bx + 2;
    const inner1 = ex - 2;
    if (b === door) {
      for (let yy = y + 3; yy < y + h - 1; yy++)
        for (let xx = inner0; xx <= inner1; xx++) {
          const frame = xx === inner0 || xx === inner1 || yy === y + 3;
          const grid = (xx - inner0) % 2 === 0 || (yy - y) % 3 === 0;
          r.set(xx, yy, frame ? ARCH.door : o.palace ? (grid ? ARCH.dancheongRedDark : ARCH.paper) : grid ? ARCH.lattice : ARCH.paper);
        }
      if (!o.palace) r.vline(Math.round((inner0 + inner1) / 2), y + 4, y + h - 2, ARCH.door);
    } else if (o.palace || hash01(b, 1, seed) < 0.75) {
      const wy0 = y + 3;
      const wy1 = o.palace ? y + h - 2 : y + Math.min(h - 3, 7);
      for (let yy = wy0; yy <= wy1; yy++)
        for (let xx = inner0; xx <= inner1; xx++) {
          const frame = xx === inner0 || xx === inner1 || yy === wy0 || yy === wy1;
          const grid = (xx - inner0) % 2 === 0 && (yy - wy0) % 2 === 0;
          r.set(xx, yy, frame ? ARCH.lattice : grid ? ARCH.paperShade : ARCH.paper);
        }
    }
    // Post at the bay's left edge (and the right edge for the last bay).
    for (const px of b === bays - 1 ? [bx, ex - 1] : [bx]) {
      r.vline(px, y + 1, y + h - 1, post);
      r.set(px, y + h - 1, postDark);
    }
  }
}

// ---------------------------------------------------------------------------
// Houses

export function giwaHouse(variant: number, season: Season): StructureSprite {
  const snow = season === "winter";
  const r = new Raster(42, 44);
  const tiles = ARCH.giwa[variant & 1] as readonly Rgba[];
  // Footprint (32×32) sits at (5, 12) inside the sprite.
  const fx = 5;
  const fy = 12;
  paintStoneBase(r, fx + 1, fy + 25, 30, 2, 4, variant);
  // Steps up to the door.
  const doorBay = (variant >> 1) % 3;
  paintFacade(r, { x: fx + 3, y: fy + 12, w: 26, h: 13, bays: 3, door: doorBay, seed: variant });
  // Chimney (굴뚝) beside the house on some variants.
  if ((variant >> 3) % 3 === 0) {
    const cx = (variant & 16) !== 0 ? fx + 30 : fx;
    r.rect(cx, fy + 14, 3, 13, ARCH.stone[2] as Rgba);
    r.vline(cx, fy + 14, fy + 26, ARCH.stone[4] as Rgba);
    r.rect(cx - 1, fy + 12, 5, 2, tiles[2] as Rgba);
  }
  paintGiwaRoof(r, { x: 0, y: 1, w: 42, h: 25, inset: 12, curve: 5, tiles, snow, seed: variant, side: 4 });
  return finish((variant & 32) !== 0 ? r.mirrored() : r, -fx, -fy);
}

export function chogaHouse(variant: number, season: Season): StructureSprite {
  const snow = season === "winter";
  const r = new Raster(38, 40);
  const fx = 3;
  const fy = 7;
  // Low earthen base and mud walls with a wooden door and paper window.
  r.rect(fx + 2, fy + 27, 28, 3, ARCH.mud[1] as Rgba);
  r.hline(fx + 2, fx + 29, fy + 27, ARCH.mud[3] as Rgba);
  for (let xx = fx + 2; xx < fx + 30; xx++) r.blend(xx, fy + 30, ARCH.shadow);
  paintFacade(r, { x: fx + 4, y: fy + 14, w: 24, h: 13, bays: 3, door: variant % 3, mud: true, seed: variant });
  // A 마루 porch plank in front of one bay.
  const porch = fx + 4 + ((variant + 1) % 3) * 8;
  r.rect(porch + 1, fy + 24, 7, 2, ARCH.postLight);
  r.hline(porch + 1, porch + 7, fy + 26, ARCH.postDark);
  paintThatchRoof(r, 0, 1, 38, 22, snow, variant);
  // Jangdok (옹기) jars beside some houses.
  if ((variant >> 2) % 2 === 0) {
    const jx = (variant & 8) !== 0 ? fx + 30 : fx - 2;
    for (const [dx, dy] of [
      [0, 0],
      [3, 1],
    ] as const) {
      r.ellipse(jx + dx + 1.5, fy + 27 + dy, 1.8, 2, hex("#4a2f1f"));
      r.set(jx + dx + 1, fy + 26 + dy, hex("#7a5038"));
    }
  }
  return finish((variant & 32) !== 0 ? r.mirrored() : r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Palace (정전) and its ruins

function paintTerrace(r: Raster, x: number, y: number, w: number, topH: number, faceH: number, seed: number, cracked: boolean): void {
  paintStoneBase(r, x, y, w, topH, faceH, seed, cracked);
  // Central stairs.
  const sx = x + Math.round(w / 2) - 6;
  for (let yy = y; yy < y + topH + faceH; yy++) {
    const step = (yy - y) % 2 === 0;
    for (let xx = sx; xx < sx + 12; xx++) r.set(xx, yy, step ? (ARCH.stone[5] as Rgba) : (ARCH.stone[2] as Rgba));
    r.set(sx - 1, yy, ARCH.stone[1] as Rgba);
    r.set(sx + 12, yy, ARCH.stone[1] as Rgba);
  }
  if (!cracked) {
    // Balustrade posts along the front edge (난간).
    for (let xx = x; xx < x + w; xx++) {
      if (xx >= sx - 1 && xx <= sx + 12) continue;
      r.set(xx, y - 1, ARCH.stone[4] as Rgba);
      if ((xx - x) % 5 === 0) {
        r.set(xx, y - 2, ARCH.stone[5] as Rgba);
        r.set(xx, y - 3, ARCH.stone[4] as Rgba);
      }
    }
  }
}

export function palace(variant: number, season: Season): StructureSprite {
  const snow = season === "winter";
  const W = 94;
  const fx = 7;
  const fy = 40;
  const r = new Raster(W, fy + 50);
  // 월대 terrace across the footprint.
  paintTerrace(r, fx, fy + 30, 80, 4, 12, variant, false);
  // Hall body with 단청 pillars and lattice doors.
  paintFacade(r, { x: fx + 10, y: fy + 12, w: 60, h: 18, bays: 6, door: -1, palace: true, seed: variant });
  // Bracket band (공포) under the lower eave.
  for (let xx = fx + 8; xx < fx + 72; xx++) {
    r.set(xx, fy + 11, xx % 4 === 0 ? ARCH.dancheongRed : ARCH.dancheongGreen);
    r.set(xx, fy + 10, xx % 2 === 0 ? ARCH.dancheongGreenDark : ARCH.dancheongBlue);
  }
  // Lower roof skirt.
  paintGiwaRoof(r, { x: 0, y: fy - 8, w: W, h: 19, inset: 8, curve: 5, tiles: ARCH.palaceRoof, snow, seed: variant, side: 4, dancheong: true });
  // Upper storey band and brackets.
  for (let yy = fy - 16; yy <= fy - 7; yy++)
    for (let xx = fx + 18; xx < fx + 62; xx++) {
      const band = yy - (fy - 16);
      let c: Rgba = ARCH.dancheongGreen;
      if (band === 0 || band === 9) c = ARCH.dancheongGreenDark;
      else if (band >= 5) c = (xx - fx) % 4 === 0 ? ARCH.lattice : ARCH.paperShade;
      else if (band === 2) c = xx % 4 === 0 ? ARCH.dancheongYellow : ARCH.dancheongBlue;
      else if (band === 3) c = xx % 2 === 0 ? ARCH.dancheongRed : ARCH.dancheongGreen;
      if ((xx - fx - 18) % 11 === 0 && band > 3) c = ARCH.dancheongRed;
      r.set(xx, yy, c);
    }
  // Upper roof with white ridge and figurines.
  paintGiwaRoof(r, {
    x: 6,
    y: 1,
    w: W - 12,
    h: fy - 14,
    inset: 18,
    curve: 6,
    tiles: ARCH.palaceRoof,
    snow,
    seed: variant + 7,
    side: 4,
    whiteRidge: true,
    dancheong: true,
    figurines: true,
  });
  return finish(r, -fx, -fy);
}

export function palaceRuin(variant: number, season: Season): StructureSprite {
  const snow = season === "winter";
  const fx = 4;
  const fy = 14;
  const r = new Raster(88, fy + 52);
  paintTerrace(r, fx, fy + 30, 80, 4, 12, variant, true);
  // Upper platform (기단) where the hall stood, now cracked and overgrown.
  paintStoneBase(r, fx + 8, fy + 20, 64, 9, 3, variant + 3, true);
  // Foundation stones (주춧돌) in a grid.
  for (let k = 0; k < 7; k++)
    for (const row of [fy + 21, fy + 26]) {
      const x = fx + 11 + k * 10;
      r.ellipse(x + 1, row + 1, 2, 1.4, ARCH.stone[5] as Rgba);
      r.set(x + 1, row + 2, ARCH.stone[1] as Rgba);
    }
  // Charred posts (some broken off, some leaning).
  const posts = [
    [fx + 21, 14],
    [fx + 31, 7],
    [fx + 51, 11],
    [fx + 61, 5],
    [fx + 41, 3],
  ] as const;
  posts.forEach(([x, height], k) => {
    const lean = k % 3 === 1 ? 1 : 0;
    for (let i = 0; i < height; i++) {
      const xx = x + (lean && i > height / 2 ? 1 : 0);
      const yy = fy + 26 - i;
      r.set(xx, yy, ARCH.char[i % 4 === 0 ? 2 : 1] as Rgba);
      r.set(xx + 1, yy, ARCH.char[0] as Rgba);
    }
    r.set(x, fy + 26 - height, ARCH.char[2] as Rgba);
  });
  // Fallen beam and piles of broken roof tiles.
  r.line(fx + 24, fy + 25, fx + 36, fy + 28, ARCH.char[1] as Rgba);
  r.line(fx + 24, fy + 24, fx + 36, fy + 27, ARCH.char[2] as Rgba);
  const tiles = ARCH.palaceRoof;
  for (let k = 0; k < 70; k++) {
    const pile = k % 3;
    const cx = [fx + 18, fx + 46, fx + 64][pile] as number;
    const x = Math.round(cx + (hash01(k, 1, variant) - 0.5) * 12);
    const y = Math.round(fy + 24 + (hash01(k, 2, variant) - 0.3) * 6);
    r.set(x, y, tiles[1 + (k % 4)] as Rgba);
    if (k % 2) r.set(x + 1, y, tiles[0] as Rgba);
  }
  // Weeds through the cracks.
  const weed = snow ? (ARCH.snow[3] as Rgba) : season === "autumn" ? hex("#9a8a4a") : hex("#5f8a3e");
  const weedDark = snow ? (ARCH.snow[1] as Rgba) : season === "autumn" ? hex("#6f6232") : hex("#3e6a2e");
  for (let k = 0; k < 46; k++) {
    const x = fx + 2 + Math.floor(hash01(k, 5, variant) * 76);
    const y = fy + 18 + Math.floor(hash01(k, 6, variant) * 24);
    r.set(x, y, weed);
    r.set(x, y + 1, weedDark);
    if (k % 3 === 0) r.set(x + 1, y - 1, weed);
  }
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Pavilion (누각) on a stone base

export function pavilion(variant: number, season: Season): StructureSprite {
  const snow = season === "winter";
  const W = 60;
  const fx = 6;
  const fy = 18;
  const r = new Raster(W, fy + 34);
  paintStoneBase(r, fx + 1, fy + 15, 46, 2, 14, variant);
  // Floor, railing and open bays between red posts.
  r.rect(fx + 3, fy + 4, 42, 11, hex("#3b2a20"));
  r.rect(fx + 3, fy + 12, 42, 3, ARCH.postLight);
  for (let xx = fx + 3; xx < fx + 45; xx++) {
    r.set(xx, fy + 10, ARCH.postDark);
    r.set(xx, fy + 9, xx % 3 === 0 ? ARCH.postLight : hex("#3b2a20"));
    r.set(xx, fy + 8, ARCH.postLight);
  }
  for (const px of [fx + 3, fx + 13, fx + 24, fx + 34, fx + 44]) {
    r.vline(px, fy + 2, fy + 14, ARCH.dancheongRed);
    r.set(px, fy + 14, ARCH.dancheongRedDark);
  }
  for (let xx = fx + 2; xx < fx + 46; xx++) r.set(xx, fy + 2, xx % 3 ? ARCH.dancheongGreen : ARCH.dancheongRed);
  paintGiwaRoof(r, { x: 0, y: 1, w: W, h: fy + 2, inset: 16, curve: 5, tiles: ARCH.giwa[variant & 1] as readonly Rgba[], snow, seed: variant, side: 4, dancheong: true, whiteRidge: true });
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// City walls (성곽) and gate towers

export const WALL_HEIGHT = 11;
export const PARAPET = 4;

export interface WallShape {
  /** Neighbouring wall tiles. */
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  /** Sides facing outside the town (parapets). */
  outN: boolean;
  outE: boolean;
  outS: boolean;
  outW: boolean;
  snow: boolean;
  seed: number;
}

/** One wall tile: a walkway top face, 여장 parapets on outer sides, and a coursed front face. */
export function wallTile(shape: WallShape): StructureSprite {
  const H = WALL_HEIGHT;
  const P = PARAPET;
  const r = new Raster(16, P + 16 + H + 1);
  const S = ARCH.stone;
  const top = P;
  const seed = shape.seed;
  // Walkway (top face).
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      // Flagstones laid in courses across the walkway.
      const course = y >> 2;
      const seamX = (x + (course & 1) * 4) % 8 === 0;
      let c = (hash01((x + (course & 1) * 4) >> 3, course, seed) < 0.35 ? S[2] : S[3]) as Rgba;
      if ((y & 3) === 3 || seamX) c = S[2] as Rgba;
      if (shape.snow) c = (hash01(x, y, seed) < 0.15 ? ARCH.snow[2] : ARCH.snow[3]) as Rgba;
      r.set(x, top + y, c);
    }
  // Open (non-wall) sides get an edge.
  if (!shape.n) for (let x = 0; x < 16; x++) r.set(x, top, shape.snow ? (ARCH.snow[4] as Rgba) : (S[5] as Rgba));
  if (!shape.w) for (let y = 0; y < 16; y++) r.set(0, top + y, S[2] as Rgba);
  if (!shape.e) for (let y = 0; y < 16; y++) r.set(15, top + y, S[1] as Rgba);
  // Front (south) face when nothing continues below.
  if (!shape.s) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < 16; x++) {
        const course = Math.floor(y / 3);
        const ly = y % 3;
        const off = (course & 1) * 4;
        const lx = (x + off) % 8;
        let c: Rgba;
        if (ly === 2 || lx === 0) c = ARCH.mortar;
        else {
          let level = hash01((x + off) >> 3, course, seed) < 0.4 ? 2 : 3;
          if (ly === 0) level++;
          if (y >= H - 2) level--;
          c = S[clamp(level, 0, 5)] as Rgba;
        }
        if (!shape.w && x === 0) c = S[4] as Rgba;
        if (!shape.e && x === 15) c = S[0] as Rgba;
        r.set(x, top + 16 + y, c);
      }
    for (let x = 0; x < 16; x++) r.blend(x, top + 16 + H, ARCH.shadow);
  }
  // Parapets (여장) with crenels (타구) and loopholes (총안).
  const merlonDark = S[1] as Rgba;
  const merlonLight = (shape.snow ? ARCH.snow[4] : S[5]) as Rgba;
  const merlonFace = S[3] as Rgba;
  if (shape.outN) {
    for (let x = 0; x < 16; x++) {
      const gap = x % 6 === 5;
      if (gap) continue;
      r.set(x, top - 3, merlonLight);
      r.set(x, top - 2, merlonFace);
      r.set(x, top - 1, x % 6 === 2 ? merlonDark : merlonFace);
      r.set(x, top, S[2] as Rgba);
    }
  }
  if (shape.outS) {
    for (let x = 0; x < 16; x++) {
      const gap = x % 6 === 5;
      r.set(x, top + 12, gap ? (S[2] as Rgba) : merlonLight);
      r.set(x, top + 13, gap ? (S[2] as Rgba) : merlonFace);
      r.set(x, top + 14, gap ? (S[2] as Rgba) : x % 6 === 2 ? merlonDark : merlonFace);
      r.set(x, top + 15, S[3] as Rgba);
    }
  }
  if (shape.outW || shape.outE) {
    const x0 = shape.outW ? 0 : 13;
    for (let y = -2; y < 16; y++) {
      const gap = (y + 16) % 6 === 5;
      if (y < 0 && shape.n) continue;
      for (let k = 0; k < 3; k++) {
        const x = x0 + k;
        const outer = shape.outW ? k === 0 : k === 2;
        let c: Rgba = gap ? (S[2] as Rgba) : outer ? merlonDark : k === 1 ? merlonLight : merlonFace;
        if (gap && outer) c = S[1] as Rgba;
        r.set(x, top + y, c);
      }
    }
  }
  return finish(r, 0, -(H + P));
}

/** 문루: a gate pavilion standing on the wall over a passage `span` tiles wide. */
export function gateTower(span: number, horizontal: boolean, season: Season, variant: number): StructureSprite {
  const snow = season === "winter";
  const width = horizontal ? (span + 2) * 16 : 32;
  const W = width + 8;
  const roofH = horizontal ? 24 : 18;
  const r = new Raster(W, roofH + 14);
  // Hall walls on the wall top: red posts and plaster.
  const bodyY = roofH - 3;
  for (let yy = bodyY; yy < bodyY + 10; yy++)
    for (let xx = 8; xx < W - 8; xx++) {
      let c: Rgba = (xx - 8) % 8 === 0 ? ARCH.dancheongRed : yy === bodyY ? ARCH.dancheongGreen : ARCH.plaster;
      if (yy > bodyY + 2 && yy < bodyY + 8 && (xx - 8) % 8 >= 3 && (xx - 8) % 8 <= 5) c = ARCH.lattice;
      r.set(xx, yy, c);
    }
  paintGiwaRoof(r, { x: 0, y: 1, w: W, h: roofH, inset: Math.round(W * 0.22), curve: 4, tiles: ARCH.palaceRoof, snow, seed: variant, side: 3, whiteRidge: true, dancheong: true });
  // Footprint-relative placement: centred over the passage, sitting on the wall top.
  const ox = horizontal ? -4 - 16 : -4 - 8;
  const oy = -(WALL_HEIGHT + roofH + 1);
  return finish(r, ox, oy);
}

/** Stone arch (홍예문) spanning a passage in an east–west wall. */
export function gateArch(span: number, season: Season, seed: number): StructureSprite {
  const H = WALL_HEIGHT;
  const width = span * 16;
  const r = new Raster(width, 16 + H + 1);
  const S = ARCH.stone;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < width; x++)
      r.set(x, y, season === "winter" ? (ARCH.snow[3] as Rgba) : ((hash01(x >> 1, y >> 1, seed) < 0.3 ? S[3] : S[4]) as Rgba));
  const cx = (width - 1) / 2;
  const archW = Math.min(width / 2 - 1, 6);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / archW;
      const archTop = H - 9 + Math.round(4 * (dx * dx));
      const inArch = Math.abs(dx) <= 1 && y >= archTop;
      let c: Rgba;
      if (inArch) c = withAlpha(hex("#0e0c0b"), 150);
      else if (Math.abs(dx) <= 1.25 && y >= archTop - 1) c = S[5] as Rgba;
      else c = ((y % 3 === 2 || (x + (Math.floor(y / 3) & 1) * 4) % 8 === 0) ? ARCH.mortar : S[y % 3 === 0 ? 4 : 3]) as Rgba;
      r.set(x, 16 + y, c);
    }
  return finish(r, 0, -H);
}
