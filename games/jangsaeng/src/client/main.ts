// Browser entry (bundled by scripts/build.mjs, which defines the two build
// constants below for the served and single-file targets).
import { startApp } from "./app.ts";

declare const __BUILD_TARGET__: "served" | "single";
declare const __BUILD_VERSION__: string;

const target = typeof __BUILD_TARGET__ === "string" ? __BUILD_TARGET__ : "served";
const version = typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "dev";

startApp({ target, version }).catch((error: unknown) => {
  console.error("[jangsaeng] boot failed", error);
});
