// Interaction checks for the UI preview (tools/preview/ui.ts): keyboard choice
// selection, years submission, compact drawers and menu toggles, plus the
// title logo without web fonts, input edges, settings storage, the ending
// screen, toast holding and edge-arrow labels. Pages run offline (web fonts
// blocked), like the single-file demo build. Prints PASS/FAIL.
//   node tools/preview/ui-check.mjs
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = await mkdtemp(join(tmpdir(), "jangsaeng-uicheck-"));
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
try {
  const bundle = await build({
    entryPoints: [join(root, "tools/preview/ui.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: { __BUILD_TARGET__: '"served"', __BUILD_VERSION__: '"preview"' },
  });
  const [html, css] = await Promise.all([
    readFile(join(root, "src/client/index.html"), "utf8"),
    readFile(join(root, "src/client/styles.css"), "utf8"),
  ]);
  const js = bundle.outputFiles[0]?.text ?? "";
  await writeFile(
    join(dir, "index.html"),
    html
      .replace("<!--STYLE-->", () => `<style>${css}</style>`)
      .replace("<!--SCRIPT-->", () => `<script type="module">${js.replaceAll("</script", "<\\/script")}</script>`),
  );
  const url = pathToFileURL(join(dir, "index.html")).href;
  const browser = await chromium.launch();
  const open = async (state, viewport = { width: 1280, height: 720 }, phone = false) => {
    const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone });
    // Offline, like the single-file demo: the only remote requests are web fonts.
    await context.route(/^https?:\/\//, (route) => route.abort());
    const page = await context.newPage();
    const sent = [];
    const errors = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("send ")) sent.push(JSON.parse(t.slice(5)));
      // Blocked web-font requests are expected (see the route above).
      else if (m.type() === "error" && !/Failed to load resource|net::ERR_/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}#${state}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(300);
    return { page, sent, errors, close: () => context.close() };
  };

  {
    const t = await open("prompt");
    await t.page.waitForSelector(".prompt.typed");
    await t.page.keyboard.press("3"); // locked option: denied, nothing sent
    await t.page.keyboard.press("2");
    await t.page.keyboard.press("1"); // ignored: a choice is already pending
    const choose = t.sent.find((m) => m.t === "choose");
    check("prompt: digit selects option", choose?.option === "oppose", JSON.stringify(choose));
    check("prompt: locked option not sent", !t.sent.some((m) => m.option === "silent"));
    check("prompt: no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  {
    const t = await open("result");
    await t.page.keyboard.press("Enter");
    await t.page.keyboard.press("Enter");
    check("result: Enter continues", t.sent.some((m) => m.t === "choose" && m.option === "ok"));
    await t.close();
  }
  {
    const t = await open("years");
    await t.page.click(".yr-act >> nth=2");
    await t.page.click(".yr-wash >> nth=1");
    await t.page.click(".yr-offer");
    await t.page.click('[data-action="years-confirm"]');
    const y = t.sent.find((m) => m.t === "years");
    check("years: plan sent", !!y && y.activities.length === 3 && y.wash === "descendant" && y.name === "윤현" && y.offer === true, JSON.stringify(y));
    await t.close();
  }
  {
    const t = await open("hud");
    await t.page.click('.hud-btn[data-cmd="nation"]');
    check("menu: HUD button opens 국운", (await t.page.locator(".book-tab.on").textContent())?.includes("국운"));
    await t.page.keyboard.press("Escape");
    check("menu: Escape closes", (await t.page.locator(".book").count()) === 0);
    await t.page.click(".sk-item.sk-bar");
    check("hud: quick item uses consumable", t.sent.some((m) => m.t === "action" && m.action.kind === "use"));
    await t.page.click(".btn-demo-skip");
    check("hud: demo skip action", t.sent.some((m) => m.t === "action" && m.action.kind === "demoSkip"));
    await t.close();
  }
  {
    const t = await open("hud", { width: 390, height: 844 }, true);
    check("compact: layout flag", (await t.page.evaluate(() => document.documentElement.dataset.layout)) === "compact");
    check("compact: touch controls visible", await t.page.locator(".tc-attack").isVisible());
    await t.page.click(".cstrip");
    check("compact: objective drawer opens", await t.page.locator(".hud-obj").isVisible());
    check("compact: touch hidden while drawer open", !(await t.page.locator(".tc-attack").isVisible()));
    await t.page.mouse.click(195, 760);
    check("compact: scrim closes drawer", !(await t.page.locator(".hud-obj").isVisible()));
    await t.page.click('.cbtn[aria-label="채팅"]');
    check("compact: chat drawer opens", await t.page.locator(".hud-chat").isVisible());
    await t.page.click(".chat-open");
    await t.page.keyboard.type("안녕하시오");
    await t.page.keyboard.press("Enter");
    check("compact: chat sends", t.sent.some((m) => m.t === "chat" && m.text === "안녕하시오"));
    check("compact: no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  {
    // Web fonts unavailable: the vertical logo and seal keep one box per glyph.
    const t = await open("title");
    const m = await t.page.evaluate(() => {
      const ratio = (sel) => {
        const el = document.querySelector(sel);
        return el instanceof HTMLElement ? el.offsetHeight / parseFloat(getComputedStyle(el).fontSize) : 0;
      };
      return { hanja: ratio(".logo-hanja"), seal: ratio(".logo-seal"), loaded: [...document.fonts].filter((f) => f.status === "loaded").length };
    });
    check("title: web fonts are blocked in this run", m.loaded === 0, JSON.stringify(m));
    check("title: 長生 keeps two glyph boxes without web fonts", m.hanja >= 1.9, JSON.stringify(m));
    check("title: 五百年 seal keeps three glyph boxes without web fonts", m.seal >= 3, JSON.stringify(m));
    await t.close();
  }
  {
    const t = await open("hud");
    const r = await t.page.evaluate(() => {
      const input = window.__input;
      const key = (code, repeat) => window.dispatchEvent(new KeyboardEvent("keydown", { code, repeat, bubbles: true }));
      input.state();
      key("Digit2", false);
      const press = input.state().skill;
      key("Digit2", true);
      const held = input.state().skill;
      key("KeyE", false);
      const tap = input.state().interact;
      key("KeyE", true);
      const heldE = input.state().interact;
      return { press, held, tap, heldE };
    });
    check("input: a skill key press fires once", r.press === 2 && r.tap === true, JSON.stringify(r));
    check("input: keyboard auto-repeat does not re-fire skills or interact", r.held === 0 && r.heldE === false, JSON.stringify(r));
    await t.page.keyboard.press("KeyO");
    const stored = await t.page.evaluate(() => ({ owned: localStorage.getItem("jangsaeng:v1:settings"), legacy: localStorage.getItem("jangsaeng.settings.v1") }));
    check("settings: saved through the client storage owner", JSON.parse(stored.owned ?? "{}").muted === true && stored.legacy === null, JSON.stringify(stored));
    const arrow = await t.page.evaluate(() => window.__arrowLabel("center"));
    check("arrow: edge label starts on screen even after centred text", arrow.label[0] >= 4, JSON.stringify(arrow));
    check("arrow: edge label clears its arrow", arrow.label[0] > arrow.arrow[1], JSON.stringify(arrow));
    // Toasts showing when a full-screen document opens are taken back and replayed after it.
    const visible = () => t.page.evaluate(() => ({ top: document.querySelectorAll(".toasts .toast:not(.out)").length, dock: document.querySelectorAll(".toast-dock .toast").length }));
    const before = await visible();
    await t.page.evaluate(() => window.__ui.handle({ t: "prompt", prompt: window.__mock.YEARS_PROMPT }));
    const open1 = await visible();
    await t.page.evaluate(() => {
      window.__ui.handle({ t: "toast", text: "목표 달성 — 시험", tone: "good" });
      window.__ui.handle({ t: "toast", text: "전이 모자랍니다", tone: "bad" });
    });
    const open2 = await visible();
    await t.page.evaluate(() => window.__ui.handle({ t: "prompt", prompt: null }));
    const after = await visible();
    check("toasts: none over the years planner; errors dock below", before.top >= 2 && open1.top === 0 && open2.top === 0 && open2.dock === 1, JSON.stringify({ before, open1, open2 }));
    check("toasts: held toasts play after the planner closes", after.top === Math.min(4, before.top + 1), JSON.stringify({ before, after }));
    await t.close();
  }
  for (const phone of [false, true]) {
    const t = await open("ending", phone ? { width: 390, height: 844 } : undefined, phone);
    const tag = phone ? "ending (phone)" : "ending";
    const score = await t.page.evaluate(() => ({ big: document.querySelector(".score-big b")?.textContent, sum: document.querySelector(".breakdown tr.sum td")?.textContent }));
    check(`${tag}: 합계 shows the settled score`, score.big === "52.4" && score.sum === score.big, JSON.stringify(score));
    await t.page.evaluate(() => {
      const ending = { ...window.__mock.ENDING, lifeline: { lifeEnd: 1958, gained: 97, spent: 0 } };
      window.__ui.handle({ t: "ending", ending });
      window.__ui.handle({ t: "toast", text: "목표 달성 — 1910년 여름", tone: "good" });
    });
    const s = await t.page.evaluate(() => {
      const svg = document.querySelector(".life-graph");
      const out = [...svg.querySelectorAll("text")]
        .filter((el) => getComputedStyle(el).display !== "none")
        .map((el) => el.getBBox())
        .filter((b) => b.x < 0 || b.x + b.width > 640)
        .map((b) => Math.round(b.x + b.width));
      const legend = document.querySelector(".lg-legend");
      return {
        screens: document.querySelectorAll(".ending-screen").length,
        toasts: document.querySelectorAll(".toasts .toast").length,
        out,
        legend: legend?.textContent ?? "",
        legendPx: legend ? parseFloat(getComputedStyle(legend).fontSize) : 0,
        legendVisible: !!legend && legend.getClientRects().length > 0,
      };
    });
    check(`${tag}: a repeated ending replaces the screen`, s.screens === 1, JSON.stringify(s));
    check(`${tag}: no toast over the ending`, s.toasts === 0, JSON.stringify(s));
    check(`${tag}: life graph labels stay inside the graph`, s.out.length === 0, JSON.stringify(s.out));
    check(`${tag}: life graph values in a readable legend`, s.legendVisible && s.legendPx >= 13 && s.legend.includes("+97년"), JSON.stringify(s));
    check(`${tag}: no page errors`, t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  await browser.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : "all UI checks passed");
process.exitCode = failures ? 1 : 0;
