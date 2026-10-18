// Battles through the host: Channel and Session on the real World and Bot
// stack, as the offline build runs them (8 ◇ companions). One owner places
// a battle (World.arenaOf): the story teleport, the trigger, the marker and
// the demo skip all use the arena the fight is resolved on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT } from "../../src/shared/content/index.ts";
import type { ChapterId } from "../../src/shared/content/schema.ts";
import { Channel } from "../../src/shared/host/channel.ts";
import { Session } from "../../src/shared/host/session.ts";
import { generateMap } from "../../src/shared/map/generate.ts";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import { createSave } from "../../src/shared/rules/index.ts";
import type { PlayerSave, SelfView } from "../../src/shared/types.ts";

const map = generateMap("jangsaeng");
const DT = 0.05;
let nextId = 3_000_000;

/** 정족산성 (ch14 s4): its arena resolves 8 tiles from the site + offset the content names. */
const CHAPTER: ChapterId = "ch14";
const STEP = 3;
const BATTLE = "b_jeongjok";

interface Player {
  session: Session;
  save: PlayerSave;
  toasts: string[];
  self: () => SelfView | null;
}

function channelOf(bots: number, chapter: ChapterId = CHAPTER): Channel {
  return new Channel(
    { content: CONTENT, map, seed: "host-battle", mode: "offline", botsPerChannel: bots, nextId: () => nextId++, log: () => {} },
    CONTENT.chapters[chapter],
    1,
    true,
  );
}

/** A demo character standing at a battle's step of the channel's chapter (정족산성 by default), no card open. */
function join(channel: Channel, name: string, step = STEP): Player {
  const chapter = channel.chapter.id;
  const save = createSave(CONTENT, { token: "e".repeat(32), name, variant: "m", origin: "northeast", seed: 99, demoChapter: chapter });
  save.step = step;
  save.flags[`entered:${chapter}`] = true;
  const toasts: string[] = [];
  let self: SelfView | null = null;
  const session = new Session(nextId++, save.token, save, (message: ServerMsg) => {
    if (message.t === "toast") toasts.push(message.text);
    if (message.t === "self") self = message.self;
  }, { content: CONTENT, map, mode: "offline", save: () => {}, relocate: () => {}, log: () => {} });
  channel.add(session);
  return { session, save, toasts, self: () => self };
}

function tick(channel: Channel, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += DT) {
    each?.();
    channel.tick(DT);
  }
}

const press = (player: Player) => player.session.receive({ t: "action", action: { kind: "demoSkip" } });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test("a battle the story starts carries the hero and every companion into its resolved arena", () => {
  const channel = channelOf(8);
  const hero = join(channel, "한결");
  const world = channel.world;
  tick(channel, 1);
  const ring = world.arenaOf(BATTLE);
  const def = CONTENT.chapters[CHAPTER].battles.find((battle) => battle.id === BATTLE);
  const site = world.sitePosition(def?.site ?? "");
  assert.ok(ring && def && site);
  const named = { x: site.x + (def.offset?.[0] ?? 0), y: site.y + (def.offset?.[1] ?? 0) };
  assert.ok(distance(ring, named) > 4, "the arena is resolved away from the named spot, inside the fortress");
  const start = world.playerStatus(hero.session.id);
  assert.ok(start && distance(start, ring) > ring.radius + 6, "the hero starts far off");
  assert.ok(channel.startBattle(BATTLE, hero.session, true));
  const view = world.battleView();
  assert.deepEqual(view && { x: view.x, y: view.y, radius: view.radius }, ring, "the fight is where arenaOf said");
  const me = world.playerStatus(hero.session.id);
  assert.ok(me && distance(me, ring) <= ring.radius, `the hero stands in the ring (${me && distance(me, ring).toFixed(1)} tiles out)`);
  assert.equal(view?.participants, 9, "every companion came along onto the arena");
  tick(channel, 5);
  for (const id of channel.bots.keys()) {
    const bot = world.query().player(id);
    assert.ok(bot && distance(bot, ring) <= ring.radius + 0.5, `companion ${id} is ${bot && distance(bot, ring).toFixed(1)} tiles from the centre`);
  }
});

test("the objective marker and the trigger stand on the resolved arena", () => {
  const channel = channelOf(0);
  const hero = join(channel, "한결");
  const world = channel.world;
  tick(channel, 0.5);
  const ring = world.arenaOf(BATTLE);
  assert.ok(ring);
  const marker = hero.self()?.objectives.find((objective) => objective.id === "o_jeongjok");
  assert.deepEqual(marker && { x: marker.x, y: marker.y }, { x: ring.x, y: ring.y }, "the battle's offset is not applied twice");
  world.teleport(hero.session.id, ring.x, ring.y + ring.radius + 5.5);
  tick(channel, 0.5);
  assert.equal(world.battleView()?.id, BATTLE, "stepping within 6 tiles of the arena's rim starts it");
});

test("a lone hero who revives themself mid-battle fights on from the rim; the battle is not won without them", () => {
  // 명량 (ch10 s7): the nearest post station is some 40 tiles off.
  const channel = channelOf(8, "ch10");
  const hero = join(channel, "한결", 6);
  const world = channel.world;
  tick(channel, 1);
  assert.ok(channel.startBattle("b_myeongnyang", hero.session, true));
  tick(channel, 1);
  world.damage(hero.session.id, 1e6);
  tick(channel, 0.5);
  assert.ok(hero.toasts.includes("사경(死境)에 빠졌다 — 동료를 기다리거나 스스로 일어서라."), "companions stand: wait for them or rise");
  hero.session.receive({ t: "action", action: { kind: "selfRevive" } });
  const ring = world.battleView();
  const me = world.playerStatus(hero.session.id);
  assert.ok(ring && me && me.downed === null, "revived and the battle goes on");
  assert.ok(distance(me, ring) <= ring.radius, `revived in the ring, ${distance(me, ring).toFixed(1)} tiles from its centre`);
  assert.ok(world.battleParticipants().includes(hero.session.id), "still a participant");
  let farthest = 0;
  tick(channel, 120, () => {
    const at = world.playerStatus(hero.session.id);
    if (at && world.battleView()) farthest = Math.max(farthest, distance(at, ring));
  });
  assert.ok(farthest <= ring.radius + 0.5, `the hero stayed in the fight (at most ${farthest.toFixed(1)} tiles out)`);
});

test("a demo skip while another person fights on leaves the battle to them", () => {
  const channel = channelOf(2);
  const presenter = join(channel, "시연자");
  const friend = join(channel, "동무");
  const world = channel.world;
  tick(channel, 1);
  assert.ok(channel.startBattle(BATTLE, presenter.session, true));
  const ring = world.battleView();
  assert.ok(ring);
  world.teleport(friend.session.id, ring.x, ring.y);
  tick(channel, 0.5);
  assert.ok(world.battleParticipants().includes(friend.session.id));
  const def = CONTENT.chapters[CHAPTER].battles.find((battle) => battle.id === BATTLE);
  assert.ok(def);
  channel.skipBattle(presenter.session, def);
  assert.ok(presenter.save.battlesWon.includes(BATTLE), "the presenter won it");
  assert.equal(world.battleView()?.id, BATTLE, "the battle runs on for the friend");
  assert.ok(!world.battleParticipants().includes(presenter.session.id), "the presenter left it");
  tick(channel, 1);
  assert.ok(!world.battleParticipants().includes(presenter.session.id), "standing on the arena does not rejoin it");
  world.endBattle("defeat");
  tick(channel, 0.1);
  assert.ok(friend.toasts.some((text) => text.includes("물러났다")), "the friend's defeat is resolved");
  assert.ok(!presenter.toasts.some((text) => text.includes("물러났다")), "the presenter, who left, is not resolved again");
});

test("demo skip at the ring starts the battle in view; only the next press wins it", () => {
  const channel = channelOf(2);
  const presenter = join(channel, "시연자");
  const world = channel.world;
  tick(channel, 1);
  const ring = world.arenaOf(BATTLE);
  assert.ok(ring);
  // Within reach of the demo's ring spot (radius + 2 south) but short of the trigger (radius + 6).
  const spot = { x: ring.x, y: ring.y + ring.radius + 2 };
  const near = (p: { x: number; y: number } | null) => p !== null && distance(p, spot) <= 8 && distance(p, ring) > ring.radius + 6;
  for (let k = 0; k < 16 && !near(world.playerStatus(presenter.session.id)); k++)
    world.teleport(presenter.session.id, spot.x + Math.cos((k / 16) * Math.PI * 2) * 6.5, spot.y + Math.sin((k / 16) * Math.PI * 2) * 6.5);
  assert.ok(near(world.playerStatus(presenter.session.id)), "a stand-point by the ring spot, outside the trigger");
  tick(channel, 0.5);
  assert.equal(world.battleView(), null, "not started on foot");
  press(presenter);
  assert.equal(world.battleView()?.id, BATTLE, "the first press starts the fight");
  assert.ok(!presenter.save.battlesWon.includes(BATTLE), "and does not win it");
  tick(channel, 0.5);
  press(presenter);
  assert.ok(presenter.save.battlesWon.includes(BATTLE), "the next press wins it");
});

test("the downed toast promises help only when someone could bring it", () => {
  const channel = channelOf(0);
  const hero = join(channel, "한결");
  const world = channel.world;
  tick(channel, 1);
  assert.ok(channel.startBattle(BATTLE, hero.session, true));
  world.damage(hero.session.id, 1e6);
  tick(channel, 0.2);
  assert.ok(hero.toasts.includes("사경(死境)에 빠졌다 — 스스로 일어서라."), hero.toasts.join(" / "));
  assert.ok(!hero.toasts.some((text) => text.includes("동료를 기다리거나")));
});
