// The authoritative game host: connections, profiles, era channels and the
// fixed-step clock. Runs identically in the Node server and in the browser
// (offline mode).
import { CONTENT, type ContentIndex } from "../content/index.ts";
import { generateMap, type GameMap } from "../map/generate.ts";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../protocol.ts";
import { hashString } from "../rng.ts";
import { createSave, migrateSave } from "../rules/index.ts";
import type { PlayerSave } from "../types.ts";
import type { ConnectionMeta, GameHost, HostConnection, HostOptions, HostStats } from "./api.ts";
import { Channel, channelKey } from "./channel.ts";
import { parseClientMsg, sanitizeName } from "./parse.ts";
import { Session } from "./session.ts";

const STEP_MS = 50;
const MAX_STEPS_PER_TICK = 10;
const EMPTY_CHANNEL_TTL = 60;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?(array: Uint8Array): Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

class Host implements GameHost {
  readonly #options: HostOptions;
  readonly #content: ContentIndex = CONTENT;
  readonly #map: GameMap;
  readonly #channels = new Map<string, Channel>();
  readonly #sessionsByToken = new Map<string, { session: Session; kick: () => void }>();
  #nextId = 1_000_000;
  #last: number | null = null;
  #accumulator = 0;
  #tick = 0;

  constructor(options: HostOptions) {
    this.#options = options;
    this.#map = generateMap(options.seed);
  }

  #log(line: string): void {
    this.#options.log?.(line);
  }

  connect(send: (message: ServerMsg) => void, meta?: ConnectionMeta): HostConnection {
    let session: Session | null = null;
    let closed = false;
    const connection: HostConnection = {
      receive: (raw) => {
        if (closed) return;
        const message = parseClientMsg(raw);
        if (!message) {
          send({ t: "error", code: "bad_message", message: "알 수 없는 요청입니다." });
          return;
        }
        if (message.t === "hello") {
          if (session) return;
          session = this.#hello(message, send, () => {
            closed = true;
            send({ t: "error", code: "replaced", message: "다른 곳에서 같은 인물로 접속했습니다." });
            if (session) this.#leave(session);
          });
          return;
        }
        if (!session) {
          send({ t: "error", code: "hello_required", message: "먼저 접속 인사가 필요합니다." });
          return;
        }
        session.receive(message);
      },
      close: (reason) => {
        if (closed) return;
        closed = true;
        if (session) {
          this.#log(`leave ${session.save.name} (${reason ?? "closed"}) ${meta?.remote ?? ""}`);
          this.#leave(session);
        }
      },
    };
    return connection;
  }

  #hello(
    message: Extract<ClientMsg, { t: "hello" }>,
    send: (message: ServerMsg) => void,
    kick: () => void,
  ): Session | null {
    if (message.v !== PROTOCOL_VERSION) {
      send({ t: "error", code: "version", message: "게임 버전이 맞지 않습니다. 새로고침해 주세요." });
      return null;
    }
    let save: PlayerSave | null = null;
    let token = message.token;
    let resumed = false;
    if (token) {
      const stored = this.#options.store.load(token);
      save = stored ? migrateSave(this.#content, stored) : null;
      resumed = save !== null;
      if (!save) token = undefined;
    }
    if (!save || !token) {
      const name = sanitizeName(message.name);
      if (!name) {
        send({ t: "error", code: "name", message: "이름은 한글·영문·숫자 2~12자로 지어 주세요." });
        return null;
      }
      token = randomToken();
      if (this.#options.mode === "online" && this.#options.store.isNameTaken?.(name, token)) {
        send({ t: "error", code: "name_taken", message: "이미 같은 이름의 장생인이 있습니다." });
        return null;
      }
      const options: Parameters<typeof createSave>[1] = {
        token,
        name,
        variant: message.variant,
        origin: message.origin,
        seed: hashString(token),
      };
      if (message.demo) options.demoChapter = message.demo;
      if (message.demoPath) options.demoPath = message.demoPath;
      save = createSave(this.#content, options);
    }
    const previous = this.#sessionsByToken.get(token);
    if (previous) previous.kick();
    const session = new Session(this.#nextId++, token, save, send, {
      content: this.#content,
      map: this.#map,
      mode: this.#options.mode,
      save: (saveToken, data) => this.#options.store.save(saveToken, data),
      relocate: (moving) => this.#relocate(moving),
      log: (line) => this.#log(line),
    });
    this.#sessionsByToken.set(token, { session, kick });
    this.#options.store.save(token, save);
    send({
      t: "welcome",
      v: PROTOCOL_VERSION,
      token,
      mode: this.#options.mode,
      seed: this.#options.seed,
      motd:
        this.#options.mode === "offline"
          ? "오프라인 모드 — 이 시대의 동료(◇)는 시뮬레이션입니다."
          : "장생 서버에 오신 것을 환영합니다.",
      resumed,
    });
    this.#log(`${resumed ? "resume" : "new"} ${save.name} @ ${save.chapter}`);
    this.#channelFor(save).add(session);
    return session;
  }

  #leave(session: Session): void {
    session.channel?.remove(session);
    session.close();
    const entry = this.#sessionsByToken.get(session.token);
    if (entry?.session === session) this.#sessionsByToken.delete(session.token);
  }

  #relocate(session: Session): void {
    session.channel?.remove(session);
    if (session.closed) return;
    this.#channelFor(session.save).add(session);
  }

  /**
   * The first shard of the save's chapter with room. Demo-preset characters get
   * their own shards: a demo's skips and presets never touch a real player's world.
   */
  #channelFor(save: PlayerSave): Channel {
    const chapterId = save.chapter;
    const capacity = this.#options.channelCapacity ?? 40;
    let shard = 1;
    for (;;) {
      const key = channelKey(chapterId, shard, save.demo);
      const existing = this.#channels.get(key);
      if (!existing) {
        const channel = new Channel(
          {
            content: this.#content,
            map: this.#map,
            seed: this.#options.seed,
            mode: this.#options.mode,
            botsPerChannel: this.#options.botsPerChannel,
            nextId: () => this.#nextId++,
            log: (line) => this.#log(line),
          },
          this.#content.chapters[chapterId],
          shard,
          save.demo,
        );
        this.#channels.set(key, channel);
        return channel;
      }
      if (existing.humans < capacity) return existing;
      shard++;
    }
  }

  tick(nowMs: number): void {
    if (this.#last === null) this.#last = nowMs;
    this.#accumulator += Math.min(1000, Math.max(0, nowMs - this.#last));
    this.#last = nowMs;
    let steps = 0;
    while (this.#accumulator >= STEP_MS && steps < MAX_STEPS_PER_TICK) {
      this.#accumulator -= STEP_MS;
      steps++;
      this.#step(STEP_MS / 1000);
    }
    if (steps === MAX_STEPS_PER_TICK) this.#accumulator = 0;
  }

  #step(dt: number): void {
    this.#tick++;
    for (const [key, channel] of this.#channels) {
      try {
        channel.tick(dt);
      } catch (error) {
        this.#log(`channel ${key} tick failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      }
      if (channel.humans === 0 && channel.emptyFor > EMPTY_CHANNEL_TTL) this.#channels.delete(key);
    }
  }

  stats(): HostStats {
    let players = 0;
    let bots = 0;
    for (const channel of this.#channels.values()) {
      players += channel.humans;
      bots += channel.bots.size;
    }
    return { players, bots, channels: this.#channels.size, tick: this.#tick };
  }

  flush(): void {
    for (const { session } of this.#sessionsByToken.values()) session.persist();
  }
}

export function createGameHost(options: HostOptions): GameHost {
  return new Host(options);
}
