// 연대기: the personal chronicle as a timeline, plus this era's history notes.
import type { ChapterView, ChronicleEntry } from "../../../shared/types.ts";
import { h } from "../dom.ts";

export function chronicleList(entries: readonly ChronicleEntry[], cls = ""): HTMLElement {
  if (!entries.length) return h("p", { class: "muted" }, "아직 기록된 일이 없다.");
  return h(
    "ol",
    { class: `chron ${cls}` },
    ...entries.map((e) =>
      h("li", { class: `chron-item tone-${e.tone ?? "info"}` },
        h("span", { class: "chron-year" }, String(e.year)),
        h("span", { class: "chron-text" }, e.text))),
  );
}

/** History-note lines; "[해석]" marks interpretation, distinguished visually. */
export function historyNotes(lines: readonly string[]): HTMLElement {
  return h(
    "ul",
    { class: "history-notes" },
    ...lines.map((line) => {
      const interp = line.startsWith("[해석]");
      return h("li", { class: interp ? "interp" : "fact" },
        h("span", { class: "hn-tag" }, interp ? "해석" : "사실"),
        interp ? line.replace(/^\[해석\]\s*/, "") : line);
    }),
  );
}

export function chronicleTab(entries: readonly ChronicleEntry[], chapter: ChapterView | null): HTMLElement {
  return h(
    "div",
    { class: "tab-chronicle" },
    h("section", null, h("h3", { class: "sub-title" }, "나의 실록"), chronicleList(entries)),
    chapter && chapter.history.length
      ? h("section", { class: "chron-history" },
          h("h3", { class: "sub-title" }, `실제 역사 노트 · ${chapter.title}`),
          historyNotes(chapter.history))
      : null,
  );
}
