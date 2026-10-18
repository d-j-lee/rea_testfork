// Wire protocol between client and host (JSON over WebSocket, or direct
// objects over the offline loopback). Client messages are untrusted and are
// parsed by src/shared/host/parse.ts before use.
import type {
  ChapterView,
  EndingView,
  EntitySnap,
  FxEvent,
  PromptView,
  RosterEntry,
  SelfView,
} from "./types.ts";

export const PROTOCOL_VERSION = 1;

export type PlayerAction =
  | { kind: "allocate"; stat: string }
  | { kind: "equip"; item: string }
  | { kind: "use"; item: string }
  | { kind: "travel"; site: string }
  | { kind: "respawn" }
  | { kind: "emote"; emote: string }
  | { kind: "debugSkip" };

export type ClientMsg =
  | {
      t: "hello";
      v: number;
      name: string;
      variant: "m" | "f";
      token?: string;
    }
  | {
      t: "input";
      seq: number;
      /** Movement intent, each in [-1, 1]. */
      mx: number;
      my: number;
      /** Held buttons. */
      attack: boolean;
      shoot: boolean;
      dodge: boolean;
      /** Skill slot pressed this frame (1-4) or 0. */
      skill: number;
      interact: boolean;
      /** Optional aim in tiles relative to the player (mouse/touch aim). */
      ax?: number;
      ay?: number;
    }
  | { t: "choose"; prompt: string; option: string }
  | { t: "chat"; text: string }
  | { t: "action"; action: PlayerAction }
  | { t: "ping"; at: number };

export type ServerMsg =
  | {
      t: "welcome";
      v: number;
      token: string;
      mode: "online" | "offline";
      seed: string;
      motd: string;
    }
  | { t: "enter"; you: number; chapter: ChapterView; channel: string }
  | { t: "snap"; tick: number; ents: EntitySnap[]; gone: number[] }
  | { t: "self"; self: SelfView }
  | { t: "prompt"; prompt: PromptView | null }
  | { t: "fx"; fx: FxEvent[] }
  | {
      t: "chat";
      from: string;
      text: string;
      kind: "player" | "bot" | "system" | "npc";
    }
  | {
      t: "toast";
      text: string;
      tone: "info" | "good" | "bad" | "warn" | "epic";
    }
  | { t: "roster"; players: RosterEntry[] }
  | { t: "ending"; ending: EndingView }
  | { t: "pong"; at: number }
  | { t: "error"; code: string; message: string };
