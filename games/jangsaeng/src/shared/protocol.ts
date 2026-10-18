// Wire protocol between client and host (JSON over WebSocket, or direct
// objects over the offline loopback). Client messages are untrusted and are
// parsed by src/shared/host/parse.ts before use.
import type { ChapterId, OriginId, StatKey, WashMethod } from "./content/schema.ts";
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
  | { kind: "allocate"; stat: StatKey }
  | { kind: "equip"; item: string }
  | { kind: "use"; item: string }
  /** Assign a known skill to slot 1-4. */
  | { kind: "slot"; skill: string; slot: number }
  /** Fast travel between post stations (needs 마패). */
  | { kind: "travel"; site: string }
  /** Give up waiting for a revive: −1 lifespan year, respawn at a station. */
  | { kind: "selfRevive" }
  | { kind: "emote"; emote: string }
  /** Demo mode only: complete the current objective/battle immediately. */
  | { kind: "demoSkip" };

export type ClientMsg =
  | {
      t: "hello";
      v: number;
      /** Existing profile token to resume; omitted for a new character. */
      token?: string;
      /** New character fields (ignored when resuming). */
      name: string;
      variant: "m" | "f";
      origin: OriginId;
      /** Demo mode: start at this chapter with a preset build. */
      demo?: ChapterId;
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
      /** Skill slot pressed this frame: 1-4, 5 = 노인성 일섬, 0 none. */
      skill: number;
      interact: boolean;
      /** Optional aim in tiles relative to the player (mouse/touch aim). */
      ax?: number;
      ay?: number;
    }
  | { t: "choose"; prompt: string; option: string }
  /** Passage-of-years plan (answers a prompt of kind "years"). */
  | {
      t: "years";
      prompt: string;
      activities: string[];
      wash?: WashMethod;
      name?: string;
      offer: boolean;
    }
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
      /** True when an existing profile was resumed. */
      resumed: boolean;
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
