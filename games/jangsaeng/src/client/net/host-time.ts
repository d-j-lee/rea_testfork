// The in-page host's clock in offline play. It follows the page's clock,
// except while the UI holds the world (the menu book is open): then it stands
// still, so nothing happens behind the menu. A message the player sends while
// held still gets a short beat of host time, so its answer comes at once (an
// equip or a skill slot shows in the open menu). Releasing never replays the
// held time. Online play has no such clock: the shared world stays live.

/** Host time a held world runs after each message: longer than the host's 0.25 s self-view cadence. */
export const HELD_BEAT_MS = 300;

export class HostTime {
  #now: number;
  #real: number;
  #beat = 0;

  constructor(real: number) {
    this.#now = real;
    this.#real = real;
  }

  /** Host milliseconds (monotonic). */
  get now(): number {
    return this.#now;
  }

  /** A message went to the host: let it run a beat even while held. */
  nudge(): void {
    this.#beat = HELD_BEAT_MS;
  }

  /** Advances to the page time `real`; while `held`, only by what is left of the beat. */
  advance(real: number, held: boolean): number {
    let step = Math.max(0, real - this.#real);
    this.#real = Math.max(this.#real, real);
    if (held) {
      step = Math.min(step, this.#beat);
      this.#beat -= step;
    }
    this.#now += step;
    return this.#now;
  }
}
