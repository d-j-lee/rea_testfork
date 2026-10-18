// The UI is DOM (HTML/CSS) layered over the game canvas. It owns every screen
// except the world view: title, character creation, demo-mode chapter select,
// pitch/introduction screen, HUD, prompts and choices, years planner, menus,
// chat, toasts, ending.
import type { ChapterId, OriginId } from "../../shared/content/schema.ts";
import type { GameMap } from "../../shared/map/generate.ts";
import type { ClientMsg, PlayerAction, ServerMsg } from "../../shared/protocol.ts";
import type { ChapterView, DemoPath, EntitySnap, PromptView } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import type { Input, UiCommand } from "../input.ts";
import { chapterCard } from "./chapter-card.ts";
import { button, h } from "./dom.ts";
import { endingScreen } from "./ending.ts";
import { Hud, isCompact } from "./hud.ts";
import { createLoading, type LoadingScreen } from "./loading.ts";
import { commandTab, MenuBook } from "./menus/index.ts";
import { paperPanel } from "./panel.ts";
import { PromptDialog } from "./prompt.ts";
import { SettingsStore } from "./settings.ts";
import { createTitle, type TitleScreen } from "./title.ts";
import { Toasts } from "./toasts.ts";
import { YearsPlanner } from "./years.ts";

export interface TitleChoice {
  mode: "offline" | "online";
  /** Resume the stored profile (token kept by the client core). */
  resume: boolean;
  name: string;
  variant: "m" | "f";
  origin: OriginId;
  /** Demo mode start chapter. */
  demo?: ChapterId;
  /** Demo mode: the history the preset assumes. */
  demoPath?: DemoPath;
}

export interface TitleOptions {
  onlineAvailable: boolean;
  /** Stored profile summary for "이어하기". */
  saved?: { name: string; chapterTitle: string; year: number; mode: "offline" | "online" };
  version: string;
}

export interface UiDeps {
  root: HTMLElement;
  send(message: ClientMsg): void;
  audio: AudioEngine;
  input: Input;
  map: GameMap;
}

export interface FrameInfo {
  dtMs: number;
  fps: number;
  /** Round-trip ms (online) or null offline. */
  ping: number | null;
  /** Own entity in tiles. */
  self: { x: number; y: number } | null;
  /** Entities currently known (for minimap dots). */
  ents: readonly EntitySnap[];
  /** CSS-pixel position of the player on screen (touch aim, bubbles). */
  playerScreen: { x: number; y: number };
}

export interface Ui {
  showTitle(options: TitleOptions): Promise<TitleChoice>;
  showLoading(text: string): void;
  /** Hide title/loading and show the in-game HUD. */
  enterGame(): void;
  handle(message: ServerMsg): void;
  frame(info: FrameInfo): void;
  /** A modal (prompt, menu, chat input) is open; gameplay input is paused. */
  readonly blocking: boolean;
  showError(text: string): void;
}

/** Ink filters referenced from CSS (brush-edged borders). */
function injectDefs(): void {
  if (document.getElementById("ui-defs")) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "ui-defs";
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const filter = document.createElementNS(svg.namespaceURI, "filter");
  filter.id = "ink-rough";
  const turb = document.createElementNS(svg.namespaceURI, "feTurbulence");
  turb.setAttribute("type", "fractalNoise");
  turb.setAttribute("baseFrequency", "0.04");
  turb.setAttribute("numOctaves", "2");
  turb.setAttribute("seed", "7");
  const disp = document.createElementNS(svg.namespaceURI, "feDisplacementMap");
  disp.setAttribute("in", "SourceGraphic");
  disp.setAttribute("scale", "3");
  filter.append(turb, disp);
  svg.appendChild(filter);
  document.body.appendChild(svg);
}

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);

export function createUi(deps: UiDeps): Ui {
  const { root, audio, input, map } = deps;
  injectDefs();
  document.getElementById("boot")?.remove();
  root.classList.add("ui-root");
  const settings = new SettingsStore(audio);
  const reduced = () => settings.reducedMotion;

  let title: TitleScreen | null = null;
  let loading: LoadingScreen | null = null;
  let inGame = false;
  /** The mounted ending screen; a repeated "ending" message replaces it. */
  let ending: HTMLElement | null = null;
  let card: { dismiss(): void } | null = null;
  let pendingCard: { chapter: ChapterView; channel: string } | null = null;
  let queuedPrompt: PromptView | null = null;
  let chapter: ChapterView | null = null;
  let offline = true;
  let pos: { x: number; y: number } | null = null;
  let errorEl: HTMLElement | null = null;

  const act = (action: PlayerAction) => deps.send({ t: "action", action });
  const screens = h("div", { class: "layer layer-screen" });
  const modals = h("div", { class: "layer layer-modal" });
  const toasts = new Toasts();

  const prompt = new PromptDialog(audio, (p, option) => deps.send({ t: "choose", prompt: p, option }), reduced);
  // The passage roll starts with the confirm, so the planner stays open (held
  // toasts, paused input) from the plan until the roll ends; nothing else
  // re-syncs when the roll finishes, so its end does.
  const years = new YearsPlanner(audio, (plan, passage) => {
    deps.send({ t: "years", ...plan });
    void passage.then(sync);
    sync();
  }, reduced);
  const menu = new MenuBook({
    audio,
    settings,
    map,
    act,
    self: () => hud.self,
    chapter: () => chapter,
    pos: () => pos,
    onToggle: () => sync(),
  });

  const command = (cmd: UiCommand) => {
    if (cmd === "mute") {
      const muted = !settings.value.muted;
      settings.update({ muted });
      toasts.show(muted ? "소리를 껐습니다 (O)" : "소리를 켰습니다 (O)", "info");
      return;
    }
    if (!inGame || ending || card || title || loading) return;
    if (prompt.open || years.open) return;
    if (cmd === "chat") {
      if (menu.open) return;
      if (isCompact() && hud.drawer !== "chat") {
        hud.closeDrawer();
        hud.toggleDrawer("chat");
      }
      hud.chat.open();
      return;
    }
    if (hud.drawer) {
      hud.closeDrawer();
      if (cmd === "menu") return;
    }
    if (cmd === "menu" && menu.open) {
      menu.close();
      return;
    }
    const tab = commandTab(cmd);
    if (tab) {
      if (tab !== "system" || !menu.open) menu.toggle(tab);
    }
  };

  const hud = new Hud({
    audio,
    input,
    map,
    act,
    chat: (text) => deps.send({ t: "chat", text }),
    command: (cmd) => {
      audio.sfx("ui_click");
      command(cmd);
    },
    onTyping: () => sync(),
    onDrawer: () => sync(),
    openMenu: () => {
      audio.sfx("ui_click");
      if (!prompt.open && !years.open) menu.showLast();
    },
    compactChat: false,
  });
  const compactQuery = window.matchMedia("(max-width: 640px), (max-height: 500px)");
  const applyLayout = () => {
    document.documentElement.dataset.layout = compactQuery.matches ? "compact" : "full";
    if (!compactQuery.matches) hud.closeDrawer();
  };
  compactQuery.addEventListener?.("change", applyLayout);
  applyLayout();
  root.replaceChildren(
    h("div", { class: "layer layer-hud" }, hud.el),
    h("div", { class: "layer layer-downed" }, hud.downedEl),
    h("div", { class: "layer layer-touch" }, hud.touchEl),
    modals,
    screens,
    h("div", { class: "layer layer-toasts" }, toasts.el),
  );
  modals.append(menu.el, prompt.el, years.el);

  const isBlocking = () =>
    !inGame || !!ending || !!title || !!loading || !!card || prompt.open || years.open || menu.open || hud.chat.typing || !!hud.drawer || !!errorEl;

  let lastBlocking: boolean | null = null;
  const sync = () => {
    const blocking = isBlocking();
    root.classList.toggle("in-game", inGame && !ending);
    root.classList.toggle("modal-open", prompt.open || years.open || menu.open || !!card || !!ending || !!hud.drawer);
    root.classList.toggle("card-open", !!card);
    // Toasts wait while a full-screen document would sit under them.
    toasts.hold(!!card || years.open || !!ending);
    root.dataset.drawer = hud.drawer ?? "";
    if (blocking !== lastBlocking) {
      lastBlocking = blocking;
      input.setEnabled(!blocking);
      if (blocking) hud.touch.release();
    }
  };
  settings.onChange(() => sync());

  input.onCommand(command);
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target) || e.repeat) return;
    if (prompt.open && !card && !menu.open && prompt.handleKey(e)) {
      e.preventDefault();
      return;
    }
  });

  const showPrompt = (p: PromptView) => {
    if (card) {
      queuedPrompt = p;
      return;
    }
    if (p.kind === "years") {
      prompt.close();
      years.show(p);
    } else {
      years.close();
      prompt.show(p);
    }
    if (menu.open) menu.close();
    hud.closeDrawer();
    if (hud.chat.typing) hud.chat.close();
    sync();
  };

  const showCard = (c: ChapterView, channel: string) => {
    if (!inGame) {
      pendingCard = { chapter: c, channel };
      return;
    }
    card?.dismiss();
    const built = chapterCard(c, channel, reduced(), () => {
      card = null;
      sync();
      const q = queuedPrompt;
      queuedPrompt = null;
      if (q) showPrompt(q);
    });
    card = built;
    screens.appendChild(built.el);
    built.el.focus({ preventScroll: true });
    audio.sfx("gong");
    sync();
  };

  const ui: Ui = {
    showTitle(options) {
      title?.destroy();
      inGame = false;
      title = createTitle(options, audio, settings);
      screens.appendChild(title.el);
      sync();
      return title.result;
    },
    showLoading(text) {
      if (!loading) {
        loading = createLoading();
        screens.appendChild(loading.el);
      }
      loading.setText(text);
      sync();
    },
    enterGame() {
      title?.destroy();
      title = null;
      loading?.destroy();
      loading = null;
      inGame = true;
      sync();
      if (pendingCard) {
        const p = pendingCard;
        pendingCard = null;
        showCard(p.chapter, p.channel);
      }
    },
    handle(msg) {
      switch (msg.t) {
        case "welcome":
          offline = msg.mode === "offline";
          hud.setMode(offline ? "오프라인 · ◇ 시뮬 동료" : "온라인", offline ? "◇ 오프라인" : "온라인");
          if (msg.motd) hud.addChat("", msg.motd, "system");
          if (msg.resumed) toasts.show("지난 기록에서 이어갑니다", "info");
          break;
        case "enter":
          chapter = msg.chapter;
          showCard(msg.chapter, msg.channel);
          break;
        case "self":
          hud.update(msg.self, offline);
          root.classList.toggle("battle-on", !!msg.self.battle);
          menu.refresh();
          break;
        case "prompt":
          if (msg.prompt) showPrompt(msg.prompt);
          else {
            queuedPrompt = null;
            prompt.close();
            years.close();
          }
          sync();
          break;
        case "chat":
          hud.addChat(msg.from, msg.text, msg.kind);
          break;
        case "toast":
          toasts.show(msg.text, msg.tone);
          break;
        case "roster":
          hud.chat.setRoster(msg.players);
          break;
        case "ending": {
          card?.dismiss();
          prompt.close();
          years.close();
          menu.close();
          const next = endingScreen(msg.ending);
          if (ending) ending.replaceWith(next);
          else screens.appendChild(next);
          ending = next;
          sync();
          break;
        }
        case "error":
          if (inGame) toasts.show(msg.message, "bad");
          else ui.showError(msg.message);
          break;
        default:
          break;
      }
    },
    frame(info) {
      pos = info.self;
      hud.frame(info);
    },
    get blocking() {
      return isBlocking();
    },
    showError(text) {
      errorEl?.remove();
      loading?.destroy();
      loading = null;
      const close = () => {
        errorEl?.remove();
        errorEl = null;
        sync();
      };
      errorEl = h("div", { class: "screen error-screen" },
        paperPanel({
          title: "문제가 생겼습니다",
          glyph: "警",
          class: "error-panel",
          footer: h("div", { class: "foot-actions" },
            button("닫기", close, { class: "btn" }),
            button("다시 시도", () => window.location.reload(), { class: "btn btn-primary" })),
        }, h("p", { class: "error-text" }, text)));
      screens.appendChild(errorEl);
      audio.sfx("warning");
      sync();
    },
  };
  sync();
  return ui;
}
