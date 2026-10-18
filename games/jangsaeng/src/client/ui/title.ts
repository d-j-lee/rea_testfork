// Title screen: calligraphic logo over the Old Man Star, main menu, mode badge
// and the fixed alternate-history disclaimer. Sub-screens open as paper panels
// over the same backdrop.
import type { AudioEngine } from "../audio/types.ts";
import { chapterArc } from "./chapters.ts";
import { creationPanel } from "./creation.ts";
import { demoPanel } from "./demo.ts";
import { h, type Child } from "./dom.ts";
import type { TitleChoice, TitleOptions } from "./index.ts";
import { paperPanel, seal, segmented, stackedGlyphs } from "./panel.ts";
import { pitchPanel } from "./pitch.ts";
import type { SettingsStore } from "./settings.ts";
import { settingsControls } from "./settings-panel.ts";
import { titleBackdrop } from "./title-art.ts";

export const DISCLAIMER =
  "이 게임은 실제 역사에 바탕을 둔 대체역사 픽션입니다. 실존 인물과 사건은 사료를 존중해 묘사했으며, 가상의 주인공과 선택에 따른 전개는 창작입니다.";

export const DEMO_PRESET_NAME = "윤무진";

export interface TitleScreen {
  el: HTMLElement;
  result: Promise<TitleChoice>;
  destroy(): void;
}

function menuItem(label: string, desc: Child, action: string, onClick: () => void, primary = false): HTMLElement {
  return h(
    "li",
    null,
    h(
      "button",
      { type: "button", class: `menu-item${primary ? " primary" : ""}`, "data-action": action, onclick: onClick },
      h("span", { class: "menu-label" }, label),
      h("span", { class: "menu-desc" }, desc),
    ),
  );
}

export function createTitle(
  options: TitleOptions,
  audio: AudioEngine,
  settings: SettingsStore,
): TitleScreen {
  let resolve!: (choice: TitleChoice) => void;
  const result = new Promise<TitleChoice>((r) => (resolve = r));
  let mode: "offline" | "online" = options.onlineAvailable ? (options.saved?.mode ?? "offline") : "offline";
  const backdrop = titleBackdrop(() => settings.reducedMotion);
  const host = h("div", { class: "title-host" });
  let settled = false;

  const unlock = () => {
    if (audio.unlocked) return;
    void audio.unlock().then(() => audio.setMusic("title"));
  };

  const finish = (choice: TitleChoice) => {
    if (settled) return;
    settled = true;
    el.classList.add("leaving");
    resolve(choice);
  };

  const showMain = () => {
    host.replaceChildren();
    el.classList.remove("sub-open");
    main.querySelector<HTMLElement>(".menu-item")?.focus({ preventScroll: true });
  };
  const openSub = (panel: HTMLElement) => {
    audio.sfx("ui_open");
    host.replaceChildren(panel);
    el.classList.add("sub-open");
    panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
  };
  const back = () => {
    audio.sfx("ui_close");
    showMain();
  };

  const openCreation = () =>
    openSub(
      creationPanel(audio, {
        onBack: back,
        onStart: (r) => finish({ mode, resume: false, name: r.name, variant: r.variant, origin: r.origin }),
      }),
    );
  const openDemo = () =>
    openSub(
      demoPanel(audio, {
        onBack: back,
        onPick: (chapter, variant, demoPath) =>
          finish({ mode, resume: false, name: DEMO_PRESET_NAME, variant, origin: "northeast", demo: chapter, demoPath }),
      }),
    );
  const openPitch = () => openSub(pitchPanel({ onBack: back, onNew: openCreation, onDemo: openDemo }));
  const openSettings = () =>
    openSub(paperPanel({ title: "설정", glyph: "設", onClose: back, class: "settings-panel" }, settingsControls(settings, audio)));

  const saved = options.saved;
  const arc = chapterArc();
  const menu = h(
    "ul",
    { class: "title-menu" },
    saved
      ? menuItem("이어하기", `${saved.name} · ${saved.chapterTitle} · ${saved.year}년`, "resume", () => {
          audio.sfx("choice");
          finish({ mode: saved.mode, resume: true, name: saved.name, variant: "m", origin: "northeast" });
        }, true)
      : null,
    menuItem("새로 시작", `${arc.from}년, 노인성의 밤에서`, "new", openCreation, !saved),
    menuItem("시연 모드", `${arc.count}개 장 중 하나로 바로`, "demo", openDemo),
    menuItem("게임 소개", "무엇을 하는 게임인가", "pitch", openPitch),
    menuItem("설정", "소리 · 터치 · 움직임", "settings", openSettings),
  );

  const modeNote = h("p", { class: "mode-note" });
  const renderModeNote = () => {
    modeNote.textContent =
      mode === "offline"
        ? "실제 플레이어 없이 ◇ 시뮬레이션 동료와 함께"
        : "같은 시대의 장생인과 한 마당에서";
  };
  renderModeNote();
  const modeSeg = segmented(
    "접속 방식",
    [
      { value: "offline", label: "오프라인 플레이" },
      {
        value: "online",
        label: "온라인 서버",
        disabled: !options.onlineAvailable,
        title: options.onlineAvailable ? undefined : "이 빌드에서는 서버에 연결할 수 없습니다",
      },
    ] as const,
    mode,
    (v) => {
      mode = v;
      renderModeNote();
      audio.sfx("ui_click");
    },
    "seg-mode",
  );

  const logo = h(
    "div",
    { class: "logo" },
    h("h1", { class: "logo-hanja", "aria-label": "장생 오백년" }, ...stackedGlyphs("長生")),
    h("div", { class: "logo-side" },
      seal("五百年", "logo-seal", true),
      h("p", { class: "logo-hangul" }, "장생"),
      h("p", { class: "logo-sub" }, "오백년")),
  );
  const main = h(
    "div",
    { class: "title-main" },
    h("div", { class: "title-brand" },
      logo,
      h("p", { class: "tagline" }, "고려의 황혼에서 대한제국의 끝까지,", h("br"), "오백 년을 살아낸 무신")),
    h("nav", { class: "title-nav", "aria-label": "주 메뉴" }, menu),
  );

  const el = h(
    "div",
    {
      class: "screen title-screen",
      onpointerdown: unlock,
      onkeydown: unlock,
      onclick: (e: Event) => {
        if ((e.target as HTMLElement).closest("button")) audio.sfx("ui_click");
      },
    },
    backdrop.el,
    h("div", { class: "title-mode" }, modeSeg, modeNote),
    main,
    host,
    h("footer", { class: "title-foot" },
      h("p", { class: "disclaimer" }, DISCLAIMER),
      h("p", { class: "version" }, `프로토타입 v${options.version}`)),
  );

  // Deep links used by the ending screen ("처음부터", "시연 모드").
  const hash = window.location.hash;
  if (hash === "#demo" || hash === "#new") {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    queueMicrotask(() => (hash === "#demo" ? openDemo() : openCreation()));
  }

  return {
    el,
    result,
    destroy() {
      backdrop.stop();
      el.remove();
    },
  };
}
