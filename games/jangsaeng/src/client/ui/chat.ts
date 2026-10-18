// Channel chat (bottom-left): collapsible log, roster count and an input that
// pauses gameplay keys while typing. Simulated companions are marked ◇.
import type { RosterEntry } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import { button, h, setText, toggle } from "./dom.ts";
import { botName, SIM_MARK } from "./labels.ts";

const MAX_LINES = 80;

export type ChatKind = "player" | "bot" | "system" | "npc";

export class ChatPanel {
  readonly el: HTMLElement;
  readonly #log = h("ol", { class: "chat-log", "aria-live": "polite", "aria-relevant": "additions" });
  readonly #input = h("input", {
    class: "chat-input",
    type: "text",
    maxlength: "140",
    placeholder: "말하기 (Enter 보내기 · Esc 닫기)",
    "aria-label": "채팅 입력",
    autocomplete: "off",
  });
  readonly #channel = h("span", { class: "chat-channel" });
  readonly #count = h("button", { type: "button", class: "chat-count", "aria-expanded": "false" });
  readonly #roster = h("div", { class: "chat-roster hidden", role: "list" });
  readonly #toggleBtn: HTMLButtonElement;
  readonly #audio: AudioEngine;
  readonly #send: (text: string) => void;
  readonly #onFocus: (typing: boolean) => void;
  #typing = false;

  constructor(audio: AudioEngine, send: (text: string) => void, onFocus: (typing: boolean) => void, collapsed: boolean) {
    this.#audio = audio;
    this.#send = send;
    this.#onFocus = onFocus;
    this.#toggleBtn = button(h("span", { "aria-hidden": "true" }, "▾"), () => this.setCollapsed(!this.el.classList.contains("collapsed")), {
      class: "chat-toggle",
      "aria-label": "채팅 접기/펼치기",
    });
    this.#count.addEventListener("click", () => {
      const open = this.#roster.classList.contains("hidden");
      toggle(this.#roster, "hidden", !open);
      this.#count.setAttribute("aria-expanded", String(open));
    });
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const text = this.#input.value.trim();
        if (text) {
          this.#send(text);
          this.#audio.sfx("chat");
        }
        this.#input.value = "";
        this.close();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.#input.value = "";
        this.close();
      }
    });
    this.#input.addEventListener("blur", () => {
      if (this.#typing) this.close();
    });
    const openBtn = button("말하기", () => this.open(), { class: "chat-open", "aria-label": "채팅 입력 열기 (Enter)" });
    this.el = h(
      "section",
      { class: `hud-chat${collapsed ? " collapsed" : ""}`, "aria-label": "시대 마당 채팅" },
      h("header", { class: "chat-head" }, this.#channel, this.#count, this.#toggleBtn),
      this.#roster,
      this.#log,
      h("div", { class: "chat-row" }, this.#input, openBtn),
    );
  }

  get typing(): boolean {
    return this.#typing;
  }

  setCollapsed(collapsed: boolean): void {
    this.el.classList.toggle("collapsed", collapsed);
    this.#log.scrollTop = this.#log.scrollHeight;
  }

  open(): void {
    if (this.#typing) return;
    this.#typing = true;
    this.el.classList.add("typing");
    this.el.classList.remove("collapsed");
    this.#onFocus(true);
    this.#input.focus();
  }

  close(): void {
    if (!this.#typing) return;
    this.#typing = false;
    this.el.classList.remove("typing");
    this.#input.blur();
    this.#onFocus(false);
  }

  setChannel(name: string, players: number, companions: number, offline: boolean): void {
    setText(this.#channel, name);
    setText(this.#count, offline ? `동료 ${companions}${SIM_MARK} · 장생인 ${players}` : `동료 ${companions} · 장생인 ${players}`);
    this.#count.title = offline ? "◇ 표시는 시뮬레이션 동료입니다 (오프라인 모드)" : "같은 마당의 동료와 장생인";
  }

  setRoster(list: readonly RosterEntry[]): void {
    this.#roster.replaceChildren(
      ...list.map((r) =>
        h("p", { class: `roster-row${r.kind === "bot" ? " bot" : ""}`, role: "listitem" },
          h("b", null, r.kind === "bot" ? botName(r.name) : r.name),
          h("span", null, `Lv ${r.level}`),
          h("small", null, r.title))),
    );
  }

  add(from: string, text: string, kind: ChatKind): void {
    let line: HTMLElement;
    if (kind === "system") line = h("li", { class: "msg sys" }, text);
    else if (kind === "bot")
      line = h("li", { class: "msg bot" }, h("b", { class: "who", title: "시뮬레이션 동료" }, botName(from)), " ", text);
    else if (kind === "npc") line = h("li", { class: "msg npc" }, h("b", { class: "who" }, from), " ", `“${text}”`);
    else line = h("li", { class: "msg player" }, h("b", { class: "who" }, from), " ", text);
    this.#log.appendChild(line);
    while (this.#log.childElementCount > MAX_LINES) this.#log.firstElementChild?.remove();
    this.#log.scrollTop = this.#log.scrollHeight;
    if (kind === "player") this.#audio.sfx("chat", { gain: 0.6 });
  }
}
