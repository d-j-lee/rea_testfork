import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Serves files below `root`; refuses paths that escape it. */
export function createStaticHandler(root: string) {
  const base = normalize(root + sep);
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end("bad request");
      return;
    }
    const relative = pathname.endsWith("/")
      ? `${pathname}index.html`
      : pathname;
    const file = normalize(join(base, relative));
    if (!file.startsWith(base)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-length": info.size,
        "cache-control": extname(file) === ".html" ? "no-cache" : "max-age=300",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  };
}
