// In-game HUD composition: status (top-left), minimap + menu buttons and the
// objective tracker (top-right), battle banner (top-centre), skill bar
// (bottom-right), chat (bottom-left), downed overlay and the touch layer.
import type { GameMap } from "../../shared/map/generate.ts";
import type { PlayerAction } from "../../shared/protocol.ts";
import type { FrameInfo } from "./index.ts";
import type { SelfView } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import type { Input, UiCommand } from "../input.ts";
import { BattleBanner, DownedOverlay } from "./battle.ts";
import { ChatPanel, type ChatKind } from "./chat.ts";
import { h, toggle } from "./dom.ts";
import { CompactBar, CompactRow, type Drawer } from "./hud-compact.ts";
import { MapPanel } from "./hud-map.ts";
import { ObjectiveTracker } from "./hud-objectives.ts";
import { SkillBar, SkillState } from "./hud-skills.ts";
import { StatusCard } from "./hud-status.ts";
import { TouchControls } from "./touch.ts";

export interface HudDeps {
  audio: AudioEngine;
  input: Input;
  map: GameMap;
  act(action: PlayerAction): void;
  chat(text: string): void;
  command(cmd: UiCommand): void;
  onTyping(typing: boolean): void;
  /** A compact-layout drawer opened or closed. */
  onDrawer(): void;
  /** ≡ on the compact layout: open the menu book. */
  openMenu(): void;
  compactChat: boolean;
}

export const isCompact = (): boolean => document.documentElement.dataset.layout === "compact";

export class Hud {
  readonly el: HTMLElement;
  readonly touchEl: HTMLElement;
  readonly downedEl: HTMLElement;
  readonly status = new StatusCard();
  readonly map: MapPanel;
  readonly objectives: ObjectiveTracker;
  readonly skills = new SkillState();
  readonly battle = new BattleBanner();
  readonly downed: DownedOverlay;
  readonly chat: ChatPanel;
  readonly touch: TouchControls;
  readonly bar: CompactBar;
  readonly row: CompactRow;
  readonly #deps: HudDeps;
  #self: SelfView | null = null;
  #drawer: Drawer | null = null;

  constructor(deps: HudDeps) {
    const useItem = () => {
      const item = this.skills.quickItem;
      if (item) deps.act({ kind: "use", item: item.id });
      else deps.audio.sfx("denied");
    };
    this.map = new MapPanel(deps.map, deps.command);
    this.objectives = new ObjectiveTracker(deps.audio, () => deps.act({ kind: "demoSkip" }));
    this.downed = new DownedOverlay(() => deps.act({ kind: "selfRevive" }));
    this.chat = new ChatPanel(deps.audio, deps.chat, deps.onTyping, deps.compactChat);
    const bar = new SkillBar(this.skills, (n) => deps.input.pressSkill(n), useItem);
    this.#deps = deps;
    this.touch = new TouchControls(deps.input, this.skills, useItem);
    this.touchEl = this.touch.el;
    this.downedEl = this.downed.el;
    this.bar = new CompactBar(() => this.toggleDrawer("status"));
    this.row = new CompactRow({
      onObjectives: () => this.toggleDrawer("objectives"),
      onChat: () => this.toggleDrawer("chat"),
      onMenu: () => deps.openMenu(),
      onSkip: () => deps.act({ kind: "demoSkip" }),
    });
    this.status.el.addEventListener("click", (e) => {
      if (this.#drawer === "status" && !(e.target as HTMLElement).closest(".st-name")) this.closeDrawer();
    });
    this.el = h(
      "div",
      { class: "hud" },
      h("div", { class: "drawer-scrim", onclick: () => this.closeDrawer() }),
      h("div", { class: "hud-cbar" }, this.bar.el),
      h("div", { class: "hud-crow" }, this.row.el),
      h("div", { class: "hud-tl" }, this.status.el),
      h("div", { class: "hud-tc" }, this.battle.el),
      h("div", { class: "hud-tr" }, this.map.el, this.objectives.el),
      h("div", { class: "hud-bl" }, this.chat.el),
      h("div", { class: "hud-br" }, bar.el),
    );
  }

  get drawer(): Drawer | null {
    return this.#drawer;
  }

  toggleDrawer(d: Drawer): void {
    if (this.#drawer === d) {
      this.closeDrawer();
      return;
    }
    this.#deps.audio.sfx("ui_open");
    this.#drawer = d;
    this.el.dataset.drawer = d;
    if (d === "chat") {
      this.row.clearUnread();
      this.chat.setCollapsed(false);
    }
    this.#deps.onDrawer();
  }

  closeDrawer(): void {
    if (!this.#drawer) return;
    if (this.chat.typing) this.chat.close();
    this.#drawer = null;
    delete this.el.dataset.drawer;
    this.#deps.audio.sfx("ui_close");
    this.#deps.onDrawer();
  }

  addChat(from: string, text: string, kind: ChatKind): void {
    this.chat.add(from, text, kind);
    if (kind !== "system" && isCompact() && this.#drawer !== "chat") this.row.addUnread();
  }

  setMode(text: string, short: string): void {
    this.map.setMode(text);
    this.bar.setMode(short);
  }

  get self(): SelfView | null {
    return this.#self;
  }

  update(self: SelfView, offline: boolean): void {
    const now = performance.now();
    this.#self = self;
    this.status.update(self);
    this.bar.update(self);
    this.row.update(self);
    this.map.setYear(self.year);
    this.map.setObjectives(self.objectives);
    this.objectives.update(self);
    this.skills.update(self, now);
    this.battle.update(self.battle, now);
    this.downed.update(self, now);
    this.chat.setChannel(self.channel.name, self.channel.players, self.channel.companions, offline);
    toggle(this.el, "in-battle", !!self.battle);
    toggle(this.el, "is-demo", self.demo);
  }

  frame(info: FrameInfo): void {
    const now = performance.now();
    this.map.draw(info.self, info.ents, this.#self?.id ?? -1, now);
    this.skills.tick(now);
    this.battle.tick(now);
    this.downed.tick(now);
  }
}
