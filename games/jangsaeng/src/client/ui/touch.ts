// Touch controls: a floating joystick on the left, and on the right a thumb
// arc of 공격 (hold), 활 (hold), 구르기, 상호작용, skills 1–4 and 일섬. Hidden
// whenever a dialog or menu is open so it never covers them.
import type { Input } from "../input.ts";
import { h } from "./dom.ts";
import { slotView, type SkillState } from "./hud-skills.ts";

const STICK_R = 56;
const DEAD = 0.14;

function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

function holdButton(label: string, glyph: string, cls: string, onDown: () => void, onUp: () => void): HTMLElement {
  const el = h("button", { type: "button", class: `tc-btn ${cls}`, "aria-label": label },
    h("span", { class: "tc-glyph", "aria-hidden": "true" }, glyph), h("span", { class: "tc-label" }, label));
  let id: number | null = null;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    id = e.pointerId;
    el.setPointerCapture(e.pointerId);
    el.classList.add("down");
    vibrate(8);
    onDown();
  });
  const up = (e: PointerEvent) => {
    if (id !== e.pointerId) return;
    id = null;
    el.classList.remove("down");
    onUp();
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  return el;
}

export class TouchControls {
  readonly el: HTMLElement;
  readonly #input: Input;
  readonly #knob = h("span", { class: "stick-knob" });
  readonly #base = h("span", { class: "stick-base hidden" }, this.#knob);
  #stickId: number | null = null;
  #origin = { x: 0, y: 0 };

  constructor(input: Input, skills: SkillState, onItem: () => void) {
    this.#input = input;
    const zone = h("div", { class: "stick-zone", "aria-hidden": "true" }, this.#base);
    zone.addEventListener("pointerdown", (e) => this.#stickDown(e, zone));
    zone.addEventListener("pointermove", (e) => this.#stickMove(e));
    const end = (e: PointerEvent) => this.#stickUp(e);
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
    zone.addEventListener("lostpointercapture", end);

    const attack = holdButton("공격", "劍", "tc-attack", () => input.setVirtualButton("attack", true), () => input.setVirtualButton("attack", false));
    const shoot = holdButton("활", "弓", "tc-shoot", () => input.setVirtualButton("shoot", true), () => input.setVirtualButton("shoot", false));
    const dodge = holdButton("구르기", "轉", "tc-dodge", () => {
      input.setVirtualButton("dodge", true);
      window.setTimeout(() => input.setVirtualButton("dodge", false), 140);
    }, () => undefined);
    const interact = holdButton("행동", "手", "tc-interact", () => input.pressInteract(), () => undefined);
    const slots = [1, 2, 3, 4, 5].map((n) => {
      const v = slotView(n, `tc-skill tc-s${n}`, false);
      v.el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        vibrate(6);
        input.pressSkill(n);
      });
      skills.register(v);
      return v.el;
    });
    const itemGlyph = h("span", { class: "it-name" });
    const itemCount = h("span", { class: "it-count" });
    const item = h("button", { type: "button", class: "sk sk-item tc-item", "aria-label": "소모품 사용" }, itemGlyph, itemCount);
    item.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onItem();
    });
    skills.registerItem(item, itemGlyph, itemCount);
    this.el = h(
      "div",
      { class: "touch-layer" },
      zone,
      h("div", { class: "tc-cluster" }, attack, shoot, dodge, interact, ...slots, item),
    );
  }

  /** Releases everything (dialog opened, controls hidden). */
  release(): void {
    this.#stickId = null;
    this.#base.classList.add("hidden");
    this.#input.setVirtualMove(0, 0);
    this.#input.setVirtualButton("attack", false);
    this.#input.setVirtualButton("shoot", false);
    this.#input.setVirtualButton("dodge", false);
  }

  #stickDown(e: PointerEvent, zone: HTMLElement): void {
    if (this.#stickId !== null) return;
    e.preventDefault();
    this.#stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const rect = zone.getBoundingClientRect();
    this.#origin = { x: e.clientX, y: e.clientY };
    this.#base.style.left = `${e.clientX - rect.left}px`;
    this.#base.style.top = `${e.clientY - rect.top}px`;
    this.#base.classList.remove("hidden");
    this.#knob.style.transform = "translate(-50%, -50%)";
  }

  #stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.#stickId) return;
    let dx = e.clientX - this.#origin.x;
    let dy = e.clientY - this.#origin.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx = (dx / d) * STICK_R;
      dy = (dy / d) * STICK_R;
    }
    this.#knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / STICK_R;
    const ny = dy / STICK_R;
    if (Math.hypot(nx, ny) < DEAD) this.#input.setVirtualMove(0, 0);
    else this.#input.setVirtualMove(nx, ny);
  }

  #stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.#stickId) return;
    this.#stickId = null;
    this.#base.classList.add("hidden");
    this.#input.setVirtualMove(0, 0);
  }
}
