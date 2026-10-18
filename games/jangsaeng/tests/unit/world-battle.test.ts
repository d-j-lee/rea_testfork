// Battles: waves to victory, defend defeat, boss phases/summons, scaling,
// rings, aborts and naval deck spawns.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ENEMIES } from "../../src/shared/content/enemies.ts";
import type { ChapterDef } from "../../src/shared/content/schema.ts";
import { Tile } from "../../src/shared/map/tiles.ts";
import type { FxEvent } from "../../src/shared/types.ts";
import { CHAPTER, DERIVED, arena, fightNearest, input, makeWorld, map, run, siteCentre, spec } from "./world-fixture.ts";

const STRONG = { ...DERIVED, weaponAtk: 120, maxHp: 5000 };

test("waves spawn in order and clearing them wins the battle", () => {
  const { world, log } = makeWorld("waves");
  const c = arena();
  const p = spec(c.x - 2, c.y, { derived: STRONG });
  world.addPlayer(p);
  assert.equal(world.startBattle("waves", p.id), true);
  assert.equal(world.startBattle("waves", p.id), false, "only one battle at a time");
  run(world, 0.1);
  const view = world.battleView();
  assert.ok(view);
  assert.deepEqual(view.wave, [1, 2]);
  assert.equal(view.participants, 1);
  assert.equal(view.morale, 100);
  let sawSecond = false;
  const lines: string[] = [];
  for (let i = 0; i < 1200 && log.battles.length === 0; i++) {
    fightNearest(world, p.id);
    world.tick(0.05);
    if (world.battleView()?.wave?.[0] === 2) sawSecond = true;
    for (const fx of world.drainFx()) if (fx.k === "text" && fx.text) lines.push(fx.text);
  }
  assert.ok(sawSecond, "the second wave arrived after the first was cleared");
  assert.ok(lines.includes("증원이다!"), "wave lines are shown");
  assert.deepEqual(log.battles, [{ id: "waves", result: "victory", participants: [p.id] }]);
  assert.equal(log.kills.filter((k) => k.enemy.id === "bandit").length, 5);
  assert.equal(world.battleView(), null);
});

test("waves spawn on their side just inside the arena", () => {
  const { world } = makeWorld("sides");
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  world.startBattle("waves", p.id);
  run(world, 0.05);
  const bandits = world.entityIds().map((id) => world.inspect(id)).filter((e) => e?.sprite === "bandit");
  assert.equal(bandits.length, 3);
  for (const b of bandits) {
    assert.ok(b);
    assert.ok(b.x > c.x + 3, `east wave at ${b.x}`);
    assert.ok(Math.hypot(b.x - c.x, b.y - c.y) <= 8.5);
  }
});

test("a destroyed defend target loses the battle", () => {
  const { world, log } = makeWorld("defend");
  const c = arena();
  const p = spec(c.x - 7, c.y + 2, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  assert.ok(world.startBattle("defend", p.id));
  const first = world.battleView();
  assert.equal(first?.defend?.hp, 100);
  assert.equal(first?.timeLeft, 120);
  let lowest = 100;
  run(world, 40, () => {
    world.setInput(p.id, input());
    lowest = Math.min(lowest, world.battleView()?.defend?.hp ?? lowest);
  });
  assert.ok(lowest < 100);
  assert.deepEqual(log.battles, [{ id: "defend", result: "defeat", participants: [p.id] }]);
});

test("all participating humans downed at once is a defeat (bots excluded)", () => {
  const { world, log } = makeWorld("wipe");
  const c = arena();
  const human = spec(c.x, c.y);
  const bot = spec(c.x + 1, c.y, { kind: "bot", derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(human);
  world.addPlayer(bot);
  world.startBattle("waves", human.id);
  run(world, 0.2);
  world.damage(human.id, 1000);
  run(world, 0.1);
  assert.deepEqual(log.battles, [{ id: "waves", result: "defeat", participants: [human.id, bot.id] }]);
  // Leftover enemies retreat and despawn.
  run(world, 3.5);
  assert.equal(world.entityIds().map((id) => world.inspect(id)).filter((e) => e?.sprite === "bandit").length, 0);
});

test("boss phases change by HP threshold, shout their line and summon", () => {
  const { world, log } = makeWorld("boss");
  const c = arena();
  const p = spec(c.x - 3, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  assert.ok(world.startBattle("boss", p.id));
  const fx: FxEvent[] = [];
  run(world, 0.1, () => fx.push(...world.drainFx()));
  assert.ok(fx.some((f) => f.k === "text" && f.text === "덤벼라!"), "the opening phase line");
  const view = world.battleView();
  assert.equal(view?.boss?.name, "아지발도");
  assert.equal(view?.boss?.title, "왜구 소년 장수");
  assert.equal(view?.boss?.hp, 100);
  const boss = world.snapshotFor(p.id).ents.find((e) => e.tm === "boss");
  assert.ok(boss);
  assert.equal(boss.n, "아지발도");
  const info = world.inspect(boss.id);
  assert.ok(info);
  const body = ENEMIES.boss_wokou_captain;
  assert.ok(body);
  assert.equal(info.maxHp, Math.round(body.hp * (1 + 0.1 * 7)));
  world.damage(boss.id, info.maxHp * 0.55);
  fx.length = 0;
  run(world, 0.2, () => fx.push(...world.drainFx()));
  assert.ok(fx.some((f) => f.k === "text" && f.text === "나와라, 늑대들아!"));
  assert.ok(fx.some((f) => f.k === "shake" && (f.power ?? 0) >= 8), "a big shake on the phase change");
  assert.ok(fx.some((f) => f.k === "shout"));
  const wolves = world.entityIds().map((id) => world.inspect(id)).filter((e) => e?.sprite === "wolf" && e.alive);
  assert.equal(wolves.length, 2);
  world.damage(boss.id, info.maxHp);
  run(world, 0.1);
  assert.equal(log.kills.find((k) => k.boss)?.enemy.id, "boss_wokou_captain");
  assert.deepEqual(log.battles.map((b) => [b.id, b.result]), [["boss", "victory"]]);
});

test("the boss fights back with telegraphed mechanics", () => {
  const { world } = makeWorld("mechanics");
  const c = arena();
  const p = spec(c.x - 2, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  world.startBattle("boss", p.id);
  const shapes = new Set<string>();
  run(world, 20, () => {
    for (const f of world.drainFx()) if (f.k === "telegraph" && f.tg) shapes.add(`${f.tg.shape}:${f.tg.ms}`);
  });
  assert.ok(shapes.has("circle:700"), `spin telegraph seen in ${[...shapes].join(",")}`);
  for (const s of shapes) assert.ok(Number(s.split(":")[1]) >= 400, `telegraph ${s} too short`);
  const hurt = world.playerStatus(p.id);
  assert.ok(hurt && hurt.hp < hurt.maxHp);
});

test("scaled battles count humans 1 and bots 0.5", () => {
  const { world } = makeWorld("scaled");
  const c = arena();
  const ids: number[] = [];
  for (const [i, kind] of (["player", "player", "bot", "bot"] as const).entries()) {
    const s = spec(c.x - 3 + i * 0.8, c.y + 2, { kind, derived: { ...DERIVED, maxHp: 100_000 } });
    world.addPlayer(s);
    ids.push(s.id);
  }
  const first = ids[0];
  assert.ok(first !== undefined);
  assert.ok(world.startBattle("scaled", first));
  run(world, 0.05);
  const ents = world.entityIds().map((id) => world.inspect(id));
  const boss = ents.find((e) => e?.boss);
  const body = ENEMIES.boss_wokou_captain;
  assert.ok(boss && body);
  // n = 2 + 0.5·2 = 3 → hp ×(1 + 0.65·2), wave counts ×(1 + 0.5·2).
  assert.equal(boss.maxHp, Math.round(body.hp * (1 + 0.1 * 7) * 2.3));
  assert.equal(ents.filter((e) => e?.sprite === "bandit").length, 8);
  assert.equal(world.battleView()?.participants, 4);
});

test("participants cannot leave the ring; aborting ends silently", () => {
  const { world, log } = makeWorld("ring");
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  world.startBattle("boss", p.id);
  run(world, 5, () => world.setInput(p.id, input({ my: -1 })));
  const me = world.playerStatus(p.id);
  assert.ok(me);
  assert.ok(Math.hypot(me.x - c.x, me.y - c.y) <= 9.01, "held inside the arena");
  const q = world.query().battleCentre();
  assert.ok(q && q.radius === 9);
  world.abortBattle();
  run(world, 0.1);
  assert.equal(world.battleView(), null);
  assert.equal(log.battles.length, 0, "no onBattleEnd after abort");
});

test("story NPCs who fight join battles at their site and cannot die", () => {
  const { world } = makeWorld("npc-fight");
  const c = arena();
  const p = spec(c.x - 2, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  const home = world.npcPosition("taejo");
  assert.ok(home);
  world.startBattle("waves", p.id);
  let moved = 0;
  run(world, 6, () => {
    const at = world.npcPosition("taejo");
    if (at) moved = Math.max(moved, Math.hypot(at.x - home.x, at.y - home.y));
  });
  assert.ok(moved > 2, "이성계 left his post to fight");
  const npc = world.entityIds().map((id) => world.inspect(id)).find((e) => e?.name === "이성계");
  assert.ok(npc?.alive && npc.hp === npc.maxHp);
});

test("deck battles board from the hull edges", () => {
  const site = map().sites.find((s) => s.id === "myeongnyang");
  assert.ok(site);
  const chapter: ChapterDef = {
    ...CHAPTER,
    npcs: [],
    spawns: [],
    battles: [{
      id: "deck", title: "명량", site: "myeongnyang", radius: 6, kind: "deck",
      waves: [{ enemies: [{ enemy: "japanese_marine", count: 4, level: 1 }], from: "sea" }],
      victory: [], defeat: [],
    }],
  };
  const { world } = makeWorld("deck", chapter);
  const at = siteCentre("myeongnyang");
  const p = spec(at.x, at.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  assert.ok(world.startBattle("deck", p.id));
  run(world, 0.05);
  const marines = world.entityIds().map((id) => world.inspect(id)).filter((e) => e?.name === "왜군 도선병");
  assert.equal(marines.length, 4);
  const m = map();
  for (const e of marines) {
    assert.ok(e);
    assert.equal(m.tiles[Math.floor(e.y) * m.width + Math.floor(e.x)], Tile.Deck, "boarders stand on the deck");
  }
});

function withBattles(battles: ChapterDef["battles"]): ChapterDef {
  return { ...CHAPTER, npcs: [], spawns: [], battles };
}

test("morale: 40% of each wave falling routs the rest, which counts as cleared", () => {
  const wave = { at: 0, enemies: [{ enemy: "bandit", count: 2, level: 1 }], from: "east" as const };
  const chapter = withBattles([{ id: "rout", title: "격퇴", site: "hwangsan", offset: [4, 0], radius: 8, kind: "waves", waves: [wave, wave, wave, wave], victory: [], defeat: [] }]);
  const { world, log } = makeWorld("rout", chapter);
  const c = arena();
  const p = spec(c.x - 5, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  world.startBattle("rout", p.id);
  run(world, 0.1);
  const bandits = world.entityIds().filter((id) => world.inspect(id)?.sprite === "bandit");
  assert.equal(bandits.length, 8);
  // Waves spawn in order, so ids pair up per wave.
  for (let w = 0; w < 4; w++) {
    world.damage(bandits[w * 2] as number, 1000);
    run(world, 0.05);
    if (w < 3) assert.equal(world.battleView()?.morale, 100 - 25 * (w + 1));
  }
  assert.deepEqual(log.battles.map((b) => b.result), ["victory"]);
  assert.equal(log.kills.length, 4, "fleeing enemies are not kills");
  run(world, 3.5);
  assert.equal(world.entityIds().filter((id) => world.inspect(id)?.sprite === "bandit").length, 0, "the routed despawn");
});

test("duels: only the starter can hurt the boss and the boss only hunts the starter", () => {
  const chapter = withBattles([{
    id: "duel", title: "결투", site: "hwangsan", offset: [4, 0], radius: 7, kind: "duel",
    boss: { enemy: "boss_duelist", name: "강휘", level: 10, hpScale: 1, phases: [{ at: 1, mechanic: "charge" }] },
    waves: [{ enemies: [{ enemy: "bandit", count: 5, level: 1 }] }], victory: [], defeat: [],
  }]);
  const { world } = makeWorld("duel", chapter);
  const c = arena();
  const hero = spec(c.x - 2, c.y, { derived: { ...DERIVED, maxHp: 100_000 } });
  const friend = spec(c.x - 2, c.y + 1.5, { kind: "bot", derived: { ...DERIVED, maxHp: 100_000, weaponAtk: 500 } });
  world.addPlayer(hero);
  world.addPlayer(friend);
  world.startBattle("duel", hero.id);
  run(world, 0.05);
  assert.equal(world.battleView()?.participants, 1);
  assert.equal(world.entityIds().filter((id) => world.inspect(id)?.sprite === "bandit").length, 0, "duels have no waves");
  const bossId = world.entityIds().find((id) => world.inspect(id)?.boss);
  assert.ok(bossId !== undefined);
  assert.equal(world.query().nearestEnemy(c.x, c.y, 20), null, "companions do not see the duel boss");
  run(world, 4, () => {
    const boss = world.inspect(bossId);
    const me = world.query().player(friend.id);
    if (boss && me) world.setInput(friend.id, input({ mx: Math.sign(boss.x - me.x), my: Math.sign(boss.y - me.y), attack: true, ax: boss.x - me.x, ay: boss.y - me.y }));
  });
  const boss = world.inspect(bossId);
  assert.equal(boss?.hp, boss?.maxHp, "the friend's blows do nothing");
  assert.equal(boss?.target, hero.id);
  const friendHp = world.playerStatus(friend.id);
  assert.equal(friendHp?.hp, friendHp?.maxHp, "the boss ignores bystanders");
});

test("every boss mechanic runs with its telegraph", () => {
  const phases = [
    { at: 1, mechanic: "charge" as const },
    { at: 0.85, mechanic: "guard_front" as const, line: "투구" },
    { at: 0.7, mechanic: "fire_zone" as const },
    { at: 0.55, mechanic: "volley" as const },
    { at: 0.4, mechanic: "cannon" as const },
    { at: 0.25, mechanic: "shield_wall" as const },
    { at: 0.1, mechanic: "frenzy" as const, line: "광폭" },
  ];
  const chapter = withBattles([{
    id: "all", title: "기믹", site: "hwangsan", offset: [4, 0], radius: 9, kind: "boss",
    boss: { enemy: "boss_rebel_captain", name: "부장", level: 12, hpScale: 1, phases }, waves: [], victory: [], defeat: [],
  }]);
  const { world } = makeWorld("mechanics-all", chapter);
  const c = arena();
  const p = spec(c.x - 3, c.y, { derived: { ...DERIVED, maxHp: 1_000_000 } });
  world.addPlayer(p);
  world.startBattle("all", p.id);
  run(world, 0.05);
  const bossId = world.entityIds().find((id) => world.inspect(id)?.boss);
  assert.ok(bossId !== undefined);
  const seen = new Set<string>();
  const texts = new Set<string>();
  const hp = () => world.inspect(bossId);
  for (const next of [0.84, 0.69, 0.54, 0.39, 0.24, 0.09]) {
    run(world, 8, () => {
      const me = world.query().player(p.id);
      const boss = hp();
      // Strike the boss head-on so guard_front can block.
      if (me && boss) world.setInput(p.id, input({ attack: true, ax: boss.x - me.x, ay: boss.y - me.y }));
      for (const f of world.drainFx()) {
        if (f.k === "telegraph" && f.tg) seen.add(`${f.tg.shape}:${f.tg.ms}`);
        if (f.k === "text" && f.text) texts.add(f.text);
        if (f.k === "cannonball") seen.add("cannonball");
      }
    });
    const boss = hp();
    assert.ok(boss?.alive);
    world.damage(bossId, boss.hp - boss.maxHp * next);
  }
  run(world, 6, () => {
    for (const f of world.drainFx()) {
      if (f.k === "telegraph" && f.tg) seen.add(`${f.tg.shape}:${f.tg.ms}`);
      if (f.k === "text" && f.text) texts.add(f.text);
      if (f.k === "cannonball") seen.add("cannonball");
    }
  });
  for (const key of ["line:800", "circle:1000", "cone:1000", "circle:1200", "cannonball"]) assert.ok(seen.has(key), `${key} in ${[...seen].join(",")}`);
  assert.ok(texts.has("투구") && texts.has("광폭"));
  assert.ok(texts.has("막음"), "guard_front blocks frontal blows");
  assert.ok(world.entityIds().filter((id) => world.inspect(id)?.name === "반란군 방패병").length >= 2, "shield wall");
});
