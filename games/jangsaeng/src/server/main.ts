// Online server: serves the built client and runs the authoritative game host
// behind a WebSocket endpoint at /ws.
//   PORT (8080)  HOST (0.0.0.0)  DATA_DIR (./data)  BOTS (2)  SEED (jangsaeng)
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { WebSocketServer, type RawData } from "ws";
import { createGameHost } from "../shared/host/host.ts";
import type { HostConnection } from "../shared/host/api.ts";
import { createStaticHandler } from "./static.ts";
import { JsonProfileStore } from "./store.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT ?? 8080);
const hostname = process.env.HOST ?? "0.0.0.0";
const dataDir = resolve(process.env.DATA_DIR ?? join(root, "data"));
const log = (line: string) =>
  console.log(`[${new Date().toISOString()}] ${line}`);

const store = new JsonProfileStore(dataDir, log);
const host = createGameHost({
  seed: process.env.SEED ?? "jangsaeng",
  mode: "online",
  store,
  clock: { now: () => performance.now() },
  botsPerChannel: Number(process.env.BOTS ?? 2),
  channelCapacity: 40,
  log,
});

const serveStatic = createStaticHandler(join(root, "dist/client"));
const server = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, ...host.stats() }));
    return;
  }
  void serveStatic(request, response);
});

const MAX_MESSAGE_BYTES = 8 * 1024;
const MESSAGES_PER_SECOND = 40;
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_MESSAGE_BYTES,
});

wss.on("connection", (socket, request) => {
  const remote = request.socket.remoteAddress ?? "unknown";
  let budget = MESSAGES_PER_SECOND;
  let windowStart = performance.now();
  let connection: HostConnection | null = host.connect(
    (message) => {
      if (socket.readyState === socket.OPEN)
        socket.send(JSON.stringify(message));
    },
    { remote },
  );
  const close = (reason: string) => {
    connection?.close(reason);
    connection = null;
  };
  socket.on("message", (data: RawData, isBinary) => {
    if (!connection) return;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      budget = MESSAGES_PER_SECOND;
    }
    if (--budget < 0 || isBinary) {
      socket.close(1008, budget < 0 ? "rate limit" : "binary unsupported");
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      socket.close(1007, "invalid json");
      return;
    }
    connection.receive(message);
  });
  socket.on("close", () => close("socket closed"));
  socket.on("error", (error) => {
    log(`socket error from ${remote}: ${error.message}`);
    close("socket error");
  });
});

const TICK_MS = 50;
const ticker = setInterval(() => host.tick(performance.now()), TICK_MS);

server.listen(port, hostname, () => {
  log(
    `장생 server on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (data: ${dataDir})`,
  );
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: saving and shutting down`);
  clearInterval(ticker);
  host.flush();
  store.flush();
  for (const client of wss.clients) client.close(1001, "server shutdown");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
