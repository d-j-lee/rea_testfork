// Development loop: rebuilds the client on change and restarts the server on
// server/shared changes. Stop with Ctrl+C.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const children = [
  spawn(process.execPath, [join(root, "scripts/build.mjs"), "--watch"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [
      "--watch-path=src/server",
      "--watch-path=src/shared",
      "src/server/main.ts",
    ],
    { stdio: "inherit", cwd: root },
  ),
];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (code) stop();
  });
