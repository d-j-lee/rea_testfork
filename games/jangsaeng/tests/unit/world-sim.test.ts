// Snapshots (interest + gone), pickups, determinism and the tick budget.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashString } from "../../src/shared/rng.ts";
import type { World } from "../../src/shared/sim/world.ts";
import { DERIVED, DT, arena, fightNearest, input, makeWorld, run, spec } from "./world-fixture.ts";

test("snapshots cover 24 tiles, keep corpses 1.2 s and report gone ids once", () => {
  const { world } = makeWorld("snap");
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  const near = world.spawnEnemy("bandit", c.x + 10, c.y + 1, 1);
  const far = world.spawnEnemy("bandit", c.x + 30, c.y, 1);
  assert.ok(near !== null && far !== null);
  const first = world.snapshotFor(p.id);
  const ids = first.ents.map((e) => e.id);
  assert.ok(ids.includes(near));
  assert.ok(!ids.includes(far));
  assert.equal(first.ents.find((e) => e.id === p.id)?.tm, "self");
  assert.equal(first.ents.find((e) => e.id === near)?.tm, "enemy");
  assert.deepEqual(first.gone, []);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids, "stable id order");
  world.damage(near, 1000);
  run(world, 0.6);
  const corpse = world.snapshotFor(p.id).ents.find((e) => e.id === near);
  assert.equal(corpse?.a, "dead");
  assert.equal(corpse?.hp, 0);
  assert.ok((corpse?.at ?? 0) >= 500, "anim timestamp counts from death");
  run(world, 0.7);
  assert.deepEqual(world.snapshotFor(p.id).gone, [near]);
  assert.deepEqual(world.snapshotFor(p.id).gone, []);
  // Teleporting away drops everything else from interest.
  const before = world.snapshotFor(p.id).ents.map((e) => e.id).filter((id) => id !== p.id);
  world.teleport(p.id, c.x - 60, c.y - 40);
  const moved = world.snapshotFor(p.id);
  assert.deepEqual(moved.gone, before);
  assert.deepEqual(moved.ents.map((e) => e.id), [p.id]);
});

test("the active boss is always in the snapshot, also for someone far from it", () => {
  const { world } = makeWorld("boss-snap");
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  const far = spec(c.x - 40, c.y);
  world.addPlayer(p);
  world.addPlayer(far);
  world.startBattle("boss", p.id);
  run(world, 0.1);
  assert.ok(world.battleView(), "the battle runs on for its fighter");
  assert.ok(world.snapshotFor(far.id).ents.some((e) => e.tm === "boss"));
});

test("drops become props that players collect by walking over them", () => {
  const { world, log } = makeWorld("drops");
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  // Bandits drop coin pouches 25% of the time; kill until one drops.
  const dropped = () => world.entityIds().some((id) => world.inspect(id)?.kind === "prop");
  for (let i = 0; i < 80 && !dropped(); i++) {
    const id = world.spawnEnemy("bandit", c.x + 3, c.y + 3, 1);
    assert.ok(id !== null);
    world.damage(id, 1000);
  }
  run(world, 0.1);
  const props = world.snapshotFor(p.id).ents.filter((e) => e.k === "prop");
  assert.ok(props.length > 0, "something dropped");
  assert.equal(props[0]?.s, "coin");
  const target = props[0];
  assert.ok(target);
  for (let i = 0; i < 60 && log.pickups.length === 0; i++) {
    const me = world.query().player(p.id);
    assert.ok(me);
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    world.setInput(p.id, input({ mx: dx / d, my: dy / d }));
    world.tick(DT);
  }
  assert.equal(log.pickups[0]?.item, "coin_pouch");
  assert.equal(log.pickups[0]?.player, p.id);
});

function scripted(seed: string): string {
  const { world, log } = makeWorld(seed);
  const c = arena();
  const a = spec(c.x - 2, c.y, { id: 1_000_001, derived: { ...DERIVED, weaponAtk: 30 } });
  const b = spec(c.x - 3, c.y + 1, { id: 1_000_002, kind: "bot", derived: { ...DERIVED, weaponAtk: 30 } });
  world.addPlayer(a);
  world.addPlayer(b);
  world.startBattle("waves", a.id);
  for (let i = 0; i < 4; i++) world.spawnEnemy(i % 2 ? "wokou_archer" : "red_turban_axe", c.x + 5, c.y - 3 + i * 2, 2);
  let hash = 0;
  for (let i = 0; i < 400; i++) {
    const ang = i * 0.07;
    world.setInput(a.id, input({
      mx: Math.cos(ang), my: Math.sin(ang), attack: i % 9 < 5, shoot: i % 40 > 30, dodge: i % 50 === 0,
      skill: i % 60 === 10 ? 1 + ((i / 60) % 4 | 0) : 0, ax: Math.cos(ang), ay: Math.sin(ang),
    }));
    fightNearest(world, b.id);
    world.tick(DT);
    hash = hashString(`${hash}|${JSON.stringify(world.snapshotFor(a.id))}|${JSON.stringify(world.drainFx())}`);
  }
  return `${hash}:${log.kills.length}:${JSON.stringify(world.playerStatus(a.id))}`;
}

test("same seed and inputs replay identically", () => {
  const first = scripted("det");
  assert.equal(scripted("det"), first);
  assert.notEqual(scripted("det-2"), first, "a different seed changes rolls");
});

function populate(world: World, humans: number, bots: number, enemies: number): number[] {
  const c = arena();
  const ids: number[] = [];
  const tough = { ...DERIVED, maxHp: 1_000_000, weaponAtk: 1 };
  for (let i = 0; i < humans + bots; i++) {
    const s = spec(c.x - 6 + (i % 5) * 2, c.y - 4 + Math.floor(i / 5) * 2, { kind: i < humans ? "player" : "bot", derived: tough });
    world.addPlayer(s);
    ids.push(s.id);
  }
  const roster = ["bandit", "wokou_archer", "red_turban_axe", "jurchen_rider", "rebel_shield", "japanese_musket", "french_marine", "wolf"];
  for (let i = 0; i < enemies; i++) {
    const ang = (i / enemies) * Math.PI * 2;
    const r = 6 + (i % 7);
    world.spawnEnemy(roster[i % roster.length] as string, c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r, 30);
  }
  return ids;
}

test("tick budget: 10 players + 10 bots + 120 enemies", () => {
  const { world } = makeWorld("perf");
  const ids = populate(world, 10, 10, 120);
  const drive = (i: number) => {
    ids.forEach((id, k) => {
      if (k >= 10) fightNearest(world, id);
      else {
        const ang = i * 0.05 + k;
        world.setInput(id, input({ mx: Math.cos(ang), my: Math.sin(ang), attack: (i + k) % 7 < 4, shoot: (i + k) % 30 > 24 }));
      }
    });
  };
  for (let i = 0; i < 60; i++) {
    drive(i);
    world.tick(DT);
    world.drainFx();
  }
  const ticks = 400;
  let tickMs = 0;
  let snapMs = 0;
  let fxCount = 0;
  let worst = 0;
  for (let i = 0; i < ticks; i++) {
    drive(i);
    const t0 = performance.now();
    world.tick(DT);
    const t1 = performance.now();
    tickMs += t1 - t0;
    worst = Math.max(worst, t1 - t0);
    for (let k = 0; k < 10; k++) world.snapshotFor(ids[k] as number);
    snapMs += performance.now() - t1;
    fxCount += world.drainFx().length;
  }
  const live = world.entityIds().map((id) => world.inspect(id)).filter((e) => e?.kind === "enemy" && e.alive).length;
  const perTick = tickMs / ticks;
  console.log(
    `[world perf] ${perTick.toFixed(3)} ms/tick (worst ${worst.toFixed(2)} ms), ` +
      `snapshots ${(snapMs / ticks / 10).toFixed(3)} ms/viewer, ${(fxCount / ticks).toFixed(0)} fx/tick, ${live} enemies alive`,
  );
  assert.ok(live >= 100, "the load stayed in place");
  assert.ok(perTick < 8, `tick cost ${perTick} ms`);
});
