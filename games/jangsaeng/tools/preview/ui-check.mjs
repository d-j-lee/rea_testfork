// Interaction checks for the UI preview (tools/preview/ui.ts): keyboard choice
// selection, years submission, compact drawers and menu toggles. Prints PASS/FAIL.
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
    const page = await context.newPage();
    const sent = [];
    const errors = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("send ")) sent.push(JSON.parse(t.slice(5)));
      else if (m.type() === "error") errors.push(t);
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
  await browser.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : "all UI checks passed");
process.exitCode = failures ? 1 : 0;
