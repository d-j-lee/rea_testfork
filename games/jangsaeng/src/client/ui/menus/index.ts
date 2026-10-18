// In-game menu book: tabs for 인물 · 소지품 · 국운 · 연대기 · 지도 · 도움말 ·
// 설정. Opened by Input commands or HUD buttons; re-renders the open tab when
// the player state changes (keeping its scroll position).
import type { GameMap } from "../../../shared/map/generate.ts";
import type { PlayerAction } from "../../../shared/protocol.ts";
import type { ChapterView, SelfView } from "../../../shared/types.ts";
import type { AudioEngine } from "../../audio/types.ts";
import type { UiCommand } from "../../input.ts";
import { button, focusFirst, h } from "../dom.ts";
import type { SettingsStore } from "../settings.ts";
import { settingsControls } from "../settings-panel.ts";
import { characterTab } from "./character.ts";
import { chronicleTab } from "./chronicle.ts";
import { helpTab } from "./help.ts";
import { inventoryTab } from "./inventory.ts";
import { mapTab } from "./map.ts";
import { nationTab } from "./nation.ts";

export type MenuTab = "character" | "inventory" | "nation" | "chronicle" | "map" | "help" | "system";

const TABS: readonly { id: MenuTab; label: string; glyph: string; key: string }[] = [
  { id: "character", label: "인물", glyph: "人", key: "C" },
  { id: "inventory", label: "소지품", glyph: "囊", key: "I" },
  { id: "nation", label: "국운", glyph: "國", key: "N" },
  { id: "chronicle", label: "연대기", glyph: "史", key: "T" },
  { id: "map", label: "지도", glyph: "圖", key: "M" },
  { id: "help", label: "도움말", glyph: "助", key: "F1" },
  { id: "system", label: "설정", glyph: "設", key: "Esc" },
];

export function commandTab(cmd: UiCommand): MenuTab | null {
  switch (cmd) {
    case "character":
    case "inventory":
    case "nation":
    case "chronicle":
    case "map":
    case "help":
      return cmd;
    case "menu":
      return "system";
    default:
      return null;
  }
}

export interface MenuDeps {
  audio: AudioEngine;
  settings: SettingsStore;
  map: GameMap;
  act(action: PlayerAction): void;
  self(): SelfView | null;
  chapter(): ChapterView | null;
  pos(): { x: number; y: number } | null;
  onToggle(open: boolean): void;
}

export class MenuBook {
  readonly el = h("div", { class: "menu-host" });
  readonly #deps: MenuDeps;
  #tab: MenuTab | null = null;
  #body: HTMLElement | null = null;
  #tabs: HTMLElement | null = null;

  constructor(deps: MenuDeps) {
    this.#deps = deps;
  }

  get open(): boolean {
    return this.#tab !== null;
  }

  get tab(): MenuTab | null {
    return this.#tab;
  }

  /** Toggle: the same tab closes the book, another tab switches to it. */
  toggle(tab: MenuTab): void {
    if (this.#tab === tab) this.close();
    else this.show(tab);
  }

  show(tab: MenuTab): void {
    const wasOpen = this.#tab !== null;
    this.#tab = tab;
    if (!wasOpen) {
      this.#deps.audio.sfx("ui_open");
      this.#build();
      this.#deps.onToggle(true);
    }
    this.#renderTabs();
    this.refresh(true);
    if (!wasOpen && this.#tabs) focusFirst(this.#tabs);
  }

  close(): void {
    if (this.#tab === null) return;
    this.#tab = null;
    this.el.replaceChildren();
    this.#body = null;
    this.#deps.audio.sfx("ui_close");
    this.#deps.onToggle(false);
  }

  /** Re-render the open tab (keeps scroll unless switching tabs). */
  refresh(reset = false): void {
    const tab = this.#tab;
    const body = this.#body;
    if (!tab || !body) return;
    // The settings tab holds live controls; the map is heavy — leave both alone on state ticks.
    if (!reset && (tab === "system" || tab === "map" || tab === "help")) return;
    const scroll = body.scrollTop;
    body.replaceChildren(this.#content(tab));
    body.scrollTop = reset ? 0 : scroll;
  }

  #build(): void {
    this.#tabs = h("nav", { class: "book-tabs", role: "tablist", "aria-label": "메뉴" });
    this.#body = h("div", { class: "book-body", role: "tabpanel" });
    const close = button(h("span", { "aria-hidden": "true" }, "✕"), () => this.close(), { class: "btn btn-icon book-close", "aria-label": "닫기 (Esc)", title: "닫기 · Esc" });
    const book = h("section", { class: "book paper", role: "dialog", "aria-modal": "true", "aria-label": "메뉴" },
      h("header", { class: "book-head" }, this.#tabs, close), this.#body);
    const scrim = h("div", { class: "scrim", onclick: () => this.close() });
    this.el.replaceChildren(scrim, book);
  }

  #renderTabs(): void {
    if (!this.#tabs) return;
    this.#tabs.replaceChildren(
      ...TABS.map((t) =>
        h("button", {
          type: "button",
          role: "tab",
          class: `book-tab${t.id === this.#tab ? " on" : ""}`,
          "aria-selected": t.id === this.#tab ? "true" : "false",
          title: `${t.label} · ${t.key}`,
          onclick: () => {
            if (t.id !== this.#tab) {
              this.#deps.audio.sfx("ui_click");
              this.show(t.id);
            }
          },
        }, h("span", { class: "tab-glyph", "aria-hidden": "true" }, t.glyph), h("span", { class: "tab-label" }, t.label))),
    );
  }

  #content(tab: MenuTab): HTMLElement {
    const d = this.#deps;
    const self = d.self();
    if (tab === "help") return h("div", null, h("h2", { class: "book-title" }, "도움말"), helpTab());
    if (tab === "system") {
      return h("div", { class: "tab-system" },
        h("h2", { class: "book-title" }, "설정"),
        settingsControls(d.settings, d.audio),
        h("h3", { class: "sub-title" }, "게임"),
        h("div", { class: "foot-actions left" },
          button("타이틀로 돌아가기", (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            if (b.dataset.armed) window.location.reload();
            else {
              b.dataset.armed = "1";
              b.textContent = "한 번 더 누르면 타이틀로";
              b.classList.add("btn-danger");
            }
          }, { class: "btn" })));
    }
    if (!self) return h("p", { class: "muted" }, "인물 정보를 불러오는 중…");
    const titles: Record<Exclude<MenuTab, "help" | "system">, string> = {
      character: "인물",
      inventory: "소지품",
      nation: "국운",
      chronicle: "연대기",
      map: `지도 · ${self.year}년`,
    };
    const body =
      tab === "character" ? characterTab(self, d.act)
      : tab === "inventory" ? inventoryTab(self, d.act)
      : tab === "nation" ? nationTab(self)
      : tab === "chronicle" ? chronicleTab(self.chronicle, d.chapter())
      : mapTab(d.map, self, d.pos(), d.act);
    return h("div", null, h("h2", { class: "book-title" }, titles[tab]), body);
  }
}
