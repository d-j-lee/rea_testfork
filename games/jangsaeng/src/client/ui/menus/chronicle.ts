// 연대기: the personal chronicle as a timeline, plus this era's history notes.
import type { HistoryNote, HistoryNoteKind } from "../../../shared/content/schema.ts";
import type { ChapterView, ChronicleEntry } from "../../../shared/types.ts";
import { h } from "../dom.ts";

/** The badge each history-note kind shows. */
const NOTE_LABELS: Readonly<Record<HistoryNoteKind, string>> = {
  fact: "사실",
  interp: "해석",
  uncertain: "불확실",
  fiction: "창작",
  principle: "원칙",
};

export function chronicleList(entries: readonly ChronicleEntry[], cls = ""): HTMLElement {
  if (!entries.length) return h("p", { class: "muted" }, "아직 기록된 일이 없다.");
  return h(
    "ol",
    { class: `chron ${cls}` },
    ...entries.map((e) =>
      h("li", { class: `chron-item tone-${e.tone ?? "info"}${e.alt ? " alt" : ""}` },
        h("span", { class: "chron-year" }, String(e.year)),
        h("span", { class: "chron-text" },
          e.alt ? h("span", { class: "hn-tag chron-alt", title: "게임 속 대체역사" }, "대체역사") : null,
          e.alt ? " " : null,
          e.text))),
  );
}

/** 실제 역사 노트: each line badged by its kind (사실·해석·불확실·창작·원칙). */
export function historyNotes(notes: readonly HistoryNote[]): HTMLElement {
  return h(
    "ul",
    { class: "history-notes" },
    ...notes.map((note) =>
      h("li", { class: `note-${note.kind}${note.kind === "fact" ? " fact" : " interp"}` },
        h("span", { class: "hn-tag" }, NOTE_LABELS[note.kind]),
        note.text)),
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
