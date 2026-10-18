// Name plates around the player: simulated companions are marked in the
// snapshot and give way in a crowd; the player's own plate keeps its spot.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EntitySnap } from "../../src/shared/types.ts";
import { byPlacement, placePlates, plateRole, type PlateBox, type PlateRole } from "../../src/client/game/plate-layout.ts";
import { arena, makeWorld, spec } from "./world-fixture.ts";

test("snapshots flag simulated companions, not real players", () => {
  const { world } = makeWorld();
  const c = arena();
  const human = spec(c.x, c.y);
  const other = spec(c.x + 1, c.y);
  const bot = spec(c.x - 1, c.y, { kind: "bot", name: "동료" });
  for (const p of [human, other, bot]) world.addPlayer(p);
  const ents = world.snapshotFor(human.id).ents;
  const of = (id: number) => ents.find((e) => e.id === id);
  assert.equal(of(bot.id)?.tm, "player");
  assert.equal(of(bot.id)?.bot, true);
  assert.equal(of(other.id)?.bot, undefined);
  assert.equal(of(human.id)?.bot, undefined);
});

const snap = (patch: Partial<EntitySnap>): EntitySnap =>
  ({ id: 1, k: "player", s: "hero_youth", x: 0, y: 0, d: "down", a: "idle", tm: "player", ...patch }) as EntitySnap;

test("plate roles come from the snapshot facts", () => {
  assert.equal(plateRole(snap({ tm: "player", bot: true }), false), "companion");
  assert.equal(plateRole(snap({ tm: "player" }), false), "player");
  assert.equal(plateRole(snap({ tm: "self" }), false), "self");
  assert.equal(plateRole(snap({ tm: "player" }), true), "self");
  assert.equal(plateRole(snap({ tm: "npc", hist: true }), false), "story");
  assert.equal(plateRole(snap({ tm: "npc" }), false), "npc");
});

const box = (role: PlateRole, dist: number): PlateBox => ({ role, dist, plate: true, x0: -20, x1: 20, y0: -10, y1: 0 });

test("a crowd of companions on the player keeps the player's plate and drops the overflow", () => {
  const order = [box("self", 0), ...Array.from({ length: 8 }, (_, i) => box("companion", 0.5 + i * 0.1))].sort(byPlacement);
  placePlates(order);
  const shown = order.filter((b) => b.plate);
  assert.equal(shown[0]?.role, "self");
  assert.deepEqual([shown[0]?.y0, shown[0]?.y1], [-10, 0], "the player's plate never moves");
  assert.equal(shown.length, 3, "two companions fit after nudging; the rest give way");
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i] as PlateBox;
      const b = shown[j] as PlateBox;
      assert.ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), "shown plates never overlap");
    }
});

test("real players are never dropped for a crowd", () => {
  const order = [box("self", 0), ...Array.from({ length: 4 }, (_, i) => box("player", 1 + i))].sort(byPlacement);
  placePlates(order);
  assert.equal(order.filter((b) => b.plate).length, 5);
});
