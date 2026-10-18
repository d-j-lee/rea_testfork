// Per-connection message rate gate over fixed one-second windows. It reads
// messages as host/parse.ts parsed them (null: malformed), never the raw
// JSON. Over the budget it drops only an input heartbeat that repeats the
// last input this gate passed (the host may have reset its own copy, e.g. to
// idle while a card is open; that bounded case resolves when the window
// rolls over). Dropping therefore loses no press or release:
//  - the sim acts on button changes (sim/player.ts applyInput: attack and
//    dodge on the press, the bow draws on the press and shoots on the
//    release), so an input whose attack, shoot or dodge differs from the
//    last accepted one is a press or a release and always goes through;
//  - a skill or interact press is sent once and always goes through;
//  - the release to idle (no stick, no button) always goes through, because
//    a client that stops playing (a dialog opens) sends it once and nothing
//    after it;
//  - what is left only moves the stick or the aim, and the client resends
//    its whole state every 50 ms while it plays.
// Choices, years plans, actions, chat, pings and malformed messages (the
// host answers those) always go through. Every message counts toward abuse:
// more than ABUSE_FACTOR × budget inside one window closes the socket.
import type { ClientMsg } from "../shared/protocol.ts";

export type RateVerdict = "accept" | "drop" | "close";

export const ABUSE_FACTOR = 3;

type Input = Extract<ClientMsg, { t: "input" }>;
/** What the host holds from the last accepted input: the stick and the held buttons. */
type Held = Pick<Input, "mx" | "my" | "attack" | "shoot" | "dodge">;

const idle = (held: Held): boolean => held.mx === 0 && held.my === 0 && !held.attack && !held.shoot && !held.dodge;

export class RateGate {
  readonly #budget: number;
  readonly #windowMs: number;
  #windowStart = Number.NEGATIVE_INFINITY;
  #count = 0;
  /** The host's starting input is idle (sim IDLE_INPUT). */
  #held: Held = { mx: 0, my: 0, attack: false, shoot: false, dodge: false };

  constructor(budget: number, windowMs = 1000) {
    this.#budget = budget;
    this.#windowMs = windowMs;
  }

  /**
   * Counts one parsed message (null when parseClientMsg rejected it)
   * arriving at `now` (ms) and says what to do with it.
   */
  admit(now: number, message: ClientMsg | null): RateVerdict {
    if (now - this.#windowStart >= this.#windowMs) {
      this.#windowStart = now;
      this.#count = 0;
    }
    this.#count++;
    if (this.#count > this.#budget * ABUSE_FACTOR) return "close";
    if (message?.t !== "input") return "accept";
    if (this.#count > this.#budget && this.#repeats(message)) return "drop";
    this.#held = { mx: message.mx, my: message.my, attack: message.attack, shoot: message.shoot, dodge: message.dodge };
    return "accept";
  }

  /** True when `input` changes nothing the next heartbeat would not also carry. */
  #repeats(input: Input): boolean {
    const held = this.#held;
    if (input.skill !== 0 || input.interact) return false;
    if (input.attack !== held.attack || input.shoot !== held.shoot || input.dodge !== held.dodge) return false;
    return !idle(input) || idle(held);
  }
}
