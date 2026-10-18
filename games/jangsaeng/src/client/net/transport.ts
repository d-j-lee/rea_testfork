// Client-side transports. Both deliver ServerMsg objects to the game client
// and accept ClientMsg objects; the client never knows which one it uses.
import type { GameHost, HostConnection } from "../../shared/host/api.ts";
import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";

export interface Transport {
  readonly kind: "ws" | "loopback";
  send(message: ClientMsg): void;
  onMessage(handler: (message: ServerMsg) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

export function webSocketUrl(location: Location): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws`;
}

/** Opens a WebSocket and resolves once it is open (rejects on early failure). */
export function connectWebSocket(
  url: string,
  timeoutMs = 5000,
): Promise<Transport> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    const handlers: ((message: ServerMsg) => void)[] = [];
    const closers: ((reason: string) => void)[] = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("서버 응답 시간이 초과되었습니다."));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        kind: "ws",
        send: (message) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify(message));
        },
        onMessage: (handler) => handlers.push(handler),
        onClose: (handler) => closers.push(handler),
        close: () => socket.close(1000, "client closed"),
      });
    });
    socket.addEventListener("message", (event) => {
      let message: ServerMsg;
      try {
        message = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      for (const handler of handlers) handler(message);
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error("서버에 연결할 수 없습니다."));
        return;
      }
      for (const closer of closers)
        closer(event.reason || `연결 종료 (${event.code})`);
    });
  });
}

/**
 * In-memory transport to a host running in this page. Messages are delivered
 * asynchronously (microtasks) in both directions, like a real socket, and are
 * structured-cloned so neither side can mutate the other's objects.
 */
export function connectLoopback(host: GameHost): Transport {
  const handlers: ((message: ServerMsg) => void)[] = [];
  const closers: ((reason: string) => void)[] = [];
  let open = true;
  const connection: HostConnection = host.connect((message) => {
    if (!open) return;
    const copy = structuredClone(message);
    queueMicrotask(() => {
      for (const handler of handlers) handler(copy);
    });
  });
  return {
    kind: "loopback",
    send: (message) => {
      if (!open) return;
      const copy = structuredClone(message);
      queueMicrotask(() => connection.receive(copy));
    },
    onMessage: (handler) => handlers.push(handler),
    onClose: (handler) => closers.push(handler),
    close: () => {
      if (!open) return;
      open = false;
      connection.close("client closed");
      for (const closer of closers) closer("closed");
    },
  };
}
