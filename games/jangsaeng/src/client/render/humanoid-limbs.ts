// Legs, skirts, arms and hands for the paper-doll humanoid.

import type { CostumeSpec } from "./costume-types.ts";
import type { View } from "./humanoid-head.ts";
import type { LegPose, Pt } from "./humanoid-pose.ts";
import type { Colors, Metrics } from "./humanoid-garments.ts";
import { darker, lighter, px, type PixGrid, type Px } from "./pixgrid.ts";

// ---------------------------------------------------------------- legs ----

export function drawLegs(
  g: PixGrid,
  spec: CostumeSpec,
  view: View,
  legs: LegPose,
  m: Metrics,
  col: Colors,
  bob: number,
): void {
  const up = spec.upper.kind;
  const lower = spec.lower.kind;
  const covered = up === "robe" || lower === "skirt";
  if (view === "right") return drawLegsSide(g, spec, legs, m, col, bob, covered);
  // Front / back views: two legs side by side.
  const lift = (i: 0 | 1): number => {
    if (legs === "walk0") return i === 1 ? -1 : 0;
    if (legs === "walk2") return i === 0 ? -1 : 0;
    return 0;
  };
  const spread = legs === "brace" || legs === "lunge" ? 1 : 0;
  if (legs === "kneel") {
    if (lower === "skirt") return drawSkirt(g, view, m, col);
    g.rect(8 - m.half - 1, m.footY - 1, 4, 2, col.shoe);
    g.rect(5 + m.half, m.footY - 1, 4, 2, col.shoe);
    if (!covered) g.hline(8 - m.half - 1, 7 + m.half + 1, m.footY - 2, col.L);
    return;
  }
  if (lower === "skirt") {
    drawSkirt(g, view, m, col);
    const fy = m.footY;
    for (const i of [0, 1] as const) {
      if (lift(i) < 0) continue;
      const x = i === 0 ? 5 - spread : 9 + spread;
      g.hline(x, x + 1, fy, col.shoe);
    }
    return;
  }
  const top = m.hipY + Math.min(0, bob);
  for (const i of [0, 1] as const) {
    const dy = lift(i);
    const x0 = i === 0 ? 8 - m.half - spread : 8 + spread;
    const w = m.half;
    const ankle = m.footY - 2 + dy;
    if (!covered) {
      for (let y = top; y < ankle; y++) {
        if (lower === "rolled" && y >= m.footY - 4 + dy) {
          g.hline(x0 + (i === 0 ? 1 : 0), x0 + w - (i === 0 ? 1 : 2), y, col.skin);
          continue;
        }
        const narrow = lower === "straight" ? (i === 0 ? 1 : 0) : 0;
        const wide = lower === "hakama" ? 1 : 0;
        const a = x0 + narrow - (i === 0 ? wide : 0);
        const b = x0 + w - 1 - (lower === "straight" ? (i === 0 ? 0 : 1) : 0) + (i === 1 ? wide : 0);
        g.hline(a, b, y, col.L);
        g.set(i === 0 ? b : a, y, col.l);
        if (i === 0 && y === top) g.set(a, y, col.lL);
      }
      // Ankle tie / gaiter / stripe.
      if (lower === "straight") {
        if (spec.lower.tie) for (let y = top; y < ankle; y++) g.set(i === 0 ? x0 + 1 : x0 + w - 2, y, col.tie);
      } else if (lower === "rolled") {
        g.hline(x0 + (i === 0 ? 1 : 0), x0 + w - (i === 0 ? 1 : 2), ankle - 1, col.tie);
      } else {
        g.hline(x0 + (i === 0 ? 1 : 0), x0 + w - (i === 0 ? 1 : 2), ankle, col.tie);
      }
    }
    // Shoes.
    const sx = i === 0 ? x0 : x0 + 1;
    const fy = m.footY - 1 + dy + (covered ? 1 : 0);
    if (spec.shoes.boots && !covered) {
      g.rect(sx, fy - 1, 3, 3 - (dy < 0 ? 0 : 0), col.shoe);
      g.set(sx + (i === 0 ? 0 : 2), fy - 1, px(lighter(spec.shoes.color, 0.3)));
    } else {
      g.hline(sx, sx + 2, fy, col.shoe);
      if (!covered) g.hline(sx, sx + 2, fy + 1, col.shoeD);
      if (fy + 1 <= m.footY && covered) g.set(sx + 1, fy, col.shoeD);
    }
  }
}

function drawSkirt(g: PixGrid, view: View, m: Metrics, col: Colors): void {
  const top = m.neckY + 3;
  for (let y = top; y < m.footY; y++) {
    const r = y - top;
    const half = r === 0 ? m.half : r < 3 ? m.half + 1 : m.half + 2;
    const x0 = view === "right" ? 8 - half + 1 : 8 - half;
    const x1 = view === "right" ? 7 + half - 1 : 7 + half;
    g.hline(x0, x1, y, y === m.footY - 1 ? col.l : col.L);
    g.set(x1, y, col.l);
    if (r >= 2 && view !== "right")
      for (const x of [5, 8, 11]) if (x > x0 && x < x1) g.set(x, y, col.l);
    if (r >= 1 && r < 3) g.set(x0, y, col.lL);
  }
}

function drawLegsSide(
  g: PixGrid,
  spec: CostumeSpec,
  legs: LegPose,
  m: Metrics,
  col: Colors,
  bob: number,
  covered: boolean,
): void {
  // [far foot x, near foot x, far lift, near lift]
  const table: Record<LegPose, [number, number, number, number]> = {
    stand: [6, 7, 0, 0],
    walk0: [4, 9, 0, 0],
    walk1: [6, 7, -1, 0],
    walk2: [9, 4, 0, 0],
    walk3: [7, 6, 0, -1],
    brace: [4, 8, 0, 0],
    lunge: [3, 10, 0, 0],
    kneel: [4, 9, 0, 0],
  };
  const [farX, nearX, farLift, nearLift] = table[legs];
  const top = m.hipY + Math.min(0, bob);
  const hip = 6;
  if (legs === "kneel") {
    if (spec.lower.kind === "skirt") return drawSkirt(g, "right", m, col);
    g.rect(3, m.footY - 1, 4, 2, col.shoeD);
    if (!covered) g.rect(8, m.footY - 2, 4, 2, col.L);
    g.rect(9, m.footY - 1, 4, 2, col.shoe);
    return;
  }
  if (spec.lower.kind === "skirt") {
    drawSkirt(g, "right", m, col);
    g.hline(nearX + 1, nearX + 3, m.footY, col.shoe);
    return;
  }
  const leg = (fx: number, lift: number, L: Px, shoe: Px, shoeD: Px) => {
    const ankle = m.footY - 2 + lift;
    if (!covered) {
      const rows = ankle - top;
      for (let r = 0; r < rows; r++) {
        const x = Math.round(hip + ((fx - hip) * r) / Math.max(1, rows - 1));
        const wide = spec.lower.kind === "hakama" ? 4 : spec.lower.kind === "straight" ? 3 : 3;
        if (spec.lower.kind === "rolled" && r >= rows - 2) g.hline(x, x + 1, top + r, col.skin);
        else g.hline(x, x + wide - 1, top + r, L);
      }
      if (spec.lower.kind === "trousers" || spec.lower.kind === "rolled")
        g.hline(fx, fx + 2, ankle - 1, spec.lower.kind === "rolled" ? col.tie : col.tie);
      if (spec.lower.kind === "straight" && spec.lower.tie)
        for (let y = top; y < ankle; y++) g.set(Math.round(hip + ((fx - hip) * (y - top)) / Math.max(1, rows - 1)) + 1, y, col.tie);
    }
    const fy = m.footY - 1 + lift + (covered ? 1 : 0);
    if (spec.shoes.boots && !covered) {
      g.rect(fx, fy - 1, 3, 2, shoe);
      g.hline(fx, fx + 3, fy + 1, shoeD);
    } else {
      g.hline(fx, fx + 3, fy, shoe);
      if (!covered) g.hline(fx, fx + 3, fy + 1, shoeD);
    }
  };
  leg(farX, farLift, col.l, col.shoeD, px(darker(spec.shoes.color, 0.5)));
  leg(nearX, nearLift, col.L, col.shoe, col.shoeD);
}

// ---------------------------------------------------------------- arms ----

export function drawArm(
  g: PixGrid,
  spec: CostumeSpec,
  s: Pt,
  h: Pt,
  col: Colors,
  far: boolean,
): void {
  const up = spec.upper;
  const sleeve = far ? col.s : col.S;
  const shade = far ? px(darker(up.sleeve ?? up.color, 0.45)) : col.s;
  const stripes = up.stripes?.map((c) => px(far ? darker(c, 0.3) : c));
  const steps: Pt[] = [];
  g.walk(s.x, s.y, h.x, h.y, (x, y) => steps.push({ x, y }));
  const n = steps.length;
  for (let i = 0; i < n - 1; i++) {
    const st = steps[i] as Pt;
    let c = sleeve;
    if (up.bareArms && i >= Math.floor((n - 1) / 2)) c = far ? col.skinD : col.skin;
    if (stripes && stripes.length) c = stripes[i % stripes.length] as Px;
    g.rect(st.x, st.y, 2, 2, c);
    if (!up.bareArms && !stripes) g.set(st.x + 1, st.y + 1, shade);
    if (up.wideSleeves && i >= n - 3) {
      const outer = st.x < 8 ? st.x - 1 : st.x + 2;
      g.set(outer, st.y + 1, shade);
      g.set(st.x, st.y + 2, sleeve);
      g.set(st.x + 1, st.y + 2, shade);
    }
  }
  if (n >= 2 && up.trim && !up.bareArms) {
    const cuff = steps[n - 2] as Pt;
    g.rect(cuff.x, cuff.y + 1, 2, 1, col.T);
  }
  drawHand(g, h, col, far);
}

export function drawHand(g: PixGrid, h: Pt, col: Colors, far: boolean): void {
  g.rect(h.x, h.y, 2, 2, far ? col.skinD : col.skin);
  g.set(h.x + 1, h.y + 1, col.skinD);
}

