// Objective tracker (right side) with progress and completion check, plus the
// presenter-only demo skip button.
import type { InputHint } from "../../shared/content/schema.ts";
import type { ObjectiveView, SelfView } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import { chapterNumber } from "./chapters.ts";
import { button, h, setText, toggle } from "./dom.ts";

/** Control names for an objective's input hints, per device. */
const INPUT_HINT_TEXT: Readonly<Record<InputHint, { keys: string; touch: string }>> = {
  move: { keys: "이동 WASD·방향키", touch: "이동 왼쪽 화면을 끌기" },
  interact: { keys: "말 걸기 E", touch: "말 걸기 手 행동" },
  attack: { keys: "공격 J·Space·클릭", touch: "공격 劍" },
  bow: { keys: "활 K·우클릭, 길게 당기기", touch: "활 弓, 길게 누르기" },
  roll: { keys: "구르기 Shift·L", touch: "구르기 轉" },
  skill: { keys: "기술 1·2·3", touch: "기술 칸 1·2·3" },
};

/** The settings store publishes the active input mode on <html data-touch>. */
export function touchInput(): boolean {
  return document.documentElement.dataset["touch"] === "on";
}

/** The controls an objective teaches, named for the keyboard or the touch buttons. */
export function inputHintText(hints: readonly InputHint[] | undefined, touch: boolean): string {
  return (hints ?? []).map((hint) => INPUT_HINT_TEXT[hint][touch ? "touch" : "keys"]).join(" · ");
}

export class ObjectiveTracker {
  readonly el: HTMLElement;
  readonly #list = h("ol", { class: "obj-list" });
  readonly #head = h("span", { class: "obj-chapter" });
  readonly #skip: HTMLButtonElement;
  readonly #audio: AudioEngine;
  #known = new Map<string, boolean>();
  #key = "";

  constructor(audio: AudioEngine, onSkip: () => void) {
    this.#audio = audio;
    this.#skip = button("시연: 건너뛰기 ⏭", onSkip, { class: "btn-demo-skip hidden", title: "현재 목표를 즉시 완료합니다 (시연 모드 전용)" });
    this.el = h(
      "section",
      { class: "hud-obj", "aria-label": "목표", "aria-live": "polite" },
      h("header", { class: "obj-head" }, h("span", { class: "obj-k" }, "목표"), this.#head),
      this.#list,
      this.#skip,
    );
  }

  update(self: SelfView): void {
    setText(this.#head, `${chapterNumber(self.chapter.order)} · ${self.chapter.title}`);
    toggle(this.#skip, "hidden", !self.demo);
    const list = self.objectives;
    const touch = touchInput();
    const key = `${touch ? "t" : "k"}|${list.map((o) => `${o.id}:${o.done ? 1 : 0}:${o.progress?.[0] ?? ""}/${o.progress?.[1] ?? ""}:${o.text}`).join("|")}`;
    if (key === this.#key) return;
    this.#key = key;
    let newlyDone = false;
    let fresh = false;
    for (const o of list) {
      const before = this.#known.get(o.id);
      if (before === undefined && this.#known.size > 0) fresh = true;
      if (before === false && o.done) newlyDone = true;
    }
    this.#known = new Map(list.map((o) => [o.id, o.done]));
    if (newlyDone) this.#audio.sfx("quest_done");
    else if (fresh) this.#audio.sfx("quest");
    // Pending first, then completed; optional ones last among pending.
    const sorted = [...list].sort((a, b) => Number(a.done) - Number(b.done) || Number(a.optional) - Number(b.optional));
    this.#list.replaceChildren(...sorted.map((o) => this.#item(o, touch)));
    toggle(this.el, "empty", list.length === 0);
  }

  #item(o: ObjectiveView, touch: boolean): HTMLElement {
    const progress = o.progress ? h("span", { class: "obj-prog" }, `${o.progress[0]}/${o.progress[1]}`) : null;
    const keys = o.done ? "" : inputHintText(o.hint, touch);
    return h(
      "li",
      { class: `obj${o.done ? " done" : ""}${o.optional ? " optional" : ""}` },
      h("span", { class: "obj-box", "aria-hidden": "true" }),
      h("span", { class: "obj-text" },
        o.optional ? h("span", { class: "obj-opt" }, "선택") : null,
        o.text,
        keys ? h("small", { class: "obj-site obj-keys" }, keys) : null,
        o.siteName && !o.done ? h("small", { class: "obj-site" }, o.siteName) : null),
      progress,
      o.done ? h("span", { class: "sr-only" }, "완료") : null,
    );
  }
}
