// Held weapons and back items for the paper-doll humanoid. Weapons are drawn
// along an angle from the grip point so one routine covers every pose and
// view; angles are screen degrees (0 = +x, 90 = +y / down).

import type { BackItem, WeaponKind } from "./costume-types.ts";
import type { View } from "./humanoid-head.ts";
import { darker, lighter, px, type PixGrid, type Px } from "./pixgrid.ts";

const STEEL = px("#d9dee4");
const STEEL_D = px("#8f99a5");
const STEEL_L = px("#ffffff");
const WOOD = px("#8a5a35");
const WOOD_D = px("#5e3a22");
const WOOD_L = px("#a8774a");
const IRON = px("#4a4f57");
const IRON_L = px("#6c727b");
const BRASS = px("#e2b23a");
const BRASS_D = px("#a87a22");
const BAMBOO = px("#b9b65a");
const BAMBOO_D = px("#7b8638");
const BAMBOO_L = px("#e3dc9a");
const BOW = px("#6b3e22");
const BOW_D = px("#2a1e18");
const STRING = px("#cdbf9f");
const BLACK = px("#26211f");
const FLASH_W = px("#fffbe6");
const FLASH_Y = px("#ffd84a");
const FLASH_O = px("#ff8a2a");

export interface WeaponDraw {
  kind: WeaponKind;
  /** Grip point (body-local). */
  x: number;
  y: number;
  angle: number;
  /** Shift along the weapon axis (thrust / recoil). */
  slide: number;
  accent: string;
  /** Bow: draw hand position; string runs through it when set. */
  drawHand?: { x: number; y: number } | null;
  /** Bow: show a nocked arrow. */
  arrow?: boolean;
  /** Gun: muzzle flash. */
  flash?: boolean;
  /** Foreshortening along the axis (weapons pointing at / away from the camera). */
  scale?: number;
}

export function drawWeapon(g: PixGrid, w: WeaponDraw): void {
  if (w.kind === "none") return;
  const a = (w.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy;
  const ny = dx;
  const k = w.scale ?? 1;
  const P = (t: number, n = 0): [number, number] => [
    Math.round(w.x + dx * (t + w.slide) * k + nx * n),
    Math.round(w.y + dy * (t + w.slide) * k + ny * n),
  ];
  const seg = (t0: number, t1: number, c: Px, n = 0) => {
    const [x0, y0] = P(t0, n);
    const [x1, y1] = P(t1, n);
    g.line(x0, y0, x1, y1, c);
  };
  const dot = (t: number, c: Px, n = 0) => {
    const [x, y] = P(t, n);
    g.set(x, y, c);
  };
  const accent = px(w.accent);
  switch (w.kind) {
    case "sword":
      seg(-2, 0, WOOD_D);
      dot(-2, BRASS);
      seg(2, 8, STEEL);
      dot(8, STEEL_L);
      dot(3, STEEL_L);
      dot(1, BRASS);
      dot(1, BRASS_D, 1);
      dot(1, BRASS_D, -1);
      break;
    case "sabre":
      seg(-1, 0, BRASS);
      dot(0, BRASS_D, 1);
      seg(1, 6, STEEL);
      seg(6, 8, STEEL, 0.6);
      dot(8, STEEL_L, 0.6);
      dot(1, BRASS);
      break;
    case "curved":
    case "longsword": {
      const len = w.kind === "longsword" ? 11 : 8;
      seg(-3, 0, BLACK);
      dot(-2, px("#e9e1cc"));
      dot(1, BRASS_D);
      dot(1, BRASS_D, 1);
      dot(1, BRASS_D, -1);
      seg(2, len - 3, STEEL);
      seg(len - 2, len, STEEL, -1);
      dot(len, STEEL_L, -1);
      dot(3, STEEL_L);
      break;
    }
    case "spear":
      seg(-6, 12, WOOD);
      dot(-6, WOOD_D);
      dot(12, accent);
      dot(12, accent, 1);
      dot(12, accent, -1);
      dot(11, px(darker(w.accent)));
      dot(11, accent, 1);
      seg(13, 16, STEEL);
      dot(14, STEEL_D, 1);
      dot(14, STEEL_D, -1);
      dot(16, STEEL_L);
      break;
    case "trident":
      seg(-6, 12, WOOD);
      dot(12, accent);
      dot(12, accent, 1);
      seg(13, 16, STEEL);
      seg(13, 13, STEEL, 2);
      dot(13, STEEL, 1);
      dot(13, STEEL, -1);
      dot(13, STEEL, -2);
      seg(14, 15, STEEL, 2);
      seg(14, 15, STEEL, -2);
      dot(16, STEEL_L);
      break;
    case "bamboo":
      seg(-6, 15, BAMBOO);
      for (const t of [-3, 2, 7, 12]) dot(t, BAMBOO_D);
      dot(16, BAMBOO_L);
      dot(17, BAMBOO_L);
      dot(16, BAMBOO_D, 1);
      break;
    case "staff":
      seg(-8, 12, WOOD);
      dot(-8, WOOD_D);
      dot(12, WOOD_D);
      dot(13, WOOD_L);
      dot(12, WOOD_D, 1);
      break;
    case "monkstaff":
      seg(-8, 11, WOOD_D);
      dot(-8, BRASS_D);
      for (const n of [-1, 0, 1]) {
        dot(12, BRASS, n);
        dot(15, BRASS, n);
      }
      dot(13, BRASS, -2);
      dot(14, BRASS, -2);
      dot(13, BRASS, 2);
      dot(14, BRASS, 2);
      dot(13, BRASS_D, -1);
      dot(14, BRASS_D, 1);
      dot(16, BRASS);
      break;
    case "hoe":
      seg(-5, 8, WOOD);
      dot(9, IRON);
      dot(9, IRON, 1);
      dot(9, IRON_L, 2);
      dot(8, IRON, 1);
      dot(8, IRON, 2);
      break;
    case "cane":
      seg(-1, 8, WOOD_D);
      dot(-1, WOOD, 1);
      dot(-2, WOOD, 1);
      dot(-2, WOOD_D, 2);
      break;
    case "fan":
      seg(0, 3, BLACK);
      dot(4, px("#e9e1cc"));
      dot(3, px("#e9e1cc"), 1);
      break;
    case "warfan":
      seg(0, 2, BLACK);
      for (let t = 3; t <= 6; t++)
        for (let n = -2; n <= 2; n++) {
          if ((t === 3 || t === 6) && Math.abs(n) === 2) continue;
          dot(t, BLACK, n);
        }
      dot(4, BRASS);
      dot(5, BRASS);
      dot(4, BRASS, 1);
      dot(5, BRASS, -1);
      break;
    case "bow":
      drawBow(g, w, P);
      break;
    case "musket":
    case "rifle": {
      const rifle = w.kind === "rifle";
      const wood = rifle ? px("#6b4226") : WOOD;
      const woodD = rifle ? px("#4a2c18") : WOOD_D;
      seg(0, 10, IRON);
      dot(9, IRON_L);
      seg(-4, -1, wood);
      seg(-4, -2, woodD, 1);
      seg(0, 3, wood, 1);
      dot(0, BRASS, -1);
      if (!rifle) dot(1, px("#ff5a2a"), -1);
      if (rifle) {
        seg(11, 13, STEEL);
        dot(13, STEEL_L);
      }
      if (w.flash) {
        const t = rifle ? 14 : 11;
        dot(t, FLASH_W);
        dot(t + 1, FLASH_Y);
        dot(t + 2, FLASH_O);
        dot(t, FLASH_Y, 1);
        dot(t, FLASH_Y, -1);
        dot(t + 1, FLASH_O, 1);
        dot(t + 1, FLASH_O, -1);
      }
      break;
    }
  }
}

function drawBow(
  g: PixGrid,
  w: WeaponDraw,
  P: (t: number, n?: number) => [number, number],
): void {
  // Recurved 각궁: limbs bend toward the archer, tips flick forward.
  const back = [0, 0, 0, -1, -1, -2];
  let top: [number, number] = P(0);
  let bottom: [number, number] = P(0);
  for (let s = -5; s <= 5; s++) {
    const off = back[Math.abs(s)] as number;
    const [x, y] = P(off, s);
    g.set(x, y, Math.abs(s) >= 4 ? BOW_D : BOW);
    if (s === -5) top = [x, y];
    if (s === 5) bottom = [x, y];
  }
  const [ex0, ey0] = P(-1, -6);
  const [ex1, ey1] = P(-1, 6);
  g.set(ex0, ey0, BOW_D);
  g.set(ex1, ey1, BOW_D);
  const [gx, gy] = P(0);
  g.set(gx, gy, px("#c8402e"));
  if (w.drawHand) {
    const h = w.drawHand;
    g.line(top[0], top[1], h.x, h.y, STRING);
    g.line(bottom[0], bottom[1], h.x, h.y, STRING);
    if (w.arrow) {
      const a = (w.angle * Math.PI) / 180;
      const tx = Math.round(gx + Math.cos(a) * 3);
      const ty = Math.round(gy + Math.sin(a) * 3);
      g.line(h.x, h.y, tx, ty, px("#c9a35a"));
      g.set(tx, ty, STEEL_L);
      g.set(h.x, h.y, px("#f4f1e8"));
    }
  } else {
    g.line(top[0], top[1], bottom[0], bottom[1], STRING);
  }
}

// ------------------------------------------------------------ back items --

/**
 * Back items. `phase` animates flags; `front` selects the part drawn over
 * the body in the up view (items worn on the back face the camera there).
 */
export function drawBackItem(
  g: PixGrid,
  item: BackItem,
  view: View,
  neckY: number,
  phase: number,
): void {
  const C = px(item.color);
  const c = px(darker(item.color, 0.3));
  const l = px(lighter(item.color, 0.3));
  const n = neckY;
  switch (item.kind) {
    case "quiver": {
      const red = px("#c8402e");
      const fl = px("#f4f1e8");
      if (view === "down") {
        g.set(1, n - 4, fl);
        g.set(2, n - 5, red);
        g.set(2, n - 4, fl);
        g.set(3, n - 5, fl);
        g.rect(1, n - 3, 3, 3, C);
        g.set(1, n - 3, l);
      } else if (view === "up") {
        for (let i = 0; i < 9; i++) {
          g.rect(11 - Math.floor(i / 1.5), n - 1 + i, 3, 1, i === 0 ? l : C);
          g.set(13 - Math.floor(i / 1.5), n - 1 + i, c);
        }
        g.set(11, n - 2, fl);
        g.set(12, n - 3, red);
        g.set(13, n - 2, fl);
        g.set(13, n - 3, fl);
        g.set(14, n - 4, red);
        g.hline(5, 6, n + 7, px("#e2b23a"));
      } else {
        for (let i = 0; i < 8; i++) g.rect(3 + Math.floor(i / 3), n - 2 + i, 2, 1, C);
        g.set(3, n - 2, l);
        g.set(4, n - 3, fl);
        g.set(5, n - 4, red);
        g.set(5, n - 3, fl);
      }
      break;
    }
    case "flag": {
      const A = px(item.accent);
      const pole = WOOD_D;
      const wave = phase % 2;
      if (view === "right") {
        g.vline(4, n - 18, n + 4, pole);
        g.set(4, n - 19, BRASS);
        drawFlagCloth(g, 3, n - 18, -1, wave, C, c, A);
      } else {
        const x = view === "down" ? 13 : 2;
        const dir = view === "down" ? 1 : -1;
        g.vline(x, n - 18, n + 4, pole);
        g.set(x, n - 19, BRASS);
        drawFlagCloth(g, x + dir, n - 18, dir, wave, C, c, A);
      }
      break;
    }
    case "banner": {
      const A = px(item.accent);
      const top = n - 21;
      const x = view === "right" ? 3 : view === "down" ? 9 : 6;
      const poleX = view === "right" ? 4 : view === "down" ? 8 : 7;
      g.vline(poleX, top, n + 3, WOOD_D);
      g.hline(Math.min(x, poleX), Math.max(x + 3, poleX), top, WOOD_D);
      const bx = view === "right" ? 1 : x;
      g.rect(bx, top + 1, 4, 8, C);
      g.vline(bx + 3, top + 1, top + 8, c);
      g.rect(bx + 1, top + 3, 2, 2, A);
      g.hline(bx, bx + 3, top + 8, c);
      break;
    }
    case "jige": {
      const load = px(item.load);
      const loadD = px(darker(item.load, 0.3));
      if (view === "up") {
        g.vline(4, n - 7, n + 9, WOOD);
        g.vline(11, n - 7, n + 9, WOOD_D);
        g.hline(4, 11, n + 6, WOOD_D);
        g.rect(3, n - 5, 10, 7, load);
        g.hline(3, 12, n - 2, loadD);
        g.vline(8, n - 5, n + 1, loadD);
        g.hline(3, 12, n + 1, loadD);
      } else if (view === "down") {
        g.vline(2, n - 8, n - 1, WOOD);
        g.vline(13, n - 8, n - 1, WOOD_D);
        g.rect(3, n - 7, 10, 2, load);
        g.hline(3, 12, n - 6, loadD);
      } else {
        g.vline(3, n - 8, n + 9, WOOD);
        g.vline(1, n - 7, n + 6, WOOD_D);
        g.rect(-1, n - 6, 4, 8, load);
        g.vline(-1, n - 6, n + 1, loadD);
        g.hline(-1, 2, n - 2, loadD);
      }
      break;
    }
    case "pack": {
      if (view === "up") {
        g.rect(4, n + 1, 8, 5, C);
        g.hline(4, 11, n + 1, l);
        g.hline(4, 11, n + 5, c);
        g.set(7, n, c);
        g.set(8, n, c);
      } else if (view === "right") {
        g.rect(2, n + 1, 3, 5, C);
        g.vline(2, n + 1, n + 5, c);
      } else {
        g.set(7, n + 2, c);
        g.set(8, n + 2, c);
      }
      break;
    }
    case "cape": {
      if (view === "up") {
        g.rect(4, n, 8, 8, C);
        g.rect(3, n + 2, 10, 6, C);
        g.hline(3, 12, n + 8, c);
        g.vline(8, n + 1, n + 7, c);
      } else if (view === "right") {
        g.rect(3, n, 3, 8, C);
        g.vline(3, n + 2, n + 8, c);
      } else {
        g.vline(3, n + 1, n + 7, c);
        g.vline(12, n + 1, n + 7, c);
      }
      break;
    }
  }
}

function drawFlagCloth(
  g: PixGrid,
  x: number,
  y: number,
  dir: number,
  wave: number,
  C: Px,
  c: Px,
  A: Px,
): void {
  // 6 × 5 banner with an accent border; the free edge ripples.
  const w = 6;
  for (let i = 0; i < w; i++) {
    const ripple = wave ? (i % 3 === 2 ? 1 : 0) : i % 3 === 0 ? 1 : 0;
    const top = y + ripple;
    const fx = x + dir * i;
    g.set(fx, top, A);
    g.vline(fx, top + 1, top + 3, i % 2 ? c : C);
    g.set(fx, top + 4, A);
  }
  g.vline(x + dir * (w - 1), y + 1, y + 4, A);
}
