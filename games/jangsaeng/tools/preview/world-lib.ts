// Shared helpers for world-render preview entries (contact sheets, close-ups,
// benchmarks). Renders camera views of the generated map into sub-rectangles
// of the preview canvas, exactly as the game frame loop would.
import { generateMap, type GameMap } from "../../src/shared/map/generate.ts";
import { TILE_PX } from "../../src/shared/sprites.ts";
import { drawAtmosphere, type AtmosphereOptions } from "../../src/client/render/lighting.ts";
import type { Camera, Drawable } from "../../src/client/render/types.ts";
import { WorldRenderer, applyCamera, type Season } from "../../src/client/render/world.ts";

export interface View {
  label: string;
  /** Site id to centre on, or explicit tile coordinates. */
  site?: string;
  tx?: number;
  ty?: number;
  /** Tile offset from the site centre. */
  dx?: number;
  dy?: number;
  scale: number;
  season: Season;
  year: number;
  atmosphere?: Omit<AtmosphereOptions, "timeMs">;
  /** Draw stand-in characters to judge legibility. */
  figures?: boolean;
}

let cachedMap: GameMap | null = null;
export const worldMap = (): GameMap => (cachedMap ??= generateMap("jangsaeng"));

export function viewCentre(map: GameMap, view: View): { x: number; y: number } {
  let tx = view.tx ?? 0;
  let ty = view.ty ?? 0;
  if (view.site) {
    const site = map.sites.find((s) => s.id === view.site);
    if (!site) throw new Error(`unknown site ${view.site}`);
    tx = site.x;
    ty = site.y;
  }
  tx += view.dx ?? 0;
  ty += view.dy ?? 0;
  return { x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 };
}

/** Simple 16×24 stand-in figures (hero, soldier) to judge contrast. */
function figure(x: number, y: number, body: string, hat: string): Drawable {
  return {
    sortY: y,
    draw(ctx) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x - 5, y - 2, 10, 3);
      ctx.fillStyle = "#1d1a19";
      ctx.fillRect(x - 5, y - 20, 10, 19);
      ctx.fillStyle = body;
      ctx.fillRect(x - 4, y - 12, 8, 10);
      ctx.fillStyle = "#f0c8a0";
      ctx.fillRect(x - 3, y - 19, 6, 6);
      ctx.fillStyle = hat;
      ctx.fillRect(x - 4, y - 21, 8, 3);
      ctx.fillRect(x - 6, y - 18, 12, 1);
    },
  };
}

export function renderView(
  ctx: CanvasRenderingContext2D,
  renderer: WorldRenderer,
  view: View,
  rect: { x: number; y: number; w: number; h: number },
  timeMs: number,
): { groundMs: number; structuresMs: number; drawn: number } {
  const map = renderer.map;
  renderer.setSeason(view.season);
  renderer.setYear(view.year);
  const centre = viewCentre(map, view);
  const camera: Camera = { x: centre.x, y: centre.y, scale: view.scale, width: rect.w, height: rect.h };
  // Each cell is its own "game canvas" so screen-space passes behave as in the game.
  const cell = document.createElement("canvas");
  cell.width = rect.w;
  cell.height = rect.h;
  const c = cell.getContext("2d");
  if (!c) throw new Error("no 2d context");
  c.fillStyle = "#111";
  c.fillRect(0, 0, rect.w, rect.h);
  renderer.warm(camera);
  const t0 = performance.now();
  applyCamera(c, camera);
  renderer.drawGround(c, camera, timeMs);
  const t1 = performance.now();
  const drawables = renderer.structureDrawables(camera, timeMs);
  if (view.figures) {
    drawables.push(figure(centre.x - 20, centre.y + 30, "#2b5a8c", "#1d1a19"));
    drawables.push(figure(centre.x + 24, centre.y + 26, "#b8312f", "#3a2a1a"));
  }
  drawables.sort((a, b) => a.sortY - b.sortY);
  for (const d of drawables) d.draw(c, timeMs);
  const t2 = performance.now();
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (view.atmosphere) drawAtmosphere(c, rect.w, rect.h, { ...view.atmosphere, timeMs });
  ctx.drawImage(cell, rect.x, rect.y);
  return { groundMs: t1 - t0, structuresMs: t2 - t1, drawn: drawables.length };
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  const w = ctx.measureText(text).width;
  ctx.fillRect(x, y, w + 10, 19);
  ctx.fillStyle = "#f3ecdc";
  ctx.fillText(text, x + 5, y + 14);
  ctx.restore();
}

export function previewCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.getElementById("preview") as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  return ctx;
}

export interface SidePanel {
  width: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): void;
}

export function renderSheet(
  views: readonly View[],
  columns: number,
  cellW: number,
  cellH: number,
  opts: { timeMs?: number; side?: SidePanel } = {},
): void {
  const timeMs = opts.timeMs ?? 1200;
  const rows = Math.ceil(views.length / columns);
  const gap = 4;
  const gridW = columns * (cellW + gap) - gap;
  const gridH = rows * (cellH + gap) - gap;
  const ctx = previewCanvas(gridW + (opts.side ? opts.side.width + gap : 0), gridH);
  if (opts.side) opts.side.draw(ctx, gridW + gap, 0, gridH);
  const renderer = new WorldRenderer(worldMap());
  views.forEach((view, k) => {
    const x = (k % columns) * (cellW + gap);
    const y = Math.floor(k / columns) * (cellH + gap);
    const result = renderView(ctx, renderer, view, { x, y, w: cellW, h: cellH }, timeMs);
    label(ctx, `${view.label} · ${view.year} · ${view.season} · ×${view.scale}`, x + 6, y + 6);
    console.log(`${view.label}: ground ${result.groundMs.toFixed(2)}ms, structures ${result.structuresMs.toFixed(2)}ms (${result.drawn})`);
  });
  const s = renderer.stats;
  console.log(`chunks built ${s.totalBuilt}, cached ${s.cachedChunks}`);
}
