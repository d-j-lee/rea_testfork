// Passage of years (prompt kind "years"): one activity per 10-year token,
// optional identity wash with a new name, the 노인성 offering and a lifespan
// projection. Confirming sends { t: "years" }; the passage then rolls the
// year counter when the host answers.
import type { WashMethod } from "../../shared/content/schema.ts";
import type { PromptView, YearsPlanView } from "../../shared/types.ts";
import { AWAKENING_YEAR, FINAL_YEAR } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import { button, h, ratio, wait } from "./dom.ts";
import { suggestName, validateName, WASH_GLYPH } from "./labels.ts";
import { paperPanel } from "./panel.ts";

export interface YearsSubmit {
  prompt: string;
  activities: string[];
  wash?: WashMethod;
  name?: string;
  offer: boolean;
}

const WASH_IDS: readonly string[] = ["descendant", "fakeDeath", "monk", "merchant", "exam"];
const isWash = (id: string): id is WashMethod => WASH_IDS.includes(id);

/** A name the host suggested in the prompt body ("새 이름: ○○"), if any. */
function suggestedName(body: readonly string[]): string | null {
  for (const line of body) {
    const m = /(?:새\s*이름|추천\s*이름|이름\s*후보)\s*[:：]?\s*[‘'"“「]?([가-힣A-Za-z0-9]{2,12})/.exec(line);
    if (m?.[1]) return m[1];
  }
  return null;
}

export class YearsPlanner {
  readonly el = h("div", { class: "years-host" });
  readonly #audio: AudioEngine;
  readonly #submit: (plan: YearsSubmit) => void;
  readonly #reduced: () => boolean;
  #prompt: PromptView | null = null;
  #pending: { from: number; to: number } | null = null;
  #rolling = false;

  constructor(audio: AudioEngine, submit: (plan: YearsSubmit) => void, reduced: () => boolean) {
    this.#audio = audio;
    this.#submit = submit;
    this.#reduced = reduced;
  }

  get open(): boolean {
    return this.#prompt !== null || this.#rolling;
  }

  close(): void {
    this.#prompt = null;
    if (!this.#rolling) this.el.replaceChildren();
  }

  show(p: PromptView, variant: "m" | "f"): void {
    const plan = p.data?.type === "years" ? p.data : null;
    if (!plan) return;
    this.#prompt = p;
    this.el.replaceChildren(this.#build(p, plan, variant));
    this.#audio.sfx("ui_open");
  }

  /** Called when the host answers the plan (next prompt/self). */
  async playPassage(): Promise<void> {
    const span = this.#pending;
    if (!span || this.#rolling) return;
    this.#pending = null;
    this.#rolling = true;
    const num = h("span", { class: "roll-num" }, String(span.from));
    const overlay = h("div", { class: "years-roll", "aria-live": "polite" },
      h("p", { class: "roll-k" }, "세월이 흐른다"), num,
      h("p", { class: "roll-span" }, `${span.from} → ${span.to}`));
    this.el.replaceChildren(overlay);
    this.#audio.sfx("years_pass");
    const ms = this.#reduced() ? 600 : 2100;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const e = 1 - Math.pow(1 - t, 3);
        num.textContent = String(Math.round(span.from + (span.to - span.from) * e));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    await wait(this.#reduced() ? 200 : 650);
    overlay.classList.add("out");
    await wait(this.#reduced() ? 0 : 420);
    this.#rolling = false;
    if (!this.#prompt) this.el.replaceChildren();
  }

  #build(p: PromptView, plan: YearsPlanView, variant: "m" | "f"): HTMLElement {
    const tokens = Math.max(1, plan.tokens);
    const firstOk = plan.activities.find((a) => !a.disabled)?.id ?? plan.activities[0]?.id ?? "";
    const chosen: string[] = Array.from({ length: tokens }, () => firstOk);
    let current = 0;
    let wash: WashMethod | null = null;
    let offer = false;
    const span = (plan.toYear - plan.fromYear) / tokens;
    const nameInput = h("input", {
      class: "text-input",
      type: "text",
      maxlength: "12",
      value: suggestedName(p.body) ?? suggestName(variant),
      "aria-label": "새 이름",
    });
    const nameHint = h("p", { class: "field-hint" }, "새 신분으로 쓸 이름 (2–12자)");
    const nameRow = h("div", { class: "yr-name hidden" }, h("label", { class: "field-label" }, "새 이름"), nameInput, nameHint);
    nameInput.addEventListener("input", () => {
      const err = validateName(nameInput.value);
      nameHint.textContent = err ?? "새 신분으로 쓸 이름 (2–12자)";
      nameHint.classList.toggle("bad", !!err);
    });

    const track = h("ol", { class: "yr-track", "aria-label": "10년 단위 세월" });
    const cards = h("div", { class: "yr-acts", role: "radiogroup", "aria-label": "활동" });
    const projection = h("div", { class: "yr-proj" });
    const summary = h("p", { class: "yr-summary", "aria-live": "polite" });
    const renderTrack = () => {
      track.replaceChildren(
        ...chosen.map((id, i) => {
          const act = plan.activities.find((a) => a.id === id);
          const y0 = Math.round(plan.fromYear + span * i);
          const y1 = Math.round(plan.fromYear + span * (i + 1));
          return h("li", null,
            h("button", {
              type: "button",
              class: `yr-token${i === current ? " on" : ""}`,
              "aria-pressed": i === current ? "true" : "false",
              onclick: () => {
                current = i;
                renderAll();
                this.#audio.sfx("ui_click");
              },
            },
            h("span", { class: "yr-range" }, `${y0}–${y1}`),
            h("strong", null, act?.name ?? "—")));
        }),
      );
    };
    const renderCards = () => {
      cards.replaceChildren(
        ...plan.activities.map((a) =>
          h(
            "button",
            {
              type: "button",
              role: "radio",
              class: `yr-act${chosen[current] === a.id ? " on" : ""}${a.disabled ? " locked" : ""}`,
              "aria-checked": chosen[current] === a.id ? "true" : "false",
              "aria-disabled": a.disabled ? "true" : "false",
              onclick: () => {
                if (a.disabled) {
                  this.#audio.sfx("denied");
                  return;
                }
                chosen[current] = a.id;
                if (current < tokens - 1) current++;
                this.#audio.sfx("ui_click");
                renderAll();
              },
            },
            h("strong", null, a.name),
            h("span", { class: "yr-desc" }, a.desc),
            h("span", { class: "yr-effect" }, a.effect),
            a.disabled ? h("span", { class: "opt-lock" }, "⊘ ", a.disabled) : null,
          ),
        ),
      );
    };
    const renderProjection = () => {
      const end = plan.lifeEnd + (offer ? plan.canOffer : 0);
      const axis = Math.max(FINAL_YEAR, end) - AWAKENING_YEAR;
      const at = (y: number) => ratio(y - AWAKENING_YEAR, axis).toFixed(4);
      const short = FINAL_YEAR - end;
      summary.replaceChildren(
        h("span", { class: "st-k" }, "천수"),
        `${end}년`,
        h("b", { class: "good" }, offer && plan.canOffer > 0 ? ` +${plan.canOffer}` : ""),
        short > 0 ? h("span", { class: "yr-short-chip" }, `${FINAL_YEAR}까지 −${short}년`) : h("span", { class: "yr-ok-chip" }, `${FINAL_YEAR}까지 닿는다`),
      );
      projection.replaceChildren(
        h("p", null,
          h("span", { class: "st-k" }, "천수"), ` ${end}년까지`,
          offer && plan.canOffer > 0 ? h("b", { class: "good" }, ` (+${plan.canOffer})`) : null,
          ` · ${plan.toYear}년에 ${Math.max(0, end - plan.toYear)}년 남음`),
        h("span", { class: "life-track big", style: `--now:${at(plan.toYear)};--end:${at(end)};--goal:${at(FINAL_YEAR)}` },
          h("span", { class: "life-past" }), h("span", { class: "life-left" }), h("span", { class: "life-gap" }), h("span", { class: "life-goal" })),
        short > 0
          ? h("p", { class: "yr-short" }, `이대로면 ${end}년에 천수가 다한다 · ${FINAL_YEAR}년까지 ${short}년 부족`)
          : h("p", { class: "yr-ok" }, `${FINAL_YEAR}년까지 닿는다`),
      );
    };
    const washList = h("div", { class: "yr-washes", role: "radiogroup", "aria-label": "신분 세탁" });
    const renderWashes = () => {
      const none = h("button", {
        type: "button", role: "radio", class: `yr-wash${wash === null ? " on" : ""}`, "aria-checked": wash === null ? "true" : "false",
        onclick: () => { wash = null; this.#audio.sfx("ui_click"); renderAll(); },
      }, h("span", { class: "wash-glyph", "aria-hidden": "true" }, "—"), h("strong", null, "지금 이름을 지킨다"), h("span", { class: "yr-desc" }, "신분을 바꾸지 않는다."));
      washList.replaceChildren(
        none,
        ...plan.washes.map((w) =>
          h("button", {
            type: "button", role: "radio",
            class: `yr-wash${wash === w.id ? " on" : ""}${w.disabled ? " locked" : ""}`,
            "aria-checked": wash === w.id ? "true" : "false",
            "aria-disabled": w.disabled ? "true" : "false",
            onclick: () => {
              if (w.disabled || !isWash(w.id)) { this.#audio.sfx("denied"); return; }
              wash = w.id;
              this.#audio.sfx("ui_click");
              renderAll();
            },
          },
          h("span", { class: "wash-glyph", "aria-hidden": "true" }, isWash(w.id) ? WASH_GLYPH[w.id] : "·"),
          h("strong", null, w.name),
          h("span", { class: "yr-desc" }, w.desc),
          w.disabled ? h("span", { class: "opt-lock" }, "⊘ ", w.disabled) : null)),
      );
      nameRow.classList.toggle("hidden", wash === null);
    };
    const offerBtn = h("button", {
      type: "button",
      class: "yr-offer",
      role: "switch",
      "aria-checked": "false",
      disabled: plan.canOffer <= 0,
      onclick: () => {
        offer = !offer;
        offerBtn.setAttribute("aria-checked", String(offer));
        offerBtn.classList.toggle("on", offer);
        this.#audio.sfx(offer ? "heal" : "ui_click");
        renderProjection();
      },
    },
    h("span", { class: "offer-star", "aria-hidden": "true" }, "✦"),
    h("span", { class: "offer-text" },
      h("strong", null, "노인성 봉헌"),
      h("span", null, plan.canOffer > 0 ? `공덕 ${plan.virtue}을 바쳐 천수 +${plan.canOffer}년` : `공덕 ${plan.virtue} · 이번 장에는 더 바칠 수 없다`)),
    h("span", { class: "switch", "aria-hidden": "true" }));
    const renderAll = () => {
      renderTrack();
      renderCards();
      renderWashes();
      renderProjection();
    };
    renderAll();

    const confirm = button(`세월을 보낸다 · ${plan.toYear - plan.fromYear}년`, () => {
      if (wash && validateName(nameInput.value)) {
        this.#audio.sfx("denied");
        nameInput.focus();
        return;
      }
      const name = wash ? nameInput.value.trim() : undefined;
      this.#pending = { from: plan.fromYear, to: plan.toYear };
      this.#prompt = null;
      confirm.disabled = true;
      this.#audio.sfx("choice");
      this.#submit({ prompt: p.id, activities: [...chosen], wash: wash ?? undefined, name, offer });
      // Fallback if the host answers without a follow-up message.
      window.setTimeout(() => void this.playPassage(), 1200);
    }, { class: "btn btn-primary btn-wide", "data-action": "years-confirm" });

    return paperPanel(
      { title: `세월이 흐른다 · ${plan.fromYear} → ${plan.toYear}`, kicker: p.title || "세월 흐르기", glyph: "年", class: "years-panel", footer: h("div", { class: "yr-foot" }, summary, confirm) },
      h("div", { class: "yr-grid" },
      h("div", { class: "yr-main" },
      p.body.length ? h("div", { class: "yr-body" }, ...p.body.map((t) => h("p", null, t))) : null,
      h("h3", { class: "sub-title" }, `10년마다 무엇을 하며 지낼까 · ${tokens}마디`),
      track,
      cards),
      h("div", { class: "yr-side" },
      h("h3", { class: "sub-title" }, "신분"),
      plan.washAdvised
        ? h("p", { class: "yr-warn", role: "alert" }, "의심이 짙다. 늙지 않는 얼굴을 보는 눈이 많다 — 이번 세월에 신분을 바꾸는 편이 안전하다.")
        : null,
      washList,
      nameRow,
      h("h3", { class: "sub-title" }, "천수"),
      offerBtn,
      projection)),
    );
  }
}
