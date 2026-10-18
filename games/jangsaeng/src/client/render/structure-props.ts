// Smaller structures: market stalls, 봉수대 beacons, 판옥선 warships, army
// tents, 장승 totems, the village 정자나무, stone pagodas, wells and flags.
// Animated parts (smoke, cloth) are separate frames chosen at draw time.

import type { Surface } from "./pixel.ts";
import { Raster, bayer, hash01, hex, paintBlobs, ramp, withAlpha, type Rgba } from "./raster.ts";
import { ARCH, finish, paintGiwaRoof, paintStoneBase, type StructureSprite } from "./structure-art.ts";
import type { Season } from "./terrain-art.ts";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const WOOD = ramp("#3f2919", "#5a3b24", "#76502f", "#93683e", "#ad8250");

// ---------------------------------------------------------------------------
// Market stall (장터)

const AWNINGS: readonly (readonly [string, string])[] = [
  ["#ece4d0", "#2b5a8c"],
  ["#c9a35a", "#9c7a38"],
  ["#ece4d0", "#b8312f"],
  ["#d9c48f", "#7c6a3a"],
];

export function market(variant: number, season: Season): StructureSprite {
  const r = new Raster(20, 28);
  const fx = 2;
  const fy = 12;
  const [cloth, stripe] = AWNINGS[variant % AWNINGS.length] as readonly [string, string];
  const C = hex(cloth);
  const T = hex(stripe);
  // Posts.
  for (const x of [fx + 1, fx + 14]) {
    r.vline(x, fy - 7, fy + 14, WOOD[1] as Rgba);
    r.vline(x + 1, fy - 7, fy + 14, WOOD[0] as Rgba);
  }
  // Counter: top with goods, front boards.
  r.rect(fx, fy + 6, 16, 3, WOOD[4] as Rgba);
  r.rect(fx, fy + 9, 16, 6, WOOD[2] as Rgba);
  for (let x = fx; x < fx + 16; x++) {
    r.set(x, fy + 9, WOOD[3] as Rgba);
    if (x % 4 === 0) r.vline(x, fy + 10, fy + 14, WOOD[1] as Rgba);
    r.blend(x, fy + 15, ARCH.shadow);
  }
  const goods = variant >> 2;
  const items: readonly (readonly [number, number, string, string])[] = [
    [2, 4, "#4a2f1f", "#7a5038"],
    [6, 5, "#5f8a3e", "#86b05a"],
    [10, 5, "#d8782a", "#f0a050"],
    [13, 4, "#4a2f1f", "#7a5038"],
    [4, 6, "#c9d3da", "#eef2f4"],
    [9, 6, "#b8312f", "#d9667b"],
  ];
  items.forEach(([dx, dy, dark, light], k) => {
    if ((goods + k) % 5 === 0) return;
    const x = fx + dx;
    const y = fy + dy;
    r.ellipse(x + 1, y + 1.2, 1.7, 1.6, hex(dark));
    r.set(x, y, hex(light));
  });
  // Sloped awning with stripes and a fringe.
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 20; x++) {
      const stripeOn = Math.floor(x / 3) % 2 === 0;
      let c = stripeOn ? C : T;
      if (y === 0) c = withAlpha(C, 255);
      if (y >= 5) c = y === 6 && x % 2 ? 0 : stripeOn ? T : C;
      if (season === "winter" && y < 3) c = ARCH.snow[y === 0 ? 4 : 3] as Rgba;
      if (c) r.set(x, fy - 12 + y + (y > 0 ? 0 : 0), c);
    }
  for (let x = 0; x < 20; x++) r.blend(x, fy - 5, withAlpha(hex("#101010"), 90));
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Beacon (봉수대) with animated smoke

export function beacon(variant: number, season: Season): StructureSprite {
  const r = new Raster(18, 34);
  const fx = 1;
  const fy = 18;
  paintStoneBase(r, fx, fy + 5, 16, 3, 7, variant);
  // Chimney: a rounded stack of fieldstone, lit from the left.
  for (let y = fy - 14; y <= fy + 5; y++) {
    const narrowing = y < fy - 10 ? 1 : 0;
    for (let x = fx + 3 + narrowing; x <= fx + 12 - narrowing; x++) {
      const t = (x - fx - 3) / 9;
      let level = t < 0.25 ? 4 : t < 0.6 ? 3 : t < 0.85 ? 2 : 1;
      if ((y + (x >> 2)) % 3 === 0) level -= 1;
      if (hash01(x, y, variant) < 0.08) level -= 1;
      r.set(x, y, ARCH.stone[clamp(level, 0, 5)] as Rgba);
    }
  }
  // Mouth of the chimney.
  r.ellipse(fx + 8, fy - 14, 4, 1.6, hex("#1a1412"));
  r.hline(fx + 5, fx + 10, fy - 15, ARCH.stone[5] as Rgba);
  if (season === "winter") r.hline(fx + 4, fx + 11, fy - 16, ARCH.snow[4] as Rgba);
  return finish(r, -fx, -fy);
}

let puffs: readonly Surface[] | null = null;

/** Soft smoke puffs (small → large). */
export function smokePuffs(): readonly Surface[] {
  if (puffs) return puffs;
  puffs = [2, 3, 4, 5].map((radius) => {
    const size = radius * 2 + 2;
    const r = new Raster(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - size / 2) / radius;
        const dy = (y + 0.5 - size / 2) / radius;
        const q = dx * dx + dy * dy;
        if (q > 1) continue;
        const lit = dx + dy < -0.3;
        if (q > 0.6 && bayer(x, y) > 0.1) continue;
        r.set(x, y, lit ? hex("#e4e2dc") : hex("#b9b6ae"));
      }
    return r.toSurface();
  });
  return puffs;
}

// ---------------------------------------------------------------------------
// 판옥선 (panokseon) warship, 3×2 tiles

export function ship(variant: number, season: Season): StructureSprite {
  const W = 58;
  const fx = 5;
  const fy = 28;
  const r = new Raster(W, fy + 36);
  const hull = WOOD;
  const deckY0 = fy + 3;
  const deckY1 = fy + 22;
  const bow = (y: number) => {
    const t = (y - deckY0) / (deckY1 - deckY0);
    return Math.round(Math.abs(t - 0.5) * 2 * 6);
  };
  // Waterline wake.
  for (let x = fx - 4; x < fx + 52; x++) {
    r.set(x, fy + 30, withAlpha(hex("#e6f2f3"), x % 3 === 0 ? 90 : 200));
    if (x % 2 === 0) r.set(x, fy + 31, withAlpha(hex("#a6d0dc"), 150));
  }
  // Oars slanting into the water from the hull side.
  for (let k = 0; k < 9; k++) {
    const x = fx + 8 + k * 4;
    r.line(x, fy + 24, x - 3, fy + 31, hull[1] as Rgba);
  }
  // Hull side (dark planking) under the deck edge.
  for (let y = deckY1 - 2; y <= fy + 29; y++) {
    const shrink = Math.max(0, y - (fy + 26)) * 2;
    for (let x = fx + 2 + shrink + 2; x < fx + 48 - shrink; x++) {
      let c = hull[(y - deckY1) % 3 === 0 ? 0 : 1] as Rgba;
      if (y === deckY1 + 1) c = hull[3] as Rgba;
      if (y === fy + 25 && x % 4 === 1) c = hex("#120c08");
      r.set(x, y, c);
    }
  }
  // Main deck (seen from above): planks with a bulwark (여장) around.
  for (let y = deckY0; y <= deckY1; y++) {
    const inset = bow(y);
    for (let x = fx + inset; x < fx + 48 - Math.round(inset / 3); x++) {
      const edge = x === fx + inset || x === fx + 47 - Math.round(inset / 3) || y === deckY0 || y === deckY1;
      let c: Rgba = ((y - deckY0) % 3 === 2 ? hull[2] : hull[3]) as Rgba;
      if (edge) c = hull[4] as Rgba;
      else if (y === deckY0 + 1 || y === deckY1 - 1 || x === fx + inset + 1) c = (x % 4 === 0 ? hull[0] : hull[2]) as Rgba;
      if (season === "winter" && !edge && hash01(x, y, variant) < 0.25) c = ARCH.snow[3] as Rgba;
      r.set(x, y, c);
    }
  }
  // 장대: the command pavilion on the upper deck.
  const px = fx + 26;
  for (let y = fy + 6; y <= fy + 14; y++)
    for (let x = px; x < px + 14; x++) r.set(x, y, (x - px) % 4 === 0 ? ARCH.dancheongRed : hull[1] as Rgba);
  paintGiwaRoof(r, { x: px - 3, y: fy - 4, w: 20, h: 11, inset: 5, curve: 2, tiles: ARCH.giwa[0] as readonly Rgba[], snow: season === "winter", seed: variant, side: 2 });
  // Masts and square sails.
  const sail = hex(variant % 3 === 0 ? "#c9b48a" : "#b9876a");
  const sailDark = hex(variant % 3 === 0 ? "#a08a62" : "#8f5f48");
  for (const [mx, top, h] of [
    [fx + 14, 4, 22],
    [fx + 24, 0, 24],
  ] as const) {
    r.vline(mx, top, fy + 12, hull[0] as Rgba);
    for (let y = top + 2; y < top + 2 + h - 6; y++)
      for (let x = mx - 6; x <= mx + 6; x++) {
        const batten = (y - top - 2) % 4 === 3;
        const lit = x < mx;
        r.set(x, y, batten ? (hull[1] as Rgba) : lit ? sail : sailDark);
      }
    r.hline(mx - 7, mx + 7, top + 2, hull[0] as Rgba);
  }
  // Stern banner.
  r.vline(fx + 45, fy - 4, fy + 6, hull[0] as Rgba);
  r.rect(fx + 46, fy - 4, 5, 3, ARCH.dancheongRed);
  r.rect(fx + 46, fy - 1, 5, 1, hex("#2b5a8c"));
  return finish((variant & 1) !== 0 ? r.mirrored() : r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Army tent (군막), sized to its footprint

export function tent(variant: number, season: Season, w: number, h: number): StructureSprite {
  const fw = w * 16;
  const fh = h * 16;
  const W = fw + 6;
  const top = Math.round(fh * 0.3) + 4;
  const r = new Raster(W, fh + top);
  const canvas = ramp("#9d968a", "#bdb6a8", "#d8d1c2", "#ece6d8");
  const trim = variant % 2 ? ARCH.dancheongRed : hex("#2b5a8c");
  const cx = (W - 1) / 2;
  const base = fh + top - 2;
  const ridgeY = 3;
  for (let y = ridgeY; y <= base; y++) {
    const t = (y - ridgeY) / (base - ridgeY);
    const half = 2 + Math.min(1, t * 1.5) * (W / 2 - 2);
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const dx = x - cx;
      const front = y > base - fh * 0.45 && Math.abs(dx) < half * 0.55;
      let c: Rgba;
      if (front) c = Math.abs(dx) < half * 0.22 && y > base - fh * 0.38 ? hex("#2a211b") : (canvas[2] as Rgba);
      else c = (dx < 0 ? canvas[3] : canvas[1]) as Rgba;
      if (Math.abs(Math.abs(dx) - half) < 1) c = trim;
      if (season === "winter" && !front && t < 0.5) c = ARCH.snow[dx < 0 ? 4 : 2] as Rgba;
      r.set(x, y, c);
    }
  }
  r.vline(Math.round(cx), 0, ridgeY + 1, WOOD[0] as Rgba);
  r.rect(Math.round(cx) + 1, 0, 3, 2, trim);
  for (let x = 0; x < W; x++) r.blend(x, base + 1, ARCH.shadow);
  return finish(r, -3, -(top - 2));
}

// ---------------------------------------------------------------------------
// 장승: a pair of carved village guardians

export function jangseung(variant: number, season: Season): StructureSprite {
  const r = new Raster(18, 34);
  const fx = 1;
  const fy = 18;
  const pole = (x: number, height: number, face: Rgba, hat: boolean, seed: number) => {
    const top = fy + 15 - height;
    for (let y = top; y <= fy + 14; y++)
      for (let k = 0; k < 5; k++) {
        const c = k === 0 ? (WOOD[3] as Rgba) : k === 4 ? (WOOD[1] as Rgba) : (WOOD[2] as Rgba);
        r.set(x + k, y, c);
      }
    // Face: painted, with bulging eyes, a big nose and a toothy grin.
    r.rect(x, top + 3, 5, 7, face);
    r.set(x + 1, top + 4, hex("#f3ecdc"));
    r.set(x + 3, top + 4, hex("#f3ecdc"));
    r.set(x + 1, top + 5, hex("#1d1a19"));
    r.set(x + 3, top + 5, hex("#1d1a19"));
    r.set(x + 2, top + 6, WOOD[1] as Rgba);
    r.hline(x + 1, x + 3, top + 8, hex("#f3ecdc"));
    r.set(x + 2, top + 8, hex("#1d1a19"));
    if (hat) {
      r.rect(x - 1, top + 1, 7, 2, hex("#1d1a19"));
      r.rect(x, top - 2, 5, 3, hex("#2a2523"));
    } else {
      r.rect(x, top, 5, 3, WOOD[3] as Rgba);
      r.hline(x, x + 4, top, WOOD[4] as Rgba);
    }
    // Carved inscription marks.
    for (let y = top + 11; y < fy + 13; y += 2) r.hline(x + 1, x + 1 + (hash01(y, seed, 3) < 0.5 ? 2 : 1), y, hex("#2a1d14"));
    if (season === "winter") r.hline(x, x + 4, hat ? top - 3 : top - 1, ARCH.snow[4] as Rgba);
  };
  pole(fx + 1, 22 + (variant % 3), hex("#b8462e"), true, 1);
  pole(fx + 9, 19 + (variant % 2), hex("#d9b48a"), false, 2);
  for (let x = fx; x < fx + 16; x++) r.blend(x, fy + 15, ARCH.shadow);
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// 정자나무: the great village zelkova

const CANOPY: Readonly<Record<Season, readonly Rgba[]>> = {
  spring: ramp("#24452a", "#335f34", "#477a40", "#5f9450", "#7cad64", "#9cc47c"),
  summer: ramp("#18321e", "#234629", "#305b34", "#3f6f3f", "#52844b", "#699a59"),
  autumn: ramp("#4a2014", "#6e3418", "#97521e", "#b87428", "#d39838", "#e6b852"),
  winter: ramp("#3a2e26", "#4d3e32", "#5f4d3e", "#73604c", "#86725b", "#99846a"),
};

export function greatTree(variant: number, season: Season): StructureSprite {
  const W = 56;
  const fx = 12;
  const fy = 30;
  const r = new Raster(W, fy + 34);
  const bark = ramp("#2e2219", "#45342a", "#5c4637", "#735a48");
  // Ground shadow.
  r.ellipse(fx + 18, fy + 29, 20, 5, withAlpha(hex("#0e140c"), 70), true);
  // Gnarled trunk with buttress roots.
  for (let y = fy + 6; y <= fy + 29; y++) {
    const t = (y - fy - 6) / 23;
    const half = 3.5 + Math.pow(t, 3) * 6;
    const lean = Math.round(Math.sin(t * 2.4) * 1.5);
    for (let x = Math.floor(fx + 16 - half + lean); x <= Math.ceil(fx + 16 + half + lean); x++) {
      const u = (x - (fx + 16 - half + lean)) / (2 * half);
      const level = u < 0.3 ? 3 : u < 0.7 ? 2 : u < 0.9 ? 1 : 0;
      r.set(x, y, bark[(hash01(x, y >> 1, variant) < 0.15 ? Math.max(0, level - 1) : level)] as Rgba);
    }
  }
  // Straw rope (금줄) with paper strips.
  for (let x = fx + 11; x <= fx + 21; x++) {
    r.set(x, fy + 19, hex("#d4c08a"));
    if (x % 3 === 0) {
      r.set(x, fy + 20, hex("#f4f0e4"));
      r.set(x, fy + 21, hex("#f4f0e4"));
    }
  }
  if (season === "winter") {
    // Bare crown: a dense fan of branches.
    const twig = bark[2] as Rgba;
    const branch = (x: number, y: number, a: number, len: number, depth: number, k: number) => {
      const x1 = x + Math.cos(a) * len;
      const y1 = y + Math.sin(a) * len;
      r.line(x, y, x1, y1, depth > 2 ? (bark[1] as Rgba) : twig);
      if (depth === 0) return;
      const s = 0.35 + hash01(k, depth, variant) * 0.3;
      branch(x1, y1, a - s, len * 0.72, depth - 1, k * 2 + 1);
      branch(x1, y1, a + s, len * 0.72, depth - 1, k * 2 + 2);
    };
    branch(fx + 16, fy + 8, -Math.PI / 2 - 0.7, 10, 4, 1);
    branch(fx + 16, fy + 8, -Math.PI / 2 + 0.7, 10, 4, 2);
    branch(fx + 16, fy + 6, -Math.PI / 2, 12, 4, 3);
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < W; x++)
        if (r.get(x, y) === twig && r.get(x, y - 1) === 0 && hash01(x, y, 5) < 0.5) r.set(x, y - 1, ARCH.snow[4] as Rgba);
  } else {
    const cx = fx + 16;
    const blobs = [
      { cx, cy: fy - 6, rx: 22, ry: 13 },
      { cx: cx - 13, cy: fy - 12, rx: 10, ry: 8, z: 0.05 },
      { cx: cx + 12, cy: fy - 14, rx: 11, ry: 8, z: 0.05 },
      { cx: cx - 2, cy: fy - 20, rx: 11, ry: 8, z: 0.08 },
      { cx: cx - 18, cy: fy - 2, rx: 8, ry: 6, z: 0.02 },
      { cx: cx + 18, cy: fy - 3, rx: 8, ry: 6, z: 0.02 },
      { cx: cx + 4, cy: fy + 2, rx: 12, ry: 6, z: 0.01 },
    ];
    paintBlobs(r, blobs, { ramp: CANOPY[season], seed: variant, texture: 0.15, dither: 0.4, creases: false });
    r.outline(CANOPY[season][0] as Rgba, { top: false });
  }
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Stone pagoda (석탑), 1×2 tiles

export function pagoda(variant: number, season: Season): StructureSprite {
  const W = 24;
  const fx = 4;
  const fy = 30;
  const r = new Raster(W, fy + 34);
  const S = ARCH.stone;
  const block = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const t = (x - x0) / Math.max(1, x1 - x0);
        let level = t < 0.2 ? 5 : t < 0.55 ? 4 : t < 0.85 ? 3 : 2;
        if (y === y1) level -= 1;
        r.set(x, y, S[clamp(level, 0, 5)] as Rgba);
      }
  };
  const roofStone = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) {
      const corner = x === x0 || x === x1;
      r.set(x, y - (corner ? 1 : 0), S[corner ? 4 : 5] as Rgba);
      r.set(x, y + 1 - (corner ? 1 : 0), S[3] as Rgba);
      r.set(x, y + 2, S[1] as Rgba);
      if (season === "winter") r.set(x, y - 1 - (corner ? 1 : 0), ARCH.snow[4] as Rgba);
    }
  };
  // Two-tier base (기단).
  block(fx - 3, fx + 18, fy + 26, fy + 31);
  block(fx - 1, fx + 16, fy + 20, fy + 25);
  // Three storeys.
  let y = fy + 19;
  for (let k = 0; k < 3; k++) {
    const half = 6 - k;
    const bodyH = k === 0 ? 7 : 4;
    block(fx + 8 - half + 2, fx + 7 + half - 2, y - bodyH, y);
    y -= bodyH;
    roofStone(fx + 8 - half - 2, fx + 7 + half + 2, y - 2);
    y -= 3;
  }
  // Finial (상륜부).
  for (let k = 0; k < 7; k++) r.hline(fx + 7 - (k % 2), fx + 8 + (k % 2), y - k, (k % 2 ? S[3] : S[4]) as Rgba);
  r.set(fx + 7, y - 7, S[5] as Rgba);
  for (let x = fx - 3; x <= fx + 18; x++) r.blend(x, fy + 32, ARCH.shadow);
  void variant;
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Well (우물)

export function well(variant: number, season: Season): StructureSprite {
  const r = new Raster(18, 28);
  const fx = 1;
  const fy = 10;
  const S = ARCH.stone;
  // Stone rim in 3/4: lit top ring, dark water, coursed front.
  r.ellipse(fx + 8, fy + 8, 7, 3.6, S[4] as Rgba);
  r.ellipse(fx + 8, fy + 8, 4.6, 2, hex("#162330"));
  r.set(fx + 6, fy + 8, hex("#3c5a6e"));
  for (let y = fy + 9; y <= fy + 14; y++)
    for (let x = fx + 1; x <= fx + 15; x++) {
      const dx = (x + 0.5 - (fx + 8)) / 7;
      if (y > fy + 8 + Math.round(3.6 * Math.sqrt(Math.max(0, 1 - dx * dx))) + 5) continue;
      if (y < fy + 8 + Math.round(3.6 * Math.sqrt(Math.max(0, 1 - dx * dx)))) continue;
      const level = dx < -0.4 ? 4 : dx < 0.4 ? 3 : 2;
      r.set(x, y, ((y + (x >> 2)) % 3 === 0 ? S[1] : S[level]) as Rgba);
    }
  // Wooden frame with a pulley and bucket (두레박).
  for (const x of [fx + 1, fx + 14]) {
    r.vline(x, fy - 8, fy + 8, WOOD[2] as Rgba);
    r.vline(x + 1, fy - 8, fy + 8, WOOD[0] as Rgba);
  }
  r.hline(fx, fx + 16, fy - 9, WOOD[3] as Rgba);
  r.hline(fx, fx + 16, fy - 8, WOOD[1] as Rgba);
  r.vline(fx + 8, fy - 7, fy - 2, hex("#c8b27a"));
  r.rect(fx + 7, fy - 2, 3, 3, WOOD[3] as Rgba);
  r.hline(fx + 7, fx + 9, fy + 1, WOOD[1] as Rgba);
  if (season === "winter") {
    r.hline(fx, fx + 16, fy - 10, ARCH.snow[4] as Rgba);
    for (let x = fx + 2; x <= fx + 14; x++) if (hash01(x, 1, variant) < 0.6) r.set(x, fy + 5, ARCH.snow[3] as Rgba);
  }
  for (let x = fx; x <= fx + 16; x++) r.blend(x, fy + 15, ARCH.shadow);
  return finish(r, -fx, -fy);
}

// ---------------------------------------------------------------------------
// Flag (깃발): a pole plus animated cloth frames

const FLAG_COLOURS: readonly (readonly [string, string])[] = [
  ["#b8312f", "#e2b23a"],
  ["#2b5a8c", "#f3ecdc"],
  ["#e2b23a", "#b8312f"],
  ["#f3ecdc", "#2b5a8c"],
  ["#1d1a19", "#f3ecdc"],
];

export function flagPole(variant: number, season: Season): StructureSprite {
  const r = new Raster(8, 36);
  const fx = 0;
  const fy = 20;
  r.vline(fx + 3, 1, fy + 13, WOOD[3] as Rgba);
  r.vline(fx + 4, 1, fy + 13, WOOD[1] as Rgba);
  r.rect(fx + 2, 0, 4, 2, ARCH.dancheongYellow);
  r.rect(fx + 1, fy + 12, 6, 3, ARCH.stone[3] as Rgba);
  r.hline(fx + 1, fx + 6, fy + 12, season === "winter" ? (ARCH.snow[4] as Rgba) : (ARCH.stone[5] as Rgba));
  for (let x = fx; x < fx + 8; x++) r.blend(x, fy + 15, ARCH.shadow);
  void variant;
  return finish(r, -4, -fy);
}

/** Four frames of waving cloth; draw at the pole top (+5, +2 from the pole sprite). */
export function flagCloth(variant: number): readonly Surface[] {
  const [main, edge] = FLAG_COLOURS[variant % FLAG_COLOURS.length] as readonly [string, string];
  const M = hex(main);
  const E = hex(edge);
  const shade = hex(main === "#1d1a19" ? "#3a3534" : main === "#f3ecdc" ? "#c9c0ad" : main === "#e2b23a" ? "#b88a22" : main === "#2b5a8c" ? "#1f4269" : "#86221f");
  return [0, 1, 2, 3].map((frame) => {
    const r = new Raster(14, 13);
    for (let x = 0; x < 12; x++) {
      const wave = Math.round(Math.sin((x / 12) * Math.PI * 2 - frame * (Math.PI / 2)) * 1.2 * (x / 11));
      const slope = Math.sin((x / 12) * Math.PI * 2 - frame * (Math.PI / 2) + 0.6);
      for (let y = 0; y < 9; y++) {
        const border = y === 0 || y === 8 || x === 11;
        const c = border ? E : slope > 0.3 ? shade : M;
        r.set(x, y + 2 + wave, c);
      }
      // Tail ribbons (화염각) on the fly edge.
      if (x >= 9) r.set(x + 1, 11 + wave, E);
    }
    // Emblem: a disc.
    const wave5 = Math.round(Math.sin((5 / 12) * Math.PI * 2 - frame * (Math.PI / 2)) * 1.2 * (5 / 11));
    r.ellipse(5.5, 6.5 + wave5, 2, 2, E);
    return r.toSurface();
  });
}
