// Offline mode: the authoritative host runs inside the page, persisted to
// localStorage, and the client talks to it through the in-memory loopback.
// Also owns the small "last session" records the title screen uses for
// 이어하기 (resume): the last token and a profile summary per mode.

import { createGameHost } from "../../shared/host/host.ts";
import type { GameHost, ProfileStore } from "../../shared/host/api.ts";
import type { PlayerSave } from "../../shared/types.ts";
import { connectLoopback, type Transport } from "./transport.ts";
import { isRecord, readJson, readKey, removeKey, writeKey } from "../storage.ts";

export type SessionMode = "offline" | "online";

// ── Profile store ───────────────────────────────────────────────────────────

/**
 * ProfileStore over localStorage. Saves are coalesced (the host may save
 * often) and written within `delayMs`, or at once by flush() on page hide.
 */
export class LocalStorageStore implements ProfileStore {
  readonly #pending = new Map<string, PlayerSave>();
  readonly #delayMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(delayMs = 750) {
    this.#delayMs = delayMs;
  }

  load(token: string): PlayerSave | null {
    const pending = this.#pending.get(token);
    if (pending) return structuredClone(pending);
    const value = readJson(`profile:${token}`, isRecord);
    // The host validates and migrates the payload; reject only foreign data.
    if (!value || value["token"] !== token) return null;
    return value as unknown as PlayerSave;
  }

  save(token: string, save: PlayerSave): void {
    this.#pending.set(token, structuredClone(save));
    this.#timer ??= setTimeout(() => this.flush(), this.#delayMs);
  }

  flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    for (const [token, save] of this.#pending) {
      try {
        writeKey(`profile:${token}`, JSON.stringify(save));
      } catch {
        // Unserialisable save: keep playing; nothing sensible to persist.
      }
    }
    this.#pending.clear();
  }
}

// ── Resume records ─────────────────────────────────────────────────────────

export interface SavedSummary {
  name: string;
  chapterTitle: string;
  year: number;
  mode: SessionMode;
  /** Wall-clock ms of the last update (most recent mode wins on the title). */
  at: number;
}

const isSummary = (value: unknown): value is SavedSummary =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["chapterTitle"] === "string" &&
  typeof value["year"] === "number" &&
  (value["mode"] === "offline" || value["mode"] === "online") &&
  typeof value["at"] === "number";

export function lastToken(mode: SessionMode): string | null {
  const token = readKey(`last:${mode}`);
  return token && token.length <= 128 ? token : null;
}

export function rememberToken(mode: SessionMode, token: string): void {
  writeKey(`last:${mode}`, token);
}

export function forgetSession(mode: SessionMode): void {
  removeKey(`last:${mode}`);
  removeKey(`summary:${mode}`);
}

export function readSummary(mode: SessionMode): SavedSummary | null {
  return lastToken(mode) ? readJson(`summary:${mode}`, isSummary) : null;
}

/** Writes the title-screen summary when it changed (cheap to call often). */
export function rememberSummary(summary: Omit<SavedSummary, "at">): void {
  const previous = readJson(`summary:${summary.mode}`, isSummary);
  if (
    previous &&
    previous.name === summary.name &&
    previous.chapterTitle === summary.chapterTitle &&
    previous.year === summary.year
  )
    return;
  writeKey(`summary:${summary.mode}`, JSON.stringify({ ...summary, at: Date.now() }));
}

/** The summary the title screen offers for 이어하기, newest first. */
export function savedForTitle(onlineAvailable: boolean): SavedSummary | null {
  const offline = readSummary("offline");
  const online = onlineAvailable ? readSummary("online") : null;
  if (offline && online) return online.at > offline.at ? online : offline;
  return offline ?? online;
}

// ── In-page host ───────────────────────────────────────────────────────────

export interface OfflineSession {
  readonly host: GameHost;
  readonly transport: Transport;
  /** Advances the host to now; safe to call every frame (fixed steps). */
  pump(): void;
  /** Saves everything (page hide). */
  flush(): void;
  stop(): void;
}

const TICK_MS = 50;

/** A host that keeps failing to tick this long (ms) is abandoned. */
const FATAL_MS = 2000;

/**
 * Starts the in-page host. Throws when the host cannot be created;
 * `onFatal` reports a host that keeps failing to tick (the session stops).
 */
export function startOffline(log: (line: string) => void, onFatal: (reason: string) => void): OfflineSession {
  const store = new LocalStorageStore();
  const host = createGameHost({
    seed: "jangsaeng",
    mode: "offline",
    store,
    clock: { now: () => performance.now() },
    botsPerChannel: 8,
    log,
  });
  let logged = false;
  let failingSince = -1;
  let stopped = false;
  const pump = () => {
    if (stopped) return;
    const now = performance.now();
    try {
      // host.tick runs every fixed step due since the last call, so the
      // timer also catches up after background-tab throttling.
      host.tick(now);
      failingSince = -1;
    } catch (error) {
      if (!logged) console.error("[offline host] tick failed", error);
      logged = true;
      if (failingSince < 0) failingSince = now;
      else if (now - failingSince > FATAL_MS) {
        session.stop();
        onFatal(`호스트 오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const flush = () => {
    try {
      host.flush();
    } catch (error) {
      console.error("[offline host] flush failed", error);
    }
    store.flush();
  };
  const timer = setInterval(pump, TICK_MS);
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onHide);
  const transport = connectLoopback(host);
  const session: OfflineSession = {
    host,
    transport,
    pump,
    flush,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      transport.close();
      flush();
    },
  };
  return session;
}
