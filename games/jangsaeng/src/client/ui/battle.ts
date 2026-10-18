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
  /** BattleView.alt: beside the title, so the compact layout (no subtitle) keeps it. */
  readonly #alt = h("span", { class: "hn-tag bt-alt hidden", title: "게임 속 대체역사" }, "대체역사");
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
        h("span", { class: "bt-titles" }, h("span", null, this.#title, " ", this.#alt), this.#sub), this.#status),
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
    toggle(this.#alt, "hidden", !battle.alt);
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
  #downed = false;
  /** Nobody can raise the player any more: the host's down timer ran out. */
  #alone = false;
  #wasActive = false;
  readonly #onActive: () => void;

  /** `onActive`: the full overlay opened or closed (the UI holds toasts under it). */
  constructor(onRevive: () => void, onActive: () => void) {
    this.#onActive = onActive;
    // rules/lifespan.ts selfRevive: the first in each chapter is free, then a year each.
    const revive = button(h("span", null, "자력 소생 ", h("small", null, "장마다 첫 소생 무료 · 이후 천수 −1년")), onRevive, { class: "btn btn-danger dn-btn" });
    this.el = h(
      "section",
      { class: "downed hidden", role: "alertdialog", "aria-label": "사경" },
      h("div", { class: "dn-center" },
        h("p", { class: "dn-title" }, "사경", h("small", null, "死境")),
        h("p", { class: "dn-line" }, this.#count, h("small", null, "초")),
        h("p", { class: "dn-wait" }, "동료를 기다리는 중…"),
        h("p", { class: "dn-alone" }, "일으켜 줄 이가 없다 — 스스로 일어서야 한다"),
        revive),
    );
  }

  /**
   * The full 사경 overlay is up (the countdown while others can still help).
   * Once nobody can — the host's timer ran out — it closes and only a small
   * self-revive plate stays while the player is down. (A lost battle's fallen
   * are stood up by the host, so the overlay simply goes away then.)
   */
  get active(): boolean {
    return this.#downed && !this.#alone;
  }

  /** The host's facts decide; the local clock only animates the countdown between them. */
  update(self: SelfView, now: number): void {
    const d = self.dead ? undefined : self.downed;
    if (!d) this.#alone = false;
    else {
      // Only the host knows whether anyone can still raise the player.
      if (d.secondsLeft <= 0) this.#alone = true;
      this.#endsAt = now + d.secondsLeft * 1000;
    }
    this.#downed = !!d;
    toggle(this.el, "hidden", !this.#downed);
    toggle(this.el, "alone", this.#alone);
    this.tick(now);
    const active = this.active;
    if (active !== this.#wasActive) {
      this.#wasActive = active;
      this.#onActive();
    }
  }

  tick(now: number): void {
    // Never "0초": the host's own zero closes the countdown.
    if (this.active) setText(this.#count, String(Math.max(1, Math.ceil((this.#endsAt - now) / 1000))));
  }
}
