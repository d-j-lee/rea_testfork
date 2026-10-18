// World props: drawn at a world-pixel ground point (bottom centre) with a soft
// shadow. Static art and animation frames are authored procedurally in a
// PixGrid, outlined, and cached once per frame; glows and sparkles are cheap
// per-draw overlays.

import type { PropSprite } from "../../shared/sprites.ts";
import { createSurface, SurfaceCache, type Surface } from "./pixel.ts";
import { darker, PixGrid, px } from "./pixgrid.ts";

interface PropArt {
  w: number;
  h: number;
  /** Animation frames and frame time (ms); 1 = static. */
  frames: number;
  frameMs: number;
  /** Shadow width in px (0 = none). */
  shadow: number;
  draw(g: PixGrid, frame: number): void;
  /** Optional live overlay (glows, sparkles) drawn after the sprite. */
  overlay?(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number): void;
  /** Optional underlay (ground glow) drawn before the sprite. */
  underlay?(ctx: CanvasRenderingContext2D, x: number, y: number, timeMs: number): void;
}

const WOOD = "#8a5a35";
const WOOD_D = "#5e3a22";
const WOOD_L = "#ad7a4c";
const BRASS = "#e2b23a";
const BRASS_L = "#f6dc7a";
const BRASS_D = "#a87a22";
const BRONZE = "#4f6650";
const BRONZE_L = "#6f8a6a";
const BRONZE_D = "#34463a";
const RED = "#b8312f";
const LEAF = "#3f7d4a";
const LEAF_L = "#6aa357";
const LEAF_D = "#2a5a34";
const STONE = "#8c8a84";
const STONE_D = "#5f5d58";
const OUTLINE = "#1b1418";

function wheel(g: PixGrid, cx: number, cy: number, r: number): void {
  const rim = px(WOOD_D);
  const spoke = px(WOOD);
  const hub = px(BRASS_D);
  for (let a = 0; a < 32; a++) {
    const t = (a / 32) * Math.PI * 2;
    g.set(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), rim);
  }
  g.line(cx - r + 1, cy, cx + r - 1, cy, spoke);
  g.line(cx, cy - r + 1, cx, cy + r - 1, spoke);
  g.line(cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 2, spoke);
  g.line(cx - r + 2, cy + r - 2, cx + r - 2, cy - r + 2, spoke);
  g.set(cx, cy, hub);
}

const ART: Record<PropSprite, PropArt> = {
  chest: {
    w: 16,
    h: 13,
    frames: 1,
    frameMs: 0,
    shadow: 16,
    draw(g) {
      const L = px("#a0522d");
      const l = px("#b8683a");
      const W = px("#7a3b24");
      const d = px("#4f2416");
      const G = px(BRASS);
      const Y = px(BRASS_L);
      const B = px(BRASS_D);
      // Lid (top face in 3/4 view) and front.
      g.rect(2, 1, 12, 4, L);
      g.hline(3, 12, 1, l);
      g.hline(2, 13, 0, l);
      g.rect(1, 5, 14, 7, W);
      g.hline(1, 14, 5, d);
      g.hline(1, 14, 11, d);
      // Brass corners and straps.
      for (const x of [1, 14]) {
        g.vline(x, 5, 11, G);
        g.set(x, 6, Y);
      }
      g.rect(1, 4, 2, 1, G);
      g.rect(13, 4, 2, 1, G);
      g.hline(1, 14, 8, B);
      // Round lock plate (butterfly) with hasp.
      g.rect(6, 6, 4, 4, G);
      g.hline(7, 8, 5, G);
      g.hline(7, 8, 10, G);
      g.set(5, 7, B);
      g.set(10, 7, B);
      g.set(6, 6, Y);
      g.rect(7, 7, 2, 2, d);
      g.set(7, 3, G);
      g.set(8, 3, G);
      g.set(7, 4, B);
      g.set(8, 4, B);
    },
    overlay(ctx, x, y, t) {
      sparkle(ctx, x - 1, y - 9, t, 2400, "#fff7c8");
    },
  },
  herb: {
    w: 11,
    h: 10,
    frames: 2,
    frameMs: 700,
    shadow: 8,
    draw(g, f) {
      const L = px(LEAF);
      const l = px(LEAF_L);
      const d = px(LEAF_D);
      const sway = f;
      g.vline(5, 3, 9, d);
      const leaf = (x: number, y: number, dir: number) => {
        g.hline(x, x + 2 * dir, y, L);
        g.set(x + dir, y - 1, l);
        g.set(x + 2 * dir, y + 1, d);
      };
      leaf(4, 8, -1);
      leaf(6, 7, 1);
      leaf(4, 5 + sway, -1);
      leaf(6, 4, 1);
      // Bellflower blossoms (도라지).
      const P = px("#8a6ac8");
      const p = px("#c4b0ec");
      g.set(5 + sway, 1, P);
      g.set(4 + sway, 2, P);
      g.set(6 + sway, 2, P);
      g.set(5 + sway, 2, p);
      g.set(8, 3, P);
      g.set(8, 2, p);
    },
    overlay(ctx, x, y, t) {
      sparkle(ctx, x + 3, y - 8, t, 1800, "#e8ffd8");
    },
  },
  ginseng: {
    w: 13,
    h: 14,
    frames: 2,
    frameMs: 600,
    shadow: 9,
    draw(g, f) {
      const L = px(LEAF);
      const l = px(LEAF_L);
      const d = px(LEAF_D);
      const R = px("#e0322c");
      const r = px("#ff6a4a");
      const root = px("#e8d2a6");
      const rootD = px("#c4a878");
      // Root (사람 모양) peeking from the soil.
      g.rect(5, 11, 3, 2, root);
      g.set(4, 12, rootD);
      g.set(8, 12, rootD);
      g.set(6, 13, rootD);
      g.hline(3, 9, 13, px("#7c5c3b"));
      // Stem and five-leaf palmate clusters.
      g.vline(6, 4, 10, d);
      const palm = (cx: number, cy: number) => {
        g.set(cx, cy - 2, l);
        g.set(cx - 2, cy - 1, L);
        g.set(cx + 2, cy - 1, L);
        g.set(cx - 1, cy + 1, L);
        g.set(cx + 1, cy + 1, L);
        g.set(cx, cy, d);
        g.set(cx - 1, cy - 1, l);
        g.set(cx + 1, cy - 1, L);
      };
      palm(3, 7);
      palm(9, 7 + f);
      palm(6, 9);
      // Red berry cluster on top.
      g.rect(5, 1, 3, 2, R);
      g.set(6, 0, R);
      g.set(5, 1, r);
      g.set(7, 3, R);
      g.set(5, 3, R);
      g.set(6, 3, d);
    },
    underlay(ctx, x, y, t) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 380);
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * (0.45 + 0.3 * pulse);
      ctx.drawImage(glowSurface("#fff2a8", 13), x - 13, y - 21);
      ctx.globalAlpha = prev;
    },
    overlay(ctx, x, y, t) {
      sparkle(ctx, x - 5, y - 12, t, 1300, "#fffbd0");
      sparkle(ctx, x + 4, y - 7, t + 650, 1300, "#fffbd0");
      // Rising motes.
      const prev = ctx.globalAlpha;
      ctx.fillStyle = "#fff6b0";
      for (let i = 0; i < 2; i++) {
        const k = ((t + i * 800) % 1600) / 1600;
        ctx.globalAlpha = prev * (1 - k);
        ctx.fillRect(Math.round(x + Math.sin(t / 300 + i * 3) * 4), Math.round(y - 6 - k * 16), 1, 1);
      }
      ctx.globalAlpha = prev;
    },
  },
  coin: {
    w: 13,
    h: 10,
    frames: 1,
    frameMs: 0,
    shadow: 11,
    draw(g) {
      // 엽전 pouch (주머니) with drawstring and tassel, plus loose coins.
      const P = px("#2f5f8f");
      const p = px("#24486e");
      const pl = px("#5a8ab8");
      const S = px(RED);
      g.rect(2, 4, 7, 5, P);
      g.hline(3, 7, 9, p);
      g.vline(8, 4, 8, p);
      g.hline(3, 5, 4, pl);
      g.rect(3, 2, 5, 2, P);
      g.hline(4, 6, 1, P);
      g.hline(3, 7, 3, S);
      g.set(8, 3, S);
      g.vline(9, 4, 6, S);
      g.set(9, 7, px("#e2b23a"));
      g.set(4, 6, px("#e2b23a"));
      g.set(6, 6, px("#e2b23a"));
      g.set(5, 7, px("#e2b23a"));
      // Loose coins with square holes.
      const coin = (cx: number, cy: number) => {
        g.rect(cx - 1, cy - 1, 3, 3, px(BRASS));
        g.set(cx, cy, px(BRASS_D));
        g.set(cx - 1, cy - 1, px(BRASS_L));
      };
      coin(11, 8);
      coin(9, 9);
    },
    overlay(ctx, x, y, t) {
      sparkle(ctx, x + 5, y - 3, t, 2000, "#fff7c8");
    },
  },
  scroll: {
    w: 14,
    h: 8,
    frames: 1,
    frameMs: 0,
    shadow: 12,
    draw(g) {
      const P = px("#efe4c4");
      const p = px("#cdbd94");
      const D = px(WOOD_D);
      const R = px(RED);
      // Rolled scroll lying diagonally with wooden rod ends and a red tie.
      for (let i = 0; i < 10; i++) {
        const x = 2 + i;
        const y = 5 - Math.floor(i / 3);
        g.set(x, y, P);
        g.set(x, y + 1, P);
        g.set(x, y + 2, p);
      }
      g.rect(0, 5, 2, 3, D);
      g.rect(12, 2, 2, 3, D);
      g.set(1, 4, px(BRASS));
      g.set(13, 1, px(BRASS));
      g.vline(7, 3, 6, R);
      g.set(8, 7, R);
      g.set(6, 7, R);
    },
    overlay(ctx, x, y, t) {
      sparkle(ctx, x + 2, y - 6, t, 2200, "#ffffff");
    },
  },
  banner: {
    w: 20,
    h: 34,
    frames: 4,
    frameMs: 160,
    shadow: 8,
    draw(g, f) {
      const pole = px(WOOD_D);
      const poleL = px(WOOD);
      g.vline(4, 4, 33, pole);
      g.vline(5, 4, 33, poleL);
      // Spear finial with red tassel (상모).
      g.vline(4, 0, 2, px("#d9dee4"));
      g.set(4, 0, px("#ffffff"));
      g.rect(3, 3, 3, 2, px(RED));
      g.set(2, 4, px("#8f2a2a"));
      g.set(6, 4, px("#8f2a2a"));
      // Waving 군기: red field, yellow flame-scalloped border (화염각).
      const F = px(RED);
      const Fd = px(darker(RED, 0.3));
      const Y = px(BRASS);
      const B = px("#2b5a8c");
      for (let i = 0; i < 12; i++) {
        const wave = Math.round(Math.sin((i + f * 3) * 0.7) * 1.2);
        const x = 6 + i;
        const top = 5 + wave + Math.floor(i / 6);
        const bottom = 14 + wave - Math.floor(i / 8);
        g.vline(x, top, bottom, (i + f) % 4 === 0 ? Fd : F);
        g.set(x, top, Y);
        g.set(x, bottom, Y);
        if (i === 11 || i === 10) g.vline(x, top, bottom, Y);
        if (i === 11 && (i + f) % 2 === 0) g.set(x + 1, top + 3, Y);
        if (i === 11) g.set(x + 1, top + 6, Y);
      }
      // Central emblem: blue/yellow ring.
      const ey = 9 + Math.round(Math.sin((5 + f * 3) * 0.7) * 1.2);
      g.rect(10, ey - 1, 3, 3, B);
      g.set(11, ey, Y);
    },
  },
  cannon: {
    w: 26,
    h: 16,
    frames: 1,
    frameMs: 0,
    shadow: 22,
    draw(g) {
      const C = px(BRONZE);
      const c = px(BRONZE_D);
      const l = px(BRONZE_L);
      const W = px(WOOD);
      const w = px(WOOD_D);
      const wl = px(WOOD_L);
      // Carriage (동차): trail resting on the ground, bed under the barrel.
      g.line(1, 14, 12, 9, w);
      g.line(1, 13, 12, 8, W);
      g.rect(8, 8, 9, 3, W);
      g.hline(8, 16, 8, wl);
      g.hline(8, 16, 10, w);
      // Barrel (천자총통): bronze with reinforcing rings, tilted up.
      for (let i = 0; i < 16; i++) {
        const x = 6 + i;
        const y = 7 - Math.floor(i / 5);
        const ring = i % 4 === 1;
        g.vline(x, y - 1, y + 1, ring ? c : C);
        g.set(x, y - 1, ring ? C : l);
      }
      g.rect(21, 2, 2, 4, c);
      g.set(22, 3, px("#1b1418"));
      g.rect(4, 6, 3, 3, c);
      g.set(5, 5, px(RED));
      // Spoked wheel.
      wheel(g, 12, 11, 4);
    },
  },
  singijeon: {
    w: 24,
    h: 22,
    frames: 1,
    frameMs: 0,
    shadow: 20,
    draw(g) {
      const W = px(WOOD);
      const w = px(WOOD_D);
      const wl = px(WOOD_L);
      const hole = px("#2a1e18");
      const shaft = px("#c9a35a");
      const tip = px("#d9dee4");
      const tube = px(RED);
      // Cart bed and shafts (화차).
      g.line(0, 18, 8, 14, w);
      g.line(0, 17, 8, 13, W);
      g.rect(6, 13, 12, 3, W);
      g.hline(6, 17, 13, wl);
      g.hline(6, 17, 15, w);
      // Launch box (신기전기) tilted back: a face of tube mouths.
      g.rect(7, 3, 11, 10, W);
      g.hline(7, 17, 3, wl);
      g.vline(17, 3, 12, w);
      g.hline(7, 17, 12, w);
      g.rect(5, 5, 2, 8, w);
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 5; k++) g.set(8 + k * 2, 5 + r * 2, hole);
      // Rockets: red paper tubes on shafts poking from the top row.
      for (let k = 0; k < 5; k++) {
        const x = 8 + k * 2;
        g.line(x, 3, x + 2, 0, shaft);
        g.set(x + 1, 2, tube);
        g.set(x + 2, 0, tip);
      }
      wheel(g, 12, 17, 4);
    },
  },
  campfire: {
    w: 16,
    h: 18,
    frames: 6,
    frameMs: 90,
    shadow: 0,
    draw(g, f) {
      const S = px(STONE);
      const s = px(STONE_D);
      const W = px(WOOD);
      const w = px(WOOD_D);
      // Stone ring and crossed logs.
      for (const [x, y] of [
        [1, 15],
        [3, 16],
        [6, 17],
        [9, 17],
        [12, 16],
        [14, 15],
      ] as const) {
        g.rect(x, y, 2, 2, S);
        g.set(x + 1, y + 1, s);
      }
      g.line(3, 16, 12, 12, w);
      g.line(3, 15, 12, 11, W);
      g.line(3, 11, 12, 16, W);
      g.line(4, 11, 12, 15, w);
      // Flames: layered tongues that flicker per frame.
      const R = px("#d8432a");
      const O = px("#f08a2a");
      const Y = px("#ffd84a");
      const Wh = px("#fff6d0");
      const heights = [
        [5, 8, 6],
        [6, 9, 5],
        [5, 10, 6],
        [4, 9, 7],
        [6, 8, 6],
        [5, 9, 5],
      ][f] as [number, number, number];
      const tongue = (cx: number, hgt: number, base: number) => {
        for (let i = 0; i < hgt; i++) {
          const half = Math.max(0, Math.round((hgt - i) / 3));
          const y = base - i;
          g.hline(cx - half, cx + half, y, i < hgt * 0.35 ? R : i < hgt * 0.7 ? O : Y);
        }
      };
      tongue(5, heights[0], 13);
      tongue(10, heights[2], 13);
      tongue(8, heights[1], 13);
      g.rect(7, 10, 2, 3, Y);
      g.set(8, 11, Wh);
      g.set(7 + (f % 2), 13 - heights[1] - 1, O);
    },
    underlay(ctx, x, y, t) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 120) * Math.sin(t / 47);
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * (0.3 + 0.12 * pulse);
      ctx.drawImage(glowSurface("#ffb050", 18), x - 18, y - 22);
      ctx.globalAlpha = prev;
    },
    overlay(ctx, x, y, t) {
      ctx.fillStyle = "#ffcf6a";
      const prev = ctx.globalAlpha;
      for (let i = 0; i < 3; i++) {
        const k = ((t + i * 400) % 1200) / 1200;
        ctx.globalAlpha = prev * (1 - k);
        ctx.fillRect(
          Math.round(x - 2 + i * 2 + Math.sin(t / 200 + i * 2) * 2),
          Math.round(y - 12 - k * 14),
          1,
          1,
        );
      }
      ctx.globalAlpha = prev;
    },
  },
  signpost: {
    w: 18,
    h: 22,
    frames: 1,
    frameMs: 0,
    shadow: 6,
    draw(g) {
      const W = px(WOOD);
      const w = px(WOOD_D);
      const wl = px(WOOD_L);
      const P = px("#c9a26a");
      const p = px("#a8834e");
      const ink = px("#2a1e18");
      g.vline(7, 3, 21, w);
      g.vline(8, 3, 21, W);
      g.set(8, 3, wl);
      // Two arrow-shaped boards pointing opposite ways.
      const board = (y: number, dir: 1 | -1) => {
        const x0 = dir === 1 ? 3 : 2;
        g.rect(x0, y, 12, 4, P);
        g.hline(x0, x0 + 11, y + 3, p);
        const tipX = dir === 1 ? x0 + 12 : x0 - 1;
        g.vline(tipX, y + 1, y + 2, P);
        g.set(tipX + dir, y + 1, p);
        g.set(tipX + dir, y + 2, p);
        // Brushed lettering.
        for (let i = 0; i < 4; i++) {
          const lx = x0 + 2 + i * 2 + (dir === 1 ? 0 : 1);
          g.set(lx, y + 1, ink);
          g.set(lx + (i % 2), y + 2, ink);
        }
      };
      board(4, 1);
      board(10, -1);
      g.rect(5, 20, 6, 2, px(STONE_D));
      g.hline(5, 10, 20, px(STONE));
    },
  },
};

const cache = new SurfaceCache();
/** Allocation-free lookup in front of the SurfaceCache. */
const frameIndex = new Map<PropSprite, Surface[]>();

function frameSurface(key: PropSprite, art: PropArt, frame: number): Surface {
  let list = frameIndex.get(key);
  if (!list) frameIndex.set(key, (list = []));
  const hit = list[frame];
  if (hit) return hit;
  const built = buildFrame(key, art, frame);
  list[frame] = built;
  return built;
}

function buildFrame(key: PropSprite, art: PropArt, frame: number): Surface {
  return cache.get(`${key}|${frame}`, () => {
    const g = new PixGrid(art.w + 4, art.h + 4);
    g.ox = 2;
    g.oy = 2;
    art.draw(g, frame);
    g.ox = 0;
    g.oy = 0;
    g.outline(OUTLINE, 0.25);
    return g.toSurface();
  });
}

const glows = new Map<string, Surface>();

/** Soft radial glow, pixel-stepped to match the art (cached per colour/radius). */
function glowSurface(color: string, r: number): Surface {
  const id = `${color}|${r}`;
  let s = glows.get(id);
  if (!s) {
    s = createSurface(r * 2, r * 2);
    const ctx = s.getContext("2d");
    if (ctx) {
      ctx.fillStyle = color;
      for (let y = 0; y < r * 2; y++)
        for (let x = 0; x < r * 2; x++) {
          const d = Math.hypot(x + 0.5 - r, (y + 0.5 - r) * 1.25) / r;
          if (d >= 1) continue;
          const a = (1 - d) * (1 - d);
          ctx.globalAlpha = Math.round(a * 6) / 6;
          ctx.fillRect(x, y, 1, 1);
        }
    }
    glows.set(id, s);
  }
  return s;
}

const shadows = new Map<number, Surface>();

function shadowSurface(width: number): Surface {
  let s = shadows.get(width);
  if (!s) {
    const h = width > 14 ? 4 : 3;
    s = createSurface(width, h);
    const ctx = s.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "rgba(20, 14, 20, 0.28)";
      for (let y = 0; y < h; y++) {
        const t = (y + 0.5 - h / 2) / (h / 2);
        const half = Math.round((width / 2) * Math.sqrt(Math.max(0, 1 - t * t)));
        ctx.fillRect(width / 2 - half, y, half * 2, 1);
      }
    }
    shadows.set(width, s);
  }
  return s;
}

/** Brief four-point twinkle every `period` ms. */
function sparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  period: number,
  color: string,
): void {
  const k = (t % period) / period;
  if (k > 0.18) return;
  const s = k < 0.06 || k > 0.12 ? 1 : 2;
  const gx = Math.round(x);
  const gy = Math.round(y);
  ctx.fillStyle = color;
  ctx.fillRect(gx, gy - s, 1, s * 2 + 1);
  ctx.fillRect(gx - s, gy, s * 2 + 1, 1);
}

/** Pixel height of a prop above its ground point (for labels / interaction). */
export function propHeight(key: PropSprite): number {
  return ART[key].h;
}

export function drawProp(
  ctx: CanvasRenderingContext2D,
  key: PropSprite,
  x: number,
  y: number,
  timeMs: number,
): void {
  const art = ART[key];
  const gx = Math.round(x);
  const gy = Math.round(y);
  if (art.shadow) {
    const sh = shadowSurface(art.shadow);
    ctx.drawImage(sh, gx - (art.shadow >> 1), gy - sh.height + 1);
  }
  art.underlay?.(ctx, gx, gy, timeMs);
  const frame = art.frames > 1 ? Math.floor(timeMs / art.frameMs) % art.frames : 0;
  const surface = frameSurface(key, art, frame);
  // Surface has a 2px margin; its bottom-centre sits on the ground point.
  ctx.drawImage(surface, gx - (surface.width >> 1), gy - surface.height + 2);
  art.overlay?.(ctx, gx, gy, timeMs);
}

