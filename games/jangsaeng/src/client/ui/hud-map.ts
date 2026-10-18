// Round minimap (cached renderMinimap per year), region line, mode badge and
// the menu shortcut buttons. Off-screen objectives get a rim arrow.
import { PROVINCE_LIST, siteAt, type GameMap } from "../../shared/map/generate.ts";
import { PROVINCE_NAMES } from "../../shared/map/geo.ts";
import type { EntitySnap, ObjectiveView } from "../../shared/types.ts";
import type { UiCommand } from "../input.ts";
import { drawMinimapMarker, renderMinimap, type MinimapMarkerKind } from "../render/minimap.ts";
import { h, setText } from "./dom.ts";

const SRC_PPT = 2;
const VIEW_TILES = 44;

interface MapCache {
  year: number;
  ppt: number;
  canvas: HTMLCanvasElement;
}

const caches: MapCache[] = [];

/** Minimap surface for an era; at most two years are kept. */
export function minimapFor(map: GameMap, year: number, ppt = SRC_PPT): HTMLCanvasElement {
  const hit = caches.find((c) => c.year === year && c.ppt === ppt);
  if (hit) return hit.canvas;
  const canvas = renderMinimap(map, year, ppt);
  caches.unshift({ year, ppt, canvas });
  if (caches.length > 2) caches.length = 2;
  return canvas;
}

/** "경기 · 개경 인근" — province of a tile plus the nearest site. */
export function regionName(map: GameMap, year: number, x: number, y: number): string {
  const tx = Math.max(0, Math.min(map.width - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(map.height - 1, Math.floor(y)));
  const province = PROVINCE_LIST[map.province[ty * map.width + tx] ?? 0] ?? "gyeonggi";
  let best: { d: number; name: string } | null = null;
  for (const site of map.sites) {
    const d = Math.hypot(site.x - x, site.y - y);
    if (d < 14 && (!best || d < best.d)) best = { d, name: siteAt(site, year).name };
  }
  const p = PROVINCE_NAMES[province];
  if (!best) return p;
  return best.d < 4 ? `${p} · ${best.name}` : `${p} · ${best.name} 인근`;
}

const MENU_BUTTONS: readonly { cmd: UiCommand; glyph: string; label: string; key: string; opt?: boolean }[] = [
  { cmd: "map", glyph: "圖", label: "지도", key: "M" },
  { cmd: "character", glyph: "人", label: "인물", key: "C" },
  { cmd: "inventory", glyph: "囊", label: "소지품", key: "I", opt: true },
  { cmd: "nation", glyph: "國", label: "국운", key: "N" },
  { cmd: "chronicle", glyph: "史", label: "연대기", key: "T", opt: true },
  { cmd: "menu", glyph: "≡", label: "메뉴", key: "Esc" },
];

export class MapPanel {
  readonly el: HTMLElement;
  readonly #canvas = h("canvas", { class: "mm-canvas", "aria-hidden": "true" });
  readonly #region = h("span", { class: "mm-region" });
  readonly #mode = h("span", { class: "mm-mode" });
  readonly #map: GameMap;
  #year = 0;
  #lastDraw = 0;
  #objectives: readonly ObjectiveView[] = [];

  constructor(map: GameMap, onCommand: (cmd: UiCommand) => void) {
    this.#map = map;
    const buttons = MENU_BUTTONS.map((b) =>
      h(
        "button",
        {
          type: "button",
          class: `hud-btn${b.opt ? " opt" : ""}`,
          "aria-label": `${b.label} (${b.key})`,
          title: `${b.label} · ${b.key}`,
          "data-cmd": b.cmd,
          onclick: () => onCommand(b.cmd),
        },
        h("span", { class: "hud-btn-glyph", "aria-hidden": "true" }, b.glyph),
        h("span", { class: "hud-btn-label" }, b.label),
      ),
    );
    this.el = h(
      "section",
      { class: "hud-map", "aria-label": "소지도" },
      h("button", { type: "button", class: "mm-frame", "aria-label": "큰 지도 열기 (M)", onclick: () => onCommand("map") },
        this.#canvas, h("span", { class: "mm-north", "aria-hidden": "true" }, "北")),
      h("p", { class: "mm-meta" }, this.#region, this.#mode),
      h("nav", { class: "hud-buttons", "aria-label": "메뉴" }, ...buttons),
    );
  }

  setMode(text: string): void {
    setText(this.#mode, text);
  }

  setYear(year: number): void {
    this.#year = year;
  }

  setObjectives(list: readonly ObjectiveView[]): void {
    this.#objectives = list;
  }

  draw(self: { x: number; y: number } | null, ents: readonly EntitySnap[], selfId: number, now: number): void {
    if (now - this.#lastDraw < 90 || !this.#year) return;
    this.#lastDraw = now;
    const css = this.#canvas.clientWidth || 160;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(css * dpr);
    if (this.#canvas.width !== size) {
      this.#canvas.width = size;
      this.#canvas.height = size;
    }
    const ctx = this.#canvas.getContext("2d");
    if (!ctx) return;
    const src = minimapFor(this.#map, this.#year);
    const cx = self?.x ?? this.#map.width / 2;
    const cy = self?.y ?? this.#map.height / 2;
    const scale = size / VIEW_TILES;
    const x0 = cx - VIEW_TILES / 2;
    const y0 = cy - VIEW_TILES / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1d4570";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(src, x0 * SRC_PPT, y0 * SRC_PPT, VIEW_TILES * SRC_PPT, VIEW_TILES * SRC_PPT, 0, 0, size, size);
    const toPx = (tx: number, ty: number) => ({ x: (tx - x0) * scale, y: (ty - y0) * scale });
    const dot = Math.max(1, Math.round(1.6 * dpr));
    for (const e of ents) {
      if (e.id === selfId || e.k === "prop") continue;
      if (e.tm === "npc" && !e.mk && !e.hist) continue;
      const p = toPx(e.x, e.y);
      if (p.x < 0 || p.y < 0 || p.x > size || p.y > size) continue;
      const kind: MinimapMarkerKind = e.tm === "self" ? "player" : e.tm;
      drawMinimapMarker(ctx, p.x, p.y, kind, { size: e.tm === "boss" ? dot + 1 : dot });
    }
    const r = size / 2;
    for (const o of this.#objectives) {
      if (o.done || o.x === undefined || o.y === undefined) continue;
      const p = toPx(o.x, o.y);
      const dx = p.x - r;
      const dy = p.y - r;
      const dist = Math.hypot(dx, dy);
      if (dist < r - 8 * dpr) {
        drawMinimapMarker(ctx, p.x, p.y, "quest", { timeMs: now, size: Math.round(2 * dpr) });
      } else {
        const a = Math.atan2(dy, dx);
        const ex = r + Math.cos(a) * (r - 7 * dpr);
        const ey = r + Math.sin(a) * (r - 7 * dpr);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(a);
        ctx.fillStyle = "#ffd65a";
        ctx.strokeStyle = "#1d1a19";
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.moveTo(5 * dpr, 0);
        ctx.lineTo(-4 * dpr, -4.5 * dpr);
        ctx.lineTo(-2 * dpr, 0);
        ctx.lineTo(-4 * dpr, 4.5 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    if (self) {
      const p = toPx(self.x, self.y);
      drawMinimapMarker(ctx, p.x, p.y, "self", { timeMs: now, size: Math.round(2 * dpr) });
      setText(this.#region, regionName(this.#map, this.#year, self.x, self.y));
    }
  }
}
