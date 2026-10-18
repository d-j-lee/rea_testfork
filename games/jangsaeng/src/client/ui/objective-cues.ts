// The objective tracker's sound cues. No DOM here, so tests can drive it with
// the host's own SelfView sequence.
import type { ObjectiveView } from "../../shared/types.ts";

export type ObjectiveCue = "quest_done" | "quest";

/**
 * Remembers which objectives were done and names the sound each new list
 * earns: 'quest_done' when an objective the player achieved turns done, else
 * 'quest' when a new objective appears after the first list. A solemn
 * objective (a history card, a tragedy, the finale) is no achievement, so it
 * never earns 'quest_done'.
 */
export class ObjectiveCues {
  #known = new Map<string, boolean>();

  next(list: readonly ObjectiveView[]): ObjectiveCue | null {
    let achieved = false;
    let fresh = false;
    for (const objective of list) {
      const before = this.#known.get(objective.id);
      if (before === undefined && this.#known.size > 0) fresh = true;
      if (before === false && objective.done && !objective.solemn) achieved = true;
    }
    this.#known = new Map(list.map((objective) => [objective.id, objective.done]));
    if (achieved) return "quest_done";
    return fresh ? "quest" : null;
  }
}
