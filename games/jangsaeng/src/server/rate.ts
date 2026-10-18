// Per-connection message rate gate over fixed one-second windows. Messages
// past the budget are dropped quietly: a burst (a held key, a reconnect
// flush) costs a few superseded inputs, not the connection. Only abuse —
// more than ABUSE_FACTOR × budget inside one window — closes the socket.

export type RateVerdict = "accept" | "drop" | "close";

export const ABUSE_FACTOR = 3;

export class RateGate {
  readonly #budget: number;
  readonly #windowMs: number;
  #windowStart = Number.NEGATIVE_INFINITY;
  #count = 0;

  constructor(budget: number, windowMs = 1000) {
    this.#budget = budget;
    this.#windowMs = windowMs;
  }

  /** Counts one message arriving at `now` (ms) and says what to do with it. */
  admit(now: number): RateVerdict {
    if (now - this.#windowStart >= this.#windowMs) {
      this.#windowStart = now;
      this.#count = 0;
    }
    this.#count++;
    if (this.#count > this.#budget * ABUSE_FACTOR) return "close";
    return this.#count > this.#budget ? "drop" : "accept";
  }
}
