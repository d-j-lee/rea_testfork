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
import { ChatPanel } from "./chat.ts";
import { h, toggle } from "./dom.ts";
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
  compactChat: boolean;
}

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
  #self: SelfView | null = null;

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
    this.touch = new TouchControls(deps.input, this.skills, () => deps.command("menu"), useItem);
    this.touchEl = this.touch.el;
    this.downedEl = this.downed.el;
    this.el = h(
      "div",
      { class: "hud" },
      h("div", { class: "hud-tl" }, this.status.el),
      h("div", { class: "hud-tc" }, this.battle.el),
      h("div", { class: "hud-tr" }, this.map.el, this.objectives.el),
      h("div", { class: "hud-bl" }, this.chat.el),
      h("div", { class: "hud-br" }, bar.el),
    );
  }

  get self(): SelfView | null {
    return this.#self;
  }

  update(self: SelfView, offline: boolean): void {
    const now = performance.now();
    this.#self = self;
    this.status.update(self);
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
