// Overlays drawn above the world: name plates, HP bars, emote icons and the
// selection ring. Inputs are world pixels (the camera transform is already on
// the context). Name plates render text at device resolution so Korean stays
// crisp at any camera scale; the rest is pixel art in world pixels.

import { createSurface, SurfaceCache, type Surface } from "./pixel.ts";
import { PixGrid, px } from "./pixgrid.ts";

const FONT_FAMILY = "Galmuri11, 'Noto Sans KR', sans-serif";
const OUTLINE = "#140f12";

export interface NamePlateOptions {
  color: string;
  title?: string;
  level?: number;
  small?: boolean;
  /**
   * Canvas pixels per CSS pixel. When given, text is sized for CSS-pixel
   * legibility (phones render the canvas below devicePixelRatio).
   */
  pixelRatio?: number;
}

// ------------------------------------------------------------ name plates --

interface Plate {
  mult: number;
  small: boolean;
  color: string;
  level: number | undefined;
  title: string | undefined;
  surface: Surface;
}

/** Plates by text; each text usually has one or two option sets. */
const PLATE_CACHE_MAX = 512;
const plates = new Map<string, Plate[]>();
let measureCtx: CanvasRenderingContext2D | null = null;

// Plates are rasterised once; rebuild them when web fonts finish loading so
// the first frames' fallback-font plates do not stick.
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener("loadingdone", () => plates.clear());
}

function measurer(): CanvasRenderingContext2D | null {
  if (!measureCtx) measureCtx = createSurface(1, 1).getContext("2d");
  return measureCtx;
}

/** Device pixels per world pixel for the current transform. */
function deviceScale(ctx: CanvasRenderingContext2D): { s: number; x: number; y: number; m: DOMMatrix } {
  const m = ctx.getTransform();
  return { s: Math.max(1, Math.hypot(m.a, m.b)), x: m.e, y: m.f, m };
}

function buildPlate(
  text: string,
  opts: NamePlateOptions,
  mult: number,
): Surface {
  const nameSize = (opts.small ? 11 : 12) * mult;
  const titleSize = 11 * mult;
  const pad = 2 * mult;
  const m = measurer();
  const nameFont = `${nameSize}px ${FONT_FAMILY}`;
  const titleFont = `${titleSize}px ${FONT_FAMILY}`;
  const levelText = opts.level !== undefined ? `${opts.level}` : "";
  let nameW = text.length * nameSize;
  let titleW = 0;
  let levelW = 0;
  if (m) {
    m.font = nameFont;
    nameW = Math.ceil(m.measureText(text).width);
    if (opts.title) {
      m.font = titleFont;
      titleW = Math.ceil(m.measureText(opts.title).width);
    }
    if (levelText) {
      m.font = `${titleSize}px ${FONT_FAMILY}`;
      levelW = Math.ceil(m.measureText(levelText).width) + 4 * mult;
    }
  }
  const nameRowW = nameW + (levelW ? levelW + 3 * mult : 0);
  const w = Math.max(nameRowW, titleW) + pad * 2 + 2;
  const nameH = nameSize + pad * 2;
  const titleH = opts.title ? titleSize + 2 * mult : 0;
  const h = nameH + titleH + 2;
  const surface = createSurface(w, h);
  const ctx = surface.getContext("2d");
  if (!ctx) return surface;
  ctx.textBaseline = "top";
  // Backing: a dark rounded band behind the name row only.
  const by = titleH;
  ctx.fillStyle = "rgba(16, 12, 16, 0.55)";
  const bx = Math.floor((w - nameRowW) / 2) - pad;
  const bw = nameRowW + pad * 2;
  ctx.fillRect(bx + mult, by, bw - 2 * mult, nameH);
  ctx.fillRect(bx, by + mult, bw, nameH - 2 * mult);
  const outlined = (s: string, x: number, y: number, color: string) => {
    ctx.fillStyle = OUTLINE;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      ctx.fillText(s, x + dx * mult, y + dy * mult);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };
  let x = bx + pad;
  if (levelW) {
    // Level badge.
    ctx.fillStyle = "#2b5a8c";
    ctx.fillRect(x, by + pad, levelW, nameSize);
    ctx.fillStyle = "#e2b23a";
    ctx.fillRect(x, by + pad + nameSize - mult, levelW, mult);
    ctx.font = `${titleSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = "#f3ecdc";
    ctx.fillText(levelText, x + 2 * mult, by + pad + Math.round((nameSize - titleSize) / 2));
    x += levelW + 3 * mult;
  }
  ctx.font = nameFont;
  outlined(text, x, by + pad, opts.color);
  if (opts.title) {
    ctx.font = titleFont;
    outlined(opts.title, Math.floor((w - titleW) / 2), 0, "#e2b23a");
  }
  return surface;
}

/**
 * Name plate centred above (x, y) — pass the point just over the head
 * (ground y − characterHeight). Text is drawn at integer device pixels.
 */
export function drawNamePlate(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: NamePlateOptions,
): void {
  const d = deviceScale(ctx);
  const mult =
    opts.pixelRatio !== undefined ? Math.max(1, Math.round(opts.pixelRatio)) : d.s >= 5 ? 2 : 1;
  const small = !!opts.small;
  let list = plates.get(text);
  let plate: Surface | undefined;
  if (list)
    for (const p of list)
      if (p.mult === mult && p.small === small && p.color === opts.color && p.level === opts.level && p.title === opts.title) {
        plate = p.surface;
        break;
      }
  if (!plate) {
    plate = buildPlate(text, opts, mult);
    if (!list) {
      if (plates.size >= PLATE_CACHE_MAX) {
        const first = plates.keys().next().value;
        if (first !== undefined) plates.delete(first);
      }
      list = [];
      plates.set(text, list);
    }
    if (list.length >= 8) list.shift();
    list.push({ mult, small, color: opts.color, level: opts.level, title: opts.title, surface: plate });
  }
  const dx = Math.round(d.m.a * x + d.m.c * y + d.x - plate.width / 2);
  const dy = Math.round(d.m.b * x + d.m.d * y + d.y - plate.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(plate, dx, dy);
  ctx.restore();
}

// ---------------------------------------------------------------- HP bar --

export interface HpBarOptions {
  width?: number;
  color?: string;
}

/** HP bar centred on x with its top at y (world px). */
export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ratio: number,
  opts?: HpBarOptions,
): void {
  const w = Math.max(6, Math.round(opts?.width ?? 16));
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const left = Math.round(x - w / 2);
  const top = Math.round(y);
  const color = opts?.color ?? (r > 0.5 ? "#6fcf5a" : r > 0.25 ? "#e8c040" : "#e0503a");
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(left - 1, top - 1, w + 2, 4);
  ctx.fillStyle = "#3a2228";
  ctx.fillRect(left, top, w, 2);
  const fill = r > 0 ? Math.max(1, Math.round(w * r)) : 0;
  if (fill) {
    ctx.fillStyle = color;
    ctx.fillRect(left, top, fill, 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(left, top, fill, 1);
  }
}

// ---------------------------------------------------------------- emotes --

export type EmoteKind = "talk" | "quest" | "questDone" | "alert" | "zzz" | "heart" | "anger";

const EMOTE_ART: Record<EmoteKind, { rows: readonly string[]; pal: Record<string, string>; bubble: boolean }> = {
  talk: {
    rows: ["#.#.#"],
    pal: { "#": "#3a3434" },
    bubble: true,
  },
  quest: {
    rows: [".YY.", "YyyY", "YyyY", "YyyY", ".YY.", ".YY.", "....", ".YY.", ".YY."],
    pal: { Y: "#e2b23a", y: "#ffe27a" },
    bubble: false,
  },
  questDone: {
    rows: [".YYYY.", "YyyyyY", "Y...YY", "...YY.", "..YY..", "..YY..", "......", "..YY..", "..YY.."],
    pal: { Y: "#e2b23a", y: "#ffe27a" },
    bubble: false,
  },
  alert: {
    rows: ["R", "R", "R", ".", "R"],
    pal: { R: "#d83a2a" },
    bubble: true,
  },
  zzz: {
    rows: ["ZZZ", "..Z", ".Z.", "Z..", "ZZZ"],
    pal: { Z: "#9fc4e8" },
    bubble: false,
  },
  heart: {
    rows: [".RR.RR.", "RrRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."],
    pal: { R: "#e0405a", r: "#ffb0c0" },
    bubble: false,
  },
  anger: {
    rows: ["RR.RR", "R...R", ".....", "R...R", "RR.RR"],
    pal: { R: "#e0302a" },
    bubble: false,
  },
};

const emoteCache = new SurfaceCache();

function emoteSurface(kind: EmoteKind): Surface {
  return emoteCache.get(kind, () => {
    const art = EMOTE_ART[kind];
    const iw = Math.max(...art.rows.map((r) => r.length));
    const ih = art.rows.length;
    const bw = art.bubble ? Math.max(iw + 4, 9) : iw;
    const bh = art.bubble ? ih + 4 : ih;
    const g = new PixGrid(bw + 2, bh + (art.bubble ? 3 : 0) + 2);
    g.ox = 1;
    g.oy = 1;
    const pal: Record<string, number> = {};
    for (const [k, v] of Object.entries(art.pal)) pal[k] = px(v);
    if (art.bubble) {
      const W = px("#fbf8ee");
      const S = px("#d8d0bc");
      g.rect(1, 0, bw - 2, bh, W);
      g.rect(0, 1, bw, bh - 2, W);
      g.hline(1, bw - 2, bh - 1, S);
      // Tail.
      g.rect(2, bh, 2, 1, W);
      g.set(2, bh + 1, W);
      g.stamp(art.rows, pal, Math.floor((bw - iw) / 2), 2);
    } else g.stamp(art.rows, pal, 0, 0);
    g.ox = 0;
    g.oy = 0;
    g.outline(OUTLINE, 0);
    return g.toSurface();
  });
}

/** Emote icon whose bottom-centre sits at (x, y) — usually just over the head. */
export function drawEmote(
  ctx: CanvasRenderingContext2D,
  kind: EmoteKind,
  x: number,
  y: number,
  timeMs: number,
): void {
  const s = emoteSurface(kind);
  let bob = Math.round(Math.sin(timeMs / 260) * 1.2);
  let alpha = 1;
  let ox = 0;
  if (kind === "quest" || kind === "questDone") bob = Math.round(Math.abs(Math.sin(timeMs / 300)) * -3);
  if (kind === "zzz") {
    const k = (timeMs % 1800) / 1800;
    bob = -Math.round(k * 6);
    ox = Math.round(Math.sin(k * Math.PI * 2) * 2);
    alpha = k > 0.7 ? (1 - k) / 0.3 : 1;
  }
  if (kind === "anger" && Math.floor(timeMs / 220) % 2 === 1) bob -= 1;
  const prev = ctx.globalAlpha;
  if (kind === "quest" || kind === "questDone") {
    // Soft pulsing halo so the marker reads on bright ground.
    const cx = Math.round(x);
    const cy = Math.round(y - s.height / 2) + bob;
    ctx.globalAlpha = prev * (0.22 + 0.12 * Math.sin(timeMs / 200));
    ctx.fillStyle = "#fff2a8";
    for (let dy = -6; dy <= 6; dy++) {
      const half = Math.round(Math.sqrt(36 - dy * dy) * 0.8);
      ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(s, Math.round(x - s.width / 2) + ox, Math.round(y - s.height) + bob);
  ctx.globalAlpha = prev;
}

// --------------------------------------------------------- selection ring --

/** Animated ring around a ground point (dashes march around the ellipse). */
export function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  timeMs: number,
): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const pulse = Math.sin(timeMs / 240);
  const rx = 10 + (pulse > 0.6 ? 1 : 0);
  const ry = 5;
  const n = 40;
  const shift = Math.floor(timeMs / 90) % 4;
  const prev = ctx.globalAlpha;
  ctx.fillStyle = OUTLINE;
  ctx.globalAlpha = prev * 0.5;
  for (let i = 0; i < n; i++) {
    if ((i + shift) % 4 === 3) continue;
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry) + 1, 1, 1);
  }
  ctx.globalAlpha = prev;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    if ((i + shift) % 4 === 3) continue;
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
  }
}
