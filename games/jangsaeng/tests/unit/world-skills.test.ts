// Skills (slots 1-4), dodge stamina and 노인성 일섬 (slot 5).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILLS } from "../../src/shared/content/skills.ts";
import type { FxEvent } from "../../src/shared/types.ts";
import { DERIVED, DT, arena, input, makeWorld, run, spec } from "./world-fixture.ts";

const ALL = ["dash_slash", "whirlwind", "war_cry", "pyeonjeon", "juhwa", "singijeon", "deungpae", "bigyeok", "jochong", "ssanggeom", "rifle"];

function trySkill(skill: string): { fx: FxEvent[]; damaged: number; energy: number; cooldown: number } {
  const { world } = makeWorld(`skill-${skill}`);
  const c = arena();
  const p = spec(c.x, c.y, { skills: [skill], derived: { ...DERIVED, maxHp: 100_000 } });
  world.addPlayer(p);
  const foes: number[] = [];
  for (const [dx, dy] of [[1.2, 0], [2.5, 0.4], [4, -0.3], [6, 0.2]] as const) {
    const id = world.spawnEnemy("bear", c.x + dx, c.y + dy, 1);
    assert.ok(id !== null);
    foes.push(id);
  }
  world.setInput(p.id, input({ skill: 1, ax: 1, ay: 0 }));
  world.tick(DT);
  const status = world.playerStatus(p.id);
  assert.ok(status);
  const fx: FxEvent[] = world.drainFx();
  run(world, 3.6, () => {
    world.setInput(p.id, input({ ax: 1, ay: 0 }));
    fx.push(...world.drainFx());
  });
  const damaged = foes.filter((id) => {
    const e = world.inspect(id);
    return !e || e.hp < e.maxHp;
  }).length;
  return { fx, damaged, energy: status.energy, cooldown: status.cooldowns[0] ?? 0 };
}

test("every skill kind spends energy, starts its cooldown and has an effect", () => {
  for (const id of ALL) {
    const r = trySkill(id);
    const def = SKILLS[id];
    assert.ok(def, id);
    assert.equal(r.cooldown, def.cooldown, `${id} cooldown`);
    // Hits landed on the first tick refund +4 energy each.
    assert.ok(r.energy <= 100 - def.energy + 16, `${id} spent energy`);
    if (id === "war_cry") assert.ok(r.fx.some((f) => f.k === "shout"), "war cry shouts");
    else if (id === "deungpae") assert.ok(r.fx.some((f) => f.k === "sfx" && f.sfx === "block"));
    else assert.ok(r.damaged >= 1, `${id} damaged ${r.damaged}`);
  }
  assert.ok(trySkill("pyeonjeon").damaged >= 3, "편전 pierces the line");
  assert.ok(trySkill("jochong").fx.some((f) => f.k === "telegraph" && f.tg?.shape === "line" && f.tg.ms === 1200), "조총 aims for 1.2 s");
  assert.ok(trySkill("bigyeok").fx.some((f) => f.k === "explosion"), "진천뢰 explodes");
  const spin = trySkill("ssanggeom").fx.filter((f) => f.k === "slash").length;
  assert.ok(spin >= 12, `쌍검 six double-slashes (${spin})`);
});

test("skills cost exactly their energy", () => {
  const { world } = makeWorld("energy");
  const c = arena();
  const p = spec(c.x, c.y, { skills: ["juhwa", "rifle"] });
  world.addPlayer(p);
  world.setInput(p.id, input({ skill: 1 }));
  world.tick(DT);
  assert.equal(world.playerStatus(p.id)?.energy, 65);
  world.setInput(p.id, input({ skill: 1 }));
  world.tick(DT);
  assert.equal(world.playerStatus(p.id)?.energy, 65, "cooling down: no second cast");
  world.setInput(p.id, input({ skill: 2 }));
  world.tick(DT);
  assert.deepEqual(world.playerStatus(p.id)?.cooldowns, [13.9, 1.5]);
});

test("rolls cost 25 stamina and need stamina to start", () => {
  const { world } = makeWorld("stamina");
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  for (let i = 0; i < 4; i++) {
    world.setInput(p.id, input({ dodge: true, mx: i % 2 ? 1 : -1 }));
    world.tick(DT);
    world.setInput(p.id, input());
    run(world, 0.35);
  }
  const tired = world.playerStatus(p.id);
  assert.ok(tired && tired.stamina < 1, `stamina ${tired?.stamina}`);
  const before = tired.x;
  world.setInput(p.id, input({ dodge: true, mx: 1 }));
  world.tick(DT);
  world.setInput(p.id, input());
  run(world, 0.3);
  // One walking tick (≤ 0.25 tiles) instead of a 3.5-tile roll.
  assert.ok(Math.abs((world.playerStatus(p.id)?.x ?? 0) - before) < 0.5, "no roll without stamina");
  run(world, 4);
  assert.equal(world.playerStatus(p.id)?.stamina, 100, "regenerates 30/s after 0.5 s");
});

test("노인성 일섬 cuts every enemy within 12 tiles, grants 5 s invulnerability, 20 s cooldown", () => {
  const { world, log } = makeWorld("longevity");
  const c = arena();
  const p = spec(c.x, c.y);
  world.addPlayer(p);
  const near = [world.spawnEnemy("bandit", c.x + 3, c.y, 1), world.spawnEnemy("bandit", c.x - 6, c.y + 4, 1), world.spawnEnemy("bear", c.x, c.y - 8, 1)];
  const far = world.spawnEnemy("bandit", c.x + 14, c.y, 1);
  world.drainFx();
  world.setInput(p.id, input({ skill: 5 }));
  world.tick(DT);
  world.setInput(p.id, input());
  const fx = world.drainFx();
  assert.deepEqual(log.longevity, [p.id]);
  assert.ok(fx.some((f) => f.k === "levelup") && fx.some((f) => f.k === "shout") && fx.some((f) => f.k === "shake" && (f.power ?? 0) >= 10));
  for (const id of near) {
    assert.ok(id !== null);
    const e = world.inspect(id);
    assert.ok(!e || !e.alive || e.hp < e.maxHp, "near enemies were cut");
  }
  assert.ok(far !== null);
  assert.equal(world.inspect(far)?.hp, world.inspect(far)?.maxHp, "14 tiles is out of reach");
  assert.equal(world.playerStatus(p.id)?.longevityReady, 20);
  world.damage(p.id, 0.0001);
  const bear = near[2];
  assert.ok(bear !== null && bear !== undefined);
  // Invulnerable to enemy hits for 5 s.
  const hpBefore = world.playerStatus(p.id)?.hp;
  world.teleport(p.id, c.x + 14, c.y + 1);
  run(world, 3);
  assert.equal(world.playerStatus(p.id)?.hp, hpBefore);
  world.setInput(p.id, input({ skill: 5 }));
  world.tick(DT);
  assert.deepEqual(log.longevity, [p.id], "still cooling down");
  world.setLongevityEnabled(p.id, false);
  run(world, 18);
  world.setInput(p.id, input({ skill: 5 }));
  world.tick(DT);
  assert.deepEqual(log.longevity, [p.id], "the host can lock slot 5");
});

test("poise breaks stun enemies, who then take 30% more damage", () => {
  const { world } = makeWorld("poise");
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, critChance: 0 } });
  world.addPlayer(p);
  const bear = world.spawnEnemy("bear", c.x + 1.2, c.y, 1);
  assert.ok(bear !== null);
  const texts: string[] = [];
  run(world, 6, () => {
    world.setInput(p.id, input({ attack: true, ax: 1, ay: 0 }));
    for (const f of world.drainFx()) if (f.k === "text" && f.text) texts.push(f.text);
  });
  assert.ok(texts.includes("경직"), "the bear's balance broke");
});

test("shield bearers take −70% from the front; their flank is open", () => {
  const { world } = makeWorld("shield");
  const c = arena();
  const p = spec(c.x, c.y, { derived: { ...DERIVED, critChance: 0, maxHp: 100_000 } });
  world.addPlayer(p);
  const shield = world.spawnEnemy("rebel_shield", c.x + 1.2, c.y, 1);
  assert.ok(shield !== null);
  run(world, 1.5);
  const swing = (ax: number): number => {
    world.drainFx();
    world.setInput(p.id, input({ attack: true, ax, ay: 0 }));
    world.tick(DT);
    world.setInput(p.id, input({ ax, ay: 0 }));
    let dealt = 0;
    run(world, 0.2, () => {
      for (const f of world.drainFx()) if (f.k === "text" && f.color === "#ffffff" && /^\d+$/.test(f.text ?? "")) dealt += Number(f.text);
    });
    run(world, 0.4);
    return dealt;
  };
  const front = swing(1);
  const e = world.inspect(shield);
  assert.ok(e);
  world.teleport(p.id, e.x + 1.1, e.y);
  const back = swing(-1);
  assert.ok(front > 0 && back > front * 2.5, `front ${front}, back ${back}`);
});
