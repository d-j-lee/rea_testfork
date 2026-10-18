// Boot and session orchestration: canvas, input, audio, map, UI, title
// screen, then an offline (in-page host) or online (WebSocket) session that
// the game client core drives. Failures surface as UI errors, never crashes.

import { generateMap } from "../shared/map/generate.ts";
import { PROTOCOL_VERSION, type ClientMsg } from "../shared/protocol.ts";
import type { SelfView } from "../shared/types.ts";
import { createAudioEngine } from "./audio/engine.ts";
import type { AudioEngine } from "./audio/types.ts";
import { GameClient } from "./game/client.ts";
import { GameCanvas } from "./game/surface.ts";
import { Input } from "./input.ts";
import {
  lastToken,
  rememberSummary,
  rememberToken,
  savedForTitle,
  startOffline,
  type SessionMode,
} from "./net/offline.ts";
import { connectWebSocket, webSocketUrl } from "./net/transport.ts";
import { createUi, type TitleChoice, type Ui } from "./ui/index.ts";

export interface AppOptions {
  target: "served" | "single";
  version: string;
}

type AppState = "boot" | "title" | "connecting" | "game" | "error";

/** Test/diagnostic hook (read by tests/e2e). */
interface DebugHook {
  state: AppState;
  readonly frames: number;
  errors: string[];
  version: string;
  /** Frame timing over the last 120 frames (ms): work = time spent in our frame. */
  readonly perf: { fps: number; workAvg: number; workP95: number; workMax: number; gapAvg: number; gapMax: number } | null;
}

const hook: DebugHook = { state: "boot", frames: 0, errors: [], version: "", perf: null };
(globalThis as { __jangsaeng?: DebugHook }).__jangsaeng = hook;

function note(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (hook.errors.length < 20) hook.errors.push(text);
  return text;
}

function findCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>("canvas#game, canvas[data-game]");
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.id = "game";
  canvas.setAttribute("aria-label", "장생: 오백년 게임 화면");
  document.body.prepend(canvas);
  return canvas;
}

function findUiRoot(): HTMLElement {
  const existing = document.getElementById("ui");
  if (existing) return existing;
  const root = document.createElement("div");
  root.id = "ui";
  document.body.append(root);
  return root;
}

/** Plain canvas text for boot progress and fatal errors (before/without UI). */
function paintBoot(surface: GameCanvas, line: string, error = false): void {
  surface.fit();
  const ctx = surface.ctx;
  const w = surface.width;
  const h = surface.height;
  const u = surface.unit;
  surface.resetState();
  // Text state set here must not leak into the game's frames.
  ctx.save();
  ctx.fillStyle = "#14110f";
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e2b23a";
  ctx.font = `bold ${Math.round(28 * u)}px Galmuri11, 'Noto Sans KR', sans-serif`;
  ctx.fillText("장생 : 오백년", w / 2, h / 2 - 22 * u);
  ctx.fillStyle = error ? "#ff8a7a" : "#f3ecdc";
  ctx.font = `${Math.round(14 * u)}px Galmuri11, 'Noto Sans KR', sans-serif`;
  const words = line.split(" ");
  let row = "";
  let y = h / 2 + 16 * u;
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (ctx.measureText(next).width > w * 0.85 && row) {
      ctx.fillText(row, w / 2, y);
      row = word;
      y += 20 * u;
    } else row = next;
  }
  if (row) ctx.fillText(row, w / 2, y);
  ctx.restore();
}

const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Online play needs the served build, an http(s) page and a healthy server. */
async function probeOnline(target: AppOptions["target"]): Promise<boolean> {
  if (target !== "served") return false;
  if (location.protocol !== "http:" && location.protocol !== "https:") return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch("/healthz", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function installAudioLifecycle(audio: AudioEngine): void {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    void audio.unlock().then(() => {
      if (audio.unlocked) for (const name of events) window.removeEventListener(name, unlock, true);
    });
  };
  for (const name of events) window.addEventListener(name, unlock, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") audio.suspend();
    else audio.resume();
  });
}

export async function startApp(options: AppOptions): Promise<void> {
  hook.version = options.version;
  const surface = new GameCanvas(findCanvas());
  const root = findUiRoot();
  paintBoot(surface, "산하를 그리는 중…");
  const input = new Input(surface.canvas);
  const audio = createAudioEngine();
  installAudioLifecycle(audio);
  const online = probeOnline(options.target);
  await nextPaint();

  let map;
  try {
    map = generateMap("jangsaeng");
  } catch (error) {
    hook.state = "error";
    paintBoot(surface, `지도를 만들지 못했습니다: ${note(error)}`, true);
    return;
  }

  let client: GameClient | null = null;
  let ui: Ui;
  try {
    ui = createUi({ root, send: (message: ClientMsg) => client?.send(message), audio, input, map });
  } catch (error) {
    hook.state = "error";
    console.error(error);
    paintBoot(surface, `화면(UI)을 불러오지 못했습니다: ${note(error)}`, true);
    return;
  }
  const game = new GameClient({ surface, map, audio, input, ui });
  client = game;
  game.start();
  Object.defineProperties(hook, {
    frames: { get: () => game.frames },
    perf: { get: () => ({ fps: game.stats.fps, ...game.stats.summary() }) },
  });

  const onlineAvailable = await online;
  const saved = savedForTitle(onlineAvailable);
  hook.state = "title";
  let choice: TitleChoice;
  try {
    choice = await ui.showTitle({
      onlineAvailable,
      saved: saved
        ? { name: saved.name, chapterTitle: saved.chapterTitle, year: saved.year, mode: saved.mode }
        : undefined,
      version: options.version,
    });
  } catch (error) {
    hook.state = "error";
    ui.showError(`타이틀 화면 오류: ${note(error)}`);
    return;
  }
  await beginSession(choice, game, ui);
}

async function beginSession(choice: TitleChoice, game: GameClient, ui: Ui): Promise<void> {
  const mode: SessionMode = choice.mode === "online" ? "online" : "offline";
  const demo = choice.demo !== undefined;
  const token = choice.resume ? lastToken(mode) : null;
  const hello: Extract<ClientMsg, { t: "hello" }> = {
    t: "hello",
    v: PROTOCOL_VERSION,
    name: choice.name,
    variant: choice.variant,
    origin: choice.origin,
  };
  if (token) hello.token = token;
  if (choice.demo) hello.demo = choice.demo;
  if (choice.demo && choice.demoPath) hello.demoPath = choice.demoPath;
  hook.state = "connecting";

  // Demo characters never replace the stored profile used for 이어하기.
  let summary = "";
  const onSelf = (self: SelfView) => {
    hook.state = "game";
    if (demo || !self.chapter) return;
    const key = `${self.name}|${self.chapter.title}|${self.year}`;
    if (key === summary) return;
    summary = key;
    rememberSummary({ name: self.name, chapterTitle: self.chapter.title, year: self.year, mode });
  };
  const onWelcome = (message: { token: string }) => {
    if (!demo && typeof message.token === "string") rememberToken(mode, message.token);
  };
  const lost = (text: string) => {
    hook.state = "error";
    ui.showError(`${text} ‘다시 시도’를 누르면 처음 화면으로 돌아갑니다.`);
  };

  if (mode === "offline") {
    ui.showLoading("오프라인 세계를 여는 중…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    let session;
    try {
      session = startOffline(
        (line) => console.debug(`[host] ${line}`),
        (reason) => lost(`오프라인 세계가 멈췄습니다 (${reason}).`),
        () => ui.holdsWorld,
      );
    } catch (error) {
      console.error(error);
      lost(`오프라인 세계를 시작하지 못했습니다: ${note(error)}.`);
      return;
    }
    game.attach(
      session.transport,
      {
        mode,
        pump: session.pump,
        onWelcome,
        onSelf,
        onClose: (reason) => {
          if (reason !== "closed") lost(`오프라인 세계를 열지 못했습니다 (${reason}).`);
        },
      },
      hello,
    );
    return;
  }

  ui.showLoading("서버에 연결하는 중…");
  try {
    const transport = await connectWebSocket(webSocketUrl(location));
    game.attach(
      transport,
      { mode, onWelcome, onSelf, onClose: (reason) => lost(`서버와의 연결이 끊어졌습니다 (${reason}).`) },
      hello,
    );
  } catch (error) {
    lost(`${note(error)}`);
  }
}
