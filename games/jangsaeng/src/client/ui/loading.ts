// Loading overlay: an ink 원상(圓相) brush circle and rotating era lines.
import { h, s } from "./dom.ts";
import { ERA_QUOTES } from "./labels.ts";
import { DISCLAIMER } from "./title.ts";

export interface LoadingScreen {
  el: HTMLElement;
  setText(text: string): void;
  destroy(): void;
}

export function createLoading(): LoadingScreen {
  const text = h("p", { class: "loading-text", role: "status", "aria-live": "polite" });
  let index = Math.floor(Math.random() * ERA_QUOTES.length);
  const quote = h("p", { class: "loading-quote" }, ERA_QUOTES[index] ?? "");
  const enso = s(
    "svg",
    { class: "enso", viewBox: "0 0 120 120", "aria-hidden": "true" },
    s("circle", { class: "enso-track", cx: "60", cy: "60", r: "44" }),
    s("circle", { class: "enso-stroke", cx: "60", cy: "60", r: "44" }),
    s("circle", { class: "enso-star", cx: "60", cy: "16", r: "3.2" }),
  );
  const el = h(
    "div",
    { class: "screen loading-screen" },
    h("div", { class: "loading-center" }, enso, text, quote),
    h("p", { class: "disclaimer loading-disclaimer" }, DISCLAIMER),
  );
  const timer = window.setInterval(() => {
    index = (index + 1) % ERA_QUOTES.length;
    quote.classList.remove("in");
    window.setTimeout(() => {
      quote.textContent = ERA_QUOTES[index] ?? "";
      quote.classList.add("in");
    }, 260);
  }, 4200);
  quote.classList.add("in");
  return {
    el,
    setText(value) {
      text.textContent = value;
    },
    destroy() {
      window.clearInterval(timer);
      el.remove();
    },
  };
}
