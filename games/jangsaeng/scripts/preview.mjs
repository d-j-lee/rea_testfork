// Visual check harness for render/UI work.
//   node scripts/preview.mjs <entry.ts> <out.png> [width] [height] [waitMs]
// Bundles the entry for the browser, loads it in headless Chromium on a blank
// page with a full-window <canvas id="preview">, waits, then screenshots.
// Console errors and page errors are printed and make the command fail.
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const [entry, out, width = "960", height = "640", wait = "400"] =
  process.argv.slice(2);
if (!entry || !out) {
  console.error(
    "usage: node scripts/preview.mjs <entry.ts> <out.png> [w] [h] [waitMs]",
  );
  process.exit(2);
}

const dir = await mkdtemp(join(tmpdir(), "jangsaeng-preview-"));
try {
  const bundle = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: { __BUILD_TARGET__: '"served"', __BUILD_VERSION__: '"preview"' },
  });
  const js = bundle.outputFiles[0]?.text ?? "";
  await writeFile(
    join(dir, "index.html"),
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>html,body{margin:0;background:#111;overflow:hidden}canvas{display:block}</style>
</head><body><canvas id="preview"></canvas>
<script type="module">${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
  );
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
  });
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
    else console.log(`[page] ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: resolve(out) });
  await browser.close();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else console.log(`wrote ${out}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
