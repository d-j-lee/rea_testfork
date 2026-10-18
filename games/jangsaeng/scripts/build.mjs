// Builds the browser client from one source tree:
//   dist/client/        — served by the Node server (online + offline modes)
//   dist/jangsaeng.html — one self-contained file (offline mode), used as the
//                         shareable prototype build.
//   dist/artifact.html  — the same page without the document wrapper, for
//                         hosts that supply their own <html>/<head>/<body>.
import { build, context } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const watch = process.argv.includes("--watch");

const shared = {
  entryPoints: [join(root, "src/client/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  legalComments: "none",
  logLevel: "info",
};

async function readTemplate() {
  const [html, css] = await Promise.all([
    readFile(join(root, "src/client/index.html"), "utf8"),
    readFile(join(root, "src/client/styles.css"), "utf8"),
  ]);
  return { html, css };
}

async function writeServed(defineTarget) {
  const { html, css } = await readTemplate();
  await mkdir(join(out, "client"), { recursive: true });
  await writeFile(join(out, "client/styles.css"), css);
  await writeFile(
    join(out, "client/index.html"),
    html
      .replace("<!--STYLE-->", '<link rel="stylesheet" href="styles.css" />')
      .replace(
        "<!--SCRIPT-->",
        `<script type="module" src="app.js?v=${defineTarget.version}"></script>`,
      ),
  );
}

async function writeSingleFile(version) {
  const result = await build({
    ...shared,
    minify: true,
    write: false,
    define: { __BUILD_TARGET__: '"single"', __BUILD_VERSION__: `"${version}"` },
  });
  const js = result.outputFiles[0]?.text ?? "";
  const { html, css } = await readTemplate();
  // Inline script text must not terminate its own <script> element.
  const safeJs = js.replaceAll("</script", "<\\/script");
  const page = html
    .replace("<!--STYLE-->", () => `<style>\n${css}\n</style>`)
    .replace(
      "<!--SCRIPT-->",
      () => `<script type="module">\n${safeJs}\n</script>`,
    );
  await writeFile(join(out, "jangsaeng.html"), page);
  await writeFile(join(out, "artifact.html"), unwrapDocument(page));
  return page.length;
}

/**
 * Removes the document wrapper (doctype, html/head/body tags, charset and
 * viewport metas) so a host skeleton can wrap the content. The page title is
 * shortened to the bare name.
 */
function unwrapDocument(page) {
  // Only touch markup outside the inlined module script.
  const open = page.indexOf('<script type="module">');
  const close = page.lastIndexOf("</script>");
  if (open < 0 || close < open) throw new Error("single-file page has no module script");
  const unwrap = (markup) =>
    markup
      .replace(/<!doctype html>\s*/i, "")
      .replace(/<\/?html[^>]*>\s*/gi, "")
      .replace(/<\/?head>\s*/gi, "")
      .replace(/<\/?body>\s*/gi, "")
      .replace(/<meta charset="utf-8" \/>\s*/i, "")
      .replace(/<meta\s+name="viewport"[^>]*>\s*/i, "")
      .replace(/<title>[^<]*<\/title>/i, "<title>장생 오백년</title>");
  return (
    unwrap(page.slice(0, open)) +
    page.slice(open, close + "</script>".length) +
    unwrap(page.slice(close + "</script>".length))
  );
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = pkg.version;
const servedOptions = {
  ...shared,
  outfile: join(out, "client/app.js"),
  sourcemap: true,
  minify: !watch,
  define: { __BUILD_TARGET__: '"served"', __BUILD_VERSION__: `"${version}"` },
};

if (watch) {
  await mkdir(join(out, "client"), { recursive: true });
  await writeServed({ version });
  const ctx = await context(servedOptions);
  await ctx.watch();
  console.log("watching src/client for changes");
} else {
  await rm(out, { recursive: true, force: true });
  await build(servedOptions);
  await writeServed({ version });
  const bytes = await writeSingleFile(version);
  console.log(`single-file build: dist/jangsaeng.html (${bytes} bytes)`);
}
