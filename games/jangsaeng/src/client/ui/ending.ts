// Ending: nation and personal endings, score breakdown, radar, branch
// checklist, life graph, identities, record and the real-history note.
import type { EndingView } from "../../shared/types.ts";
import { FINAL_YEAR } from "../../shared/types.ts";
import { lifeGraph, radarChart } from "./charts.ts";
import { button, h } from "./dom.ts";
import { identityTimeline } from "./menus/character.ts";
import { chronicleList, historyNotes } from "./menus/chronicle.ts";
import { branchList, infiltrationBar } from "./menus/nation.ts";
import { seal } from "./panel.ts";
import { DISCLAIMER } from "./title.ts";

const RECORD_LABELS: readonly [keyof EndingView["record"], string][] = [
  ["kills", "물리친 적"],
  ["bossKills", "쓰러뜨린 적장"],
  ["revivesGiven", "일으켜 세운 동료"],
  ["selfRevives", "자력 소생"],
  ["purgesSurvived", "넘긴 숙청"],
  ["washes", "바꾼 신분"],
  ["lifeGained", "얻은 천수"],
  ["lifeSpent", "쓴 천수"],
  ["turncoat", "변절"],
];

function restart(hash: "#new" | "#demo"): void {
  window.location.hash = hash;
  window.location.reload();
}

/** One decimal with a true minus sign: the host settles every row and the score to 0.1. */
function tenth(value: number, plus = false): string {
  const sign = value < 0 ? "−" : plus && value > 0 ? "+" : "";
  return `${sign}${Math.abs(value).toFixed(1)}`;
}

export function endingScreen(e: EndingView): HTMLElement {
  // The host settles the score as the sum of the rows, all at 0.1, so the rows
  // shown here add up to it; the score is never re-summed on the client.
  const score = tenth(e.score);
  const record = RECORD_LABELS.filter(([k]) => k !== "turncoat" || e.record.turncoat > 0).map(([k, label]) =>
    h("li", null, h("b", null, String(e.record[k])), h("span", null, label)));
  const chron = e.chronicle.length > 14
    ? h("details", { class: "end-chron" }, h("summary", null, `실록 전체 보기 (${e.chronicle.length})`), chronicleList(e.chronicle))
    : chronicleList(e.chronicle);
  return h(
    "div",
    { class: `screen ending-screen nation-${e.nation.id}`, role: "dialog", "aria-modal": "true", "aria-label": "결말" },
    h(
      "article",
      { class: "ending paper" },
      seal("長生", "end-seal", true),
      h("header", { class: "end-head" },
        h("p", { class: "end-kicker" }, `${FINAL_YEAR}년 8월 · 정산`),
        h("h1", { class: "end-title" }, e.nation.title),
        h("div", { class: "end-body" }, ...e.nation.body.map((t) => h("p", null, t)))),
      h("section", { class: "end-personal" },
        h("p", { class: "end-k" }, "장생인의 결말"),
        h("h2", null, e.personal.title),
        ...e.personal.body.map((t) => h("p", null, t))),
      h("section", { class: "end-score" },
        h("div", { class: "score-big" }, h("span", { class: "end-k" }, "국운 판정"), h("b", null, score)),
        h("table", { class: "breakdown" },
          h("caption", { class: "sr-only" }, "판정 내역"),
          h("tbody", null,
            ...e.breakdown.map((b) =>
              h("tr", { class: b.value < 0 ? "neg" : "" }, h("th", { scope: "row" }, b.label), h("td", null, tenth(b.value, true)))),
            h("tr", { class: "sum" }, h("th", { scope: "row" }, "합계"), h("td", null, score))))),
      h("section", { class: "end-grid" },
        h("div", null,
          h("h3", { class: "sub-title" }, "국운"),
          radarChart(e.nationValues),
          infiltrationBar(e.nationValues.infiltration ?? 0)),
        h("div", null,
          h("h3", { class: "sub-title" }, "역사의 분기점"),
          branchList((id) => {
            const b = e.branches.find((x) => x.id === id);
            return { label: b?.label ?? id, ok: b ? b.ok : null };
          }))),
      h("section", null,
        h("h3", { class: "sub-title" }, "천수"),
        lifeGraph(e.lifeline.lifeEnd, e.lifeline.gained, e.lifeline.spent)),
      h("section", { class: "end-grid" },
        h("div", null, h("h3", { class: "sub-title" }, "살아온 이름들"), identityTimeline(e.identities)),
        h("div", null, h("h3", { class: "sub-title" }, "기록"), h("ul", { class: "record-grid" }, ...record))),
      h("section", null, h("h3", { class: "sub-title" }, "나의 실록"), chron),
      e.historyNote.length
        ? h("section", { class: "end-history" }, h("h3", { class: "sub-title" }, "실제 역사 노트"), historyNotes(e.historyNote))
        : null,
      h("footer", { class: "end-foot" },
        h("div", { class: "foot-actions" },
          button("시연 모드", () => restart("#demo"), { class: "btn" }),
          button("처음부터", () => restart("#new"), { class: "btn btn-primary" })),
        h("p", { class: "disclaimer" }, DISCLAIMER)),
    ),
  );
}
