// Dialogue and choice sheet for story / history / notice / identity / death /
// negotiation prompts, montage cards and result lists. Body text types out
// quickly (tap to complete); options carry hints, lock reasons and the 풍향계.
import type { PromptOptionView, PromptView, ResultView } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import { h } from "./dom.ts";
import { riskTone } from "./labels.ts";
import { seal } from "./panel.ts";
import { portrait } from "./portrait.ts";

const KIND_RIBBON: Partial<Record<PromptView["kind"], string>> = {
  history: "실제 역사",
  identity: "신분",
  negotiation: "협상",
  death: "천수",
  result: "결과",
  notice: "알림",
};

const RESULT_MARK: Readonly<Record<ResultView["lines"][number]["tone"], string>> = {
  info: "·",
  good: "▲",
  bad: "▼",
  epic: "✦",
};

function riskMeter(risk: NonNullable<PromptOptionView["risk"]>): HTMLElement {
  const v = Math.max(0, Math.min(100, Math.round(risk.value)));
  const tone = riskTone(v);
  const lo = risk.exact ? v : Math.max(0, v - 10);
  const hi = risk.exact ? v : Math.min(100, v + 10);
  return h(
    "span",
    {
      class: "risk",
      "data-tone": tone.tone,
      title: `풍향계: 숙청 위험 ${risk.exact ? v : `${v} ±10`} (${tone.label})${risk.exact ? "" : " · 지략 30 이상이면 정확해진다"}`,
    },
    h("span", { class: "risk-k" }, h("span", { class: "vane", "aria-hidden": "true", style: `--a:${(v / 100) * 150 - 75}deg` }), "풍향계"),
    h("span", { class: "risk-gauge", style: `--v:${v / 100};--lo:${lo / 100};--hi:${hi / 100}` },
      h("span", { class: "risk-fill" }), risk.exact ? null : h("span", { class: "risk-blur" })),
    h("span", { class: "risk-val" }, `${v}`, risk.exact ? null : h("small", null, "±10")),
  );
}

export class PromptDialog {
  readonly el = h("div", { class: "prompt-host" });
  readonly #audio: AudioEngine;
  readonly #choose: (prompt: string, option: string) => void;
  readonly #reduced: () => boolean;
  #prompt: PromptView | null = null;
  #typing: (() => void) | null = null;
  #sent = false;
  #timer = 0;

  constructor(audio: AudioEngine, choose: (prompt: string, option: string) => void, reduced: () => boolean) {
    this.#audio = audio;
    this.#choose = choose;
    this.#reduced = reduced;
  }

  get open(): boolean {
    return this.#prompt !== null;
  }

  get current(): PromptView | null {
    return this.#prompt;
  }

  show(p: PromptView): void {
    const same = this.#prompt?.id === p.id;
    this.#prompt = p;
    this.#sent = false;
    window.clearInterval(this.#timer);
    this.#typing = null;
    const sheet = this.#build(p, same);
    this.el.replaceChildren(sheet);
    if (!same) this.#audio.sfx(p.kind === "death" ? "warning" : "ui_open");
    sheet.focus({ preventScroll: true });
  }

  close(): void {
    window.clearInterval(this.#timer);
    this.#prompt = null;
    this.#typing = null;
    this.el.replaceChildren();
  }

  /** Keyboard: 1–9 choose, Enter/Space complete typing or continue. */
  handleKey(e: KeyboardEvent): boolean {
    const p = this.#prompt;
    if (!p || this.#sent) return false;
    if (this.#typing && (e.key === "Enter" || e.key === " " || /^[1-9]$/.test(e.key))) {
      this.#typing();
      return true;
    }
    const enabled = p.options.filter((o) => !o.disabled);
    if (/^[1-9]$/.test(e.key)) {
      const option = p.options[Number(e.key) - 1];
      if (option && !option.disabled) this.#pick(option.id);
      else this.#audio.sfx("denied");
      return true;
    }
    if ((e.key === "Enter" || e.key === " ") && enabled.length === 1 && enabled[0]) {
      this.#pick(enabled[0].id);
      return true;
    }
    return false;
  }

  #pick(option: string): void {
    const p = this.#prompt;
    if (!p || this.#sent) return;
    this.#sent = true;
    this.el.querySelector(".prompt")?.classList.add("sent");
    this.el.querySelector(`[data-option="${CSS.escape(option)}"]`)?.classList.add("picked");
    this.#audio.sfx("choice");
    this.#choose(p.id, option);
  }

  #build(p: PromptView, same: boolean): HTMLElement {
    const ribbon = KIND_RIBBON[p.kind];
    const body = h("div", { class: "pr-body" });
    const paragraphs = p.body.map((text) => {
      const shown = document.createTextNode("");
      const rest = h("span", { class: "tw-rest" }, text);
      body.appendChild(h("p", null, shown, rest));
      return { text, shown, rest };
    });
    const result = p.data?.type === "result" ? p.data : null;
    const resultList = result
      ? h("ul", { class: "pr-result" },
          ...result.lines.map((l) => h("li", { class: `tone-${l.tone}` }, h("span", { class: "rs-mark", "aria-hidden": "true" }, RESULT_MARK[l.tone]), l.text)))
      : null;
    const single = p.options.length === 1;
    const options = h(
      "div",
      { class: `pr-options${single ? " single" : ""}`, role: "group", "aria-label": "선택지" },
      ...p.options.map((o, i) =>
        h(
          "button",
          {
            type: "button",
            class: `opt${o.disabled ? " locked" : ""}${o.risk ? " has-risk" : ""}`,
            "data-option": o.id,
            "aria-disabled": o.disabled ? "true" : "false",
            onclick: () => {
              if (this.#typing) {
                this.#typing();
                return;
              }
              if (o.disabled) {
                this.#audio.sfx("denied");
                return;
              }
              this.#pick(o.id);
            },
          },
          single ? null : h("span", { class: "opt-key", "aria-hidden": "true" }, String(i + 1)),
          h("span", { class: "opt-main" },
            h("span", { class: "opt-text" }, o.text, single ? h("span", { class: "opt-arrow", "aria-hidden": "true" }, " ▸") : null),
            o.hint ? h("span", { class: "opt-hint" }, o.hint) : null,
            o.disabled ? h("span", { class: "opt-lock" }, h("span", { "aria-hidden": "true" }, "⊘ "), o.disabled) : null),
          o.risk ? riskMeter(o.risk) : null,
        ),
      ),
    );
    const speaker = p.speaker
      ? h("div", { class: "pr-speaker" },
          h("span", { class: "pr-portrait" }, portrait(p.speaker.sprite, undefined, 3)),
          h("span", { class: "pr-who" },
            h("strong", null, p.speaker.name),
            p.speaker.historical ? h("span", { class: "badge-real", title: "실존 인물" }, "실존") : null))
      : null;
    const isCard = p.kind === "card";
    const sheet = h(
      "section",
      {
        class: `prompt paper pk-${p.kind}${isCard ? " card" : " sheet"}${same ? "" : " enter"}`,
        role: "dialog",
        "aria-modal": "true",
        "aria-label": p.title || "대화",
        tabindex: "-1",
      },
      isCard && p.year !== undefined ? seal(String(p.year), "pr-yearseal") : null,
      h("header", { class: "pr-head" },
        speaker,
        h("div", { class: "pr-titles" },
          ribbon ? h("span", { class: "pr-ribbon" }, ribbon) : null,
          p.title ? h("h2", { class: "pr-title" }, p.title) : null),
        !isCard && p.year !== undefined ? h("span", { class: "pr-year" }, `${p.year}년`) : null),
      body,
      resultList,
      options,
    );
    // Typewriter: hidden remainder keeps layout stable while text appears.
    const total = paragraphs.reduce((n, x) => n + x.text.length, 0);
    const finish = () => {
      window.clearInterval(this.#timer);
      for (const x of paragraphs) {
        x.shown.data = x.text;
        x.rest.textContent = "";
      }
      this.#typing = null;
      sheet.classList.add("typed");
    };
    if (this.#reduced() || same || total === 0) finish();
    else {
      let shown = 0;
      const cps = 90;
      const start = performance.now();
      this.#typing = finish;
      this.#timer = window.setInterval(() => {
        shown = Math.floor(((performance.now() - start) / 1000) * cps);
        let left = shown;
        for (const x of paragraphs) {
          const n = Math.max(0, Math.min(x.text.length, left));
          if (x.shown.data.length !== n) {
            x.shown.data = x.text.slice(0, n);
            x.rest.textContent = x.text.slice(n);
          }
          left -= x.text.length + 6;
        }
        if (left > 0) finish();
      }, 30);
      body.addEventListener("click", () => this.#typing?.());
    }
    return sheet;
  }
}
