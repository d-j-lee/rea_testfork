// The server's per-socket rate gate: bursts over the budget are dropped
// softly; only abuse (over ABUSE_FACTOR × budget in one window) closes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ABUSE_FACTOR, RateGate } from "../../src/server/rate.ts";

function count(gate: RateGate, n: number, at: (i: number) => number) {
  const seen = { accept: 0, drop: 0, close: 0 };
  for (let i = 0; i < n; i++) seen[gate.admit(at(i))]++;
  return seen;
}

test("a client at 50 messages/s against a 40/s budget loses the excess, not the socket", () => {
  const gate = new RateGate(40);
  // Three seconds at 50/s: 20 ms apart.
  const seen = count(gate, 150, (i) => i * 20);
  assert.equal(seen.close, 0);
  assert.equal(seen.accept, 120);
  assert.equal(seen.drop, 30);
});

test("the budget refills each window", () => {
  const gate = new RateGate(40);
  assert.equal(count(gate, 40, () => 0).accept, 40);
  assert.equal(gate.admit(999), "drop");
  assert.equal(gate.admit(1000), "accept");
});

test("only more than ABUSE_FACTOR × budget in one window closes", () => {
  const gate = new RateGate(40);
  const seen = count(gate, 40 * ABUSE_FACTOR, (i) => i);
  assert.deepEqual(seen, { accept: 40, drop: 40 * (ABUSE_FACTOR - 1), close: 0 });
  assert.equal(gate.admit(500), "close");
});
