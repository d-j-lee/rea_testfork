// Small DOM toolkit for the UI layer. Every server-provided string goes in via
// text nodes (never innerHTML), so markup in content cannot inject elements.

export type Child = Node | string | number | null | undefined | false | readonly Child[];
type Handler = (event: Event) => void;
export type Props = Record<string, string | number | boolean | null | undefined | Handler>;

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child as readonly Child[]) append(parent, c);
    return;
  }
  if (child instanceof Node) parent.appendChild(child);
  else parent.appendChild(document.createTextNode(String(child)));
}

function applyProps(el: Element, props: Props | null | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") {
      el.addEventListener(key.startsWith("on") ? key.slice(2) : key, value);
    } else if (key === "class") {
      el.setAttribute("class", String(value));
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/** Creates an HTML element: h("div", { class: "x", onclick }, "text", child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  for (const child of children) append(el, child);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Creates an SVG element with attributes. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  for (const child of children) append(el, child);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replace(el: Element, ...children: Child[]): void {
  clear(el);
  for (const child of children) append(el, child);
}

/** Sets textContent only when it changed (avoids layout churn in the HUD). */
export function setText(el: Element, text: string | number): void {
  const value = String(text);
  if (el.textContent !== value) el.textContent = value;
}

export function setStyle(el: HTMLElement | SVGElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 0..1 ratio, safe for zero/negative maxima. */
export const ratio = (v: number, max: number): number => (max > 0 ? clamp(v / max, 0, 1) : 0);

export const pct = (r: number): string => `${(clamp(r, 0, 1) * 100).toFixed(1)}%`;

/** A meter: track + fill (+ optional label). Width is driven by --v (0..1). */
export function meter(cls: string, label?: string): { root: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const fill = h("span", { class: "meter-fill" });
  const text = h("span", { class: "meter-text" }, label ?? "");
  const root = h("span", { class: `meter ${cls}` }, fill, text);
  return { root, fill, text };
}

export function setMeter(m: { root: HTMLElement }, r: number): void {
  setStyle(m.root, "--v", clamp(r, 0, 1).toFixed(3));
}

export function button(
  label: Child,
  onClick: (event: Event) => void,
  props: Props = {},
): HTMLButtonElement {
  return h("button", { type: "button", ...props, onclick: onClick }, label);
}

/** Year with the era suffix used throughout the UI. */
export const yearText = (y: number): string => `${y}년`;

export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Resolves after `ms`, or immediately when reduced motion is on. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function prefersReducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced";
}

/** Focus the first focusable descendant (dialog entry). */
export function focusFirst(root: HTMLElement): void {
  const target = root.querySelector<HTMLElement>(
    "[autofocus], button:not([disabled]), input:not([disabled]), [tabindex='0']",
  );
  target?.focus({ preventScroll: true });
}
