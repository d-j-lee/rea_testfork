// Small SVG charts: nation radar and the lifespan graph.
import { NATION_KEYS, NATION_NAMES, type NationMeter } from "../../shared/content/schema.ts";
import { AWAKENING_YEAR, FINAL_YEAR } from "../../shared/types.ts";
import { h, s } from "./dom.ts";

export function radarChart(values: Partial<Record<NationMeter, number>>, cls = ""): SVGSVGElement {
  const R = 84;
  const n = NATION_KEYS.length;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  };
  const ring = (f: number) => NATION_KEYS.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(",")).join(" ");
  const vals = NATION_KEYS.map((k) => Math.max(0, Math.min(100, values[k] ?? 0)));
  const poly = vals.map((v, i) => pt(i, (R * v) / 100).map((x) => x.toFixed(1)).join(",")).join(" ");
  const label = `국운: ${NATION_KEYS.map((k, i) => `${NATION_NAMES[k]} ${Math.round(vals[i] ?? 0)}`).join(", ")}`;
  return s(
    "svg",
    { class: `radar ${cls}`, viewBox: "-150 -128 300 252", role: "img", "aria-label": label },
    ...[0.25, 0.5, 0.75, 1].map((f) => s("polygon", { class: `rd-ring${f === 1 ? " outer" : ""}`, points: ring(f) })),
    ...NATION_KEYS.map((_, i) => {
      const [x, y] = pt(i, R);
      return s("line", { class: "rd-axis", x1: "0", y1: "0", x2: x.toFixed(1), y2: y.toFixed(1) });
    }),
    s("polygon", { class: "rd-value", points: poly }),
    ...vals.map((v, i) => {
      const [x, y] = pt(i, (R * v) / 100);
      return s("circle", { class: "rd-dot", cx: x.toFixed(1), cy: y.toFixed(1), r: "3.2" });
    }),
    ...NATION_KEYS.map((k, i) => {
      const [x, y] = pt(i, R + 22);
      const anchor = Math.abs(x) < 8 ? "middle" : x > 0 ? "start" : "end";
      return s("text", { class: "rd-label", x: x.toFixed(1), y: (y + 4).toFixed(1), "text-anchor": anchor },
        s("tspan", null, NATION_NAMES[k]),
        s("tspan", { class: "rd-num", dx: "5" }, String(Math.round(vals[i] ?? 0))));
    }),
  );
}

/** Lifespan graph: natural span, years gained and spent, against 1910. */
export function lifeGraph(lifeEnd: number, gained: number, spent: number): HTMLElement {
  const base = lifeEnd - gained + spent;
  const end = Math.max(FINAL_YEAR + 20, lifeEnd + 10, base + gained + 10);
  const W = 640;
  const x = (y: number) => 24 + ((y - AWAKENING_YEAR) / (end - AWAKENING_YEAR)) * (W - 48);
  const row = (y: number, from: number, to: number, cls: string, label: string) =>
    s("g", { class: `lg-row ${cls}` },
      s("rect", { x: x(Math.min(from, to)).toFixed(1), y: String(y), width: Math.max(2, Math.abs(x(to) - x(from))).toFixed(1), height: "14", rx: "2" }),
      s("text", { x: (x(Math.max(from, to)) + 6).toFixed(1), y: String(y + 11) }, label));
  const ticks = [AWAKENING_YEAR, 1392, 1592, 1800, FINAL_YEAR];
  const svg = s(
    "svg",
    { class: "life-graph", viewBox: `0 0 ${W} 132`, role: "img", "aria-label": `천수 그래프: 타고난 천수 ${base}년, 얻은 세월 ${gained}년, 쓴 세월 ${spent}년, 최종 ${lifeEnd}년` },
    s("line", { class: "lg-axis", x1: "24", y1: "100", x2: String(W - 24), y2: "100" }),
    ...ticks.map((t) => s("g", { class: "lg-tick" },
      s("line", { x1: x(t).toFixed(1), y1: "96", x2: x(t).toFixed(1), y2: "104" }),
      s("text", { x: x(t).toFixed(1), y: "122", "text-anchor": "middle" }, String(t)))),
    row(14, AWAKENING_YEAR, base, "lg-base", `타고난 천수 ${base}`),
    row(36, base, base + gained, "lg-gain", `얻은 세월 +${gained}`),
    row(58, base + gained, lifeEnd, "lg-spent", `쓴 세월 −${spent}`),
    s("line", { class: "lg-goal", x1: x(FINAL_YEAR).toFixed(1), y1: "6", x2: x(FINAL_YEAR).toFixed(1), y2: "100" }),
    s("line", { class: `lg-end${lifeEnd < FINAL_YEAR ? " short" : ""}`, x1: x(lifeEnd).toFixed(1), y1: "6", x2: x(lifeEnd).toFixed(1), y2: "100" }),
    s("text", { class: "lg-endlabel", x: x(lifeEnd).toFixed(1), y: "88", "text-anchor": "middle" }, `천수 ${lifeEnd}`),
  );
  return h("figure", { class: "life-figure" }, svg);
}
