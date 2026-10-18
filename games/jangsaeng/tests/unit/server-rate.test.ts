// The server's per-socket rate gate: over the budget only input heartbeats
// (superseded by the next one) are dropped; messages sent once go through;
// every message counts toward abuse (over ABUSE_FACTOR × budget closes).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ABUSE_FACTOR, RateGate, supersedable } from "../../src/server/rate.ts";

const INPUT = { t: "input", seq: 1, mx: 1, my: 0, attack: false, shoot: false, dodge: false, skill: 0, interact: false };

function count(gate: RateGate, n: number, at: (i: number) => number, message: unknown = INPUT) {
  const seen = { accept: 0, drop: 0, close: 0 };
  for (let i = 0; i < n; i++) seen[gate.admit(at(i), supersedable(message))]++;
  return seen;
}

test("only input heartbeats without a press are superseded by the next message", () => {
  assert.equal(supersedable(INPUT), true);
  assert.equal(supersedable({ ...INPUT, skill: 3 }), false, "a skill press is sent once");
  assert.equal(supersedable({ ...INPUT, interact: true }), false, "an interact press is sent once");
  for (const message of [
    { t: "choose", prompt: "p_x", option: "ok" },
    { t: "years", prompt: "years_1", activities: [], offer: false },
    { t: "action", action: { kind: "demoSkip" } },
    { t: "chat", text: "안녕" },
    { t: "ping", at: 1 },
    { t: "hello" },
    null,
    "input",
    [INPUT],
  ])
    assert.equal(supersedable(message), false, JSON.stringify(message));
});

test("a client at 50 inputs/s against a 40/s budget loses the excess inputs, not the socket", () => {
  const gate = new RateGate(40);
  // Three seconds at 50/s: 20 ms apart.
  const seen = count(gate, 150, (i) => i * 20);
  assert.equal(seen.close, 0);
  assert.equal(seen.accept, 120);
  assert.equal(seen.drop, 30);
});

test("a choice, a plan or a press over the budget is not dropped", () => {
  const gate = new RateGate(40);
  assert.equal(count(gate, 40, () => 0).accept, 40);
  assert.equal(gate.admit(1, supersedable(INPUT)), "drop");
  assert.equal(gate.admit(2, supersedable({ t: "choose", prompt: "p_x", option: "ok" })), "accept");
  assert.equal(gate.admit(3, supersedable({ t: "years", prompt: "years_1", activities: [], offer: false })), "accept");
  assert.equal(gate.admit(4, supersedable({ ...INPUT, skill: 2 })), "accept");
  assert.equal(gate.admit(5, supersedable(INPUT)), "drop");
});

test("the budget refills each window", () => {
  const gate = new RateGate(40);
  assert.equal(count(gate, 40, () => 0).accept, 40);
  assert.equal(gate.admit(999, true), "drop");
  assert.equal(gate.admit(1000, true), "accept");
});

test("every message counts toward abuse: more than ABUSE_FACTOR × budget in one window closes", () => {
  const gate = new RateGate(40);
  const choose = { t: "choose", prompt: "p_x", option: "ok" };
  const seen = count(gate, 40 * ABUSE_FACTOR, (i) => i, choose);
  assert.deepEqual(seen, { accept: 40 * ABUSE_FACTOR, drop: 0, close: 0 });
  assert.equal(gate.admit(500, supersedable(choose)), "close");
  const inputs = new RateGate(40);
  assert.deepEqual(count(inputs, 40 * ABUSE_FACTOR, (i) => i), { accept: 40, drop: 40 * (ABUSE_FACTOR - 1), close: 0 });
  assert.equal(inputs.admit(500, true), "close");
});
