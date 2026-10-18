// Settings controls shared by the title screen and the in-game menu.
import type { AudioEngine } from "../audio/types.ts";
import { h } from "./dom.ts";
import { segmented } from "./panel.ts";
import type { SettingsStore } from "./settings.ts";

function slider(label: string, value: number, onInput: (v: number) => void, onCommit: () => void): HTMLElement {
  const out = h("output", { class: "range-out" }, `${Math.round(value * 100)}`);
  const input = h("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "5",
    value: String(Math.round(value * 100)),
    "aria-label": label,
    oninput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      out.textContent = String(Math.round(v * 100));
      onInput(v);
    },
    onchange: () => onCommit(),
  });
  return h("label", { class: "set-row" }, h("span", { class: "set-label" }, label), h("span", { class: "set-ctl" }, input, out));
}

function row(label: string, hint: string, control: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "set-row" },
    h("span", { class: "set-label" }, label, h("small", null, hint)),
    h("span", { class: "set-ctl" }, control),
  );
}

export function settingsControls(store: SettingsStore, audio: AudioEngine): HTMLElement {
  const v = store.value;
  return h(
    "div",
    { class: "settings" },
    h("h3", { class: "sub-title" }, "소리"),
    slider("음악", v.music, (x) => store.update({ music: x }), () => audio.sfx("ui_click")),
    slider("효과음", v.sfx, (x) => store.update({ sfx: x }), () => audio.sfx("ui_click")),
    row(
      "음소거",
      "O 키로도 켜고 끌 수 있습니다",
      segmented("음소거", [{ value: "off", label: "소리 켬" }, { value: "on", label: "소리 끔" }] as const, v.muted ? "on" : "off", (x) => {
        store.update({ muted: x === "on" });
        if (x === "off") audio.sfx("ui_click");
      }),
    ),
    h("h3", { class: "sub-title" }, "조작과 화면"),
    row(
      "터치 조작",
      "자동: 터치 화면에서만 가상 패드를 보입니다",
      segmented("터치 조작", [
        { value: "auto", label: "자동" },
        { value: "on", label: "켜기" },
        { value: "off", label: "끄기" },
      ] as const, v.touch, (x) => store.update({ touch: x })),
    ),
    row(
      "움직임 줄이기",
      "화면 효과와 글자 타자 연출을 줄입니다",
      segmented("움직임 줄이기", [
        { value: "auto", label: "시스템" },
        { value: "reduced", label: "줄이기" },
        { value: "full", label: "모두" },
      ] as const, v.motion, (x) => store.update({ motion: x })),
    ),
  );
}
