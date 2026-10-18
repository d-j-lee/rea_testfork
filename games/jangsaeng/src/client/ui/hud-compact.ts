// Compact HUD for phones (narrow or short screens): a ≤64px top bar, a
// one-line objective strip and small chat/menu buttons. Each expands into a
// drawer (the full status card, objective tracker or chat) that blocks input.
import { FINAL_YEAR, type SelfView } from "../../shared/types.ts";
import { button, h, meter, ratio, setMeter, setText, toggle } from "./dom.ts";
import { inputHintText, touchInput } from "./hud-objectives.ts";
import { lifeWarning, SUSPICION_BANDS } from "./labels.ts";

export type Drawer = "status" | "objectives" | "chat";

export class CompactBar {
  readonly el: HTMLButtonElement;
  readonly #name = h("b", { class: "cb-name" });
  readonly #lv = h("span", { class: "cb-lv" });
  readonly #time = h("span", { class: "cb-time" });
  readonly #hp = meter("cb-hp");
  readonly #en = meter("cb-en");
  readonly #st = meter("cb-st");
  readonly #life = h("span", { class: "cb-chip cb-life" });
  readonly #susp = h("span", { class: "cb-chip cb-susp" });
  readonly #mode = h("span", { class: "cb-chip cb-mode" });

  constructor(onTap: () => void) {
    this.el = h(
      "button",
      { type: "button", class: "cbar lacquer", "aria-label": "인물 상태 펼치기", onclick: onTap },
      h("span", { class: "cb-row" }, this.#name, this.#lv, this.#time),
      h("span", { class: "cb-bars" }, this.#hp.root, this.#en.root, this.#st.root),
      h("span", { class: "cb-row cb-chips" }, this.#life, this.#susp, this.#mode),
    );
  }

  setMode(text: string): void {
    setText(this.#mode, text);
  }

  update(self: SelfView): void {
    setText(this.#name, self.name);
    setText(this.#lv, `Lv ${self.level}`);
    setText(this.#time, `${self.year}년 · 외견 ${self.apparentAge}세`);
    setMeter(this.#hp, ratio(self.hp, self.maxHp));
    toggle(this.#hp.root, "low", self.hp > 0 && self.hp / Math.max(1, self.maxHp) < 0.3);
    setMeter(this.#en, ratio(self.energy, self.maxEnergy));
    setMeter(this.#st, ratio(self.stamina, 100));
    const life = lifeWarning(self);
    setText(this.#life, life === "ok" ? `천수 ${Math.max(0, self.lifeEnd - self.year)}년` : `천수 ${self.lifeEnd} −${self.lifeShortfall}`);
    this.#life.dataset.life = life;
    this.#life.title = life === "ok" ? "" : life === "near" ? `이대로면 ${self.lifeEnd}년에 천수가 다한다 · ${FINAL_YEAR}년까지 ${self.lifeShortfall}년 부족` : `${FINAL_YEAR}년에 닿으려면 천수가 ${self.lifeShortfall}년 더 필요하다`;
    const band = SUSPICION_BANDS[self.suspicionBand];
    setText(this.#susp, band.label);
    this.#susp.title = `의심도 ${Math.round(self.suspicion)} · ${band.label}`;
    this.#susp.dataset.tone = band.tone;
    this.el.setAttribute("aria-label", `${self.name} Lv ${self.level}, 체력 ${Math.ceil(self.hp)}/${self.maxHp} — 상태 펼치기`);
  }
}

export class CompactRow {
  readonly el: HTMLElement;
  readonly #strip: HTMLButtonElement;
  readonly #text = h("span", { class: "cs-text" });
  readonly #prog = h("span", { class: "cs-prog" });
  readonly #skip: HTMLButtonElement;
  readonly #badge = h("span", { class: "c-badge hidden", "aria-hidden": "true" });
  #unread = 0;

  constructor(handlers: { onObjectives(): void; onChat(): void; onMenu(): void; onSkip(): void }) {
    this.#strip = h("button", { type: "button", class: "cstrip", "aria-label": "목표 펼치기", onclick: handlers.onObjectives },
      h("span", { class: "cs-dia", "aria-hidden": "true" }, "◆"), this.#text, this.#prog, h("span", { class: "cs-more", "aria-hidden": "true" }, "▾"));
    this.#skip = button("⏭", handlers.onSkip, { class: "cbtn cbtn-skip hidden", "aria-label": "시연: 건너뛰기", title: "시연: 건너뛰기" });
    const chat = button(h("span", { class: "cbtn-glyph", "aria-hidden": "true" }, "話"), handlers.onChat, { class: "cbtn", "aria-label": "채팅" });
    chat.appendChild(this.#badge);
    const menu = button(h("span", { "aria-hidden": "true" }, "≡"), handlers.onMenu, { class: "cbtn cbtn-menu", "aria-label": "메뉴" });
    this.el = h("div", { class: "crow" }, this.#strip, this.#skip, chat, menu);
  }

  update(self: SelfView): void {
    toggle(this.#skip, "hidden", !self.demo);
    const pending = self.objectives.filter((o) => !o.done);
    const cur = pending.find((o) => !o.optional) ?? pending[0];
    // The device-neutral instruction comes first so truncation cuts the control names, not the task.
    const keys = cur ? inputHintText(cur.hint, touchInput()) : "";
    const text = cur ? `${cur.optional ? "선택 · " : ""}${cur.alt ? "대체역사 · " : ""}${cur.text}${keys ? ` · ${keys}` : ""}` : "";
    setText(this.#text, cur ? text : self.objectives.length ? "이 단계의 목표를 모두 마쳤다" : "지금은 정해진 목표가 없다");
    setText(this.#prog, cur?.progress ? `${cur.progress[0]}/${cur.progress[1]}` : pending.length > 1 ? `+${pending.length - 1}` : "");
    toggle(this.#strip, "done", !cur);
  }

  addUnread(): void {
    this.#unread = Math.min(99, this.#unread + 1);
    setText(this.#badge, String(this.#unread));
    toggle(this.#badge, "hidden", false);
  }

  clearUnread(): void {
    this.#unread = 0;
    toggle(this.#badge, "hidden", true);
  }
}
