// 지도: the whole peninsula for the current era with site names, objective
// markers and post stations; with a 마패 the stations offer fast travel.
import { siteAt, type GameMap } from "../../../shared/map/generate.ts";
import type { PlayerAction } from "../../../shared/protocol.ts";
import type { SelfView } from "../../../shared/types.ts";
import { drawMinimapMarker } from "../../render/minimap.ts";
import { button, h } from "../dom.ts";
import { minimapFor } from "../hud-map.ts";

const PPT = 2;
const LABELLED = new Set(["capital", "city", "fortress", "port", "battlefield", "frontier"]);

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
  const wrap = h("div", { class: "bigmap-wrap" }, board);

  const stations = map.sites
    .filter((s) => s.station)
    .map((s) => ({ s, d: pos ? Math.hypot(s.x - pos.x, s.y - pos.y) : 0 }))
    .sort((a, b) => a.d - b.d);
  const side = h(
    "aside",
    { class: "bigmap-side" },
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
            ? button("이동", () => act({ kind: "travel", site: s.id }), { class: "btn btn-small", "aria-label": `${siteAt(s, year).name}(으)로 이동` })
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
