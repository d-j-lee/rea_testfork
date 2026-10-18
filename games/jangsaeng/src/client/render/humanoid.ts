// Paper-doll humanoid renderer. One shared body (16 × 24, chibi proportions,
// feet at the bottom centre) is composed from costume layers for each view
// and pose into a PixGrid. Left-facing frames are mirrors of right-facing
// ones (characters.ts). Every people share the same body and face; costumes
// and equipment are the only differences.

import type { Anim } from "../../shared/sprites.ts";
import type { CostumeSpec } from "./costume-types.ts";
import { drawBackItem, drawWeapon } from "./humanoid-gear.ts";
import { drawHat, hatHidesEyes } from "./hat-art.ts";
import {
  drawHairBack,
  drawHairFront,
  drawHairOver,
  drawHead,
  type HeadOptions,
  type View,
} from "./humanoid-head.ts";
import { colorsOf, drawFaceDetails, drawTrunk, METRICS, type Metrics } from "./humanoid-garments.ts";
import { drawArm, drawHand, drawLegs } from "./humanoid-limbs.ts";
import { poseFor, type Pose, type Pt } from "./humanoid-pose.ts";
import { PixGrid, px } from "./pixgrid.ts";

/** Working grid; frames are cropped to their opaque bounds afterwards. */
export const GRID_W = 64;
export const GRID_H = 56;
/** Body-local origin inside the grid. */
const BODY_X = 24;
const BODY_Y = 16;
/** Ground point (feet centre) inside the grid. */
export const ANCHOR_X = BODY_X + 8;
export const ANCHOR_Y = BODY_Y + 24;

const OUTLINE = "#1b1418";

export function resolveCostume(spec: CostumeSpec, variant: "m" | "f"): CostumeSpec {
  if (variant === "f" && spec.female) return { ...spec, ...spec.female };
  return spec;
}

export function renderHumanoid(
  spec: CostumeSpec,
  view: View,
  anim: Anim,
  frame: number,
  phase: number,
): PixGrid {
  const pose = poseFor(view, anim, frame, spec.weapon);
  if (pose.lying) return renderLying(spec, view, pose);
  const g = new PixGrid(GRID_W, GRID_H);
  drawFigure(g, spec, view, pose, phase);
  g.ox = 0;
  g.oy = 0;
  g.outline(OUTLINE, 0.25);
  return g;
}

function renderLying(spec: CostumeSpec, view: View, pose: Pose): PixGrid {
  const body = new PixGrid(GRID_W, GRID_H);
  drawFigure(body, { ...spec, back: undefined }, "down", pose, 0);
  const headLeft = view === "right" || view === "down";
  const turned = body.rotated(headLeft);
  // The rotated body box spans y = 24..39 (ccw) or similar; centre it on the
  // anchor and rest it on the ground.
  const g = new PixGrid(GRID_W, GRID_H);
  const b = turned.bounds();
  if (b) {
    const cx = (b.x0 + b.x1 + 1) / 2;
    const dx = Math.round(ANCHOR_X - cx);
    const dy = ANCHOR_Y + 1 - (b.y1 + 1);
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const c = turned.data[y * turned.w + x] as number;
        if (c) g.set(x + dx, y + dy, c);
      }
  }
  if (spec.weapon !== "none") {
    g.ox = BODY_X;
    g.oy = BODY_Y;
    // Dropped beside the body: blades and poles lie flat, bows on their back.
    const bow = spec.weapon === "bow";
    drawWeapon(g, {
      kind: spec.weapon,
      x: bow ? 8 : headLeft ? 4 : 12,
      y: bow ? 23 : 25,
      angle: bow ? 90 : headLeft ? 8 : 172,
      slide: 0,
      accent: spec.weaponAccent ?? "#c8402e",
    });
    g.ox = 0;
    g.oy = 0;
  }
  g.outline(OUTLINE, 0.25);
  return g;
}

function drawFigure(
  g: PixGrid,
  spec: CostumeSpec,
  view: View,
  pose: Pose,
  phase: number,
): void {
  const m = METRICS[spec.build ?? "normal"];
  const col = colorsOf(spec);
  const lean = view === "right" ? pose.lean : 0;
  const upperY = BODY_Y + pose.bob;
  const head: HeadOptions = {
    view,
    hair: spec.hair,
    hairColor: spec.hairColor ?? "#2a1e18",
    beard: spec.beard ?? "none",
    beardColor: spec.beardColor ?? spec.hairColor ?? "#2a1e18",
    eyes: hatHidesEyes(spec.hat) && pose.eyes === "open" ? "hidden" : pose.eyes,
    mouth: pose.mouth,
    hatted: !!spec.hat && spec.hat.kind !== "none" && spec.hat.kind !== "headband",
    top: m.headTop + pose.headDy,
  };
  // Shoulders for this build; pose hands are authored for the normal build.
  const shoulder = shoulders(view, m);
  const nearHand = mapHand(pose.near, view, "near", m, shoulder.near);
  const farHand = mapHand(pose.far, view, "far", m, shoulder.far);
  const weapon = () => {
    if (pose.hideWeapon || spec.weapon === "none") return;
    const w = scratch();
    w.ox = g.ox;
    w.oy = g.oy;
    drawWeapon(w, {
      kind: spec.weapon,
      x: nearHand.x + (view === "right" ? 1 : 0),
      y: nearHand.y + 1,
      angle: pose.angle,
      slide: pose.slide,
      scale: pose.scale,
      accent: spec.weaponAccent ?? "#c8402e",
      drawHand: pose.bowDraw ? { x: farHand.x, y: farHand.y + 1 } : null,
      arrow: pose.arrow,
      flash: pose.flash,
    });
    overlay(g, w);
  };
  const upper = (fn: () => void) => {
    g.ox = BODY_X + lean;
    g.oy = upperY;
    fn();
  };
  const lowerLayer = (fn: () => void) => {
    g.ox = BODY_X;
    g.oy = BODY_Y;
    fn();
  };

  if (view === "down") {
    if (spec.back) upper(() => drawBackItem(g, spec.back!, view, m.neckY, phase));
    upper(() => drawHairBack(g, head));
    if (pose.layer === "back") upper(weapon);
    lowerLayer(() => drawLegs(g, spec, view, pose.legs, m, col, pose.bob));
    upper(() => drawTrunk(g, spec, view, m, col));
    upper(() => {
      drawArm(g, spec, shoulder.far, farHand, col, false);
      drawArm(g, spec, shoulder.near, nearHand, col, false);
    });
    upper(() => drawHairFront(g, head, "#c8402e"));
    if (pose.layer === "body") upper(weapon);
    upper(() => {
      drawHead(g, head);
      if (spec.hat) drawHat(g, spec.hat, view, head.top);
      drawFaceDetails(g, spec, view, head.top);
    });
    if (pose.layer === "top") upper(weapon);
    upper(() => drawHand(g, nearHand, col, false));
  } else if (view === "up") {
    if (pose.layer === "back") upper(weapon);
    lowerLayer(() => drawLegs(g, spec, view, pose.legs, m, col, pose.bob));
    upper(() => drawTrunk(g, spec, view, m, col));
    if (spec.back) upper(() => drawBackItem(g, spec.back!, view, m.neckY, phase));
    upper(() => drawHairOver(g, head, "#c8402e"));
    upper(() => {
      drawArm(g, spec, shoulder.far, farHand, col, false);
      drawArm(g, spec, shoulder.near, nearHand, col, false);
    });
    if (pose.layer === "body") upper(weapon);
    upper(() => {
      drawHead(g, head);
      if (spec.hat) drawHat(g, spec.hat, view, head.top);
    });
    if (pose.layer === "top") upper(weapon);
    if (pose.layer !== "back") upper(() => drawHand(g, nearHand, col, false));
  } else {
    if (spec.back) upper(() => drawBackItem(g, spec.back!, view, m.neckY, phase));
    upper(() => drawHairBack(g, head));
    upper(() => drawArm(g, spec, shoulder.far, farHand, col, true));
    if (pose.layer === "back") upper(weapon);
    lowerLayer(() => drawLegs(g, spec, view, pose.legs, m, col, pose.bob));
    upper(() => drawTrunk(g, spec, view, m, col));
    upper(() => drawHairOver(g, head, "#c8402e"));
    if (pose.layer === "body") upper(weapon);
    upper(() => drawArm(g, spec, shoulder.near, nearHand, col, false));
    upper(() => {
      drawHead(g, head);
      if (spec.hat) drawHat(g, spec.hat, view, head.top);
      drawFaceDetails(g, spec, view, head.top);
    });
    if (pose.layer === "top") upper(weapon);
    upper(() => drawHand(g, nearHand, col, false));
  }
}

let scratchGrid: PixGrid | null = null;

function scratch(): PixGrid {
  scratchGrid ??= new PixGrid(GRID_W, GRID_H);
  scratchGrid.data.fill(0);
  return scratchGrid;
}

const EDGE = px("#2a2024");

/**
 * Copies held gear onto the figure, darkening body pixels that border it so
 * blades and shafts stay readable over light clothing.
 */
function overlay(g: PixGrid, w: PixGrid): void {
  const { w: W, h: H } = w;
  const src = w.data;
  const dst = g.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (src[i] || !dst[i]) continue;
      if (
        (x > 0 && src[i - 1]) ||
        (x < W - 1 && src[i + 1]) ||
        (y > 0 && src[i - W]) ||
        (y < H - 1 && src[i + W])
      )
        dst[i] = EDGE;
    }
  for (let i = 0; i < src.length; i++) if (src[i]) dst[i] = src[i] as number;
}

function shoulders(view: View, m: Metrics): { near: Pt; far: Pt } {
  const y = m.neckY + 1;
  const left = { x: 8 - m.half - 2, y };
  const right = { x: 8 + m.half, y };
  if (view === "down") return { near: left, far: right };
  if (view === "up") return { near: right, far: left };
  return { near: { x: 7, y }, far: { x: 7, y } };
}

const NORMAL_SHOULDER: Record<View, { near: Pt; far: Pt }> = {
  down: { near: { x: 2, y: 13 }, far: { x: 12, y: 13 } },
  up: { near: { x: 12, y: 13 }, far: { x: 2, y: 13 } },
  right: { near: { x: 7, y: 13 }, far: { x: 7, y: 13 } },
};

function mapHand(hand: Pt, view: View, which: "near" | "far", m: Metrics, s: Pt): Pt {
  const s0 = NORMAL_SHOULDER[view][which];
  return {
    x: Math.round(s.x + (hand.x - s0.x) * (m.armK > 1 ? 1 : m.armK)),
    y: Math.round(s.y + (hand.y - s0.y) * m.armK),
  };
}

/** Top of the sprite above the ground (px), from a rendered idle frame. */
export function measureHeight(grid: PixGrid): number {
  const b = grid.bounds();
  return b ? ANCHOR_Y - b.y0 : 24;
}

