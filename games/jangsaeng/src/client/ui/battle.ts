// Battle banner (title, wave or timer, boss bar, defend bar, morale) and the
// downed (사경) overlay with the self-revive choice.
import type { BattleView, SelfView } from "../../shared/types.ts";
import { button, formatSeconds, h, meter, ratio, setMeter, setText, toggle } from "./dom.ts";

/** Boss bar label: role, name and the record marker (an invented boss is 가상). */
function bossLabel(boss: NonNullable<BattleView["boss"]>): string {
  const name = boss.title ? `${boss.title} ${boss.name}` : boss.name;
  return `${name} (${boss.historical ? "기록상" : "가상"})`;
}

export class BattleBanner {
  readonly el: HTMLElement;
  readonly #title = h("strong", { class: "bt-title" });
  readonly #sub = h("span", { class: "bt-sub" });
  readonly #status = h("span", { class: "bt-status" });
  readonly #bossName = h("span", { class: "bt-boss-name" });
  readonly #boss = meter("meter-boss");
  readonly #bossRow: HTMLElement;
  readonly #defName = h("span", { class: "bt-def-name" });
  readonly #def = meter("meter-def");
  readonly #defRow: HTMLElement;
  readonly #morale = meter("meter-morale");
  readonly #moraleRow: HTMLElement;
  #battle: BattleView | null = null;
  #endsAt = 0;
  #id = "";

  constructor() {
    this.#bossRow = h("div", { class: "bt-row bt-bossrow" }, this.#bossName, this.#boss.root);
    this.#defRow = h("div", { class: "bt-row" }, this.#defName, this.#def.root);
    this.#moraleRow = h("div", { class: "bt-row bt-small" }, h("span", { class: "bt-k" }, "사기"), this.#morale.root);
    this.el = h(
      "section",
      { class: "hud-battle hidden", "aria-label": "전투" },
      h("header", { class: "bt-head" }, h("span", { class: "bt-mark", "aria-hidden": "true" }, "戰"),
        h("span", { class: "bt-titles" }, this.#title, this.#sub), this.#status),
      this.#bossRow,
      this.#defRow,
      this.#moraleRow,
    );
  }

  update(battle: BattleView | undefined, now: number): void {
    toggle(this.el, "hidden", !battle);
    this.#battle = battle ?? null;
    if (!battle) {
      this.#id = "";
      return;
    }
    if (battle.id !== this.#id) {
      this.#id = battle.id;
      this.el.classList.remove("enter");
      void this.el.offsetWidth;
      this.el.classList.add("enter");
    }
    setText(this.#title, battle.title);
    setText(this.#sub, battle.subtitle ?? "");
    this.#endsAt = battle.timeLeft !== undefined ? now + battle.timeLeft * 1000 : 0;
    toggle(this.#bossRow, "hidden", !battle.boss);
    if (battle.boss) {
      setText(this.#bossName, bossLabel(battle.boss));
      setMeter(this.#boss, ratio(battle.boss.hp, 100));
      setText(this.#boss.text, `${Math.ceil(battle.boss.hp)}%`);
    }
    toggle(this.#defRow, "hidden", !battle.defend);
    if (battle.defend) {
      setText(this.#defName, `지킬 것 · ${battle.defend.name}`);
      setMeter(this.#def, ratio(battle.defend.hp, 100));
      setText(this.#def.text, `${Math.ceil(battle.defend.hp)}%`);
      toggle(this.#def.root, "low", battle.defend.hp < 30);
    }
    toggle(this.#moraleRow, "hidden", battle.morale === undefined);
    if (battle.morale !== undefined) {
      setMeter(this.#morale, ratio(battle.morale, 100));
      setText(this.#morale.text, `${Math.round(battle.morale)}`);
    }
    this.tick(now);
  }

  tick(now: number): void {
    const b = this.#battle;
    if (!b) return;
    const parts: string[] = [];
    if (b.wave) parts.push(`${b.wave[0]} / ${b.wave[1]} 파`);
    if (this.#endsAt) parts.push(formatSeconds((this.#endsAt - now) / 1000));
    if (b.participants > 1) parts.push(`참전 ${b.participants}`);
    setText(this.#status, parts.join(" · "));
    toggle(this.#status, "urgent", !!this.#endsAt && this.#endsAt - now < 10_000);
  }
}

export class DownedOverlay {
  readonly el: HTMLElement;
  readonly #count = h("span", { class: "dn-count" });
  #endsAt = 0;
  #on = false;

  constructor(onRevive: () => void) {
    // rules/lifespan.ts selfRevive: the first in each chapter is free, then a year each.
    const revive = button(h("span", null, "자력 소생 ", h("small", null, "장마다 첫 번 무료 · 이후 천수 −1년")), onRevive, { class: "btn btn-danger dn-btn" });
    this.el = h(
      "section",
      { class: "downed hidden", role: "alertdialog", "aria-label": "사경" },
      h("div", { class: "dn-center" },
        h("p", { class: "dn-title" }, "사경", h("small", null, "死境")),
        h("p", { class: "dn-line" }, this.#count, h("small", null, "초")),
        h("p", { class: "dn-wait" }, "동료를 기다리는 중…"),
        revive),
    );
  }

  get active(): boolean {
    return this.#on;
  }

  update(self: SelfView, now: number): void {
    const d = self.downed;
    this.#on = !!d && !self.dead;
    toggle(this.el, "hidden", !this.#on);
    if (d) this.#endsAt = now + d.secondsLeft * 1000;
    this.tick(now);
  }

  tick(now: number): void {
    if (!this.#on) return;
    const left = Math.max(0, Math.ceil((this.#endsAt - now) / 1000));
    setText(this.#count, String(left));
  }
}
