// Builds the browser client twice from one source tree:
//   dist/client/        — served by the Node server (online + offline modes)
//   dist/jangsaeng.html — one self-contained file (offline mode), used as the
//                         shareable prototype build.
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
  return page.length;
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
