// Skill slots 1–4, 노인성 일섬 (slot 5) and the quick item slot. The same slot
// state drives the desktop bar and the touch cluster: cooldown sweeps are
// interpolated locally between `self` updates, energy gating dims a slot.
import type { ItemView, SelfView, SkillView } from "../../shared/types.ts";
import { h, setStyle, setText, toggle } from "./dom.ts";
import { SKILL_GLYPH } from "./labels.ts";

export const LONGEVITY_MAX = 3;

interface SlotState {
  skill: SkillView | null;
  readyAt: number;
  cooldown: number;
}

export interface SlotView {
  slot: number;
  el: HTMLElement;
  glyph: HTMLElement;
  cd: HTMLElement;
  name?: HTMLElement;
  uses?: HTMLElement;
}

export function slotView(slot: number, cls: string, withName: boolean): SlotView {
  const glyph = h("span", { class: "sk-glyph", "aria-hidden": "true" });
  const cd = h("span", { class: "sk-cd", "aria-hidden": "true" });
  const name = withName ? h("span", { class: "sk-name" }) : undefined;
  const uses = slot === 5 ? h("span", { class: "sk-uses" }) : undefined;
  const el = h(
    "button",
    { type: "button", class: `sk ${cls}${slot === 5 ? " sk-longevity" : ""}`, "data-slot": String(slot) },
    glyph,
    cd,
    h("span", { class: "sk-key", "aria-hidden": "true" }, String(slot)),
    uses,
    name,
  );
  return { slot, el, glyph, cd, name, uses };
}

export class SkillState {
  readonly #slots = new Map<number, SlotState>();
  readonly #views: SlotView[] = [];
  readonly #items: { el: HTMLElement; glyph: HTMLElement; count: HTMLElement }[] = [];
  #energy = 0;
  #uses = 0;
  #quick: ItemView | null = null;

  register(view: SlotView): void {
    this.#views.push(view);
  }

  registerItem(el: HTMLElement, glyph: HTMLElement, count: HTMLElement): void {
    this.#items.push({ el, glyph, count });
  }

  get quickItem(): ItemView | null {
    return this.#quick;
  }

  update(self: SelfView, now: number): void {
    this.#energy = self.energy;
    this.#uses = self.longevityUses;
    this.#slots.clear();
    for (const sk of self.skills) {
      const slot = sk.kind === "longevity" ? 5 : sk.slot;
      if (slot === null || slot < 1 || slot > 5) continue;
      this.#slots.set(slot, { skill: sk, readyAt: now + sk.ready * 1000, cooldown: sk.cooldown });
    }
    for (const v of this.#views) {
      const st = this.#slots.get(v.slot);
      const sk = st?.skill ?? null;
      setText(v.glyph, sk ? (SKILL_GLYPH[sk.kind] ?? sk.name.slice(0, 1)) : "");
      if (v.name) setText(v.name, sk ? (v.slot === 5 ? "일섬" : sk.name) : "");
      const label = sk
        ? `${v.slot}: ${sk.name} — ${sk.desc}${sk.energy ? ` (기력 ${sk.energy})` : ""}${v.slot === 5 ? " · 천수 −1년" : ""}`
        : `${v.slot}번 칸 비어 있음`;
      v.el.title = label;
      v.el.setAttribute("aria-label", label);
      toggle(v.el, "empty", !sk);
      if (v.uses) setText(v.uses, `${Math.max(0, LONGEVITY_MAX - self.longevityUses)}/${LONGEVITY_MAX}`);
    }
    this.#quick =
      self.inventory.find((i) => i.kind === "consumable" && i.count > 0 && i.id !== "ginseng") ??
      self.inventory.find((i) => i.kind === "consumable" && i.count > 0) ??
      null;
    for (const it of this.#items) {
      const q = this.#quick;
      setText(it.glyph, q ? q.name : "");
      setText(it.count, q ? String(q.count) : "");
      it.el.title = q ? `${q.name} 사용 — ${q.desc}` : "쓸 수 있는 소모품이 없다";
      toggle(it.el, "empty", !q);
    }
    this.tick(now);
  }

  /** Per-frame: cooldown sweep and gating. */
  tick(now: number): void {
    for (const v of this.#views) {
      const st = this.#slots.get(v.slot);
      if (!st?.skill) continue;
      const left = Math.max(0, (st.readyAt - now) / 1000);
      const frac = st.cooldown > 0 ? Math.min(1, left / st.cooldown) : 0;
      setStyle(v.el, "--cd", frac.toFixed(3));
      setText(v.cd, left > 0.05 ? (left >= 10 ? String(Math.ceil(left)) : left.toFixed(1)) : "");
      toggle(v.el, "cooling", left > 0.05);
      toggle(v.el, "no-energy", st.skill.energy > this.#energy);
      if (v.slot === 5) toggle(v.el, "spent", this.#uses >= LONGEVITY_MAX);
    }
  }
}

export class SkillBar {
  readonly el: HTMLElement;

  constructor(state: SkillState, onSkill: (slot: number) => void, onItem: () => void) {
    const slots = [1, 2, 3, 4, 5].map((n) => {
      const v = slotView(n, "sk-bar", true);
      v.el.addEventListener("click", () => onSkill(n));
      state.register(v);
      return v.el;
    });
    const glyph = h("span", { class: "it-name" });
    const count = h("span", { class: "it-count" });
    const item = h("button", { type: "button", class: "sk sk-item sk-bar", onclick: onItem }, glyph, count);
    state.registerItem(item, glyph, count);
    this.el = h(
      "section",
      { class: "hud-skills", "aria-label": "기술" },
      h("div", { class: "sk-row" }, ...slots.slice(0, 4)),
      h("div", { class: "sk-special" }, slots[4], item),
    );
  }
}
