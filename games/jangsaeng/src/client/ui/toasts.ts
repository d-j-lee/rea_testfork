// Toasts (top-centre), coloured by tone; epic ones carry the star glyph.
// While a full-screen document is open (chapter card, years planner, ending)
// the top stack would sit on its header, so toasts are held: the ones already
// showing are taken back, new ones wait (newest MAX_SHOWN), and all of them
// play once the document closes. Only "bad" toasts (errors the player must
// see now) still show, docked at the bottom — the ones already showing move
// there too, without a second announcement or entry animation.
import { h } from "./dom.ts";

export type Tone = "info" | "good" | "bad" | "warn" | "epic";

const MAX_SHOWN = 4;

interface Live {
  readonly text: string;
  readonly tone: Tone;
  readonly el: HTMLElement;
  timer: number;
  out: boolean;
}

export class Toasts {
  readonly #top = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
  readonly #dock = h("div", { class: "toast-dock", role: "status", "aria-live": "polite" });
  readonly el = h("div", { class: "toast-layer" }, this.#top, this.#dock);
  readonly #live: Live[] = [];
  #held: { text: string; tone: Tone }[] | null = null;

  show(text: string, tone: Tone = "info"): void {
    if (this.#held && tone !== "bad") {
      this.#held.push({ text, tone });
      if (this.#held.length > MAX_SHOWN) this.#held.shift();
      return;
    }
    this.#mount(text, tone, this.#held ? this.#dock : this.#top);
  }

  /** Holds toasts while a full-screen document is open; releasing plays them. */
  hold(on: boolean): void {
    if (on === (this.#held !== null)) return;
    if (on) {
      const held: { text: string; tone: Tone }[] = [];
      for (const live of [...this.#live]) {
        if (live.el.parentElement !== this.#top) continue;
        if (live.tone === "bad") {
          // Already announced and shown: the move must not announce it again
          // (the dock is a live region too) or replay its entry (.moved).
          live.el.setAttribute("aria-hidden", "true");
          live.el.classList.add("moved");
          this.#dock.appendChild(live.el);
        } else {
          if (!live.out) held.push({ text: live.text, tone: live.tone });
          this.#drop(live);
        }
      }
      this.#trim(this.#dock);
      this.#held = held;
      return;
    }
    const held = this.#held ?? [];
    this.#held = null;
    for (const t of held) this.#mount(t.text, t.tone, this.#top);
  }

  #mount(text: string, tone: Tone, stack: HTMLElement): void {
    const el = h(
      "p",
      { class: `toast tone-${tone}` },
      tone === "epic" ? h("span", { class: "toast-star", "aria-hidden": "true" }, "✦") : null,
      h("span", null, text),
    );
    stack.appendChild(el);
    const life = tone === "epic" ? 5200 : tone === "bad" || tone === "warn" ? 4200 : 3200;
    const live: Live = { text, tone, el, timer: 0, out: false };
    live.timer = window.setTimeout(() => {
      live.out = true;
      el.classList.add("out");
      live.timer = window.setTimeout(() => this.#drop(live), 400);
    }, life);
    this.#live.push(live);
    this.#trim(stack);
  }

  /** Keeps the newest MAX_SHOWN toasts in `stack`. */
  #trim(stack: HTMLElement): void {
    const shown = this.#live.filter((l) => l.el.parentElement === stack);
    for (let i = 0; i < shown.length - MAX_SHOWN; i++) this.#drop(shown[i] as Live);
  }

  #drop(live: Live): void {
    window.clearTimeout(live.timer);
    live.el.remove();
    const i = this.#live.indexOf(live);
    if (i >= 0) this.#live.splice(i, 1);
  }
}
