// 지도: the whole peninsula for the current era with site names, objective
// markers and post stations; with a 마패 the stations offer fast travel.
import { siteAt, type GameMap } from "../../../shared/map/generate.ts";
import type { PlayerAction } from "../../../shared/protocol.ts";
import { josa } from "../../../shared/rules/index.ts";
import type { SelfView } from "../../../shared/types.ts";
import { drawMinimapMarker } from "../../render/minimap.ts";
import { button, h } from "../dom.ts";
import { minimapFor } from "../hud-map.ts";

const PPT = 2;
const LABELLED = new Set(["capital", "city", "fortress", "port", "battlefield", "frontier"]);

/** Where a name may sit around its point (CSS: [data-place]; none = the element's own default). */
type Place = "above" | "below" | "right" | "left";
type Rect = readonly [number, number, number, number];
/** Site names sit above their point by default, objective tags below it. */
const LABEL_PLACES: readonly Place[] = ["above", "below", "right", "left"];
const OBJECTIVE_PLACES: readonly Place[] = ["below", "above", "right", "left"];

/** A name's box (board px) for its point (x, y), size w × h and place; mirrors the CSS transforms. */
function nameRect(place: Place, objective: boolean, x: number, y: number, w: number, h: number): Rect {
  switch (place) {
    case "above":
      return [x - w / 2, y - 1.35 * h, x + w / 2, y - 0.35 * h];
    case "below": {
      const top = objective ? 0.45 : 0.35;
      return [x - w / 2, y + top * h, x + w / 2, y + (1 + top) * h];
    }
    case "right":
      return [x + 6, y - h / 2, x + 6 + w, y + h / 2];
    case "left":
      return [x - 6 - w, y - h / 2, x - 6, y + h / 2];
  }
}

const NAME_RANK = (el: HTMLElement): number =>
  el.classList.contains("bm-obj") ? 0 : el.classList.contains("kind-capital") ? 1 : el.classList.contains("kind-city") ? 2 : 3;

/**
 * Declutters the board's names for its current size: objective tags first,
 * then the capital, cities and the rest, each takes the first of its places
 * that overlaps nothing placed. A site name with no free place is hidden (the
 * zoomed map has room for it); an objective tag always shows.
 */
function declutterNames(board: HTMLElement): void {
  const width = board.clientWidth;
  const height = board.clientHeight;
  if (!width || !height) return;
  const placed: Rect[] = [];
  const free = (r: Rect) => !placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
  const items = [...board.querySelectorAll<HTMLElement>(".bm-obj, .bm-label")].sort((a, b) => NAME_RANK(a) - NAME_RANK(b));
  for (const el of items) {
    el.classList.remove("bm-hide");
    delete el.dataset.place;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) continue; // hidden by the unzoomed map
    const x = (parseFloat(el.style.left) / 100) * width;
    const y = (parseFloat(el.style.top) / 100) * height;
    const objective = el.classList.contains("bm-obj");
    const places = objective ? OBJECTIVE_PLACES : LABEL_PLACES;
    const place = places.find((p) => free(nameRect(p, objective, x, y, w, h)));
    if (!place && !objective) {
      el.classList.add("bm-hide");
      continue;
    }
    const at = place ?? (places[0] as Place);
    if (at !== places[0]) el.dataset.place = at;
    placed.push(nameRect(at, objective, x, y, w, h));
  }
}

export function mapTab(
  map: GameMap,
  self: SelfView,
  pos: { x: number; y: number } | null,
  act: (a: PlayerAction) => void,
): HTMLElement {
  const year = self.year;
  const src = minimapFor(map, year, PPT);
  const canvas = h("canvas", { class: "bigmap-canvas", width: String(src.width), height: String(src.height), "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");
  const hasMapae = self.inventory.some((i) => i.id === "mapae" && i.count > 0);
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    for (const o of self.objectives)
      if (!o.done && o.x !== undefined && o.y !== undefined) drawMinimapMarker(ctx, o.x * PPT, o.y * PPT, "quest", { size: 3, timeMs: 0 });
    if (pos) drawMinimapMarker(ctx, pos.x * PPT, pos.y * PPT, "self", { size: 3, timeMs: 0 });
  }
  const pctX = (x: number) => `${((x + 0.5) / map.width) * 100}%`;
  const pctY = (y: number) => `${((y + 0.5) / map.height) * 100}%`;
  const labels = map.sites
    .filter((site) => LABELLED.has(siteAt(site, year).kind) || site.station)
    .map((site) => {
      const era = siteAt(site, year);
      return h("span", {
        class: `bm-label kind-${era.kind}${site.station ? " station" : ""}`,
        style: `left:${pctX(site.x)};top:${pctY(site.y)}`,
        title: site.hanja ? `${era.name} ${site.hanja}` : era.name,
      }, era.name);
    });
  const objectiveTags = self.objectives
    .filter((o) => !o.done && o.x !== undefined && o.y !== undefined)
    .map((o) => h("span", { class: "bm-obj", style: `left:${pctX(o.x ?? 0)};top:${pctY(o.y ?? 0)}` }, o.siteName ?? "목표"));
  const board = h("div", { class: "bigmap" }, canvas, ...labels, ...objectiveTags);
  // Names are placed for the board's size: on mount, on resize and on zoom.
  new ResizeObserver(() => declutterNames(board)).observe(board);
  const wrap = h("div", { class: "bigmap-wrap" }, board);

  const stations = map.sites
    .filter((s) => s.station)
    .map((s) => ({ s, d: pos ? Math.hypot(s.x - pos.x, s.y - pos.y) : 0 }))
    .sort((a, b) => a.d - b.d);
  const side = h(
    "aside",
    { class: "bigmap-side" },
    h("h3", { class: "sub-title" }, `${year}년의 강토`),
    h("p", { class: "muted bm-note" }, "확대하면 모든 고을의 이름이 보인다."),
    h("h3", { class: "sub-title" }, "목표"),
    h("ul", { class: "bm-objs" },
      ...self.objectives.filter((o) => !o.done).map((o) => h("li", null, h("span", { class: "obj-dia", "aria-hidden": "true" }, "◆"), o.text, o.siteName ? h("small", null, ` · ${o.siteName}`) : null))),
    h("h3", { class: "sub-title" }, "역참"),
    hasMapae
      ? h("p", { class: "muted" }, "마패가 있다. 역참 사이를 말로 빠르게 오갈 수 있다.")
      : h("p", { class: "muted" }, "마패가 있으면 역참 사이를 말로 빠르게 오갈 수 있다."),
    h("ul", { class: "station-list" },
      ...stations.map(({ s, d }) =>
        h("li", null,
          h("span", null, siteAt(s, year).name, d <= 3 && pos ? h("small", null, " · 지금 여기") : null),
          hasMapae && d > 3
            ? button("이동", () => act({ kind: "travel", site: s.id }), { class: "btn btn-small", "aria-label": `${josa(siteAt(s, year).name, "으로/로")} 이동` })
            : null))),
    h("p", { class: "bm-legend" },
      h("span", { class: "lg-self" }, "나"), h("span", { class: "lg-obj" }, "목표"), h("span", { class: "lg-station" }, "역참")),
  );
  const zoom = button("확대", () => {
    const on = !board.classList.contains("zoom");
    board.classList.toggle("zoom", on);
    zoom.textContent = on ? "전체 보기" : "확대";
    if (on && pos)
      requestAnimationFrame(() => {
        wrap.scrollLeft = (pos.x / map.width) * board.clientWidth - wrap.clientWidth / 2;
        wrap.scrollTop = (pos.y / map.height) * board.clientHeight - wrap.clientHeight / 2;
      });
  }, { class: "btn btn-small bm-zoom" });
  return h("div", { class: "tab-map" }, h("div", { class: "bigmap-col" }, wrap, zoom), side);
}
