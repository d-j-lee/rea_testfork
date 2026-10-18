// Browser smoke test of the built client (npm run test:e2e).
//   node tests/e2e/run.mjs [--target=single|served|both] [--build] [--seconds=10]
// For each target it opens the page in headless Chromium (playwright-core),
// clicks through the title into offline play, plays for a few seconds with
// the keyboard, then asserts: no page errors, frames keep rendering, the
// canvas is not blank. Screenshots go to test-results/e2e-<target>.png.
// Builds first when dist/ is missing (or with --build).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "dist");
const outDir = join(root, "test-results");
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const targetArg = args.get("target") ?? "both";
const targets = targetArg === "both" ? ["single", "served"] : [targetArg];
const playSeconds = Number(args.get("seconds") ?? 10);

function log(line) {
  console.log(`[e2e] ${line}`);
}

if (args.has("build") || !existsSync(join(dist, "jangsaeng.html")) || !existsSync(join(dist, "client/index.html"))) {
  log("building…");
  const result = spawnSync(process.execPath, [join(root, "scripts/build.mjs")], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[e2e] FAIL: build failed");
    process.exit(1);
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Static server over dist/client (no /healthz, so online mode stays off). */
function serveStatic(dir) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      let file = join(dir, rel || "index.html");
      if (!file.startsWith(dir + sep) && file !== dir) throw new Error("outside root");
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls the app's debug hook until `predicate(state)` or timeout. */
async function waitForHook(page, predicate, timeoutMs, what) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(() => {
      const h = globalThis.__jangsaeng;
      return h ? { state: h.state, frames: h.frames, errors: [...h.errors] } : null;
    });
    if (last && predicate(last)) return last;
    if (last?.state === "error") throw new Error(`app error while waiting for ${what}: ${last.errors.join(" | ")}`);
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

/** Clicks the first visible element matching one of the selectors. */
async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).filter({ visible: true }).first();
    if ((await locator.count()) > 0) {
      await locator.click({ timeout: 2000 }).catch(() => {});
      return selector;
    }
  }
  return null;
}

/** Dismisses whatever blocks play: chapter card, story prompts, dialogs. */
async function unblock(page) {
  const blocking = await page.evaluate(() => {
    const ui = document.getElementById("ui");
    return !!ui && (ui.classList.contains("modal-open") || ui.classList.contains("card-open"));
  });
  if (!blocking) return false;
  const clicked = await clickFirst(page, [
    ".chapter-card",
    ".layer-modal button.opt:not(.locked):not([disabled])",
    ".layer-modal button.btn-primary:not([disabled])",
    ".layer-modal button:not([disabled])",
    ".layer-screen button.btn-primary:not([disabled])",
  ]);
  if (!clicked) await page.keyboard.press("Enter");
  return true;
}

/** Samples the game canvas; "blank" = almost a single colour. */
async function canvasHealth(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas#game");
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: "no canvas#game" };
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "no 2d context" };
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const colours = new Set();
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 32; x++) {
        const px = Math.floor(((x + 0.5) / 32) * width);
        const py = Math.floor(((y + 0.5) / 24) * height);
        const i = (py * width + px) * 4;
        colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      }
    return { ok: colours.size >= 24, colours: colours.size, width, height };
  });
}

const KEY_SCRIPT = [
  ["KeyD", 700],
  ["KeyS", 500],
  ["KeyJ", 250],
  ["KeyA", 600],
  ["Space", 200],
  ["KeyW", 500],
  ["KeyK", 250],
  ["Digit1", 80],
  ["ShiftLeft", 120],
  ["KeyE", 80],
  ["Digit2", 80],
  ["ArrowRight", 400],
  ["ArrowDown", 400],
];

async function runTarget(browser, target) {
  const problems = [];
  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // No network beyond the page itself: web fonts are optional decoration.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|ERR_FAILED|ERR_BLOCKED|net::ERR_/.test(text)) return;
    consoleErrors.push(text);
  });
  let server = null;
  let url;
  if (target === "served") {
    server = await serveStatic(join(dist, "client"));
    url = `http://127.0.0.1:${server.address().port}/`;
  } else url = pathToFileURL(join(dist, "jangsaeng.html")).href;
  const shot = join(outDir, `e2e-${target}.png`);
  const result = { target, ok: false, steps: [], screenshot: shot };
  try {
    log(`${target}: open ${url}`);
    await page.goto(url, { waitUntil: "load" });
    await waitForHook(page, (h) => h.state === "title", 20000, "title screen");
    result.steps.push("title");
    const opened = await clickFirst(page, ['[data-action="new"]', 'button:has-text("새로 시작")']);
    if (!opened) throw new Error("no 새로 시작 button on the title screen");
    await sleep(400);
    const started = await clickFirst(page, [
      '[data-action="create-start"]',
      'button:has-text("깨어나기")',
      'button.btn-primary:has-text("시작")',
    ]);
    if (!started) throw new Error("no start button in character creation");
    result.steps.push("created");
    await waitForHook(page, (h) => h.state === "game", 25000, "first self view (in game)");
    result.steps.push("in-game");
    const framesBefore = (await waitForHook(page, () => true, 1000, "hook")).frames;
    const until = Date.now() + playSeconds * 1000;
    let dismissed = 0;
    let presses = 0;
    for (let i = 0; Date.now() < until; i++) {
      if (await unblock(page)) {
        dismissed++;
        await sleep(350);
        continue;
      }
      const [key, hold] = KEY_SCRIPT[i % KEY_SCRIPT.length];
      await page.keyboard.down(key);
      await sleep(hold);
      await page.keyboard.up(key);
      presses++;
    }
    const hook = await waitForHook(page, () => true, 1000, "hook");
    const frames = hook.frames - framesBefore;
    result.steps.push(`played ${playSeconds}s: ${frames} frames, ${presses} key presses, ${dismissed} dialogs dismissed`);
    const health = await canvasHealth(page);
    result.steps.push(`canvas ${JSON.stringify(health)}`);
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: shot });
    if (frames < playSeconds * 10) problems.push(`only ${frames} frames rendered in ${playSeconds}s`);
    if (!health.ok) problems.push(`canvas looks blank (${JSON.stringify(health)})`);
    if (hook.errors.length) problems.push(`app errors: ${hook.errors.join(" | ")}`);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: shot }).catch(() => {});
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? "").catch(() => "");
    if (text) result.steps.push(`page text: ${text.replace(/\s+/g, " ")}`);
  } finally {
    await page.close();
    server?.close();
  }
  problems.push(...consoleErrors.map((text) => `console: ${text}`));
  result.ok = problems.length === 0;
  result.problems = problems;
  return result;
}

const browser = await chromium.launch();
let failed = false;
try {
  for (const target of targets) {
    const result = await runTarget(browser, target);
    for (const step of result.steps) log(`${target}: ${step}`);
    log(`${target}: screenshot ${result.screenshot}`);
    if (result.ok) log(`${target}: PASS`);
    else {
      failed = true;
      for (const problem of result.problems) console.error(`[e2e] ${target}: ${problem}`);
      console.error(`[e2e] ${target}: FAIL`);
    }
  }
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
