// Battle pacing with simulated companions (◇) on the real Channel, Session and
// Bot stack at a demo preset, as the offline build runs it (8 companions).
// Companions are the hero's supporting cast: a wave walks in from the rim and
// lasts long enough to watch, and a fallen hero is revived by companions
// (two go in) while the others cover instead of crowding in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS, CONTENT } from "../../src/shared/content/index.ts";
import type { ChapterId } from "../../src/shared/content/schema.ts";
import { Channel } from "../../src/shared/host/channel.ts";
import { Session } from "../../src/shared/host/session.ts";
import { generateMap } from "../../src/shared/map/generate.ts";
import { createSave } from "../../src/shared/rules/index.ts";
import type { World } from "../../src/shared/sim/world.ts";

const map = generateMap("jangsaeng");
let nextId = 2_000_000;
const DT = 0.05;

function demoBattle(chapterId: ChapterId, step: string, battleId: string, bots: number) {
  const chapter = CHAPTERS[chapterId];
  const channel = new Channel(
    { content: CONTENT, map, seed: "pacing", mode: "offline", botsPerChannel: bots, nextId: () => nextId++, log: () => {} },
    chapter,
    1,
  );
  const save = createSave(CONTENT, { token: "f".repeat(32), name: "한결", variant: "m", origin: "northeast", seed: 1234, demoChapter: chapterId });
  const toasts: string[] = [];
  const session = new Session(nextId++, "f".repeat(32), save, (message) => {
    if (message.t === "toast") toasts.push(message.text);
  }, { content: CONTENT, map, mode: "offline", save: () => {}, relocate: () => {}, log: () => {} });
  channel.add(session);
  const world = channel.world;
  world.abortBattle();
  world.setStep(step);
  for (let i = 0; i < 20; i++) channel.tick(DT);
  assert.ok(channel.startBattle(battleId, session, true));
  return { channel, world, hero: session.id, toasts };
}

/** The hero fights like a presenter: walks to the nearest enemy and strikes. */
function fight(world: World, hero: number): void {
  const me = world.query().player(hero);
  const foe = me && !me.downed ? world.query().nearestEnemy(me.x, me.y, 14) : null;
  if (!me || !foe) {
    world.setInput(hero, { mx: 0, my: 0, attack: false, shoot: false, dodge: false, skill: 0, interact: false });
    return;
  }
  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const d = Math.hypot(dx, dy);
  world.setInput(hero, { mx: d > 1 ? dx / d : 0, my: d > 1 ? dy / d : 0, attack: d < 1.6, shoot: false, dodge: false, skill: 0, interact: false, ax: dx, ay: dy });
}

const liveFoes = (world: World, ids: Iterable<number>) =>
  [...ids].filter((id) => {
    const e = world.inspect(id);
    return e?.alive === true && e.state !== "flee";
  });

test("with eight companions a 동래성 wave lasts long enough to watch", () => {
  const { channel, world, hero } = demoBattle("ch09", "s2", "b_dongnae", 8);
  assert.equal(channel.bots.size, 8);
  const ring = world.battleView();
  assert.ok(ring);
  channel.tick(DT);
  const first = world.entityIds().filter((id) => world.inspect(id)?.side === "foe" && Math.hypot((world.inspect(id)?.x ?? 0) - ring.x, (world.inspect(id)?.y ?? 0) - ring.y) <= ring.radius);
  assert.ok(first.length >= 8, `the first wave is scaled for the companions (${first.length})`);
  let firstGone = -1;
  let onField = 0;
  let t = 0;
  for (; t < 120 && world.battleView(); t += DT) {
    fight(world, hero);
    channel.tick(DT);
    if (firstGone < 0 && liveFoes(world, first).length === 0) firstGone = t;
    const view = world.battleView();
    if (view && world.entityIds().some((id) => {
      const e = world.inspect(id);
      return e?.side === "foe" && e.alive && e.state !== "flee" && Math.hypot(e.x - view.x, e.y - view.y) <= view.radius + 1;
    })) onField += DT;
  }
  assert.equal(world.battleView(), null, "the battle ended");
  assert.ok(firstGone >= 4, `the first wave lasted ${firstGone.toFixed(1)} s`);
  assert.ok(onField >= 0.35 * t, `enemies were on the field ${onField.toFixed(0)} of ${t.toFixed(0)} s`);
});

test("companions revive the fallen hero in pairs while the others cover", () => {
  const { channel, world, hero, toasts } = demoBattle("ch09", "s2", "b_dongnae", 8);
  for (let i = 0; i < 60; i++) {
    fight(world, hero);
    channel.tick(DT);
  }
  world.damage(hero, 100_000);
  assert.ok(world.playerStatus(hero)?.downed);
  let crowd = 0;
  let revivedAt = -1;
  for (let t = 0; t < 12 && revivedAt < 0; t += DT) {
    channel.tick(DT);
    const me = world.playerStatus(hero);
    assert.ok(me);
    if (me.downed === null) revivedAt = t;
    const near = [...channel.bots.keys()].filter((id) => {
      const bot = world.query().player(id);
      return bot !== null && !bot.downed && Math.hypot(bot.x - me.x, bot.y - me.y) <= 1;
    }).length;
    crowd = Math.max(crowd, near);
  }
  assert.ok(revivedAt >= 0, "a companion revived the hero");
  assert.ok(world.battleView(), "the first down did not lose the battle");
  assert.ok(crowd <= 4, `${crowd} of 8 companions crowded onto the fallen hero`);
  assert.ok(toasts.some((text) => text.endsWith("의 도움으로 일어섰다.")));
});
