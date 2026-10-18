// Toasts (top-centre), coloured by tone; epic ones carry the star glyph.
import { h } from "./dom.ts";

export type Tone = "info" | "good" | "bad" | "warn" | "epic";

export class Toasts {
  readonly el = h("div", { class: "toasts", role: "status", "aria-live": "polite" });

  show(text: string, tone: Tone = "info"): void {
    const item = h(
      "p",
      { class: `toast tone-${tone}` },
      tone === "epic" ? h("span", { class: "toast-star", "aria-hidden": "true" }, "✦") : null,
      h("span", null, text),
    );
    this.el.appendChild(item);
    while (this.el.childElementCount > 4) this.el.firstElementChild?.remove();
    const life = tone === "epic" ? 5200 : tone === "bad" || tone === "warn" ? 4200 : 3200;
    window.setTimeout(() => {
      item.classList.add("out");
      window.setTimeout(() => item.remove(), 400);
    }, life);
  }
}
