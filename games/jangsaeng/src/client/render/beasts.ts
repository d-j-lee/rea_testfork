// Quadruped sprites (tiger, wolf, boar, bear) in the same grid/anchor
// convention as humanoids: the ground point sits at the grid anchor. The side
// view (facing right; left is mirrored by the caller) is procedural; front
// and rear views are templates from beast-views.ts.

import type { Anim } from "../../shared/sprites.ts";
import { drawBeastView, type BeastKind, type ViewPose } from "./beast-views.ts";
import { ANCHOR_X, ANCHOR_Y, GRID_H, GRID_W } from "./humanoid.ts";
import type { View } from "./humanoid-head.ts";
import { darker, lighter, PixGrid, px, type Px } from "./pixgrid.ts";

export type { BeastKind };

interface SideSpec {
  /** Body box (local coords, ground at y = 23). */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  /** Head box. */
  hx: number;
  hy: number;
  hw: number;
  hh: number;
  snout: number;
  legW: number;
  rearX: number;
  frontX: number;
  ear: "round" | "pointed";
  tail: "tiger" | "bushy" | "stub";
  main: string;
  dark: string;
  light: string;
  nose: string;
  eye: string;
  stripes?: boolean;
  tusks?: boolean;
  mane?: boolean;
  crescent?: boolean;
  saddle?: boolean;
}

const SIDE: Record<BeastKind, SideSpec> = {
  tiger: {
    bx: -7, by: 9, bw: 21, bh: 9,
    hx: 11, hy: 5, hw: 9, hh: 9, snout: 2,
    legW: 3, rearX: -5, frontX: 8,
    ear: "round", tail: "tiger",
    main: "#dc842c", dark: "#2a1e18", light: "#f5e7c8", nose: "#d46a6a", eye: "#e8d24a",
    stripes: true,
  },
  wolf: {
    bx: -5, by: 11, bw: 16, bh: 7,
    hx: 9, hy: 7, hw: 7, hh: 6, snout: 3,
    legW: 2, rearX: -3, frontX: 7,
    ear: "pointed", tail: "bushy",
    main: "#8e8b85", dark: "#4f4d49", light: "#d4d0c6", nose: "#2a2523", eye: "#e8c84a",
    saddle: true,
  },
  boar: {
    bx: -6, by: 10, bw: 17, bh: 10,
    hx: 8, hy: 11, hw: 7, hh: 8, snout: 3,
    legW: 2, rearX: -4, frontX: 6,
    ear: "pointed", tail: "stub",
    main: "#5e4632", dark: "#2a1e18", light: "#8a6a4e", nose: "#b88a7a", eye: "#1a1210",
    tusks: true, mane: true,
  },
  bear: {
    bx: -6, by: 8, bw: 18, bh: 11,
    hx: 9, hy: 5, hw: 8, hh: 8, snout: 2,
    legW: 3, rearX: -4, frontX: 6,
    ear: "round", tail: "stub",
    main: "#2f2b2d", dark: "#1c191b", light: "#4a4548", nose: "#8a6a4e", eye: "#0e0c0d",
    crescent: true,
  },
};

interface BeastPose {
  dx: number;
  dy: number;
  /** Per-leg foot x offset and lift: [rear far, rear near, front far, front near]. */
  feet: [number, number][];
  headDx: number;
  headDy: number;
  mouth: boolean;
  eyes: "open" | "shut";
  tail: number;
  rear: boolean;
  paw: boolean;
  lying: boolean;
}

export const BEAST_FRAMES: Readonly<Record<Anim, readonly number[]>> = {
  idle: [800, 800],
  walk: [120, 120, 120, 120],
  attack: [120, 90, 180],
  shoot: [120, 90, 180],
  cast: [160, 500],
  hurt: [110, 160],
  dead: [180, 1],
};

function beastPose(kind: BeastKind, anim: Anim, f: number): BeastPose {
  const pose: BeastPose = {
    dx: 0,
    dy: 0,
    feet: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    headDx: 0,
    headDy: 0,
    mouth: false,
    eyes: "open",
    tail: 0,
    rear: false,
    paw: false,
    lying: false,
  };
  switch (anim) {
    case "idle":
      pose.headDy = f === 1 ? 1 : 0;
      pose.tail = f;
      break;
    case "walk": {
      const s = [2, 0, -2, 0][f % 4] as number;
      const a = f % 4 === 1 ? -1 : 0;
      const b = f % 4 === 3 ? -1 : 0;
      // Diagonal pairs move together.
      pose.feet = [
        [s, a],
        [-s, b],
        [-s, b],
        [s, a],
      ];
      pose.dy = f % 2 === 1 ? -1 : 0;
      pose.tail = f % 2;
      break;
    }
    case "attack":
    case "shoot":
      if (kind === "bear") {
        pose.rear = f === 1;
        pose.paw = f >= 1;
        pose.mouth = f >= 1;
        pose.dx = f === 2 ? 2 : 0;
      } else if (f === 0) {
        pose.dx = -2;
        pose.dy = 1;
        pose.headDy = 1;
        pose.feet = [
          [1, 0],
          [1, 0],
          [-1, 0],
          [-1, 0],
        ];
      } else if (f === 1) {
        pose.dx = 3;
        pose.dy = -2;
        pose.mouth = true;
        pose.feet = [
          [-2, 0],
          [-2, 0],
          [3, -2],
          [4, -2],
        ];
      } else {
        pose.dx = 2;
        pose.mouth = true;
        pose.paw = kind === "tiger";
        pose.headDx = 1;
      }
      break;
    case "cast":
      pose.mouth = f === 1;
      pose.headDy = f === 1 ? -2 : 0;
      pose.headDx = f === 1 ? 1 : 0;
      pose.tail = 1;
      break;
    case "hurt":
      pose.dx = f === 0 ? -2 : -1;
      pose.eyes = "shut";
      pose.headDy = f === 0 ? -1 : 0;
      break;
    case "dead":
      pose.eyes = "shut";
      if (f === 0) {
        pose.dy = 3;
        pose.headDy = 2;
        pose.feet = [
          [-1, 0],
          [1, 0],
          [-1, 0],
          [1, 0],
        ];
      } else pose.lying = true;
      break;
  }
  return pose;
}

function viewPose(pose: BeastPose, anim: Anim, frame: number, toward: number): ViewPose {
  const walkLift = anim === "walk" ? (frame % 4 === 0 ? -1 : frame % 4 === 2 ? 1 : 0) : 0;
  return {
    dy: pose.dy + (pose.dx > 0 ? 2 * toward : pose.dx < 0 ? -toward : 0),
    bodyDy: (anim === "idle" && frame === 1) || (anim === "dead" && frame === 0) ? 1 : 0,
    liftL: walkLift < 0 ? -1 : 0,
    liftR: walkLift > 0 ? -1 : 0,
    mouth: pose.mouth,
    eyesShut: pose.eyes === "shut",
    pawL: pose.paw && !pose.rear ? 3 : 0,
    rear: pose.rear ? 3 : 0,
  };
}

export function renderBeast(kind: BeastKind, view: View, anim: Anim, frame: number): PixGrid {
  const spec = SIDE[kind];
  const pose = beastPose(kind, anim, frame);
  const g = new PixGrid(GRID_W, GRID_H);
  g.ox = ANCHOR_X - 8;
  g.oy = ANCHOR_Y - 24;
  if (pose.lying || view === "right") drawSide(g, spec, pose, kind);
  else if (view === "down") drawBeastView(g, kind, "front", viewPose(pose, anim, frame, 1));
  else drawBeastView(g, kind, "rear", viewPose(pose, anim, frame, -1));
  g.ox = 0;
  g.oy = 0;
  const out = pose.lying && view === "up" ? mirrored(g) : g;
  out.outline("#1b1418", 0.2);
  return out;
}

function mirrored(g: PixGrid): PixGrid {
  const m = new PixGrid(g.w, g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const c = g.data[y * g.w + x] as number;
      const mx = 2 * ANCHOR_X - 1 - x;
      if (c && mx >= 0 && mx < g.w) m.data[y * g.w + mx] = c;
    }
  return m;
}

interface Pal {
  M: Px;
  D: Px;
  L: Px;
  S: Px;
  H: Px;
  N: Px;
  E: Px;
  W: Px;
  mouth: Px;
  far: Px;
}

function palOf(s: SideSpec): Pal {
  return {
    M: px(s.main),
    D: px(s.dark),
    L: px(s.light),
    S: px(darker(s.main, 0.25)),
    H: px(lighter(s.main, 0.2)),
    N: px(s.nose),
    E: px(s.eye),
    W: px("#f6f1e4"),
    mouth: px("#7a2a2a"),
    far: px(darker(s.main, 0.4)),
  };
}

function drawSide(g: PixGrid, s: SideSpec, pose: BeastPose, kind: BeastKind): void {
  const c = palOf(s);
  const lying = pose.lying;
  const ox = pose.dx;
  const oy = lying ? 23 - (s.by + s.bh) + 1 : pose.dy;
  const ground = 23;
  const legTop = s.by + s.bh - 2 + oy;
  const leg = (x: number, foot: [number, number], color: Px, paw: Px) => {
    if (lying) {
      // Legs stretched out sideways along the ground.
      g.hline(x + ox, x + ox + 4, ground, color);
      g.set(x + ox + 4, ground, paw);
      return;
    }
    const fx = x + foot[0];
    const bottom = ground + foot[1];
    for (let y = legTop; y <= bottom; y++) {
      const t = (y - legTop) / Math.max(1, bottom - legTop);
      const lx = Math.round(x + ox + (fx - x) * t);
      g.hline(lx, lx + s.legW - 1, y, color);
    }
    g.hline(fx + ox, fx + ox + s.legW - (kind === "boar" ? 1 : 0), bottom, paw);
    if (s.stripes) g.set(fx + ox + 1, bottom - 2, c.D);
  };
  const farPaw = px(darker(s.dark, 0.2));
  if (!pose.rear) {
    leg(s.rearX + 2, pose.feet[0] as [number, number], c.far, farPaw);
    leg(s.frontX - 1, pose.feet[2] as [number, number], c.far, farPaw);
  }
  drawTail(g, s, c, ox, oy, pose.tail, lying);
  if (pose.rear) {
    drawRearing(g, s, c, ox, oy, pose);
    return;
  }
  // Body: long ellipse with a shoulder hump; light belly, darker back.
  g.ellipse(s.bx + ox, s.by + oy, s.bw, s.bh, c.M);
  g.ellipse(s.bx + Math.floor(s.bw * 0.5) + ox, s.by - 1 + oy, Math.ceil(s.bw * 0.5), s.bh, c.M);
  const bellyY = s.by + s.bh - 2 + oy;
  g.hline(s.bx + 3 + ox, s.bx + s.bw - 3 + ox, bellyY, c.L);
  g.hline(s.bx + 5 + ox, s.bx + s.bw - 5 + ox, bellyY + 1, c.L);
  g.hline(s.bx + 3 + ox, s.bx + s.bw - 2 + ox, s.by + oy, c.H);
  if (s.saddle) {
    g.hline(s.bx + 2 + ox, s.bx + s.bw - 4 + ox, s.by + 1 + oy, c.D);
    g.hline(s.bx + 4 + ox, s.bx + s.bw - 6 + ox, s.by + 2 + oy, px(darker(s.main, 0.15)));
  }
  if (s.stripes)
    for (let i = 0; i < 6; i++) {
      const x = s.bx + 3 + i * 3 + ox;
      g.vline(x, s.by + oy, s.by + 3 + oy + (i % 2), c.D);
      g.set(x + 1, s.by + 4 + oy + (i % 2), c.D);
      g.set(x - 1, s.by + oy, c.D);
    }
  if (s.mane)
    for (let x = s.bx + 3; x < s.bx + s.bw - 1; x++)
      g.set(x + ox, s.by - (x > s.bx + s.bw / 2 ? 1 : 0) + oy + (x % 2), c.D);
  if (s.crescent) {
    const cx = s.bx + s.bw - 2 + ox;
    g.vline(cx, s.by + 4 + oy, s.by + 6 + oy, c.W);
    g.set(cx - 1, s.by + 7 + oy, c.W);
  }
  leg(s.rearX, pose.feet[1] as [number, number], c.M, c.D);
  leg(s.frontX, pose.feet[3] as [number, number], c.M, c.D);
  if (pose.paw) {
    g.rect(s.frontX + 3 + ox, s.by + 3 + oy, 3, 3, c.M);
    g.hline(s.frontX + 4 + ox, s.frontX + 6 + ox, s.by + 2 + oy, c.W);
  }
  drawHead(g, s, c, s.hx + ox + pose.headDx, s.hy + oy + pose.headDy, pose);
}

function drawRearing(g: PixGrid, s: SideSpec, c: Pal, ox: number, oy: number, pose: BeastPose): void {
  // Bear rearing up on its hind legs, claws raised.
  const ground = 23;
  g.rect(s.rearX + 4 + ox, ground - 5, 3, 6, c.far);
  g.rect(s.rearX + 7 + ox, ground - 5, 3, 6, c.M);
  g.hline(s.rearX + 7 + ox, s.rearX + 10 + ox, ground, c.D);
  g.ellipse(s.bx + 8 + ox, s.by - 6 + oy, s.bw - 8, s.bh + 6, c.M);
  g.ellipse(s.bx + 10 + ox, s.by - 3 + oy, 4, s.bh - 1, c.H);
  if (s.crescent) {
    g.hline(s.bx + 13 + ox, s.bx + 16 + ox, s.by - 1 + oy, c.W);
    g.set(s.bx + 12 + ox, s.by - 2 + oy, c.W);
    g.set(s.bx + 17 + ox, s.by - 2 + oy, c.W);
  }
  g.rect(s.frontX + 5 + ox, s.by - 9 + oy, 3, 5, c.M);
  g.hline(s.frontX + 6 + ox, s.frontX + 8 + ox, s.by - 10 + oy, c.W);
  g.rect(s.frontX + 1 + ox, s.by - 7 + oy, 3, 4, c.far);
  drawHead(g, s, c, s.hx + ox, s.hy + oy - 5, pose);
}

function drawTail(g: PixGrid, s: SideSpec, c: Pal, ox: number, oy: number, phase: number, lying: boolean): void {
  const x = s.bx + ox;
  const y = s.by + oy;
  if (s.tail === "tiger") {
    const pts = lying
      ? [[0, 5], [-1, 6], [-2, 6], [-3, 6], [-4, 6], [-5, 6], [-6, 6]]
      : phase
        ? [[0, 3], [-1, 2], [-2, 1], [-3, 0], [-3, -1], [-3, -2], [-2, -3]]
        : [[0, 3], [-1, 2], [-2, 1], [-3, 0], [-4, -1], [-4, -2], [-3, -3]];
    pts.forEach(([dx, dy], i) => {
      g.rect(x + (dx as number), y + (dy as number), 2, 1, i % 2 === 1 ? c.D : c.M);
    });
    const tip = pts[6] ?? [0, 0];
    g.set(x + (tip[0] as number), y + (tip[1] as number) - (lying ? 0 : 1), c.D);
  } else if (s.tail === "bushy") {
    const lift = lying ? 3 : phase ? 0 : 1;
    g.ellipse(x - 4, y + 1 + lift, 6, 4, c.M);
    g.hline(x - 4, x - 1, y + 4 + lift, c.L);
    g.set(x - 4, y + 2 + lift, c.L);
  } else {
    g.rect(x - 1, y + 2, 2, 2, c.D);
  }
}

function drawHead(g: PixGrid, s: SideSpec, c: Pal, hx: number, hy: number, pose: BeastPose): void {
  if (s.ear === "pointed") {
    g.vline(hx + 1, hy - 2, hy, c.D);
    g.vline(hx + 2, hy - 1, hy, c.M);
  } else {
    g.rect(hx + 1, hy - 1, 3, 2, c.M);
    g.set(hx + 2, hy - 1, c.D);
  }
  g.ellipse(hx, hy, s.hw, s.hh, c.M);
  const sy = hy + Math.floor(s.hh / 2);
  const sx = hx + s.hw - 2;
  g.rect(sx, sy - 1, s.snout + 1, 3, s.tusks ? c.M : c.L);
  if (s.tusks) {
    g.rect(sx + s.snout, sy - 1, 1, 3, c.N);
    g.set(sx + s.snout - 1, sy + 2, c.W);
    g.set(sx + s.snout - 1, sy + 1, c.W);
  } else {
    g.set(sx + s.snout, sy - 1, c.N);
  }
  if (s.stripes) {
    // Cheek ruff and facial stripes.
    g.hline(hx + 1, hx + 4, hy + s.hh - 2, c.L);
    g.hline(hx + 2, hx + 5, hy + s.hh - 1, c.L);
    g.set(hx + 2, hy + 1, c.D);
    g.set(hx + 3, hy + 2, c.D);
    g.set(hx + 1, hy + 4, c.D);
    g.set(hx + 5, hy + 1, c.D);
  }
  if (s.crescent) g.rect(sx - 1, sy, 2, 2, px(s.nose));
  if (pose.mouth) {
    g.rect(sx, sy + 2, s.snout + 1, 1, c.mouth);
    g.set(sx + s.snout, sy + 2, c.W);
    g.rect(sx - 1, sy + 3, s.snout + 1, 1, c.L);
  }
  const ex = hx + s.hw - 3;
  const ey = hy + 2;
  if (pose.eyes === "shut") g.hline(ex - 1, ex, ey + 1, c.D);
  else {
    g.set(ex, ey, s.eye === s.dark || s.eye.startsWith("#0") || s.eye.startsWith("#1") ? c.W : c.E);
    g.set(ex, ey + 1, c.D);
  }
}
