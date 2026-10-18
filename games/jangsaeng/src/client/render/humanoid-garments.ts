// Torso garments for the paper-doll humanoid: build metrics, costume colour
// resolution, trunk silhouettes per garment kind, patterns (lamellar, studs,
// lacing, quilting, dragon roundels), collars, belts and costume details.

import type { CostumeSpec, Detail, UpperSpec } from "./costume-types.ts";
import { SKIN, type View } from "./humanoid-head.ts";
import { darker, lighter, px, type PixGrid, type Px } from "./pixgrid.ts";

const INNER = "#f4f1e8";

export interface Metrics {
  headTop: number;
  neckY: number;
  waistY: number;
  hipY: number;
  footY: number;
  half: number;
  armK: number;
}

export const METRICS: Record<"normal" | "large" | "child", Metrics> = {
  normal: { headTop: 2, neckY: 12, waistY: 17, hipY: 18, footY: 23, half: 4, armK: 1 },
  large: { headTop: 1, neckY: 11, waistY: 17, hipY: 18, footY: 23, half: 5, armK: 1.15 },
  child: { headTop: 7, neckY: 17, waistY: 19, hipY: 20, footY: 23, half: 4, armK: 0.6 },
};

export interface Colors {
  U: Px;
  u: Px;
  uL: Px;
  S: Px;
  s: Px;
  T: Px;
  L: Px;
  l: Px;
  lL: Px;
  tie: Px;
  shoe: Px;
  shoeD: Px;
  skin: Px;
  skinD: Px;
  belt: Px;
  beltL: Px;
  pattern: Px;
}

export function colorsOf(c: CostumeSpec): Colors {
  const up = c.upper;
  const sleeve = up.sleeve ?? up.color;
  return {
    U: px(up.color),
    u: px(darker(up.color, 0.28)),
    uL: px(lighter(up.color, 0.18)),
    S: px(sleeve),
    s: px(darker(sleeve, 0.28)),
    T: px(up.trim ?? darker(up.color, 0.4)),
    L: px(c.lower.color),
    l: px(darker(c.lower.color, 0.3)),
    lL: px(lighter(c.lower.color, 0.15)),
    tie: px(c.lower.tie ?? darker(c.lower.color, 0.3)),
    shoe: px(c.shoes.color),
    shoeD: px(darker(c.shoes.color, 0.3)),
    skin: px(SKIN),
    skinD: px(darker(SKIN, 0.22)),
    belt: px(c.belt ?? up.color),
    beltL: px(lighter(c.belt ?? up.color, 0.3)),
    pattern: px(up.patternColor ?? darker(up.color, 0.35)),
  };
}

interface Span {
  y: number;
  x0: number;
  x1: number;
}

function trunkSpans(up: UpperSpec, m: Metrics, view: View): Span[] {
  const spans: Span[] = [];
  const side = view === "right";
  const half = side ? m.half - 1 : m.half;
  const bottom =
    up.kind === "robe"
      ? m.footY - 1
      : up.kind === "coat"
        ? m.hipY + 2
        : up.kind === "jacketF"
          ? m.neckY + 2
          : up.kind === "tunic"
            ? m.hipY
            : up.kind === "armor"
              ? m.hipY + 2
              : m.waistY;
  const flareFrom =
    up.kind === "robe" ? m.hipY + 1 : up.kind === "coat" || up.kind === "armor" ? m.hipY : 99;
  for (let y = m.neckY; y <= bottom; y++) {
    // Side view: the neck row is shifted toward the chest.
    if (side && y === m.neckY) {
      spans.push({ y, x0: 8 - half, x1: 6 + half });
      continue;
    }
    const h = y === m.neckY ? half - 1 : y >= flareFrom ? half + 1 : half;
    spans.push({ y, x0: 8 - h, x1: 7 + h });
  }
  return spans;
}

// ------------------------------------------------------------- garments --

export function drawTrunk(
  g: PixGrid,
  spec: CostumeSpec,
  view: View,
  m: Metrics,
  col: Colors,
): void {
  const up = spec.upper;
  const spans = trunkSpans(up, m, view);
  const last = spans[spans.length - 1]?.y ?? m.waistY;
  for (const s of spans) {
    g.hline(s.x0, s.x1, s.y, col.U);
    g.set(s.x1, s.y, col.u);
    if (s.y > m.neckY && s.y < last) g.set(s.x0, s.y, col.uL);
  }
  const lastSpan = spans[spans.length - 1];
  if (lastSpan) g.hline(lastSpan.x0, lastSpan.x1, lastSpan.y, col.u);
  drawPattern(g, up, spans, m, view, col);
  if (up.kind === "robe" || up.kind === "coat") {
    // Front opening / back seam.
    const x = view === "right" ? 9 : 8;
    for (const s of spans) if (s.y > m.waistY) g.set(x, s.y, col.u);
  }
  if (up.kind === "armor") {
    // Skirt plates split at the front.
    for (const s of spans)
      if (s.y > m.waistY) {
        if (view !== "right") g.set(view === "down" ? 7 : 8, s.y, col.u);
        if (s.y === last) for (let x = s.x0; x <= s.x1; x += 2) g.set(x, s.y, col.pattern);
      }
  }
  drawCollar(g, up, view, m, col);
  if (spec.belt) drawBelt(g, view, m, col, up);
  for (const d of spec.details ?? []) drawDetail(g, d, view, m, spans, spec);
}

function drawPattern(
  g: PixGrid,
  up: UpperSpec,
  spans: Span[],
  m: Metrics,
  view: View,
  col: Colors,
): void {
  const pat = up.pattern ?? "none";
  if (pat === "none") return;
  if (pat === "dragon") {
    const G = col.pattern;
    const g2 = px("#f6dc7a");
    const cy = m.neckY + 3;
    if (view !== "right") {
      g.rect(6, cy, 4, 2, G);
      g.hline(7, 8, cy - 1, G);
      g.hline(7, 8, cy + 2, G);
      g.set(7, cy, g2);
      g.set(8, cy + 1, px("#b8312f"));
    } else {
      g.rect(8, cy, 2, 3, G);
      g.set(8, cy, g2);
    }
    return;
  }
  for (const s of spans) {
    const r = s.y - m.neckY;
    if (r <= 0 || s.y > (up.kind === "armor" ? m.waistY : 99)) continue;
    for (let x = s.x0 + 1; x < s.x1; x++) {
      let hit = false;
      if (pat === "lamellar") hit = r % 2 === 0 || (x + (r >> 1)) % 2 === 0 ? r % 2 === 0 : false;
      else if (pat === "studs") hit = x % 2 === 0 && r % 2 === 1;
      else if (pat === "lacing") hit = r % 2 === 0;
      else if (pat === "quilt") hit = r % 2 === 0;
      if (pat === "lamellar" && r % 2 === 1) hit = x % 2 === r % 4 >> 1;
      if (hit) g.set(x, s.y, pat === "quilt" ? col.u : col.pattern);
    }
  }
  if (pat === "lamellar") {
    // Scale rows on the skirt plates too.
    for (const s of spans)
      if (s.y > m.waistY && (s.y - m.waistY) % 2 === 0)
        for (let x = s.x0; x <= s.x1; x++) g.set(x, s.y, col.pattern);
  }
}

function drawCollar(g: PixGrid, up: UpperSpec, view: View, m: Metrics, col: Colors): void {
  const n = m.neckY;
  const c = up.collar ?? "cross";
  const inner = up.kind === "jacket" || up.kind === "jacketF" ? col.skin : px(INNER);
  if (view === "down") {
    if (c === "cross") {
      g.hline(5, 6, n, col.T);
      g.hline(9, 10, n, col.T);
      g.hline(7, 8, n, inner);
      g.set(6, n + 1, col.T);
      g.set(9, n + 1, col.T);
      g.hline(7, 8, n + 1, inner);
      g.hline(7, 8, n + 2, col.T);
      g.set(9, n + 3, col.u);
      g.set(10, n + 4, col.u);
    } else if (c === "round") {
      g.set(5, n, col.T);
      g.set(10, n, col.T);
      g.hline(6, 9, n, inner);
      g.hline(6, 9, n + 1, col.T);
    } else if (c === "high") {
      g.hline(5, 10, n, col.T);
      g.vline(8, n + 1, n + 4, col.u);
    } else if (c === "open") {
      g.hline(6, 9, n, col.skin);
      g.hline(7, 8, n + 1, col.skin);
    }
  } else if (view === "up") {
    if (c !== "open" && c !== "none") g.hline(5, 10, n, col.T);
  } else {
    if (c === "cross") {
      g.hline(8, 9, n, col.T);
      g.set(9, n + 1, col.T);
      g.set(10, n + 2, col.T);
    } else if (c === "round") {
      g.hline(6, 9, n, col.T);
    } else if (c === "high") {
      g.hline(6, 9, n, col.T);
    } else if (c === "open") {
      g.set(9, n, col.skin);
    }
  }
}

function drawBelt(g: PixGrid, view: View, m: Metrics, col: Colors, up: UpperSpec): void {
  const y = up.kind === "jacketF" ? m.neckY + 2 : m.waistY;
  if (view === "right") {
    g.hline(8 - m.half + 1, 7 + m.half - 1, y, col.belt);
    g.set(7 + m.half - 1, y, col.beltL);
    return;
  }
  g.hline(8 - m.half, 7 + m.half, y, col.belt);
  if (view === "down") {
    g.set(9, y, col.beltL);
    g.set(9, y + 1, col.belt);
    g.set(10, y + 1, col.belt);
  }
}

function drawDetail(
  g: PixGrid,
  d: Detail,
  view: View,
  m: Metrics,
  spans: Span[],
  spec: CostumeSpec,
): void {
  const C = px(d.color);
  const c = px(darker(d.color, 0.3));
  const n = m.neckY;
  const side = view === "right";
  const front = view === "down";
  switch (d.kind) {
    case "patch": {
      const A = px(d.accent);
      if (side) {
        g.vline(10, n + 2, n + 4, C);
        return;
      }
      g.rect(6, n + 2, 4, 3, C);
      g.set(7, n + 3, A);
      g.set(8, n + 2, A);
      g.set(8, n + 4, A);
      g.hline(6, 9, n + 5, c);
      return;
    }
    case "buttons":
      if (side) for (let y = n + 1; y <= m.waistY; y += 2) g.set(10, y, C);
      else if (front) for (let y = n + 1; y <= m.waistY; y += 2) g.set(8, y, C);
      return;
    case "crossbelts":
      if (side) g.line(6, n, 9, n + 5, C);
      else {
        g.line(4, n + 1, 11, n + 5, C);
        g.line(11, n + 1, 4, n + 5, C);
        if (front) g.rect(7, n + 3, 2, 1, px("#e2b23a"));
      }
      return;
    case "sash":
      if (side) {
        g.line(6, n + 1, 10, n + 5, C);
        g.line(6, n + 2, 10, n + 6, c);
      } else {
        const fx = front ? 4 : 11;
        const tx = front ? 11 : 4;
        g.line(fx, n, tx, n + 5, C);
        g.line(fx, n + 1, tx, n + 6, c);
      }
      return;
    case "kasaya": {
      const A = px(d.accent ?? darker(d.color, 0.25));
      if (side) {
        g.rect(5, n + 1, 5, 5, C);
        g.vline(7, n + 1, n + 5, A);
        g.hline(5, 9, n + 3, A);
        return;
      }
      // Draped from the left shoulder (screen right when facing down).
      const from = front ? 11 : 4;
      const to = front ? 4 : 11;
      for (let i = 0; i <= 7; i++) {
        const x = Math.round(from + ((to - from) * i) / 7);
        const y = n + i;
        g.hline(Math.min(x, x + (front ? 3 : -3)), Math.max(x, x + (front ? 3 : -3)), y, C);
      }
      for (const s of spans)
        if (s.y > n && s.y < n + 8 && (s.y - n) % 3 === 0)
          for (let x = s.x0; x <= s.x1; x++) if (g.at(x, s.y) === C) g.set(x, s.y, A);
      if (front) g.set(8, n + 4, px("#e2b23a"));
      return;
    }
    case "apron":
      if (side) {
        g.vline(10, m.waistY - 1, m.footY - 3, C);
        g.vline(11, m.waistY, m.footY - 3, c);
      } else if (front) {
        g.rect(5, m.waistY - 1, 6, m.footY - m.waistY - 1, C);
        g.hline(5, 10, m.footY - 3, c);
        g.vline(10, m.waistY - 1, m.footY - 3, c);
      } else {
        g.hline(6, 9, m.waistY - 1, C);
        g.set(7, m.waistY, C);
        g.set(8, m.waistY, C);
      }
      return;
    case "vest": {
      const T = px(d.trim ?? darker(d.color, 0.4));
      const bottom = m.hipY + 2;
      for (let y = n; y <= bottom; y++) {
        const half = y === n ? m.half - 1 : y >= m.hipY ? m.half + 1 : m.half;
        if (side) {
          const x0 = 8 - (m.half - 1) - (y >= m.hipY ? 1 : 0);
          g.hline(x0, 8, y, y === bottom ? c : C);
          g.set(9, y, T);
          continue;
        }
        g.hline(8 - half, 7 + half, y, y === bottom ? c : C);
        if (front) {
          g.set(7, y, T);
          g.set(8, y, T);
          if (y > n + 1 && y < m.waistY) {
            g.set(7, y, px(spec.upper.color));
            g.set(8, y, px(spec.upper.color));
          }
        }
        g.set(7 + half, y, c);
      }
      if (front) {
        g.hline(5, 6, n, T);
        g.hline(9, 10, n, T);
      }
      return;
    }
    case "epaulettes":
      if (side) g.hline(6, 8, n, C);
      else {
        g.hline(8 - m.half - 1, 8 - m.half, n, C);
        g.hline(7 + m.half, 8 + m.half, n, C);
        g.set(8 - m.half - 1, n + 1, c);
        g.set(8 + m.half, n + 1, c);
      }
      return;
    case "pauldrons": {
      const A = px(d.accent ?? lighter(d.color, 0.3));
      if (side) {
        g.rect(5, n, 4, 3, C);
        g.hline(5, 8, n + 2, A);
        return;
      }
      g.rect(8 - m.half - 2, n, 3, 3, C);
      g.rect(6 + m.half, n, 3, 3, C);
      g.hline(8 - m.half - 2, 8 - m.half, n + 2, A);
      g.hline(6 + m.half, 8 + m.half, n + 2, A);
      return;
    }
    case "furcollar":
      if (side) {
        g.hline(5, 9, n, C);
        g.hline(5, 8, n + 1, c);
      } else {
        g.hline(8 - m.half, 7 + m.half, n, C);
        g.hline(8 - m.half + 1, 6 + m.half, n + 1, C);
        for (let x = 8 - m.half; x <= 7 + m.half; x += 2) g.set(x, n + 1, c);
      }
      return;
    case "ribbon":
      if (side) {
        g.set(10, n + 2, C);
        g.set(10, n + 3, c);
      } else if (front) {
        const long = spec.upper.kind === "jacketF";
        g.set(9, n + 2, C);
        g.set(10, n + 2, C);
        g.vline(9, n + 3, n + (long ? 6 : 4), C);
        g.vline(10, n + 3, n + (long ? 5 : 4), c);
      }
      return;
    case "bag":
      if (side) {
        g.rect(5, m.waistY - 1, 3, 3, C);
        g.hline(5, 7, m.waistY + 1, c);
      } else if (front) {
        g.line(4, n, 10, m.waistY - 2, c);
        g.rect(10, m.waistY - 1, 3, 3, C);
        g.hline(10, 12, m.waistY + 1, c);
      } else {
        g.line(11, n, 5, m.waistY - 2, c);
        g.rect(3, m.waistY - 1, 3, 3, C);
      }
      return;
    case "beads":
      if (front) {
        for (let y = m.headTop + 6; y <= n + 1; y += 2) {
          g.set(3, y, C);
          g.set(12, y, C);
        }
      }
      return;
    case "facecloth":
    case "trimhem":
      if (d.kind === "trimhem") {
        const s = spans[spans.length - 1];
        if (s) g.hline(s.x0, s.x1, s.y, C);
      }
      return;
  }
}

/** Mask / face cloth drawn after the head. */
export function drawFaceDetails(g: PixGrid, spec: CostumeSpec, view: View, top: number): void {
  for (const d of spec.details ?? []) {
    if (d.kind !== "facecloth") continue;
    const C = px(d.color);
    const c = px(darker(d.color, 0.3));
    if (view === "down") {
      g.hline(3, 12, top + 8, C);
      g.hline(4, 11, top + 9, C);
      g.set(12, top + 8, c);
    } else if (view === "right") {
      g.hline(7, 12, top + 8, C);
      g.hline(7, 11, top + 9, c);
    }
  }
}

