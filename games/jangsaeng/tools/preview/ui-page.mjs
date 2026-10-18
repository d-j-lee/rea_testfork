// UI screenshot harness. Builds tools/preview/ui.ts into the real
// src/client/index.html with src/client/styles.css inlined (exactly as
// scripts/build.mjs does), then screenshots each screen state.
//   node tools/preview/ui-page.mjs <outDir> [states|all] [sizes] [waitMs]
//   sizes: comma list like 1280x720,390x844 (phones get touch + mobile UA)
// Google Fonts load through HTTPS_PROXY when it is set.
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ALL = [
  "title", "creation", "demo", "pitch", "settings", "loading", "card", "hud", "calm", "prompt", "cardprompt",
  "result", "longresult", "alt", "death", "years", "roll", "downed", "character", "inventory", "nation", "chronicle", "map", "help",
  "menu", "ending", "error", "drawer-status", "drawer-obj", "drawer-chat",
];
const [outArg, statesArg = "all", sizesArg = "1280x720,390x844", waitArg = "1600"] = process.argv.slice(2);
if (!outArg) {
  console.error("usage: node tools/preview/ui-page.mjs <outDir> [states|all] [sizes] [waitMs]");
  process.exit(2);
}
const out = resolve(outArg);
const states = statesArg === "all" ? ALL : statesArg.split(",");
const sizes = sizesArg.split(",").map((s) => s.split("x").map(Number));
await mkdir(out, { recursive: true });

const dir = await mkdtemp(join(tmpdir(), "jangsaeng-ui-"));
try {
  const bundle = await build({
    entryPoints: [join(root, "tools/preview/ui.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: { __BUILD_TARGET__: '"served"', __BUILD_VERSION__: '"preview"' },
  });
  const js = bundle.outputFiles[0]?.text ?? "";
  const [html, css] = await Promise.all([
    readFile(join(root, "src/client/index.html"), "utf8"),
    readFile(join(root, "src/client/styles.css"), "utf8"),
  ]);
  const page = html
    .replace("<!--STYLE-->", () => `<style>\n${css}\n</style>`)
    .replace("<!--SCRIPT-->", () => `<script type="module">\n${js.replaceAll("</script", "<\\/script")}\n</script>`);
  await writeFile(join(dir, "index.html"), page);
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  let failed = false;
  for (const [w, h] of sizes) {
    const phone = Math.min(w, h) < 500;
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      hasTouch: phone,
      isMobile: phone,
    });
    for (const state of states) {
      const tab = await context.newPage();
      const problems = [];
      tab.on("console", (m) => {
        if (m.type() === "error") problems.push(`console: ${m.text()}`);
      });
      tab.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      await tab.goto(`${pathToFileURL(join(dir, "index.html")).href}#${state}`);
      await tab.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch(() => problems.push("not ready"));
      await tab.evaluate(() => document.fonts.ready);
      await tab.waitForTimeout(Number(waitArg));
      const file = join(out, `${state}-${w}x${h}.png`);
      await tab.screenshot({ path: file });
      if (problems.length) {
        failed = true;
        console.error(`${state} ${w}x${h}:\n  ${problems.join("\n  ")}`);
      } else console.log(`wrote ${file}`);
      await tab.close();
    }
    await context.close();
  }
  await browser.close();
  if (failed) process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
