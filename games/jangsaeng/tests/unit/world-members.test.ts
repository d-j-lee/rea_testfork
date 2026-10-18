// What a shared World keeps for its members: NPC and spawn windows for every
// member's step, the 노인성 일섬 gate a player joins with, and leaving a battle.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arena, DT, input, makeWorld, run, spec } from "./world-fixture.ts";

test("NPCs and spawns stay while any member's step needs them", () => {
  const { world } = makeWorld("members");
  world.setStep("s1", "s3");
  assert.ok(world.npcPosition("elder"), "the member at s1 still needs the elder (until s2)");
  assert.ok(world.npcPosition("late"), "the member at s3 already sees the messenger (from s3)");
  world.setStep("s3");
  assert.equal(world.npcPosition("elder"), null, "nobody at s1 or s2 any more");
  world.setStep();
  assert.ok(world.npcPosition("late"), "no members: the windows stay as they were");
});

test("a player joins with 노인성 일섬 locked when the host says so", () => {
  const { world, log } = makeWorld("locked");
  const c = arena();
  const locked = spec(c.x, c.y, { longevityEnabled: false });
  world.addPlayer(locked);
  world.setInput(locked.id, input({ skill: 5 }));
  world.tick(DT);
  assert.deepEqual(log.longevity, [], "the strike never fires");
  world.setLongevityEnabled(locked.id, true);
  world.setInput(locked.id, input());
  world.tick(DT);
  world.setInput(locked.id, input({ skill: 5 }));
  world.tick(DT);
  assert.deepEqual(log.longevity, [locked.id], "unlocked, it fires");
});

test("battleParticipants lists who fights the running battle", () => {
  const { world } = makeWorld("participants");
  const c = arena();
  const one = spec(c.x, c.y);
  const two = spec(c.x + 1, c.y);
  const away = spec(c.x + 40, c.y);
  world.addPlayer(one);
  world.addPlayer(two);
  world.addPlayer(away);
  assert.deepEqual(world.battleParticipants(), [], "no battle, nobody");
  assert.ok(world.startBattle("waves", one.id));
  run(world, 0.2);
  assert.deepEqual(world.battleParticipants().sort(), [one.id, two.id].sort());
});
