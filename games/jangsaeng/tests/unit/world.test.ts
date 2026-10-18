// Real-time world: movement, melee/bow/roll feel, AI tokens, downed/revive.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TILE_INFO, type TileId } from "../../src/shared/map/tiles.ts";
import type { FxEvent } from "../../src/shared/types.ts";
import { DERIVED, DT, arena, input, makeWorld, map, run, siteCentre, spec } from "./world-fixture.ts";

test("players move at terrain speed and slide against blocked tiles", () => {
  const { world } = makeWorld();
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  const start = world.playerStatus(p.id);
  assert.ok(start);
  run(world, 1, () => world.setInput(p.id, input({ mx: 1 })));
  const moved = world.playerStatus(p.id);
  assert.ok(moved);
  // 4 tiles/s × terrain (this stretch is road, ×1.25).
  const tile = map().tiles[Math.floor(start.y) * map().width + Math.floor(start.x)] as TileId;
  const expected = 4 * TILE_INFO[tile].speed;
  assert.ok(Math.abs(moved.x - start.x - expected) < 0.3, `moved ${moved.x - start.x}, expected ${expected}`);
  assert.ok(Math.abs(moved.y - start.y) < 0.01);
  // West of 황산 a river runs north-south; walking into it must stop at the bank.
  const site = siteCentre("hwangsan");
  world.teleport(p.id, site.x, site.y);
  run(world, 3, () => world.setInput(p.id, input({ mx: -1 })));
  const bank = world.playerStatus(p.id);
  assert.ok(bank);
  assert.ok(bank.x < site.x - 3, `walked to ${bank.x}`);
  assert.ok(world.query().walkable(bank.x - 0.29, bank.y) && world.query().walkable(bank.x + 0.29, bank.y));
  assert.equal(world.query().walkable(bank.x - 1.3, bank.y), false, "the river is right beside the stop point");
});

test("the melee chain kills an enemy and onKill credits the player", () => {
  const { world, log } = makeWorld();
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  const enemy = world.spawnEnemy("bandit", c.x + 1.2, c.y, 1);
  assert.ok(enemy !== null && enemy < 1_000_000);
  const kinds: string[] = [];
  let ticks = 0;
  while (world.inspect(enemy)?.alive && ticks++ < 80) {
    world.setInput(p.id, input({ attack: true, ax: 1, ay: 0 }));
    world.tick(DT);
    for (const fx of world.drainFx()) if (fx.k === "slash" || fx.k === "thrust") kinds.push(fx.k);
  }
  assert.ok(ticks < 60, `took ${ticks} ticks`);
  assert.equal(log.kills.length, 1);
  const kill = log.kills[0];
  assert.ok(kill);
  assert.equal(kill.enemy.id, "bandit");
  assert.equal(kill.level, 1);
  assert.equal(kill.boss, false);
  assert.deepEqual(kill.killers, [p.id]);
  assert.ok(kinds.includes("slash"));
  // Corpses linger 1.2 s with the dead animation, then leave.
  const snap = world.snapshotFor(p.id).ents.find((e) => e.id === enemy);
  assert.equal(snap?.a, "dead");
  run(world, 1.3);
  assert.equal(world.inspect(enemy), null);
});

test("quick shots auto-aim the nearest enemy in the facing half-plane", () => {
  const { world } = makeWorld();
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  world.setInput(p.id, input({ mx: 1 }));
  world.tick(DT);
  world.setInput(p.id, input());
  const me = world.playerStatus(p.id);
  assert.ok(me);
  const enemy = world.spawnEnemy("bandit", me.x + 5, me.y + 2.5, 1);
  assert.ok(enemy !== null);
  world.drainFx();
  world.setInput(p.id, input({ shoot: true }));
  world.setInput(p.id, input({ shoot: false }));
  world.tick(DT);
  const arrow = world.drainFx().find((fx) => fx.k === "arrow");
  assert.ok(arrow?.tx !== undefined && arrow.ty !== undefined, "an arrow flew");
  const angle = Math.atan2(arrow.ty - arrow.y, arrow.tx - arrow.x);
  assert.ok(Math.abs(angle - Math.atan2(2.5, 5)) < 0.15, `arrow angle ${angle}`);
  run(world, 1);
  const info = world.inspect(enemy);
  assert.ok(info && info.hp < info.maxHp, "the arrow hit");
});

test("a perfectly timed charged shot is a guaranteed crit", () => {
  const { world } = makeWorld();
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, critChance: 0 } });
  world.addPlayer(p);
  const enemy = world.spawnEnemy("bear", c.x + 6, c.y, 1);
  assert.ok(enemy !== null);
  const fx: FxEvent[] = [];
  run(world, 0.7, () => world.setInput(p.id, input({ shoot: true, ax: 1, ay: 0 })));
  world.setInput(p.id, input({ ax: 1, ay: 0 }));
  run(world, 0.8, () => fx.push(...world.drainFx()));
  assert.ok(fx.some((f) => f.k === "sfx" && f.sfx === "crit"));
  assert.ok(fx.some((f) => f.k === "text" && f.crit === true && /^\d+$/.test(f.text ?? "")), "crit damage number");
});

function bruteDuel(dodge: boolean): { fx: FxEvent[]; hp: number; maxHp: number } {
  const { world } = makeWorld("roll");
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  world.spawnEnemy("red_turban_axe", c.x + 1, c.y, 1);
  let telegraphed = false;
  for (let i = 0; i < 200 && !telegraphed; i++) {
    world.tick(DT);
    telegraphed = world.drainFx().some((f) => f.k === "telegraph" && f.tg?.shape === "circle");
  }
  assert.ok(telegraphed, "the brute telegraphed its slam");
  const status = world.playerStatus(p.id);
  assert.equal(status?.hp, status?.maxHp);
  run(world, 0.5);
  const fx: FxEvent[] = world.drainFx();
  // Roll so the i-frames (0.04–0.22 s) cover the hit at telegraph end + 50 ms.
  world.setInput(p.id, input({ dodge, my: dodge ? -1 : 0 }));
  world.tick(DT);
  world.setInput(p.id, input());
  world.tick(DT);
  fx.push(...world.drainFx());
  const after = world.playerStatus(p.id);
  assert.ok(after);
  return { fx, hp: after.hp, maxHp: after.maxHp };
}

test("rolling through a telegraphed slam avoids it (perfect dodge)", () => {
  const hit = bruteDuel(false);
  assert.ok(hit.hp < hit.maxHp, "without a roll the slam lands");
  const dodged = bruteDuel(true);
  assert.equal(dodged.hp, dodged.maxHp, "i-frames negate the slam");
  assert.ok(dodged.fx.some((f) => f.k === "text" && f.text === "완벽 회피"));
  assert.ok(dodged.fx.some((f) => f.k === "hitstop" && f.power === 250));
});

test("attack tokens cap simultaneous melee attackers at three per target", () => {
  const { world } = makeWorld("tokens");
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  const ids: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const id = world.spawnEnemy("wokou_raider", c.x + Math.cos(ang) * 2.5, c.y + Math.sin(ang) * 2.5, 1);
    assert.ok(id !== null);
    ids.push(id);
  }
  let maxTokens = 0;
  let maxSwinging = 0;
  let circling = 0;
  run(world, 8, () => {
    const holders = ids.map((id) => world.inspect(id)).filter((e) => e?.token === 1 && e.target === p.id);
    maxTokens = Math.max(maxTokens, holders.length);
    const swinging = world.snapshotFor(p.id).ents.filter((e) => e.k === "enemy" && e.a === "attack").length;
    maxSwinging = Math.max(maxSwinging, swinging);
    circling = Math.max(circling, ids.map((id) => world.inspect(id)).filter((e) => e?.state === "chase" && e.token === 0).length);
  });
  assert.equal(maxTokens, 3);
  assert.ok(maxSwinging <= 3, `${maxSwinging} swinging at once`);
  assert.ok(circling >= 4, "token-less enemies circle");
  const hurt = world.playerStatus(p.id);
  assert.ok(hurt && hurt.hp < hurt.maxHp, "token holders do attack");
});

test("downed players are revived by an ally standing close for 2 s", () => {
  const { world, log } = makeWorld();
  const c = arena();
  const a = spec(c.x, c.y);
  const b = spec(c.x + 5, c.y, { kind: "bot", name: "동료" });
  world.addPlayer(a);
  world.addPlayer(b);
  world.damage(a.id, 1000);
  assert.deepEqual(log.downed, [a.id]);
  const down = world.playerStatus(a.id);
  assert.ok(down?.downed !== null && down?.downed !== undefined && down.downed > 10);
  assert.equal(world.snapshotFor(a.id).ents.find((e) => e.id === a.id)?.down, true);
  assert.deepEqual(world.query().downedAllies(c.x + 5, c.y, 8).map((d) => d.id), [a.id]);
  run(world, 1.5, () => {
    const me = world.query().player(b.id);
    const dx = (me?.x ?? 0) - c.x;
    world.setInput(b.id, input({ mx: dx > 0.8 ? -1 : 0 }));
  });
  world.setInput(b.id, input());
  run(world, 1.2);
  assert.equal(log.revived.length, 0, "a revive takes 2 s");
  run(world, 1.2);
  assert.deepEqual(log.revived, [{ player: a.id, by: b.id }]);
  assert.equal(world.playerStatus(a.id)?.hp, Math.round(DERIVED.maxHp * 0.4));
  assert.equal(world.playerStatus(a.id)?.downed, null);
  assert.deepEqual(log.downed, [a.id], "onDowned fired once");
});

test("after the downed timer only self-revive at the nearest station helps", () => {
  const { world, log } = makeWorld();
  const c = arena();
  const a = spec(c.x, c.y);
  world.addPlayer(a);
  world.damage(a.id, 1000);
  run(world, 11);
  assert.equal(world.playerStatus(a.id)?.downed, 0);
  assert.equal(log.revived.length, 0);
  world.selfRevive(a.id);
  assert.deepEqual(log.revived, [{ player: a.id, by: null }]);
  const status = world.playerStatus(a.id);
  assert.ok(status);
  assert.equal(status.hp, Math.round(DERIVED.maxHp * 0.5));
  const stations = map().sites.filter((s) => s.station);
  const nearest = stations.reduce((best, s) => (Math.hypot(s.x - c.x, s.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? s : best));
  assert.ok(Math.hypot(status.x - nearest.x - 0.5, status.y - nearest.y - 0.5) < 3, `revived at ${status.x},${status.y}`);
  assert.equal(world.siteOf(a.id), nearest.id);
});

test("NPC step windows, talking and per-viewer markers", () => {
  const { world, log } = makeWorld();
  const elder = world.npcPosition("elder");
  assert.ok(elder);
  assert.equal(world.npcPosition("late"), null, "fromStep s3 hides the messenger");
  const p = spec(elder.x, elder.y);
  world.addPlayer(p);
  const me = world.playerStatus(p.id);
  assert.ok(me && Math.hypot(me.x - elder.x, me.y - elder.y) >= 1, "players spawn clear of NPCs");
  world.teleport(p.id, elder.x + 1.2, elder.y);
  world.setInput(p.id, input({ interact: true }));
  world.tick(DT);
  world.setInput(p.id, input());
  assert.deepEqual(log.talks, [{ player: p.id, npc: "elder" }]);
  const snap = world.snapshotFor(p.id).ents.find((e) => e.n === "마을 노인");
  assert.equal(snap?.mk, "quest");
  assert.equal(snap?.tm, "npc");
  const taejo = world.snapshotFor(p.id).ents.find((e) => e.n === "이성계");
  assert.equal(taejo?.hist, true, "historical figures carry the badge");
  assert.equal(taejo?.title, "동북면 원수");
  world.setStep("s3");
  assert.equal(world.npcPosition("elder"), null, "untilStep s2 removes the elder");
  assert.ok(world.npcPosition("late"));
  const after = world.snapshotFor(p.id);
  assert.ok(after.gone.length >= 1);
});

test("ambient spawns keep their count, respawn and leash home", () => {
  const { world, log } = makeWorld("spawns");
  const home = siteCentre("jeonju");
  const p = spec(home.x - 10, home.y - 10, { derived: { ...DERIVED, weaponAtk: 500 } });
  world.addPlayer(p);
  const wolves = () =>
    world.entityIds().flatMap((id) => {
      const e = world.inspect(id);
      return e && e.sprite === "wolf" && e.alive ? [e] : [];
    });
  run(world, 0.5);
  assert.equal(wolves().length, 0, "the spawn starts at step s2");
  world.setStep("s2");
  run(world, 0.2);
  assert.equal(wolves().length, 3);
  const first = wolves()[0];
  assert.ok(first);
  world.damage(first.id, 1000);
  assert.equal(log.kills.length, 1);
  assert.deepEqual(log.kills[0]?.killers, [], "raw damage credits nobody");
  run(world, 1.5);
  assert.equal(wolves().length, 2);
  run(world, 4);
  assert.equal(wolves().length, 3, "respawned after respawnSec");
  // Get noticed, then pull them away: past 12 tiles from home they give up.
  const den = { x: home.x + 6, y: home.y + 8 };
  world.teleport(p.id, den.x + 2, den.y - 3);
  run(world, 1.5);
  assert.ok(wolves().some((w) => w.state !== "idle"), "the pack noticed the player");
  world.teleport(p.id, den.x + 16, den.y - 4);
  let leashed = false;
  run(world, 6, () => {
    if (wolves().some((w) => w.state === "leash")) leashed = true;
  });
  assert.ok(leashed, "the wolf leashed back");
});
