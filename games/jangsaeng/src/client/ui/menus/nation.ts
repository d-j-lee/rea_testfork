// 국운: radar of the five nation values, infiltration (from CH14), branch
// checklist B1–B12c (unknown stays 미정), court factions and the world event.
import { BRANCH_IDS, NATION_NAMES, type BranchId } from "../../../shared/content/schema.ts";
import { BRANCH_LABELS } from "../../../shared/rules/index.ts";
import type { SelfView } from "../../../shared/types.ts";
import { radarChart } from "../charts.ts";
import { h, meter, ratio, setMeter } from "../dom.ts";

export function branchList(get: (id: BranchId) => { label: string; ok: boolean | null }): HTMLElement {
  return h(
    "ol",
    { class: "branch-list" },
    ...BRANCH_IDS.map((id) => {
      const b = get(id);
      const state = b.ok === true ? "ok" : b.ok === false ? "fail" : "open";
      return h("li", { class: `branch ${state}` },
        h("span", { class: "br-id" }, id),
        h("span", { class: "br-label" }, b.label),
        h("span", { class: "br-state" }, state === "ok" ? "성공" : state === "fail" ? "실패" : "미정"));
    }),
  );
}

export function infiltrationBar(value: number): HTMLElement {
  const m = meter("meter-infil");
  setMeter(m, ratio(value, 100));
  m.text.textContent = String(Math.round(value));
  return h("div", { class: "infil" }, h("span", { class: "st-k" }, NATION_NAMES.infiltration), m.root,
    h("small", { class: "muted" }, "외세의 침투. 실패한 분기마다 오르고, 100이면 역사의 길이다."));
}

export function nationTab(self: SelfView): HTMLElement {
  const factions = self.factions.length
    ? h("ul", { class: "faction-list" },
        ...self.factions.map((f) => {
          const power = meter("meter-power");
          setMeter(power, ratio(f.power, 100));
          return h("li", { class: `faction${f.ruling ? " ruling" : ""}${f.aligned ? " aligned" : ""}` },
            h("span", { class: "fc-name" }, f.name,
              f.ruling ? h("span", { class: "tag tag-ruling" }, "집권") : null,
              f.aligned ? h("span", { class: "tag tag-on" }, "소속") : null),
            h("span", { class: "fc-power" }, h("small", null, "권세"), power.root),
            h("span", { class: `fc-favor${f.favor < 0 ? " neg" : ""}` }, h("small", null, "총애"), h("b", null, f.favor > 0 ? `+${f.favor}` : String(f.favor))),
            f.desc ? h("small", { class: "fc-desc" }, f.desc) : null);
        }))
    : h("p", { class: "muted" }, "이 시대의 조정 판도는 아직 드러나지 않았다.");
  const we = self.worldEvent;
  let world: HTMLElement | null = null;
  if (we) {
    const m = meter("meter-world");
    setMeter(m, ratio(we.progress, 100));
    m.text.textContent = `${Math.round(we.progress)}%`;
    world = h("section", { class: "world-event" },
      h("h3", { class: "sub-title" }, "공동 실록"),
      h("p", null, h("strong", null, we.title), " — ", we.desc), m.root);
  }
  return h(
    "div",
    { class: "tab-nation" },
    h("section", { class: "nation-chart" },
      h("h3", { class: "sub-title" }, "국운"),
      radarChart(self.nation),
      self.showInfiltration ? infiltrationBar(self.nation.infiltration ?? 0) : null,
      h("h3", { class: "sub-title" }, "조정"),
      factions,
      world),
    h("section", { class: "nation-side" },
      h("h3", { class: "sub-title" }, "역사의 분기점"),
      branchList((id) => ({ label: BRANCH_LABELS[id], ok: self.branches[id] ?? null }))),
  );
}
