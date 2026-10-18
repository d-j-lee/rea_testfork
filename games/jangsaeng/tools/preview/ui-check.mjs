// Interaction checks for the UI preview (tools/preview/ui.ts): keyboard choice
// selection, years submission, compact drawers and menu toggles, plus the
// title logo without web fonts, title and help copy built from content, input
// edges, settings storage (and a failed write), the ending screen, toast
// holding and edge-arrow labels. Pages run offline (web fonts
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
  const open = async (state, viewport = { width: 1280, height: 720 }, phone = false, init = undefined) => {
    const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone });
    if (init) await context.addInitScript(init.script, init.arg);
    // Offline, like the single-file demo: the only remote requests are web fonts.
    await context.route(/^https?:\/\//, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => {
      const t = m.text();
      // Blocked web-font requests are expected (see the route above).
      if (m.type() === "error" && !/Failed to load resource|net::ERR_/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}#${state}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(300);
    // Read in the page, so it reflects every input that has already resolved.
    const sent = () => page.evaluate(() => window.__sent ?? []);
    return { page, sent, errors, close: () => context.close() };
  };

  {
    const t = await open("prompt");
    await t.page.waitForSelector(".prompt.typed");
    await t.page.keyboard.press("3"); // locked option: denied, nothing sent
    await t.page.keyboard.press("2");
    await t.page.keyboard.press("1"); // ignored: a choice is already pending
    const choose = (await t.sent()).find((m) => m.t === "choose");
    check("prompt: digit selects option", choose?.option === "oppose", JSON.stringify(choose));
    check("prompt: locked option not sent", !(await t.sent()).some((m) => m.option === "silent"));
    check("prompt: no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  {
    const t = await open("result");
    await t.page.keyboard.press("Enter");
    await t.page.keyboard.press("Enter");
    check("result: Enter continues", (await t.sent()).some((m) => m.t === "choose" && m.option === "ok"));
    await t.close();
  }
  {
    const t = await open("years");
    await t.page.click(".yr-act >> nth=2");
    await t.page.click(".yr-wash >> nth=1");
    await t.page.click(".yr-offer");
    await t.page.click('[data-action="years-confirm"]');
    const y = (await t.sent()).find((m) => m.t === "years");
    // The planner starts from the suggested plan (offering on), so the click turns it off.
    check("years: plan sent", !!y && y.activities.length === 2 && y.wash === "descendant" && y.name === "윤현" && y.offer === false, JSON.stringify(y));
    await t.close();
  }
  {
    const t = await open("hud");
    await t.page.click('.hud-btn[data-cmd="nation"]');
    check("menu: HUD button opens 국운", (await t.page.locator(".book-tab.on").textContent())?.includes("국운"));
    await t.page.keyboard.press("Escape");
    check("menu: Escape closes", (await t.page.locator(".book").count()) === 0);
    await t.page.click(".sk-item.sk-bar");
    check("hud: quick item uses consumable", (await t.sent()).some((m) => m.t === "action" && m.action.kind === "use"));
    await t.page.click(".btn-demo-skip");
    check("hud: demo skip action", (await t.sent()).some((m) => m.t === "action" && m.action.kind === "demoSkip"));
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
    check("compact: chat sends", (await t.sent()).some((m) => m.t === "chat" && m.text === "안녕하시오"));
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
    // The menu names the chapters the demo grid lists (both read the content).
    const desc = await t.page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll(".menu-item")].map((b) => [b.dataset.action, b.querySelector(".menu-desc")?.textContent ?? ""])),
    );
    await t.page.click('[data-action="demo"]');
    const grid = await t.page.evaluate(() => ({
      cards: document.querySelectorAll(".demo-card").length,
      firstYear: (document.querySelector(".demo-years")?.textContent ?? "").split("–")[0],
      firstTitle: document.querySelector(".demo-title")?.textContent ?? "",
    }));
    check("title: 시연 모드 names as many chapters as the demo grid lists", grid.cards > 0 && desc.demo === `${grid.cards}개 장 중 하나로 바로`, JSON.stringify({ desc, grid }));
    check("title: 새로 시작 starts in the first chapter's year", desc.new === `${grid.firstYear}년, ${grid.firstTitle}에서`, JSON.stringify({ desc, grid }));
    await t.close();
  }
  {
    const t = await open("help");
    const line = await t.page.evaluate(() => {
      const term = [...document.querySelectorAll(".tab-help dt")].find((dt) => dt.textContent === "국운 · 분기");
      return term?.nextElementSibling?.textContent ?? "";
    });
    // The particle follows the literal 지표, so the meter list may change order or length.
    check("help: the 국운 line reads as Korean whatever the meters", /^국운 지표\([^)]+\)와 B1–B12c 분기가 1910년의 결말을 정한다\.$/.test(line), line);
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
    await t.close();
  }
  {
    // Settings saved before the storage owner existed are carried over once.
    const legacy = { music: 0.25, sfx: 2, muted: true, touch: "off", motion: "reduced" };
    const seed = (value) => {
      // Once per tab: a reload must find the legacy key gone.
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("jangsaeng.settings.v1", value);
    };
    const t = await open("hud", undefined, false, { script: seed, arg: JSON.stringify(legacy) });
    const read = () =>
      t.page.evaluate(() => ({
        owned: JSON.parse(localStorage.getItem("jangsaeng:v1:settings") ?? "null"),
        legacy: localStorage.getItem("jangsaeng.settings.v1"),
        motion: document.documentElement.dataset.motion,
        touch: document.documentElement.dataset.touch,
      }));
    const first = await read();
    const want = { music: 0.25, sfx: 0.8, muted: true, touch: "off", motion: "reduced" };
    check("settings: legacy settings carried over, validated", JSON.stringify(first.owned) === JSON.stringify(want) && first.motion === "reduced", JSON.stringify(first));
    check("settings: the legacy key is removed", first.legacy === null, JSON.stringify(first));
    await t.page.reload();
    await t.page.waitForFunction(() => window.__ready === true);
    const second = await read();
    check("settings: carried-over settings survive a reload", JSON.stringify(second.owned) === JSON.stringify(want) && second.legacy === null && second.motion === "reduced", JSON.stringify(second));
    await t.close();
  }
  {
    // A write that fails (quota) keeps the legacy settings, applied this session.
    const legacy = { music: 0.25, sfx: 2, muted: true, touch: "off", motion: "reduced" };
    const seedFull = (value) => {
      localStorage.setItem("jangsaeng.settings.v1", value);
      // This load only: the settings key does not fit.
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, item) {
        if (key === "jangsaeng:v1:settings") throw new DOMException("full", "QuotaExceededError");
        return setItem.call(this, key, item);
      };
    };
    const t = await open("hud", undefined, false, { script: seedFull, arg: JSON.stringify(legacy) });
    const read = () =>
      t.page.evaluate(() => ({
        owned: JSON.parse(localStorage.getItem("jangsaeng:v1:settings") ?? "null"),
        legacy: localStorage.getItem("jangsaeng.settings.v1"),
        motion: document.documentElement.dataset.motion,
      }));
    const first = await read();
    check("settings: a failed write keeps the legacy settings (and applies them this session)", first.owned === null && first.legacy !== null && first.motion === "reduced", JSON.stringify(first));
    // That the next load then carries them over is pinned in tests/unit/client-storage.test.ts:
    // a second page load here races Chromium's storage commit across navigations.
    await t.close();
  }
  {
    const t = await open("hud");
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
  {
    // The shipped years path: an error already showing moves to the dock,
    // then confirm → the host's result card → the roll ends → held toasts play.
    const t = await open("hud");
    const visible = () =>
      t.page.evaluate(() => ({
        top: [...document.querySelectorAll(".toasts .toast:not(.out)")].map((el) => el.textContent ?? ""),
        dock: [...document.querySelectorAll(".toast-dock .toast")].map((el) => el.textContent ?? ""),
      }));
    await t.page.evaluate(() => window.__ui.handle({ t: "toast", text: "전이 모자랍니다", tone: "bad" }));
    const before = await visible();
    await t.page.evaluate(() => window.__ui.handle({ t: "prompt", prompt: window.__mock.YEARS_PROMPT }));
    const opened = await visible();
    check("toasts: an error showing when the planner opens moves to the dock", before.top.includes("전이 모자랍니다") && opened.top.length === 0 && opened.dock.join() === "전이 모자랍니다", JSON.stringify({ before, opened }));
    await t.page.evaluate(() => window.__ui.handle({ t: "toast", text: "길이 막혔습니다", tone: "bad" }));
    const docked = await t.page.evaluate(() =>
      [...document.querySelectorAll(".toast-dock .toast")].map((el) => ({
        text: el.textContent,
        hidden: el.getAttribute("aria-hidden"),
        animation: getComputedStyle(el).animationName,
      })),
    );
    const [moved, fresh] = docked;
    check("toasts: the moved error is not announced or animated again", moved?.hidden === "true" && moved.animation === "none", JSON.stringify(docked));
    check("toasts: a new error in the dock is announced and animated once", fresh?.text === "길이 막혔습니다" && fresh.hidden === null && fresh.animation === "toast-in", JSON.stringify(docked));
    await t.page.click('[data-action="years-confirm"]');
    await t.page.evaluate(() => {
      window.__ui.handle({ t: "prompt", prompt: window.__mock.RESULT_PROMPT });
      window.__ui.handle({ t: "toast", text: "세월이 흘렀다 — 시험", tone: "good" });
    });
    const rolling = await visible();
    await t.page.waitForTimeout(3600); // the roll: 2100 + 650 + 420 ms
    const done = await visible();
    check("toasts: held through the years roll", rolling.top.length === 0, JSON.stringify(rolling));
    check("years: the planner is gone after the roll, the result card stays", await t.page.evaluate(() => document.querySelector(".years-host")?.childElementCount === 0 && !!document.querySelector(".prompt")));
    // The result card is a modal too: the toasts wait for it.
    check("toasts: still held under the result card", done.top.length === 0, JSON.stringify(done));
    await t.page.evaluate(() => window.__ui.handle({ t: "prompt", prompt: null }));
    const after = await visible();
    check("toasts: play once the result card closes", after.top.includes("세월이 흘렀다 — 시험"), JSON.stringify(after));
    check("toasts (years path): no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  const PHONE = { width: 390, height: 844 };
  for (const phone of [false, true]) {
    // The years result with a wash (CH07): the list scrolls inside the sheet,
    // right under the header, and 계속 stays on screen.
    const tag = phone ? "long result (phone)" : "long result";
    const t = await open("longresult", phone ? PHONE : undefined, phone);
    await t.page.waitForTimeout(200);
    const g = await t.page.evaluate(() => {
      const sheet = document.querySelector(".prompt");
      const opt = sheet.querySelector(".opt").getBoundingClientRect();
      const head = sheet.querySelector(".pr-head").getBoundingClientRect();
      const list = sheet.querySelector(".pr-result");
      const scroll = sheet.querySelector(".pr-scroll");
      return {
        vh: innerHeight,
        opt: [Math.round(opt.top), Math.round(opt.bottom)],
        gap: Math.round(list.getBoundingClientRect().top - head.bottom),
        inScroll: !!scroll?.contains(list),
        scrolls: !!scroll && scroll.scrollHeight > scroll.clientHeight + 2,
        cue: !!scroll?.classList.contains("more"),
      };
    });
    check(`${tag}: 계속 stays fully on screen`, g.opt[0] >= 0 && g.opt[1] <= g.vh, JSON.stringify(g));
    check(`${tag}: the list scrolls in the sheet's body, right under the header`, g.inScroll && g.scrolls && g.gap <= 16, JSON.stringify(g));
    check(`${tag}: a fade cues the rest of the list`, g.cue, JSON.stringify(g));
    await t.page.keyboard.press("End");
    await t.page.keyboard.press("PageDown");
    await t.page.keyboard.press("PageDown");
    await t.page.waitForTimeout(150);
    const end = await t.page.evaluate(() => {
      const s = document.querySelector(".pr-scroll");
      return { top: s?.scrollTop ?? 0, cue: !!s?.classList.contains("more") };
    });
    check(`${tag}: Page keys scroll the list; the cue goes at its end`, end.top > 0 && !end.cue, JSON.stringify(end));
    await t.page.keyboard.press("Enter");
    check(`${tag}: Enter continues`, (await t.sent()).some((m) => m.t === "choose" && m.option === "ok"));
    check(`${tag}: no page errors`, t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  {
    const t = await open("alt");
    const r = await t.page.evaluate(() =>
      [...document.querySelectorAll(".prompt .pr-ribbon")].map((el) => ({ text: el.textContent, alt: el.classList.contains("alt"), w: Math.round(el.getBoundingClientRect().width) })),
    );
    check("alt card: a 대체역사 ribbon, never 실제 역사", r.length === 1 && r[0].text === "대체역사" && r[0].alt, JSON.stringify(r));
    check("alt card: the tag stays compact", (r[0]?.w ?? 999) < 120, JSON.stringify(r));
    await t.close();
  }
  {
    // Toasts never draw over modal UI; only the menu holds an offline world.
    const t = await open("hud");
    const top = () => t.page.evaluate(() => document.querySelectorAll(".toasts .toast:not(.out)").length);
    const toast = (text) => t.page.evaluate((x) => window.__ui.handle({ t: "toast", text: x, tone: "good" }), text);
    const holds = () => t.page.evaluate(() => window.__ui.holdsWorld);
    const shown = await top();
    await t.page.click('.hud-btn[data-cmd="character"]');
    await toast("목표 달성 — 메뉴 뒤");
    const menu = { top: await top(), holds: await holds() };
    await t.page.keyboard.press("Escape");
    const closed = { top: await top(), holds: await holds() };
    check("toasts: none over the menu book; they play after it closes", shown >= 1 && menu.top === 0 && closed.top >= 1, JSON.stringify({ shown, menu, closed }));
    check("world: the menu book holds an offline world, closing it releases it", menu.holds === true && closed.holds === false, JSON.stringify({ menu, closed }));
    await t.page.evaluate(() => window.__ui.handle({ t: "prompt", prompt: window.__mock.STORY_PROMPT }));
    await toast("목표 달성 — 카드 뒤");
    const story = { top: await top(), holds: await holds() };
    await t.page.evaluate(() => window.__ui.handle({ t: "toast", text: "물러났다 — 카드 위의 경고", tone: "bad" }));
    await t.page.waitForTimeout(150);
    const docked = await t.page.evaluate(() => {
      const opts = [...document.querySelectorAll(".prompt .opt")].map((el) => el.getBoundingClientRect());
      const bad = [...document.querySelectorAll(".toast-dock .toast")].map((el) => el.getBoundingClientRect());
      return { bad: bad.length, hits: bad.filter((r) => opts.some((o) => r.top < o.bottom && r.bottom > o.top && r.left < o.right && r.right > o.left)).length };
    });
    check("toasts: an error shown under a story sheet never covers its options", docked.bad >= 1 && docked.hits === 0, JSON.stringify(docked));
    await t.page.evaluate(() => window.__ui.handle({ t: "prompt", prompt: null }));
    check("toasts: none over a story sheet", story.top === 0 && (await top()) >= 1, JSON.stringify(story));
    check("world: a story card does not hold the world (the host holds its battle)", story.holds === false, JSON.stringify(story));
    // The 사경 overlay: toasts wait under it; it closes to a small self-revive
    // plate when the battle ends or the timer runs out, never showing "0초".
    const self = (over) => t.page.evaluate((o) => window.__ui.handle({ t: "self", self: window.__mock.mockSelf(o) }), over);
    const downed = () =>
      t.page.evaluate(() => {
        const el = document.querySelector(".downed");
        const shown = (sel) => !!el.querySelector(sel)?.getClientRects().length;
        return { hidden: el.classList.contains("hidden"), alone: el.classList.contains("alone"), count: shown(".dn-line") ? el.querySelector(".dn-count").textContent : null, revive: shown(".dn-btn") };
      });
    await self({ hp: 0, downed: { secondsLeft: 12, help: true } });
    await toast("사경 뒤의 소식");
    const down = { ...(await downed()), top: await top() };
    await self({ hp: 0, downed: { secondsLeft: 9, help: true }, battle: undefined });
    const ended = { ...(await downed()), top: await top() };
    check("downed: the overlay counts down while others can help; toasts wait", !down.hidden && !down.alone && down.count === "12" && down.top === 0, JSON.stringify(down));
    check("downed: only the host's timer decides — a battle view going away does not close the countdown", !ended.hidden && !ended.alone && ended.count === "9", JSON.stringify(ended));
    await self({});
    await self({ hp: 0, downed: { secondsLeft: 0.3, help: true } });
    await t.page.waitForTimeout(700);
    const late = await downed();
    await self({ hp: 0, downed: { secondsLeft: 0, help: true } });
    const expired = await downed();
    check("downed: the countdown never shows 0초 (the host's own zero is awaited)", !late.alone && late.count === "1", JSON.stringify(late));
    check("downed: the host's timer ran out — the overlay closes to the self-revive plate", expired.alone && expired.count === null && expired.revive, JSON.stringify(expired));
    await self({});
    await self({ hp: 0, downed: { secondsLeft: 10, help: false } });
    const nobody = await downed();
    check("downed: nobody standing to help — the self-revive plate at once, no countdown", nobody.alone && nobody.count === null && nobody.revive, JSON.stringify(nobody));
    await toast("사경 뒤의 다른 소식");
    const lanes = await t.page.evaluate(() => {
      const plate = document.querySelector(".downed .dn-center")?.getBoundingClientRect();
      const toasts = [...document.querySelectorAll(".toasts .toast")].map((el) => el.getBoundingClientRect());
      return { plate: plate && { top: plate.top, bottom: plate.bottom, left: plate.left, right: plate.right }, hits: toasts.filter((r) => plate && r.top < plate.bottom && r.bottom > plate.top && r.left < plate.right && r.right > plate.left).length, toasts: toasts.length };
    });
    check("downed: the self-revive plate stays out of the toast lane", !!lanes.plate && lanes.toasts >= 1 && lanes.hits === 0, JSON.stringify(lanes));
    await self({});
    check("downed: up again, nothing is left", (await downed()).hidden);
    check("modals: no page errors", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  {
    const t = await open("hud");
    const life = (over) =>
      t.page.evaluate((o) => {
        window.__ui.handle({ t: "self", self: window.__mock.mockSelf(o) });
        const card = document.querySelector(".hud-status");
        return { life: card.dataset.life, warn: card.querySelector(".st-warn").textContent, chip: getComputedStyle(card.querySelector(".st-short")).backgroundColor };
      }, over);
    const far = await life({ year: 1361, lifeEnd: 1861, lifeShortfall: 49 });
    const near = await life({ year: 1830, lifeEnd: 1870, lifeShortfall: 40 });
    const ok = await life({ year: 1361, lifeEnd: 1924, lifeShortfall: 0 });
    check("life: a shortfall centuries away is a calm note (the opening)", far.life === "far" && !far.warn.includes("다한다") && far.chip !== near.chip, JSON.stringify({ far, near }));
    check("life: red only when life runs out", near.life === "near" && near.warn === "이대로면 1870년에 천수가 다한다", JSON.stringify(near));
    check("life: no warning once 1910 is reached", ok.life === "ok" && ok.warn === "", JSON.stringify(ok));
    await t.close();
  }
  {
    const t = await open("years");
    const view = (sel) =>
      t.page.evaluate((s) => {
        const body = document.querySelector(".years-panel .panel-body").getBoundingClientRect();
        const el = document.querySelector(s);
        if (!el || !el.getClientRects().length) return null;
        const r = el.getBoundingClientRect();
        return r.top >= body.top - 1 && r.bottom <= body.bottom + 1;
      }, sel);
    check("years (laptop): the offering switch is on screen when the planner opens", (await view(".yr-offer")) === true);
    await t.page.click(".yr-wash:not(.locked) >> nth=-1");
    check("years (laptop): the new-name field shows with the chosen wash", (await view(".yr-name:not(.hidden) input")) === true);
    const nameSpot = () =>
      t.page.evaluate(() => {
        const row = document.querySelector(".yr-name");
        const r = row.getBoundingClientRect();
        const covered = [...document.querySelectorAll(".yr-wash")].filter((w) => {
          const b = w.getBoundingClientRect();
          return b.bottom > r.top + 1 && b.top < r.bottom - 1;
        });
        return { afterChosen: row.previousElementSibling?.classList.contains("on") ?? false, covered: covered.length };
      });
    const last = await nameSpot();
    await t.page.click(".yr-wash:not(.locked) >> nth=1");
    const second = await nameSpot();
    check("years (laptop): the new-name field sits under the chosen wash and covers none", last.afterChosen && second.afterChosen && last.covered === 0 && second.covered === 0, JSON.stringify({ last, second }));
    await t.close();
  }
  {
    const t = await open("demo");
    const g = await t.page.evaluate(() => {
      const b = document.querySelector(".demo-panel .panel-body").getBoundingClientRect();
      const cards = [...document.querySelectorAll(".demo-card")];
      return { n: cards.length, fit: cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }).length };
    });
    check("demo (laptop 1280×720): every chapter card is on screen", g.n === 16 && g.fit === g.n, JSON.stringify(g));
    await t.close();
  }
  {
    const t = await open("demo", PHONE, true);
    const g = await t.page.evaluate(() => {
      const lines = [...document.querySelectorAll(".demo-line")].map((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
      return { tall: lines.filter((n) => n > 2.05).length, cue: document.querySelector(".demo-panel .panel-body").classList.contains("more") };
    });
    check("demo (phone): a card's line is two lines at most", g.tall === 0, JSON.stringify(g));
    check("demo (phone): a fade cues the cards below", g.cue, JSON.stringify(g));
    await t.close();
  }
  for (const phone of [false, true]) {
    const t = await open("map", phone ? PHONE : undefined, phone);
    const tag = phone ? "map (phone)" : "map";
    const overlaps = () =>
      t.page.evaluate(() => {
        const els = [...document.querySelectorAll(".bm-label, .bm-obj")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
        const rs = els.map((e) => e.getBoundingClientRect());
        const pairs = [];
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i];
            const b = rs[j];
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) pairs.push(`${els[i].textContent}/${els[j].textContent}`);
          }
        return { shown: els.length, pairs };
      });
    await t.page.waitForTimeout(200);
    const whole = await overlaps();
    check(`${tag}: no two names overlap`, whole.shown >= 4 && whole.pairs.length === 0, JSON.stringify(whole));
    await t.page.click(".bm-zoom");
    await t.page.waitForTimeout(300);
    const zoomed = await overlaps();
    check(`${tag}: zoomed, no two names overlap`, zoomed.shown > whole.shown && zoomed.pairs.length === 0, JSON.stringify(zoomed));
    if (phone) {
      const strip = await t.page.evaluate(() => {
        const s = document.querySelector(".book-tabs");
        const r = s.getBoundingClientRect();
        return { tabs: [...s.querySelectorAll(".book-tab")].filter((b) => b.getBoundingClientRect().right <= r.right + 0.5).length, scrolls: s.scrollWidth > s.clientWidth + 1 };
      });
      check("menu (phone): all seven tabs, 설정 too, fit the strip", strip.tabs === 7 && !strip.scrolls, JSON.stringify(strip));
    }
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
