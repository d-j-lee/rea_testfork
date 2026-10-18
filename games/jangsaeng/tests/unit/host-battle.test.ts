// Battles through the host: Channel and Session on the real World and Bot
// stack, as the offline build runs them (8 ◇ companions), and two people in
// one online channel. One owner places a battle (World.arenaOf, atBattle,
// arrivalSpot): the story carry, the trigger, the marker and the demo skip
// all use the arena the fight is resolved on; one owner says who fights it
// (sim/battle.ts muster): whoever it counts is resolved with it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT, type ContentIndex } from "../../src/shared/content/index.ts";
import { CHAPTER_IDS, type ChapterId } from "../../src/shared/content/schema.ts";
import { Channel } from "../../src/shared/host/channel.ts";
import { Session } from "../../src/shared/host/session.ts";
import { generateMap } from "../../src/shared/map/generate.ts";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import { createSave, evalCond } from "../../src/shared/rules/index.ts";
import type { DemoPath, PlayerSave, SelfView } from "../../src/shared/types.ts";

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

function channelOf(bots: number, chapter: ChapterId = CHAPTER, mode: "online" | "offline" = "offline"): Channel {
  return new Channel(
    { content: CONTENT, map, seed: "host-battle", mode, botsPerChannel: bots, nextId: () => nextId++, log: () => {} },
    CONTENT.chapters[chapter],
    1,
    mode === "offline",
  );
}

/** A demo character standing at a battle's step of the channel's chapter (정족산성 by default), no card open. */
function join(channel: Channel, name: string, step = STEP): Player {
  const chapter = channel.chapter.id;
  const save = createSave(CONTENT, { token: name.padEnd(32, "e"), name, variant: "m", origin: "northeast", seed: 99, demoChapter: chapter });
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
  assert.equal(hero.self()?.downed?.help, true, "companions stand: the overlay waits for them");
  assert.ok(!hero.toasts.some((text) => text.startsWith("사경")), "the overlay says it; no toast outlives the fall");
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

test("a lost battle's fallen get up on its rim for free, and it starts again only once the player has stepped away", () => {
  const channel = channelOf(8);
  const hero = join(channel, "한결");
  const world = channel.world;
  tick(channel, 1);
  assert.ok(channel.startBattle(BATTLE, hero.session, true));
  const ring = world.battleView();
  assert.ok(ring);
  tick(channel, 1);
  const { lifeEnd, record } = hero.save;
  const selfRevives = record.selfRevives;
  for (const id of [hero.session.id, ...channel.bots.keys()]) world.damage(id, 1e6);
  assert.notEqual(world.playerStatus(hero.session.id)?.downed, null, "the hero lies downed");
  channel.tick(DT);
  assert.equal(world.battleView(), null, "everyone fell at once: the battle is lost");
  // Nobody is left lying out a down timer: the fallen withdraw to the rim at a quarter of their HP.
  for (const id of [hero.session.id, ...channel.bots.keys()]) {
    const status = world.playerStatus(id);
    assert.ok(status && status.downed === null, `${id === hero.session.id ? "the hero" : `companion ${id}`} is up`);
    const out = distance(status, ring);
    assert.ok(out > ring.radius - 2.5 && out <= ring.radius + 0.5, `${id} stands on the rim, ${out.toFixed(1)} tiles out`);
  }
  const me = world.playerStatus(hero.session.id);
  assert.ok(me && me.hp <= Math.ceil(me.maxHp * 0.3), `the hero got up hurt (${me?.hp}/${me?.maxHp})`);
  tick(channel, 0.5);
  // It is a withdrawal, not a revive: no 천수, no self-revive on the record, and the toast says so.
  assert.equal(hero.save.lifeEnd, lifeEnd);
  assert.equal(hero.save.record.selfRevives, selfRevives);
  assert.ok(!hero.toasts.some((text) => text.startsWith("스스로 일어서다")), hero.toasts.join(" / "));
  assert.ok(hero.toasts.some((text) => text.includes("물러났다") && text.includes("돌아오면 다시 싸운다")), hero.toasts.join(" / "));
  // Standing at the ring it lost does not start it again.
  tick(channel, 6);
  assert.equal(world.battleView(), null, "the lost battle does not restart by itself");
  assert.ok(world.atBattle(BATTLE, hero.session.id), "though the hero still stands at it");
  // Walking out of its reach and back in does.
  world.teleport(hero.session.id, ring.x, ring.y + ring.radius + 16);
  tick(channel, 0.5);
  assert.ok(!world.atBattle(BATTLE, hero.session.id), `the hero stepped away (${JSON.stringify(world.playerStatus(hero.session.id))})`);
  assert.equal(world.battleView(), null, "away from it nothing starts");
  world.teleport(hero.session.id, ring.x, ring.y + ring.radius + 2);
  tick(channel, 0.5);
  assert.ok(world.atBattle(BATTLE, hero.session.id), `the hero is back (${JSON.stringify(world.playerStatus(hero.session.id))} ${JSON.stringify(ring)})`);
  assert.equal(world.battleView()?.id, BATTLE, "back at the ring, the battle is on again");
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

test("demo skip: a press away carries the presenter onto the battle's ground, the next starts it in view, the one after wins it", () => {
  // 정족산성 inside its fortress, and the three sea battles on their fleets'
  // decks, whose rings are mostly water around: pressed without a tick in
  // between, as a cold-open demo entry presses.
  const cases: [ChapterId, number, string][] = [[CHAPTER, STEP, BATTLE], ["ch09", 8, "b_hansan"], ["ch10", 6, "b_myeongnyang"], ["ch10", 8, "b_noryang"]];
  for (const [chapter, step, battle] of cases) {
    const channel = channelOf(2, chapter);
    const presenter = join(channel, "시연자", step);
    const world = channel.world;
    const ring = world.arenaOf(battle);
    assert.ok(ring);
    assert.ok(!world.atBattle(battle, presenter.session.id), `${battle}: the presenter starts away from it`);
    press(presenter);
    const at = world.playerStatus(presenter.session.id);
    assert.ok(at && distance(at, ring) <= ring.radius, `${battle}: carried into the ring (${at && distance(at, ring).toFixed(1)} tiles from its centre)`);
    assert.ok(world.atBattle(battle, presenter.session.id));
    assert.equal(world.battleView(), null, `${battle}: the carry does not start it`);
    press(presenter);
    assert.equal(world.battleView()?.id, battle, `${battle}: the second press starts the fight`);
    assert.ok(!presenter.save.battlesWon.includes(battle), `${battle}: and does not win it`);
    press(presenter);
    assert.ok(presenter.save.battlesWon.includes(battle), `${battle}: the third press wins it`);
  }
});

test("a downed presenter's demo skip gets them up first; no battle starts with its starter lying down", () => {
  for (const bots of [0, 8]) {
    const channel = channelOf(bots);
    const hero = join(channel, "한결");
    const world = channel.world;
    tick(channel, 1);
    world.damage(hero.session.id, 1e6);
    tick(channel, 0.2);
    assert.notEqual(world.playerStatus(hero.session.id)?.downed, null, "down, far from the battle");
    assert.equal(world.battleRefusal(BATTLE, hero.session.id), "downed");
    assert.equal(world.startBattle(BATTLE, hero.session.id), false, "the world refuses a downed starter");
    const before = world.playerStatus(hero.session.id);
    assert.equal(channel.startBattle(BATTLE, hero.session, true), false, "so does a story start");
    assert.deepEqual(world.playerStatus(hero.session.id), before, "and nobody carries the body anywhere");
    press(hero);
    assert.equal(world.battleView(), null, `with ${bots} companions: the press starts nothing`);
    assert.equal(world.playerStatus(hero.session.id)?.downed, null, "it got the presenter up");
    assert.ok(hero.toasts.some((text) => text.startsWith("스스로 일어서다")), hero.toasts.join(" / "));
    press(hero);
    press(hero);
    assert.equal(world.battleView()?.id, BATTLE, "then the presses go on: carried, started");
    press(hero);
    assert.ok(hero.save.battlesWon.includes(BATTLE), "and won");
  }
});

test("a demo skip while another battle holds the world wins outright, without the refusal toast", () => {
  const channel = channelOf(0);
  const presenter = join(channel, "시연자");
  const other = join(channel, "동무", STEP + 2);
  const world = channel.world;
  tick(channel, 1);
  assert.ok(channel.startBattle("b_gwangseong", other.session, true), "광성보 holds the world");
  press(presenter);
  press(presenter);
  assert.ok(presenter.save.battlesWon.includes(BATTLE), "won outright at the ring");
  assert.ok(!presenter.toasts.includes("다른 전투가 이미 벌어지고 있다."), presenter.toasts.join(" / "));
  assert.equal(world.battleView()?.id, "b_gwangseong", "the other battle runs on");
});

test("online, two people: whoever waits at the ring is resolved with the battle, and a winner is not pulled into its replay", () => {
  const channel = channelOf(0, CHAPTER, "online");
  const fighter = join(channel, "투사");
  const watcher = join(channel, "구경꾼");
  const world = channel.world;
  tick(channel, 1);
  const ring = world.arenaOf(BATTLE);
  assert.ok(ring);
  assert.ok(channel.startBattle(BATTLE, fighter.session, true));
  // The watcher waits 4 tiles beyond the rim, within reach, never setting foot on the ground.
  world.teleport(watcher.session.id, ring.x, ring.y - ring.radius - 4);
  tick(channel, 0.5);
  const waiting = world.playerStatus(watcher.session.id);
  assert.ok(waiting && distance(waiting, ring) > ring.radius + 2, "the watcher stands off the ring");
  assert.ok(world.battleParticipants().includes(watcher.session.id), "the battle takes in whoever is at it");
  world.endBattle("victory");
  tick(channel, 0.6);
  assert.ok(fighter.save.battlesWon.includes(BATTLE), "the fighter won");
  assert.ok(watcher.save.battlesWon.includes(BATTLE), "and so did the watcher it counted");
  assert.equal(world.battleView(), null, "nobody's objective is left open to restart it");

  // A third person who still has it to fight starts it on foot beside the two winners.
  const late = join(channel, "늦은이");
  world.teleport(fighter.session.id, ring.x, ring.y);
  world.teleport(late.session.id, ring.x + 1, ring.y + ring.radius + 1);
  tick(channel, 0.5);
  assert.equal(world.battleView()?.id, BATTLE, "the replay runs for the late one");
  assert.deepEqual(world.battleParticipants(), [late.session.id], "the winners in and beside the ring are not pulled in");
  world.endBattle("defeat");
  tick(channel, 0.6);
  assert.ok(late.toasts.some((text) => text.includes("물러났다")), "the late one's defeat is resolved");
  for (const winner of [fighter, watcher]) assert.ok(!winner.toasts.some((text) => text.includes("물러났다")), "the winners take no defeat");
});

test("a level-up gets one toast: the battle record's line after a win, the session's after a kill", () => {
  const channel = channelOf(0, "ch01");
  const hero = join(channel, "한결", 2);
  const gate = CONTENT.chapters.ch01.battles.find((battle) => battle.id === "ch01_gate");
  assert.ok(gate);
  const level = hero.save.level;
  hero.session.onBattleEnd(gate, "victory", 8);
  assert.ok(hero.save.level > level, "the gate's exp levels a fresh hero up");
  const notices = hero.toasts.filter((text) => text.startsWith("레벨"));
  assert.deepEqual(notices, [`레벨 ${hero.save.level} 달성 (능력치 점수 +${2 * (hero.save.level - level)})`], hero.toasts.join(" / "));
  hero.toasts.length = 0;
  const boss = CONTENT.enemies.boss_red_turban;
  assert.ok(boss);
  const before = hero.save.level;
  hero.session.onKill(boss, 30, true);
  assert.ok(hero.save.level > before);
  assert.deepEqual(hero.toasts.filter((text) => text.startsWith("레벨")), [`레벨 ${hero.save.level}!`], hero.toasts.join(" / "));
});

test("companions arrive spread around the hero, and their chatter is rate-limited", () => {
  const channel = channelOf(8);
  const hero = join(channel, "한결");
  const world = channel.world;
  const lines: { t: number; from: string }[] = [];
  let t = 0;
  const original = hero.session.send.bind(hero.session);
  hero.session.send = (message: ServerMsg) => {
    if (message.t === "chat" && message.kind === "bot") lines.push({ t, from: message.from });
    original(message);
  };
  // Joining and a story jump land them on their own sides of the hero, not stacked on one spot.
  const spread = () => {
    const me = world.playerStatus(hero.session.id);
    const bots = [...channel.bots.keys()].map((id) => world.playerStatus(id));
    assert.ok(me && bots.every((bot) => bot !== null));
    for (const [i, bot] of bots.entries()) {
      assert.ok(bot && distance(bot, me) >= 1, `companion ${i} is ${bot && distance(bot, me).toFixed(1)} tiles from the hero`);
      for (const other of bots.slice(i + 1)) assert.ok(bot && other && distance(bot, other) >= 1, `two companions share a spot: ${JSON.stringify(bots.map((b) => b && [b.x, b.y]))} hero ${me.x},${me.y}`);
    }
  };
  spread();
  // A battle the story starts carries them onto its ground beside the hero, spread the same way.
  assert.ok(channel.startBattle(BATTLE, hero.session, true));
  spread();
  // A battle in which the companions keep falling: each down may raise a cry, the greetings come too.
  for (; t < 60; t += DT) {
    if (Math.round(t / DT) % 40 === 0) for (const id of channel.bots.keys()) world.damage(id, 1e6);
    world.damage(hero.session.id, -1);
    channel.tick(DT);
  }
  assert.ok(lines.length >= 2, `the companions still talk (${lines.length} lines)`);
  for (let i = 1; i < lines.length; i++)
    assert.ok(lines[i]!.t - lines[i - 1]!.t >= 4.99, `two companion lines ${(lines[i]!.t - lines[i - 1]!.t).toFixed(2)} s apart`);
  for (const [i, line] of lines.entries()) {
    const again = lines.slice(i + 1).find((later) => later.from === line.from);
    assert.ok(!again || again.t - line.t >= 19.99, `${line.from} spoke twice ${again && (again.t - line.t).toFixed(1)} s apart`);
  }
});

test("a battle won inside a failed campaign is not toasted as a victory", () => {
  const channel = channelOf(0, "ch16");
  const hero = join(channel, "한결", 21);
  const low = CONTENT.chapters.ch16.battles.find((battle) => battle.id === "b_seoul_low");
  const won = CONTENT.chapters.ch16.battles.find((battle) => battle.id === "b_eulsa_uibyeong");
  assert.ok(low?.victoryLabel && won && !won.great && !won.victoryLabel);
  hero.session.onBattleEnd(low, "victory", 0);
  hero.session.onBattleEnd(won, "victory", 0);
  assert.ok(hero.toasts.includes(`${low.title} — ${low.victoryLabel}`), hero.toasts.join(" / "));
  assert.ok(!hero.toasts.includes(`${low.title} 승리`));
  assert.ok(hero.toasts.includes(`${won.title} 승리`), "other battles keep '승리'");
});

test("the downed view promises help only when someone could bring it", () => {
  // Alone in the channel and outside any battle (a lone battle is simply lost and withdrawn).
  const channel = channelOf(0);
  const hero = join(channel, "한결");
  const world = channel.world;
  tick(channel, 1);
  world.damage(hero.session.id, 1e6);
  tick(channel, 0.5);
  assert.equal(world.battleView(), null);
  assert.equal(hero.self()?.downed?.help, false, "nobody standing: nobody can raise the hero");
  assert.ok(!hero.toasts.some((text) => text.startsWith("사경")), hero.toasts.join(" / "));
});

// ── Demo entries: a cold open plays the steps before its entry with 건너뛰기 ──

interface ColdOpen {
  save: PlayerSave;
  logs: string[];
  channel: Channel;
}

/** Cold-opens `chapter` as a demo whose ChapterDef.demoStart is `step`, as the offline build does (8 ◇ companions). */
function coldOpen(chapter: ChapterId, step: string, demoPath: DemoPath, bots = 8): ColdOpen {
  const def = { ...CONTENT.chapters[chapter], demoStart: step };
  const content: ContentIndex = { ...CONTENT, chapters: { ...CONTENT.chapters, [chapter]: def } };
  const logs: string[] = [];
  const channel = new Channel({ content, map, seed: "jangsaeng", mode: "offline", botsPerChannel: bots, nextId: () => nextId++, log: () => {} }, def, 1, true);
  const save = createSave(content, { token: "c".repeat(32), name: "한결", variant: "m", origin: "northeast", seed: 5, demoChapter: chapter, demoPath });
  const session = new Session(nextId++, save.token, save, () => {}, { content, map, mode: "offline", save: () => {}, relocate: () => {}, log: (line) => logs.push(line) });
  channel.add(session);
  return { save: session.save, logs, channel };
}

/** The objectives of a step a save must have done to stand past it: the required ones its path shows. */
const owed = (chapter: ChapterId, index: number, save: PlayerSave) =>
  (CONTENT.chapters[chapter].steps[index]?.objectives ?? []).filter((objective) => !objective.optional && evalCond(CONTENT, save, objective.requires));

test("the 1904 demo (ch16 s8) cold-opens on both paths with every earlier step played", () => {
  const steps = CONTENT.chapters.ch16.steps;
  const entry = steps.findIndex((step) => step.id === "s8");
  assert.equal(CONTENT.chapters.ch16.demoStart, "s8");
  for (const demoPath of ["history", "reform"] as const) {
    const { save, logs, channel } = coldOpen("ch16", "s8", demoPath);
    assert.equal(save.step, entry, `${demoPath}: the demo stands at s8`);
    assert.deepEqual(logs, [], `${demoPath}: the entry was reached`);
    assert.equal(channel.world.battleView(), null, `${demoPath}: no battle is left running`);
    // Standing at s8 means every earlier step's objectives were met; what they leave behind is there too.
    for (let index = 0; index < entry; index++)
      for (const objective of owed("ch16", index, save)) {
        const where = `${demoPath}: ${steps[index]?.id} ${objective.id}`;
        if (objective.kind === "battle") assert.ok(save.battlesWon.includes(objective.target ?? ""), `${where}: ${objective.target} was won`);
        const card = objective.kind === "prompt" ? objective.target : objective.prompt;
        if (card) assert.ok(save.promptsDone.includes(card), `${where}: card ${card} was answered`);
      }
  }
});

test("every step of every chapter can open a demo, on both paths", () => {
  // A step the path shows no objective of is played past, as in play.
  const problems: string[] = [];
  for (const chapter of CHAPTER_IDS) {
    const steps = CONTENT.chapters[chapter].steps;
    for (const demoPath of ["history", "reform"] as const)
      for (let entry = 1; entry < steps.length; entry++) {
        const where = `${demoPath} ${chapter}/${steps[entry]?.id}`;
        const { save, logs, channel } = coldOpen(chapter, steps[entry]?.id ?? "", demoPath, 0);
        if (logs.length || save.step < entry) problems.push(`${where}: stopped at ${steps[save.step]?.id} ${logs.join(" ")}`);
        for (let index = entry; index < save.step; index++)
          if (owed(chapter, index, save).length) problems.push(`${where}: played past ${steps[index]?.id}, which it shows objectives of`);
        if (channel.world.battleView()) problems.push(`${where}: ${channel.world.battleView()?.id} left running`);
      }
  }
  assert.deepEqual(problems, []);
});
