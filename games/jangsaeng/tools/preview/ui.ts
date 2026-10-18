// UI preview entry: builds one screen state (from location.hash) over a real
// world render, driven by mock protocol data. Used by tools/preview/ui-page.mjs.
import { Input } from "../../src/client/input.ts";
import { drawCharacter } from "../../src/client/render/characters.ts";
import { WorldRenderer } from "../../src/client/render/world.ts";
import { createUi, type Ui } from "../../src/client/ui/index.ts";
import { TILE_PX, type CharacterSprite } from "../../src/shared/sprites.ts";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import { renderView, viewCentre, worldMap } from "./world-lib.ts";
import { CARD_PROMPT, CHAPTER, DEATH_PROMPT, ENDING, mockAudio, mockSelf, RESULT_PROMPT, STORY_PROMPT, YEARS_PROMPT } from "./ui-mock.ts";

declare global {
  interface Window {
    __ready?: boolean;
  }
}

const state = (location.hash.slice(1) || "title").split("?")[0] ?? "title";
const canvas = document.getElementById("game") as HTMLCanvasElement;
const root = document.getElementById("ui") as HTMLElement;
const map = worldMap();

function drawWorld(): { x: number; y: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const view = { label: "", site: "uiju", dx: 2, dy: 1, scale: w < 700 ? 2 : 3, season: "summer" as const, year: 1388 };
  if (!ctx) return { x: 0, y: 0 };
  const renderer = new WorldRenderer(map);
  renderView(ctx, renderer, view, { x: 0, y: 0, w, h }, 1200);
  const c = viewCentre(map, view);
  const s = view.scale;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(s, 0, 0, s, Math.round(w / 2 - c.x * s), Math.round(h / 2 - c.y * s));
  const figures: [CharacterSprite, number, number, "down" | "left" | "right" | "up", "idle" | "walk" | "attack"][] = [
    ["hero_goryeo_officer", 0, 18, "right", "attack"],
    ["soldier_goryeo", -26, 10, "right", "walk"],
    ["archer_joseon", -34, 34, "right", "idle"],
    ["general_goryeo", -12, 46, "right", "idle"],
    ["wokou", 30, 14, "left", "attack"],
    ["wokou", 44, 30, "left", "walk"],
    ["wokou_captain", 58, 8, "left", "idle"],
  ];
  for (const [key, dx, dy, dir, anim] of figures) drawCharacter(ctx, key, c.x + dx, c.y + dy, dir, anim, 180);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { x: c.x / TILE_PX, y: c.y / TILE_PX };
}

const send = (m: unknown) => console.log("send", JSON.stringify(m));
const input = new Input(canvas);
const ui: Ui = createUi({ root, send, audio: mockAudio(), input, map });

const click = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
const key = (code: string, k = "") => window.dispatchEvent(new KeyboardEvent("keydown", { code, key: k, bubbles: true }));

function startGame(withCard = false): { x: number; y: number } {
  const pos = drawWorld();
  const msgs: ServerMsg[] = [
    { t: "welcome", v: 1, token: "t", mode: "offline", seed: "s", motd: "오프라인 시제품 · 시뮬레이션 동료 7명이 마당에 있습니다.", resumed: false },
  ];
  for (const m of msgs) ui.handle(m);
  ui.enterGame();
  if (withCard) ui.handle({ t: "enter", you: 1, chapter: CHAPTER, channel: "제3장 위화도 · 2마당" });
  ui.handle({ t: "self", self: mockSelf() });
  ui.handle({ t: "roster", players: [
    { name: "청룡검객", kind: "player", level: 13, title: "개경 출신 궁수" },
    { name: "송도상인", kind: "bot", level: 11, title: "남해 어촌 피란민" },
    { name: "달빛무사", kind: "bot", level: 12, title: "동북면 무가" },
  ] });
  const chat: ServerMsg[] = [
    { t: "chat", from: "", text: "◇송도상인 님이 마당에 들어왔습니다.", kind: "system" },
    { t: "chat", from: "송도상인", text: "비가 그칠 기미가 없구려. 강 건너는 무리요.", kind: "bot" },
    { t: "chat", from: "청룡검객", text: "척후 둘 남았습니다! 동쪽으로 갑니다", kind: "player" },
    { t: "chat", from: "이지란", text: "형님께서 장수들을 모으라 하셨소.", kind: "npc" },
    { t: "chat", from: "달빛무사", text: "도와주시오! 수레 쪽이 밀리오", kind: "bot" },
  ];
  for (const m of chat) ui.handle(m);
  const ents = [
    { id: 2, k: "bot", s: "soldier_goryeo", x: pos.x - 1.6, y: pos.y + 0.6, d: "right", a: "walk", tm: "ally" },
    { id: 3, k: "player", s: "hero_youth", x: pos.x + 3, y: pos.y - 4, d: "down", a: "idle", tm: "player" },
    { id: 4, k: "enemy", s: "wokou", x: pos.x + 2, y: pos.y + 1, d: "left", a: "walk", tm: "enemy" },
    { id: 5, k: "enemy", s: "wokou", x: pos.x + 5, y: pos.y + 2, d: "left", a: "walk", tm: "enemy" },
    { id: 6, k: "enemy", s: "wokou_captain", x: pos.x + 4, y: pos.y - 1, d: "left", a: "idle", tm: "boss" },
  ] as const;
  const tick = () => {
    ui.frame({ dtMs: 16, fps: 60, ping: null, self: pos, ents: ents as never, playerScreen: { x: innerWidth / 2, y: innerHeight / 2 } });
    requestAnimationFrame(tick);
  };
  tick();
  return pos;
}

async function run(): Promise<void> {
  const saved = { name: "윤무진", chapterTitle: "위화도에서 개국까지", year: 1390, mode: "offline" as const };
  switch (state) {
    case "title":
    case "creation":
    case "demo":
    case "pitch":
    case "settings": {
      void ui.showTitle({ onlineAvailable: true, saved, version: "0.1.0" });
      if (state !== "title") click(`[data-action="${state === "creation" ? "new" : state}"]`);
      break;
    }
    case "loading":
      void ui.showTitle({ onlineAvailable: false, version: "0.1.0" });
      ui.showLoading("세계를 펼치는 중…");
      break;
    case "card":
      startGame(true);
      break;
    case "hud":
      startGame();
      ui.handle({ t: "toast", text: "강가의 척후를 물리쳤다 (3/5)", tone: "good" });
      ui.handle({ t: "toast", text: "대첩의 공으로 천수 +2년", tone: "epic" });
      break;
    case "drawer-status":
    case "drawer-obj":
    case "drawer-chat":
      startGame();
      ui.handle({ t: "toast", text: "강가의 척후를 물리쳤다 (3/5)", tone: "good" });
      click(state === "drawer-status" ? ".cbar" : state === "drawer-obj" ? ".cstrip" : '.cbtn[aria-label="채팅"]');
      break;
    case "calm":
      drawWorld();
      ui.enterGame();
      ui.handle({ t: "welcome", v: 1, token: "t", mode: "online", seed: "s", motd: "", resumed: true });
      ui.handle({ t: "self", self: mockSelf({ battle: undefined, demo: false, lifeShortfall: 0, lifeEnd: 1924, suspicion: 8, suspicionBand: "calm", meritSubject: undefined }) });
      break;
    case "prompt":
      startGame();
      ui.handle({ t: "prompt", prompt: STORY_PROMPT });
      break;
    case "cardprompt":
      startGame();
      ui.handle({ t: "prompt", prompt: CARD_PROMPT });
      break;
    case "result":
      startGame();
      ui.handle({ t: "prompt", prompt: RESULT_PROMPT });
      break;
    case "death":
      startGame();
      ui.handle({ t: "prompt", prompt: DEATH_PROMPT });
      break;
    case "years":
      startGame();
      ui.handle({ t: "prompt", prompt: YEARS_PROMPT });
      break;
    case "roll":
      startGame();
      ui.handle({ t: "prompt", prompt: YEARS_PROMPT });
      click('[data-action="years-confirm"]');
      ui.handle({ t: "prompt", prompt: RESULT_PROMPT });
      break;
    case "downed":
      startGame();
      ui.handle({ t: "self", self: mockSelf({ hp: 0, downed: { secondsLeft: 12 } }) });
      break;
    case "character":
    case "inventory":
    case "nation":
    case "chronicle":
    case "map":
    case "help":
    case "menu": {
      startGame();
      const codes: Record<string, [string, string]> = {
        character: ["KeyC", "c"], inventory: ["KeyI", "i"], nation: ["KeyN", "n"], chronicle: ["KeyT", "t"],
        map: ["KeyM", "m"], help: ["F1", "F1"], menu: ["Escape", "Escape"],
      };
      const [code, k] = codes[state] ?? ["KeyN", "n"];
      key(code, k);
      // Input may not map every key yet (e.g. T); fall back to the HUD button.
      if (!document.querySelector(".book")) click(`.hud-btn[data-cmd="${state === "menu" ? "menu" : state}"]`);
      break;
    }
    case "ending":
      startGame();
      ui.handle({ t: "ending", ending: ENDING });
      break;
    case "error":
      void ui.showTitle({ onlineAvailable: true, version: "0.1.0" });
      ui.showError("서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
      break;
    default:
      console.error(`unknown state ${state}`);
  }
}

void run().then(() => {
  window.__ready = true;
});
