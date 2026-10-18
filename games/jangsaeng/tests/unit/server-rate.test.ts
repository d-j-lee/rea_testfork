// The server's per-socket rate gate reads messages as host/parse.ts parsed
// them. Over the budget it drops only an input heartbeat that repeats what
// the host already holds, so no press, tap or release is ever lost; every
// message counts toward abuse (over ABUSE_FACTOR × budget closes).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMsg } from "../../src/shared/host/parse.ts";
import type { ClientMsg } from "../../src/shared/protocol.ts";
import { ABUSE_FACTOR, RateGate, type RateVerdict } from "../../src/server/rate.ts";

const BUDGET = 40;
const RAW_INPUT = { t: "input", seq: 1, mx: 1, my: 0, attack: false, shoot: false, dodge: false, skill: 0, interact: false };

/** What main.ts does with each decoded message: parse it, then ask the gate. */
const parsed = (raw: unknown): ClientMsg | null => parseClientMsg(raw);
const input = (over: Record<string, unknown> = {}) => parsed({ ...RAW_INPUT, ...over });
const CHOOSE = parsed({ t: "choose", prompt: "p_x", option: "ok" });

function count(gate: RateGate, n: number, at: (i: number) => number, message = input()) {
  const seen: Record<RateVerdict, number> = { accept: 0, drop: 0, close: 0 };
  for (let i = 0; i < n; i++) seen[gate.admit(at(i), message)]++;
  return seen;
}

/** A gate whose current window is spent on moving heartbeats. */
function spent(): RateGate {
  const gate = new RateGate(BUDGET);
  assert.equal(count(gate, BUDGET, () => 0).accept, BUDGET);
  assert.equal(gate.admit(1, input()), "drop", "the window is over budget");
  return gate;
}

test("the host reads what the gate read: parsing a parsed message changes nothing", () => {
  for (const raw of [
    { ...RAW_INPUT, skill: 2.7, mx: 3, ax: 99, ay: -1 },
    { t: "choose", prompt: "p_x", option: "ok" },
    { t: "years", prompt: "years_1", activities: ["study"], offer: true, wash: "monk", name: "윤현" },
    { t: "hello", v: 1, name: "윤무진", variant: "f", origin: "kaesong", demo: "ch09", demoPath: "reform" },
    { t: "action", action: { kind: "slot", skill: "s_x", slot: 2 } },
    { t: "chat", text: "안녕" },
    { t: "ping", at: 5 },
  ]) {
    const once = parseClientMsg(raw);
    assert.ok(once, JSON.stringify(raw));
    assert.deepEqual(parseClientMsg(once), once, JSON.stringify(raw));
  }
});

test("a client at 50 moving heartbeats/s against a 40/s budget loses the repeats, not the socket", () => {
  const gate = new RateGate(BUDGET);
  // Three seconds at 50/s: 20 ms apart.
  const seen = count(gate, 150, (i) => i * 20);
  assert.deepEqual(seen, { accept: 120, drop: 30, close: 0 });
});

test("a tap inside an over-budget burst survives: its press and its release reach the host", () => {
  for (const button of ["attack", "shoot", "dodge"] as const) {
    const gate = spent();
    assert.equal(gate.admit(2, input({ [button]: true })), "accept", `${button} press`);
    assert.equal(gate.admit(3, input({ [button]: true })), "drop", `${button} held: the host has it`);
    assert.equal(gate.admit(4, input({ [button]: false })), "accept", `${button} release`);
    assert.equal(gate.admit(5, input()), "drop", "back to a plain repeat");
  }
});

test("the release to idle is never dropped; a repeated idle heartbeat is", () => {
  const gate = spent();
  const stop = input({ mx: 0 });
  assert.equal(gate.admit(2, stop), "accept", "the stick released");
  assert.equal(gate.admit(3, stop), "drop", "idle again: nothing new");
  assert.equal(gate.admit(4, input({ mx: -1 })), "drop", "a stick change is resent by the next heartbeat");
  // A dropped heartbeat never becomes the held state: the release still goes through.
  assert.equal(gate.admit(5, stop), "drop", "the host still holds idle");
  const moving = spent();
  assert.equal(moving.admit(2, input({ attack: true })), "accept");
  assert.equal(moving.admit(3, input({ mx: 0, attack: false })), "accept", "stick and button released together");
});

test("a choice, a plan, an action, chat, a press or a malformed message over the budget is never dropped", () => {
  const gate = spent();
  for (const message of [
    CHOOSE,
    parsed({ t: "years", prompt: "years_1", activities: [], offer: false }),
    parsed({ t: "action", action: { kind: "demoSkip" } }),
    parsed({ t: "chat", text: "안녕" }),
    parsed({ t: "ping", at: 1 }),
    input({ skill: 2 }),
    input({ interact: true }),
    parsed({ t: "nope" }),
  ])
    assert.equal(gate.admit(2, message), "accept", JSON.stringify(message));
  assert.equal(gate.admit(3, input()), "drop");
});

test("a press is what the host parses: a skill that parses to none is a plain heartbeat", () => {
  const gate = spent();
  for (const skill of [0.5, -1, "3"]) assert.equal(gate.admit(2, input({ skill })), "drop", String(skill));
  assert.equal(gate.admit(3, input({ skill: 5.9 })), "accept", "slot 5 (일섬) after truncation");
  assert.equal(gate.admit(4, input({ interact: "yes" })), "drop", "only interact: true is a press");
});

test("the budget refills each window", () => {
  const gate = spent();
  assert.equal(gate.admit(999, input()), "drop");
  assert.equal(gate.admit(1000, input()), "accept");
});

test("every message counts toward abuse: more than ABUSE_FACTOR × budget in one window closes", () => {
  const gate = new RateGate(BUDGET);
  const seen = count(gate, BUDGET * ABUSE_FACTOR, (i) => i, CHOOSE);
  assert.deepEqual(seen, { accept: BUDGET * ABUSE_FACTOR, drop: 0, close: 0 });
  assert.equal(gate.admit(500, CHOOSE), "close");
  const inputs = new RateGate(BUDGET);
  assert.deepEqual(count(inputs, BUDGET * ABUSE_FACTOR, (i) => i), { accept: BUDGET, drop: BUDGET * (ABUSE_FACTOR - 1), close: 0 });
  assert.equal(inputs.admit(500, input({ attack: true })), "close", "a press over the abuse line closes too");
  const junk = new RateGate(BUDGET);
  assert.deepEqual(count(junk, BUDGET * ABUSE_FACTOR + 1, (i) => i, null), { accept: BUDGET * ABUSE_FACTOR, drop: 0, close: 1 });
});
