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

export class MusicRouter {
  readonly #audio: AudioEngine;
  #current: MusicMood | null | undefined = undefined;

  constructor(audio: AudioEngine) {
    this.#audio = audio;
  }

  /** Call whenever state may have changed; cheap when nothing did. */
  update(state: MusicState): void {
    const mood = moodFor(state);
    if (mood === this.#current) return;
    this.#current = mood;
    this.#audio.setMusic(mood);
  }

  /** Forces a mood (title screen) and forgets the routed choice. */
  force(mood: MusicMood | null): void {
    this.#current = mood;
    this.#audio.setMusic(mood);
  }
}
