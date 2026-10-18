// CONTRACT STUB — implemented by the UI pass. The UI is DOM (HTML/CSS) layered
// over the game canvas. It owns every screen except the world view: title,
// character creation, demo-mode chapter select, pitch/introduction screen,
// HUD, prompts and choices, years planner, menus, chat, toasts, ending.
import type { ChapterId, OriginId } from "../../shared/content/schema.ts";
import type { GameMap } from "../../shared/map/generate.ts";
import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";
import type { EntitySnap } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import type { Input } from "../input.ts";

export interface TitleChoice {
  mode: "offline" | "online";
  /** Resume the stored profile (token kept by the client core). */
  resume: boolean;
  name: string;
  variant: "m" | "f";
  origin: OriginId;
  /** Demo mode start chapter. */
  demo?: ChapterId;
}

export interface TitleOptions {
  onlineAvailable: boolean;
  /** Stored profile summary for "이어하기". */
  saved?: { name: string; chapterTitle: string; year: number; mode: "offline" | "online" };
  version: string;
}

export interface UiDeps {
  root: HTMLElement;
  send(message: ClientMsg): void;
  audio: AudioEngine;
  input: Input;
  map: GameMap;
}

export interface FrameInfo {
  dtMs: number;
  fps: number;
  /** Round-trip ms (online) or null offline. */
  ping: number | null;
  /** Own entity in tiles. */
  self: { x: number; y: number } | null;
  /** Entities currently known (for minimap dots). */
  ents: readonly EntitySnap[];
  /** Device-pixel position of the player on screen (touch aim, bubbles). */
  playerScreen: { x: number; y: number };
}

export interface Ui {
  showTitle(options: TitleOptions): Promise<TitleChoice>;
  showLoading(text: string): void;
  /** Hide title/loading and show the in-game HUD. */
  enterGame(): void;
  handle(message: ServerMsg): void;
  frame(info: FrameInfo): void;
  /** A modal (prompt, menu, chat input) is open; gameplay input is paused. */
  readonly blocking: boolean;
  showError(text: string): void;
}

export function createUi(deps: UiDeps): Ui {
  void deps;
  throw new Error("createUi not implemented");
}
