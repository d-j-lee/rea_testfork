// Presenter mode: jump into any of the 16 chapters with a preset character.
import type { ChapterId } from "../../shared/content/schema.ts";
import type { AudioEngine } from "../audio/types.ts";
import { allChapters, chapterNumber } from "./chapters.ts";
import { h } from "./dom.ts";
import { paperPanel, segmented } from "./panel.ts";

export function demoPanel(
  audio: AudioEngine,
  handlers: { onBack(): void; onPick(chapter: ChapterId, variant: "m" | "f"): void },
): HTMLElement {
  let variant: "m" | "f" = "m";
  const grid = h(
    "ol",
    { class: "demo-grid" },
    ...allChapters().map((c) =>
      h(
        "li",
        null,
        h(
          "button",
          {
            type: "button",
            class: `demo-card${c.tags.includes("대첩") ? " great" : ""}${c.montage ? " montage" : ""}`,
            "data-chapter": c.id,
            onclick: () => {
              audio.sfx("choice");
              handlers.onPick(c.id, variant);
            },
          },
          h("span", { class: "demo-top" },
            h("span", { class: "demo-no" }, chapterNumber(c.order)),
            h("span", { class: "demo-years" }, `${c.years[0]}–${c.years[1]}`)),
          h("strong", { class: "demo-title" }, c.title),
          h("span", { class: "demo-line" }, c.highlight),
          h("span", { class: "demo-tags" },
            h("span", { class: "tag tag-level" }, `권장 Lv ${c.level[0]}–${c.level[1]}`),
            ...c.tags.map((t) => h("span", { class: `tag${t === "대첩" ? " tag-great" : ""}` }, t))),
        ),
      ),
    ),
  );
  return paperPanel(
    { title: "시연 모드", kicker: "발표자용", glyph: "演", onClose: handlers.onBack, class: "demo-panel" },
    h(
      "div",
      { class: "demo-intro" },
      h("p", null, "원하는 장을 고르면 그 장의 권장 레벨·장비·관계로 미리 설정된 시연용 인물로 바로 시작합니다. 화면 상단의 ‘시연: 건너뛰기’로 현재 목표를 즉시 완료할 수 있습니다."),
      segmented("시연 인물 외형", [{ value: "m", label: "남" }, { value: "f", label: "여" }] as const, variant, (v) => {
        variant = v;
        audio.sfx("ui_click");
      }, "seg-variant"),
    ),
    grid,
  );
}
