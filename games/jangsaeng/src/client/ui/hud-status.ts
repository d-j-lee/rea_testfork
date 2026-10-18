// Top-left status card: name, level/exp, HP · 기력 · 지구력, year and ages,
// 천수 (lifespan) track with the 1910 goal, 의심도 gauge and rank/office.
import { AWAKENING_YEAR, FINAL_YEAR, type SelfView } from "../../shared/types.ts";
import { h, meter, ratio, setMeter, setStyle, setText, toggle } from "./dom.ts";
import { IDENTITY_LABELS, lifeWarning, meritLabel, SUSPICION_BANDS } from "./labels.ts";

export class StatusCard {
  readonly el: HTMLElement;
  readonly #name = h("span", { class: "st-name-text" });
  readonly #nameBtn: HTMLButtonElement;
  readonly #birth = h("p", { class: "st-birth" });
  readonly #level = h("b");
  readonly #exp = meter("meter-exp");
  readonly #hp = meter("meter-hp");
  readonly #en = meter("meter-en");
  readonly #st = meter("meter-st");
  readonly #time = h("p", { class: "st-time" });
  readonly #lifeText = h("span", { class: "st-life-text" });
  readonly #lifeTrack = h("span", { class: "life-track" },
    h("span", { class: "life-past" }), h("span", { class: "life-left" }), h("span", { class: "life-gap" }),
    h("span", { class: "life-goal", title: `${FINAL_YEAR}년` }));
  readonly #warn = h("p", { class: "st-warn", role: "status" });
  readonly #short = h("span", { class: "st-short" });
  readonly #susp = meter("meter-susp");
  readonly #suspBand = h("span", { class: "susp-band" });
  readonly #rank = h("span", { class: "st-rank-text" });
  readonly #merit = h("span", { class: "merit-badge" });
  #last: SelfView | null = null;

  constructor() {
    this.#nameBtn = h("button", { type: "button", class: "st-name", "aria-expanded": "false" }, this.#name);
    this.#nameBtn.addEventListener("click", () => {
      const open = !this.el.classList.contains("show-birth");
      this.el.classList.toggle("show-birth", open);
      this.#nameBtn.setAttribute("aria-expanded", String(open));
    });
    this.el = h(
      "section",
      { class: "hud-status lacquer", "aria-label": "인물 상태" },
      h("div", { class: "st-head" }, this.#nameBtn, h("span", { class: "st-lv" }, "Lv ", this.#level)),
      this.#birth,
      this.#exp.root,
      h("div", { class: "st-bars" },
        h("div", { class: "bar-row" }, h("span", { class: "bar-label" }, "체력"), this.#hp.root),
        h("div", { class: "bar-row" }, h("span", { class: "bar-label" }, "기력"), this.#en.root),
        h("div", { class: "bar-row" }, h("span", { class: "bar-label" }, "지구력"), this.#st.root)),
      this.#time,
      h("div", { class: "st-life" }, h("span", { class: "st-k" }, "천수"), h("span", { class: "st-life-line" }, this.#lifeText, this.#short), this.#lifeTrack),
      this.#warn,
      h("div", { class: "st-susp" },
        h("span", { class: "st-k" }, h("span", { class: "eye", "aria-hidden": "true" }), "의심도"),
        this.#susp.root, this.#suspBand),
      h("p", { class: "st-rank" }, this.#rank, this.#merit),
    );
  }

  update(self: SelfView): void {
    const prev = this.#last;
    this.#last = self;
    setText(this.#name, self.name);
    const washed = self.name !== self.birthName;
    this.#nameBtn.title = washed ? `본명 ${self.birthName}` : "본명 그대로";
    setText(this.#birth, washed ? `본명 ${self.birthName} · ${IDENTITY_LABELS[self.identityKind]}` : `본명 그대로 · ${IDENTITY_LABELS[self.identityKind]}`);
    setText(this.#level, self.level);
    setMeter(this.#exp, ratio(self.exp, self.expNext));
    this.#exp.root.title = `경험 ${self.exp} / ${self.expNext}`;
    setMeter(this.#hp, ratio(self.hp, self.maxHp));
    setText(this.#hp.text, `${Math.ceil(self.hp)} / ${self.maxHp}`);
    toggle(this.#hp.root, "low", self.hp > 0 && self.hp / Math.max(1, self.maxHp) < 0.3);
    setMeter(this.#en, ratio(self.energy, self.maxEnergy));
    setText(this.#en.text, `${Math.floor(self.energy)} / ${self.maxEnergy}`);
    setMeter(this.#st, ratio(self.stamina, 100));
    setText(this.#st.text, `${Math.floor(self.stamina)}`);
    setText(this.#time, `${self.year}년 · 실제 ${self.age}세 · 외견 ${self.apparentAge}세`);

    const left = self.lifeEnd - self.year;
    setText(this.#lifeText, `${self.lifeEnd}년까지 · ${Math.max(0, left)}년 남음`);
    const end = Math.max(FINAL_YEAR, self.lifeEnd);
    const span = end - AWAKENING_YEAR;
    const at = (y: number) => ratio(y - AWAKENING_YEAR, span);
    setStyle(this.#lifeTrack, "--now", at(self.year).toFixed(4));
    setStyle(this.#lifeTrack, "--end", at(self.lifeEnd).toFixed(4));
    setStyle(this.#lifeTrack, "--goal", at(FINAL_YEAR).toFixed(4));
    this.#lifeTrack.title = `${AWAKENING_YEAR} 각성 · 지금 ${self.year} · 천수 ${self.lifeEnd} · 목표 ${FINAL_YEAR}`;
    // A shortfall decades away is a calm amber note; red only when life runs out.
    const life = lifeWarning(self);
    this.el.dataset.life = life;
    setText(this.#warn, life === "near" ? `이대로면 ${self.lifeEnd}년에 천수가 다한다` : life === "far" ? `${FINAL_YEAR}년에 닿으려면 천수가 ${self.lifeShortfall}년 더 필요하다` : "");
    setText(this.#short, life === "ok" ? "" : `−${self.lifeShortfall}년`);
    this.#short.title = life === "ok" ? "" : `${FINAL_YEAR}년까지 ${self.lifeShortfall}년 부족`;

    const band = SUSPICION_BANDS[self.suspicionBand];
    setMeter(this.#susp, ratio(self.suspicion, 100));
    setText(this.#susp.text, String(Math.round(self.suspicion)));
    setText(this.#suspBand, band.label);
    this.#susp.root.dataset.tone = band.tone;
    this.#suspBand.dataset.tone = band.tone;

    setText(this.#rank, self.office ? `${self.rankName} · ${self.office}` : self.rankName);
    setText(this.#merit, self.meritSubject ? meritLabel(self.meritSubject) : "");
    toggle(this.#merit, "hidden", !self.meritSubject);

    if (prev && self.level > prev.level) this.#flash("lv-up");
    if (prev && self.hp < prev.hp - 1) this.#flash("hurt");
  }

  #flash(cls: string): void {
    this.el.classList.remove(cls);
    void this.el.offsetWidth;
    this.el.classList.add(cls);
  }
}
