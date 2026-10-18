// Per-connection message rate gate over fixed one-second windows. Over the
// budget, only input heartbeats are dropped: each carries the whole held
// state, so the next one supersedes it, and a burst (stick wiggles, a
// reconnect flush) costs a few of them, not the connection. Everything else
// (choices, years plans, actions, chat, a press) is sent once and never
// resent, so it always goes through. Every message counts toward abuse —
// more than ABUSE_FACTOR × budget inside one window closes the socket.

export type RateVerdict = "accept" | "drop" | "close";

export const ABUSE_FACTOR = 3;

/**
 * True for a decoded client message that a later one supersedes: an input
 * heartbeat with no press (skill or interact edge) in it. It only peeks at
 * the shape; the host still parses and validates whatever goes through.
 */
export function supersedable(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { t?: unknown; skill?: unknown; interact?: unknown };
  return m.t === "input" && !m.skill && m.interact !== true;
}

export class RateGate {
  readonly #budget: number;
  readonly #windowMs: number;
  #windowStart = Number.NEGATIVE_INFINITY;
  #count = 0;

  constructor(budget: number, windowMs = 1000) {
    this.#budget = budget;
    this.#windowMs = windowMs;
  }

  /**
   * Counts one message arriving at `now` (ms) and says what to do with it.
   * `droppable` (see supersedable) is the only kind dropped over budget.
   */
  admit(now: number, droppable: boolean): RateVerdict {
    if (now - this.#windowStart >= this.#windowMs) {
      this.#windowStart = now;
      this.#count = 0;
    }
    this.#count++;
    if (this.#count > this.#budget * ABUSE_FACTOR) return "close";
    return droppable && this.#count > this.#budget ? "drop" : "accept";
  }
}
