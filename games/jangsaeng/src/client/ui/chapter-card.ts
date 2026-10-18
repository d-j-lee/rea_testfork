// Chapter title card shown on `enter`: big calligraphic title, years and the
// briefing lines fading in. Skippable (tap / key); dismisses itself.
import type { ChapterView } from "../../shared/types.ts";
import { chapterNumber } from "./chapters.ts";
import { h } from "./dom.ts";

export function chapterCard(
  chapter: ChapterView,
  channel: string,
  reduced: boolean,
  onDone: () => void,
): { el: HTMLElement; dismiss(): void } {
  let done = false;
  const lines = chapter.briefing.slice(0, 5);
  const skip = h("p", { class: "card-skip" }, "눌러서 계속");
  const el = h(
    "div",
    { class: "screen chapter-card", role: "dialog", "aria-modal": "true", "aria-label": `${chapterNumber(chapter.order)} ${chapter.title}`, tabindex: "-1" },
    h("div", { class: "card-inner" },
      h("p", { class: "card-no" }, chapterNumber(chapter.order), chapter.montage ? h("span", { class: "tag" }, "몽타주") : null),
      h("h2", { class: "card-title" }, chapter.title),
      chapter.subtitle ? h("p", { class: "card-sub" }, chapter.subtitle) : null,
      h("p", { class: "card-years" }, h("span", null, String(chapter.years[0])), h("span", { class: "dash", "aria-hidden": "true" }), h("span", null, String(chapter.years[1]))),
      h("div", { class: "card-brief" }, ...lines.map((line, i) => h("p", { style: `--i:${i}` }, line))),
      channel ? h("p", { class: "card-channel" }, channel) : null),
    skip,
  );
  const total = reduced ? 3200 : 2600 + lines.length * 1700;
  const dismiss = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    window.removeEventListener("keydown", onKey, true);
    el.classList.add("out");
    window.setTimeout(() => el.remove(), reduced ? 0 : 450);
    onDone();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  };
  const timer = window.setTimeout(dismiss, total);
  el.addEventListener("click", dismiss);
  window.addEventListener("keydown", onKey, true);
  return { el, dismiss };
}
