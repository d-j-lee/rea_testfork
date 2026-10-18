// Drives an audio harness entry in headless Chromium with a real user gesture
// (a click, so an AudioContext may start) and lets the page write files:
//   node tools/preview/audio-run.mjs <entry.ts> <outDir> [timeoutMs]
// The page may call `await window.__save(name, base64)`; it logs "READY" when
// it wants the click and "DONE" when finished. Page errors fail the run.
import { build } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const [entry, outDir, timeout = "600000"] = process.argv.slice(2);
if (!entry || !outDir) {
  console.error("usage: node tools/preview/audio-run.mjs <entry.ts> <outDir> [timeoutMs]");
  process.exit(2);
}
await mkdir(resolve(outDir), { recursive: true });
const dir = await mkdtemp(join(tmpdir(), "jangsaeng-audio-"));
const browser = await chromium.launch();
try {
  const bundle = await build({ entryPoints: [resolve(entry)], bundle: true, format: "esm", target: "es2022", write: false });
  const js = bundle.outputFiles[0]?.text ?? "";
  await writeFile(
    join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#111}canvas{display:block}</style></head>` +
      `<body><canvas id="preview" width="400" height="200"></canvas><script type="module">${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
  );
  const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
  const problems = [];
  let ready;
  let done;
  const readyP = new Promise((r) => (ready = r));
  const doneP = new Promise((r) => (done = r));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error") problems.push(`console: ${text}`);
    else if (!text.includes("not allowed to start")) console.log(text);
    if (text === "READY") ready();
    if (text === "DONE") done();
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.exposeFunction("__save", async (name, b64) => {
    await writeFile(join(resolve(outDir), basename(name)), Buffer.from(b64, "base64"));
    return true;
  });
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await Promise.race([readyP, page.waitForTimeout(5000)]);
  await page.mouse.click(200, 100);
  await Promise.race([doneP, page.waitForTimeout(Number(timeout))]);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
