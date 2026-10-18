// Passage of years (prompt kind "years"): one activity per token of the era
// (spans and heading come from the host's plan), optional identity wash with a
// new name, the 노인성 offering, the once-in-a-run 마지막 은혜 (its own switch,
// off unless the player turns it on) and the lifespan projection, which the
// rules make from the plan's own numbers (projectYears) as the choices change.
// The planner
// starts from the plan's suggestion and suggested name. Confirming starts the
// year-counter roll here and hands the plan, with the roll's promise, to the
// owner, which sends { t: "years" } and re-syncs when the roll has ended.
import type { WashMethod } from "../../shared/content/schema.ts";
import { projectYears, type YearsProjection } from "../../shared/rules/index.ts";
import type { PromptView, YearsPlanView } from "../../shared/types.ts";
import { AWAKENING_YEAR, FINAL_YEAR } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import { button, h, ratio, wait } from "./dom.ts";
import { lifeWarning, validateName, WASH_GLYPH } from "./labels.ts";
import { paperPanel } from "./panel.ts";

interface YearsSubmit {
  prompt: string;
  activities: string[];
  wash?: WashMethod;
  name?: string;
  offer: boolean;
  grace: boolean;
}

const WASH_IDS: readonly string[] = ["descendant", "fakeDeath", "monk", "merchant", "exam"];
const isWash = (id: string): id is WashMethod => WASH_IDS.includes(id);
/** How far the year counter moves: the panel's kicker and the roll show the same span. */
const rollSpan = (from: number, to: number): string => `${from}년 → ${to}년`;
/** "+3년" / "−1년" with a true minus sign. */
const signedYears = (years: number): string => `${years < 0 ? "−" : "+"}${Math.abs(years)}년`;
/** The parts of the projection the planner names under the lifespan line. */
const PROJECTION_PARTS: readonly (readonly [Exclude<keyof YearsProjection, "lifeEnd" | "offerable">, string])[] = [
  ["activities", "활동"],
  ["wash", "신분 세탁"],
  ["resonance", "노인성 감응"],
  ["offer", "봉헌"],
  ["grace", "마지막 은혜"],
];

/**
 * Called once per confirmed plan. `passage` is the year-counter roll the
 * confirm has already started; it resolves when the roll has ended and the
 * planner is gone (or holds the next years card).
 */
type YearsSubmitHandler = (plan: YearsSubmit, passage: Promise<void>) => void;

export class YearsPlanner {
  readonly el = h("div", { class: "years-host" });
  readonly #audio: AudioEngine;
  readonly #submit: YearsSubmitHandler;
  readonly #reduced: () => boolean;
  #prompt: PromptView | null = null;
  #rolling = false;

  constructor(audio: AudioEngine, submit: YearsSubmitHandler, reduced: () => boolean) {
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

  show(p: PromptView): void {
    const plan = p.data?.type === "years" ? p.data : null;
    if (!plan) return;
    this.#prompt = p;
    this.el.replaceChildren(this.#build(p, plan));
    this.#audio.sfx("ui_open");
  }

  /** Rolls the year counter over the planner; the planner is cleared after unless a new years card came. */
  async #roll(from: number, to: number): Promise<void> {
    this.#rolling = true;
    const num = h("span", { class: "roll-num" }, String(from));
    const overlay = h("div", { class: "years-roll", "aria-live": "polite" },
      h("p", { class: "roll-k" }, "세월이 흐른다"), num,
      h("p", { class: "roll-span" }, rollSpan(from, to)));
    this.el.replaceChildren(overlay);
    try {
      this.#audio.sfx("years_pass");
      const ms = this.#reduced() ? 600 : 2100;
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / ms);
          const e = 1 - Math.pow(1 - t, 3);
          num.textContent = String(Math.round(from + (to - from) * e));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      await wait(this.#reduced() ? 200 : 650);
      overlay.classList.add("out");
      await wait(this.#reduced() ? 0 : 420);
    } finally {
      this.#rolling = false;
      if (!this.#prompt) this.el.replaceChildren();
    }
  }

  #build(p: PromptView, plan: YearsPlanView): HTMLElement {
    const tokens = Math.max(1, plan.tokens);
    const chosen: string[] = Array.from({ length: tokens }, (_, i) => plan.suggested.activities[i] ?? plan.suggested.activities[0] ?? "");
    let current = 0;
    let wash: WashMethod | null = null;
    let offer = plan.suggested.offer;
    const graceYears = plan.graceYears ?? 0;
    let grace = false;
    // The host's suggestion is the name a wash takes when the field is left as it is.
    const nameInput = h("input", {
      class: "text-input",
      type: "text",
      maxlength: "12",
      value: plan.suggestedName,
      "aria-label": "새 이름",
    });
    const nameHint = h("p", { class: "field-hint" }, "새 신분으로 쓸 이름 (2–12자)");
    const nameRow = h("div", { class: "yr-name hidden" }, h("label", { class: "field-label" }, "새 이름"), nameInput, nameHint);
    nameInput.addEventListener("input", () => {
      const err = validateName(nameInput.value);
      nameHint.textContent = err ?? "새 신분으로 쓸 이름 (2–12자)";
      nameHint.classList.toggle("bad", !!err);
    });

    const track = h("ol", { class: "yr-track", "aria-label": "세월 마디" });
    const cards = h("div", { class: "yr-acts", role: "radiogroup", "aria-label": "활동" });
    const projection = h("div", { class: "yr-proj" });
    const summary = h("p", { class: "yr-summary", "aria-live": "polite" });
    const renderTrack = () => {
      track.replaceChildren(
        ...chosen.map((id, i) => {
          const act = plan.activities.find((a) => a.id === id);
          const range = plan.spans[i];
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
            range ? h("span", { class: "yr-range" }, `${range.from}–${range.to}`) : null,
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
    // The rules project the plan from its own numbers; the planner only shows them.
    const renderProjection = () => {
      // An offering the plan can no longer pay for turns itself off (e.g. after 구휼 is taken out).
      if (offer && projectYears(plan, { activities: chosen, wash, offer: true, grace }).offerable <= 0) {
        offer = false;
        offerBtn.setAttribute("aria-checked", "false");
        offerBtn.classList.remove("on");
      }
      const p = projectYears(plan, { activities: chosen, wash, offer, grace });
      const end = p.lifeEnd;
      const added = end - plan.lifeEnd;
      const axis = Math.max(FINAL_YEAR, end) - AWAKENING_YEAR;
      const at = (y: number) => ratio(y - AWAKENING_YEAR, axis).toFixed(4);
      const short = FINAL_YEAR - end;
      // The same calm-or-urgent reading the HUD gives this lifespan.
      const life = lifeWarning({ year: plan.toYear, lifeEnd: end, lifeShortfall: Math.max(0, short) });
      summary.dataset.life = life;
      projection.dataset.life = life;
      const parts = PROJECTION_PARTS.filter(([key]) => p[key] !== 0).map(([key, label]) => `${label} ${signedYears(p[key])}`);
      // A gain reads green; a loss (전사 위장 alone) stays in ink.
      const tone = added > 0 ? { class: "good" } : null;
      summary.replaceChildren(
        h("span", { class: "st-k" }, "천수"),
        `${end}년`,
        h("b", tone, added !== 0 ? ` ${signedYears(added)}` : ""),
        short > 0 ? h("span", { class: "yr-short-chip" }, `${FINAL_YEAR}까지 −${short}년`) : h("span", { class: "yr-ok-chip" }, `${FINAL_YEAR}까지 닿는다`),
      );
      offerLine.textContent = p.offerable > 0
        ? `공덕을 바쳐 천수 +${p.offerable}년 (지닌 공덕 ${plan.virtue})`
        : `공덕 ${plan.virtue} · 바칠 만큼 모이지 않았다`;
      offerBtn.disabled = p.offerable <= 0 && !offer;
      projection.replaceChildren(
        h("p", null,
          h("span", { class: "st-k" }, "천수"), ` ${end}년까지`,
          added !== 0 ? h("b", tone, ` (${signedYears(added)})`) : null,
          ` · ${plan.toYear}년에 ${Math.max(0, end - plan.toYear)}년 남음`),
        ...(parts.length ? [h("p", { class: "muted" }, parts.join(" · "))] : []),
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
    // What the offering buys moves with the plan (선행·구휼, 출가 add 공덕), so renderProjection writes it.
    const offerLine = h("span", null);
    const offerBtn = h("button", {
      type: "button",
      class: `yr-offer${offer ? " on" : ""}`,
      role: "switch",
      "aria-checked": String(offer),
      onclick: () => {
        offer = !offer;
        offerBtn.setAttribute("aria-checked", String(offer));
        offerBtn.classList.toggle("on", offer);
        this.#audio.sfx(offer ? "heal" : "ui_click");
        renderProjection();
      },
    },
    h("span", { class: "offer-star", "aria-hidden": "true" }, "✦"),
    h("span", { class: "offer-text" }, h("strong", null, "노인성 봉헌"), offerLine),
    h("span", { class: "switch", "aria-hidden": "true" }));
    // The last grace is offered only while it can be taken, and only ever on the player's word.
    const graceBtn = graceYears > 0
      ? h("button", {
        type: "button",
        class: "yr-offer",
        role: "switch",
        "aria-checked": "false",
        onclick: () => {
          grace = !grace;
          graceBtn?.setAttribute("aria-checked", String(grace));
          graceBtn?.classList.toggle("on", grace);
          this.#audio.sfx(grace ? "heal" : "ui_click");
          renderProjection();
        },
      },
      h("span", { class: "offer-star", "aria-hidden": "true" }, "✧"),
      h("span", { class: "offer-text" },
        h("strong", null, "노인성의 마지막 은혜"),
        h("span", null, `단 한 번 · 천수 +${graceYears}년 · 봉헌하고 남은 공덕 전부와 명망 10을 바친다`)),
      h("span", { class: "switch", "aria-hidden": "true" }))
      : null;
    const renderAll = () => {
      renderTrack();
      renderCards();
      renderWashes();
      renderProjection();
    };
    renderAll();

    const confirm = button(`세월을 보낸다 · ${plan.toYear}년으로`, () => {
      if (wash && validateName(nameInput.value)) {
        this.#audio.sfx("denied");
        nameInput.focus();
        return;
      }
      const name = wash ? nameInput.value.trim() : undefined;
      this.#prompt = null;
      confirm.disabled = true;
      this.#audio.sfx("choice");
      // The roll starts here, before the plan leaves, so the host's answer finds it running.
      const passage = this.#roll(plan.fromYear, plan.toYear);
      this.#submit({ prompt: p.id, activities: [...chosen], wash: wash ?? undefined, name, offer, grace }, passage);
    }, { class: "btn btn-primary btn-wide", "data-action": "years-confirm" });

    // Title: the host's card title. Kicker: how far the counter moves (the roll's span).
    // The era the tokens stand for is the plan's summary, under the next era's line.
    return paperPanel(
      { title: p.title, kicker: rollSpan(plan.fromYear, plan.toYear), glyph: "年", class: "years-panel", footer: h("div", { class: "yr-foot" }, summary, confirm) },
      h("div", { class: "yr-grid" },
      h("div", { class: "yr-main" },
      p.body.length ? h("div", { class: "yr-body" }, ...p.body.map((t) => h("p", null, t))) : null,
      h("h3", { class: "sub-title" }, plan.summary),
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
      graceBtn,
      projection)),
    );
  }
}
