// Presenter mode: jump into any chapter with a preset character.
import type { ChapterId } from "../../shared/content/schema.ts";
import type { DemoPath } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import { allChapters, chapterNumber } from "./chapters.ts";
import { h } from "./dom.ts";
import { paperPanel, segmented } from "./panel.ts";

export function demoPanel(
  audio: AudioEngine,
  handlers: { onBack(): void; onPick(chapter: ChapterId, variant: "m" | "f", path: DemoPath): void },
): HTMLElement {
  let variant: "m" | "f" = "m";
  let path: DemoPath = "history";
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
            class: `demo-card${c.great ? " great" : ""}${c.montage ? " montage" : ""}`,
            "data-chapter": c.id,
            onclick: () => {
              audio.sfx("choice");
              handlers.onPick(c.id, variant, path);
            },
          },
          h("span", { class: "demo-top" },
            h("span", { class: "demo-no" }, chapterNumber(c.order)),
            h("span", { class: "demo-level" }, `Lv ${c.level[0]}–${c.level[1]}`),
            h("span", { class: "demo-years" }, `${c.years[0]}–${c.years[1]}`)),
          h("span", { class: "demo-head" },
            h("strong", { class: "demo-title" }, c.title),
            ...c.tags.map((t) => h("span", { class: `tag${t === "대전" ? " tag-great" : ""}` }, t))),
          h("span", { class: "demo-line" }, c.highlight),
        ),
      ),
    ),
  );
  const panel = paperPanel(
    { title: "시연 모드", kicker: "발표자용", glyph: "演", onClose: handlers.onBack, class: "demo-panel" },
    h(
      "div",
      { class: "demo-intro" },
      h("p", null, "장을 고르면 그 장의 권장 레벨·장비·관계로 미리 설정된 시연용 인물로 바로 시작합니다. ‘개혁 누적’은 앞선 장의 분기를 지켜 낸 역사에서 출발해, 같은 장이 다른 결말로 이어지는 것을 보여 줍니다. 게임 중 ‘시연: 건너뛰기’로 현재 목표를 바로 완료할 수 있습니다."),
      h(
        "div",
        { class: "demo-options" },
        segmented("시연 인물 외형", [{ value: "m", label: "남" }, { value: "f", label: "여" }] as const, variant, (v) => {
          variant = v;
          audio.sfx("ui_click");
        }, "seg-variant"),
        segmented(
          "앞선 역사",
          [
            { value: "history", label: "역사 경로", title: "국운은 실제 역사의 기준선에서 시작합니다." },
            { value: "reform", label: "개혁 누적", title: "앞선 장의 분기를 모두 지켜 낸 국운과 장기 플래그로 시작합니다." },
          ] as const,
          path,
          (v) => {
            path = v;
            audio.sfx("ui_click");
          },
          "seg-path",
        ),
      ),
    ),
    grid,
  );
  // Where the grid does not fit (a phone), a fade at the bottom says there is more.
  const body = panel.querySelector<HTMLElement>(".panel-body");
  if (body) {
    const cue = () => body.classList.toggle("more", body.scrollTop + body.clientHeight < body.scrollHeight - 2);
    body.addEventListener("scroll", cue, { passive: true });
    const watch = new ResizeObserver(cue);
    watch.observe(body);
    watch.observe(grid);
  }
  return panel;
}
