// World markers drawn by the client core: the battle arena ring, objective
// markers (floating in the world, with an edge-of-screen arrow when the
// target is off-screen) and the pulsing 사경 ring under downed players.

import { TILE_PX } from "../../shared/sprites.ts";
import type { BattleView, ObjectiveView } from "../../shared/types.ts";
import { drawNamePlate, type NamePlateOptions } from "../render/overlays.ts";
import { OBANG } from "../render/palette.ts";
import type { CameraRig } from "./camera.ts";
import { disc, ring } from "./fx.ts";

const FONT = "Galmuri11, 'Noto Sans KR', sans-serif";
const MAIN = OBANG.yellow;
const MAIN_LIGHT = "#ffe27a";
const OPTIONAL = "#7fb8e8";
const OUTLINE = "#1b1418";

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Dashed arena ring (오방색 red), dashes marching slowly; culled to the view. */
export function drawBattleRing(ctx: CanvasRenderingContext2D, battle: BattleView, view: Rect, timeMs: number): void {
  const cx = battle.x * TILE_PX;
  const cy = battle.y * TILE_PX;
  const r = Math.max(1, battle.radius) * TILE_PX;
  if (cx + r < view.x0 || cx - r > view.x1 || cy + r < view.y0 || cy - r > view.y1) return;
  const n = Math.max(24, Math.round(Math.PI * 2 * r));
  const shift = Math.floor(timeMs / 70);
  const prev = ctx.globalAlpha;
  // Shadow pass, then red dashes with a lighter inner edge.
  for (let pass = 0; pass < 3; pass++) {
    const rr = pass === 0 ? r + 1 : pass === 1 ? r : r - 1;
    ctx.fillStyle = pass === 0 ? OUTLINE : pass === 1 ? OBANG.red : "#e2574a";
    ctx.globalAlpha = prev * (pass === 0 ? 0.45 : pass === 1 ? 0.95 : 0.7);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if ((i + shift) % 12 >= 7) continue;
      const a = (i / n) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * rr);
      const y = Math.round(cy + Math.sin(a) * rr) + (pass === 0 ? 1 : 0);
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      ctx.rect(x, y, 1, 1);
    }
    ctx.fill();
  }
  ctx.globalAlpha = prev;
}

/** Pulsing red ellipse and 사경 label around a downed body (ground point). */
const downedPlate: NamePlateOptions = { color: "#ff7a68", small: true };

export function drawDownedRing(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number, unit: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 180);
  const cx = Math.round(x);
  const cy = Math.round(y);
  const rx = 11 + Math.round(pulse * 2);
  const ry = 5 + Math.round(pulse);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (0.18 + 0.12 * pulse);
  ctx.fillStyle = "#d8302a";
  ctx.beginPath();
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    ctx.rect(cx - half, cy + dy - 2, half * 2 + 1, 1);
  }
  ctx.fill();
  ctx.globalAlpha = prev * (0.6 + 0.4 * pulse);
  ctx.fillStyle = "#ff5a48";
  ctx.beginPath();
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.rect(Math.round(cx + Math.cos(a) * rx), Math.round(cy - 2 + Math.sin(a) * ry), 1, 1);
  }
  ctx.fill();
  ctx.globalAlpha = prev;
  downedPlate.pixelRatio = unit;
  drawNamePlate(ctx, "사경", x, y - 12, downedPlate);
}

let chevron: HTMLCanvasElement | null = null;
let chevronAlt: HTMLCanvasElement | null = null;

/** 9 × 9 downward chevron with outline, in two colours. */
function chevronSurface(optional: boolean): HTMLCanvasElement | null {
  const cached = optional ? chevronAlt : chevron;
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = 11;
  c.height = 11;
  const g = c.getContext("2d");
  if (!g) return null;
  const rows = ["#########", "#ooooooo#", ".#ooooo#.", ".#ooooo#.", "..#ooo#..", "..#ooo#..", "...#o#...", "...#o#...", "....#...."];
  const body = optional ? OPTIONAL : MAIN;
  const light = optional ? "#c8e4ff" : MAIN_LIGHT;
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < 9; x++) {
      const ch = (rows[y] as string)[x];
      if (ch === ".") continue;
      g.fillStyle = ch === "#" ? OUTLINE : y === 1 ? light : body;
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  if (optional) chevronAlt = c;
  else chevron = c;
  return c;
}

export function objectiveVisible(o: ObjectiveView): boolean {
  return !o.done && typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y);
}

/**
 * Floating chevron + ground pulse over an objective (world space). When a
 * character stands on it, `anchorTop` (world y above its name plate) lifts
 * the chevron clear of the plate.
 */
export function drawObjectiveMarker(
  ctx: CanvasRenderingContext2D,
  o: ObjectiveView,
  timeMs: number,
  anchorTop: number | null,
): void {
  const x = Math.round((o.x as number) * TILE_PX);
  const y = Math.round((o.y as number) * TILE_PX);
  const k = (timeMs % 1600) / 1600;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * 0.55 * (1 - k);
  ctx.fillStyle = o.optional ? OPTIONAL : MAIN_LIGHT;
  ring(ctx, x, y, 3 + k * 10);
  ctx.globalAlpha = prev * 0.25;
  disc(ctx, x, y, 2);
  ctx.globalAlpha = prev;
  const s = chevronSurface(o.optional);
  const top = anchorTop !== null ? Math.round(anchorTop) - 12 : y - 34;
  if (s) ctx.drawImage(s, x - 5, top + Math.round(Math.abs(Math.sin(timeMs / 320)) * -4));
}

/**
 * Screen-space arrow at the viewport edge pointing at an off-screen
 * objective. `unit` is device px per CSS px. Returns false when on-screen.
 */
export function drawObjectiveArrow(
  ctx: CanvasRenderingContext2D,
  rig: CameraRig,
  o: ObjectiveView,
  unit: number,
  timeMs: number,
): boolean {
  const cam = rig.camera;
  const sx = rig.screenX((o.x as number) * TILE_PX);
  const sy = rig.screenY((o.y as number) * TILE_PX - 16);
  const margin = 30 * unit;
  if (sx >= margin && sx <= cam.width - margin && sy >= margin && sy <= cam.height - margin) return false;
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const tx = dx !== 0 ? (cx - margin) / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? (cy - margin) / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  const ax = cx + dx * t;
  const ay = cy + dy * t;
  const angle = Math.atan2(dy, dx);
  const bob = Math.sin(timeMs / 260) * 3 * unit;
  const size = 9 * unit;
  ctx.save();
  ctx.translate(Math.round(ax + Math.cos(angle) * bob), Math.round(ay + Math.sin(angle) * bob));
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.8);
  ctx.lineTo(-size * 0.3, 0);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3 * unit;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = o.optional ? OPTIONAL : MAIN;
  ctx.fill();
  ctx.restore();
  const label = o.siteName ?? "";
  if (label) {
    // The clamp below measures from the label's left edge, so the text state
    // it assumes is set here, not inherited from whoever drew before.
    ctx.save();
    const fs = Math.round(11 * unit);
    ctx.font = `${fs}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(label).width;
    // Keep the label inside the screen, on the inner side of the arrow: at a
    // side edge it grows away from the arrow, at the top or bottom it is
    // centred past the arrow's tail.
    const c = Math.cos(angle);
    const px = ax - c * (size + 6 * unit);
    const left = c < -0.5 ? px : c > 0.5 ? px - w : px - w / 2;
    const lx = Math.min(cam.width - w - 6 * unit, Math.max(6 * unit, left));
    const ly = Math.min(cam.height - fs, Math.max(fs, ay - Math.sin(angle) * (size + 8 * unit)));
    ctx.lineJoin = "round";
    ctx.lineWidth = 3 * unit;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(label, Math.round(lx), Math.round(ly));
    ctx.fillStyle = "#f3ecdc";
    ctx.fillText(label, Math.round(lx), Math.round(ly));
    ctx.restore();
  }
  return true;
}
