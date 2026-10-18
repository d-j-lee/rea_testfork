// Transport-independent boundary of the authoritative game host. The Node
// server wraps it with WebSockets; the browser's offline mode wraps the same
// host with an in-memory loopback. Inbound messages are untrusted `unknown`
// values that the host parses before acting on them.
import type { PlayerSave } from "../types.ts";
import type { ServerMsg } from "../protocol.ts";

/**
 * ◇ companions per era channel. Battles are tuned for this many beside one
 * person (offline play and the demo), and the server uses it unless BOTS says
 * otherwise; fewer companions make the 대전 much harder for a lone player.
 */
export const DEFAULT_COMPANIONS = 8;

export type HostMode = "online" | "offline";

export interface ConnectionMeta {
  /** Remote address for logging/rate limiting (online only). */
  readonly remote?: string;
}

export interface HostConnection {
  /** Feed one decoded client message (already JSON-parsed, unvalidated). */
  receive(message: unknown): void;
  /** Transport closed; the host saves and removes the player. */
  close(reason?: string): void;
}

/** Synchronous profile persistence; implementations may write asynchronously. */
export interface ProfileStore {
  load(token: string): PlayerSave | null;
  save(token: string, save: PlayerSave): void;
  /** Names currently reserved by stored profiles (lower-cased). */
  isNameTaken?(name: string, exceptToken: string): boolean;
}

export interface HostClock {
  /** Monotonic milliseconds. */
  now(): number;
}

export interface HostOptions {
  readonly seed: string;
  readonly mode: HostMode;
  readonly store: ProfileStore;
  readonly clock: HostClock;
  /** Simulated companions per active channel (DEFAULT_COMPANIONS unless set). */
  readonly botsPerChannel: number;
  /** Max real players per era channel shard before a new shard opens. */
  readonly channelCapacity?: number;
  readonly log?: (line: string) => void;
}

export interface HostStats {
  players: number;
  bots: number;
  channels: number;
  tick: number;
}

export interface GameHost {
  connect(
    send: (message: ServerMsg) => void,
    meta?: ConnectionMeta,
  ): HostConnection;
  /** Advances the simulation to `nowMs` in fixed steps. */
  tick(nowMs: number): void;
  stats(): HostStats;
  /** Saves every connected player (called on shutdown). */
  flush(): void;
}
