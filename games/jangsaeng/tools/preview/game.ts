// Visual check of the client core against a scripted host (no UI):
//   node scripts/preview.mjs tools/preview/game.ts out.png 1280 720 2500
// Globals: PREVIEW_DEV (show the F3 overlay), PREVIEW_ZOOM (+/- steps),
// PREVIEW_MOCK (crowd size, weather, hour for load and night checks).
import { generateMap } from "../../src/shared/map/generate.ts";
import { PROTOCOL_VERSION } from "../../src/shared/protocol.ts";
import { createAudioEngine } from "../../src/client/audio/engine.ts";
import { GameClient, type UiPort } from "../../src/client/game/client.ts";
import { GameCanvas } from "../../src/client/game/surface.ts";
import { Input } from "../../src/client/input.ts";
import { connectLoopback } from "../../src/client/net/transport.ts";
import { createMockHost } from "./game-mock.ts";

const flags = globalThis as {
  PREVIEW_DEV?: boolean;
  PREVIEW_ZOOM?: number;
  PREVIEW_MOCK?: import("./game-mock.ts").MockOptions;
};
const canvas = document.getElementById("preview") as HTMLCanvasElement;
const surface = new GameCanvas(canvas);
const input = new Input(canvas);
const audio = createAudioEngine();
const t0 = performance.now();
const map = generateMap("jangsaeng");
console.log(`map ${Math.round(performance.now() - t0)} ms`);

const ui: UiPort = {
  handle() {},
  frame() {},
  blocking: false,
  enterGame() {
    console.log("enterGame");
  },
  showError(text) {
    console.error(`ui error: ${text}`);
  },
};
const client = new GameClient({ surface, map, audio, input, ui });
const host = createMockHost(flags.PREVIEW_MOCK);
client.start();
client.attach(
  connectLoopback(host),
  { mode: "offline", pump: () => host.tick(performance.now()) },
  { t: "hello", v: PROTOCOL_VERSION, name: "장생", variant: "m", origin: "kaesong" },
);
const key = (code: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code }));
if (flags.PREVIEW_DEV) key("F3");
for (let i = 0; i < Math.abs(flags.PREVIEW_ZOOM ?? 0); i++) key((flags.PREVIEW_ZOOM ?? 0) > 0 ? "Equal" : "Minus");

// Frame timing over the last 120 frames, every 2 s (the first includes warm-up).
setInterval(() => {
  const s = client.stats.summary();
  console.log(
    `t=${Math.round(performance.now() - t0)}ms frames ${client.frames} fps ${client.stats.fps} work avg ${s.workAvg.toFixed(2)}ms p95 ${s.workP95.toFixed(2)}ms max ${s.workMax.toFixed(2)}ms gap avg ${s.gapAvg.toFixed(1)}ms max ${s.gapMax.toFixed(1)}ms`,
  );
}, 2000);
