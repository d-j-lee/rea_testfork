// Music routing: picks the mood from game state and tells the audio engine
// only when the choice changes (so UI-driven cues are not fought every
// frame). Priority: ending > years planner > battle > chapter.

import type { MusicMood, Season } from "../../shared/content/schema.ts";
import type { AudioEngine } from "../audio/types.ts";
import type { BattleView, ChapterView, EndingView } from "../../shared/types.ts";

export interface MusicState {
  chapter: ChapterView | null;
  battle: BattleView | undefined;
  /** Kind of the open prompt, if any. */
  promptKind: string | null;
  ending: EndingView | null;
}

export function endingMood(ending: EndingView): MusicMood {
  const id = ending.nation.id;
  return id === "N1" ? "ending_good" : id === "N2" ? "reform" : "ending_bad";
}

export function battleMood(battle: BattleView, season: Season | undefined): MusicMood {
  const kind = `${battle.kind} ${battle.id}`.toLowerCase();
  if (/naval|deck|ship|sea|fleet/.test(kind)) return "naval";
  if (/siege/.test(kind)) return "siege";
  if (/survive|defend|hold/.test(kind) && season === "winter") return "siege";
  return "war";
}

export function moodFor(state: MusicState): MusicMood | null {
  if (state.ending) return endingMood(state.ending);
  if (state.promptKind === "years") return "years";
  if (state.battle) return battleMood(state.battle, state.chapter?.season);
  return state.chapter?.music ?? null;
}

/** In game the router owns the music; re-assert it this often (ms). */
const REASSERT_MS = 1000;

export class MusicRouter {
  readonly #audio: AudioEngine;
  #current: MusicMood | null | undefined = undefined;
  #at = 0;

  constructor(audio: AudioEngine) {
    this.#audio = audio;
  }

  /**
   * Call every frame in game. Tells the engine on changes, and re-asserts
   * the mood now and then so a late title-screen cue (e.g. an audio unlock
   * that resolves after the game started) cannot stick. setMusic with the
   * current mood is a no-op in the engine.
   */
  update(state: MusicState, now: number): void {
    const mood = moodFor(state);
    if (mood === this.#current && now - this.#at < REASSERT_MS) return;
    this.#current = mood;
    this.#at = now;
    this.#audio.setMusic(mood);
  }
}
