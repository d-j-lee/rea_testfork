// End-to-end host tests: a scripted client drives the authoritative host
// through character creation, chapters, the passage of years and the ending.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT, type ContentIndex } from "../../src/shared/content/index.ts";
import { CHAPTER_IDS, type ChapterId, type PromptDef, type WashMethod } from "../../src/shared/content/schema.ts";
import type { HostConnection, HostMode, ProfileStore } from "../../src/shared/host/api.ts";
import { Channel } from "../../src/shared/host/channel.ts";
import { createGameHost } from "../../src/shared/host/host.ts";
import { parseClientMsg } from "../../src/shared/host/parse.ts";
import { Session } from "../../src/shared/host/session.ts";
import { generateMap, type GameMap } from "../../src/shared/map/generate.ts";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../../src/shared/protocol.ts";
import {
  bondName,
  computeEnding,
  createSave,
  growSuspicion,
  hashRoll,
  nationValue,
} from "../../src/shared/rules/index.ts";
import type { EndingView, PlayerSave, PromptView, SelfView } from "../../src/shared/types.ts";

class MemoryStore implements ProfileStore {
  readonly profiles = new Map<string, PlayerSave>();
  load(token: string): PlayerSave | null {
    const save = this.profiles.get(token);
    return save ? structuredClone(save) : null;
  }
  save(token: string, save: PlayerSave): void {
    this.profiles.set(token, structuredClone(save));
  }
}

class ScriptedClient {
  readonly messages: ServerMsg[] = [];
  prompt: PromptView | null = null;
  self: SelfView | null = null;
  chapters: ChapterId[] = [];
  channels: string[] = [];
  token = "";
  errors: string[] = [];
  toasts: string[] = [];
  endings: EndingView[] = [];
  ending = false;
  connection: HostConnection | null = null;

  receive(message: ServerMsg): void {
    this.messages.push(message);
    if (message.t === "prompt") this.prompt = message.prompt;
    if (message.t === "self") this.self = message.self;
    if (message.t === "enter") {
      this.chapters.push(message.chapter.id);
      this.channels.push(message.channel);
    }
    if (message.t === "welcome") this.token = message.token;
    if (message.t === "error") this.errors.push(`${message.code}: ${message.message}`);
    if (message.t === "toast") this.toasts.push(message.text);
    if (message.t === "ending") {
      this.ending = true;
      this.endings.push(message.ending);
    }
  }

  send(message: ClientMsg): void {
    // Round-trip through JSON like a real socket.
    this.connection?.receive(JSON.parse(JSON.stringify(message)));
  }

  /** Prompts shown so far, in order. */
  prompts(): PromptView[] {
    return this.messages.flatMap((message) => (message.t === "prompt" && message.prompt ? [message.prompt] : []));
  }
}

function setup(store = new MemoryStore(), mode: HostMode = "offline", botsPerChannel = 4) {
  let now = 0;
  const host = createGameHost({
    seed: "jangsaeng",
    mode,
    store,
    clock: { now: () => now },
    botsPerChannel,
  });
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      now += 50;
      host.tick(now);
    }
  };
  const connect = () => {
    const client = new ScriptedClient();
    client.connection = host.connect((message) => client.receive(message));
    return client;
  };
  return { host, store, advance, connect };
}

function hello(client: ScriptedClient, extra: Partial<Extract<ClientMsg, { t: "hello" }>> = {}): void {
  client.send({ t: "hello", v: PROTOCOL_VERSION, name: "한결", variant: "m", origin: "northeast", ...extra });
}

/** Answers the open prompt: `option` if offered, else the first enabled one; the years card with the suggested plan. */
function answer(client: ScriptedClient, option?: string): void {
  const prompt = client.prompt;
  if (!prompt) return;
  // The host answers synchronously with the next card (or none), so clear first.
  client.prompt = null;
  if (prompt.kind === "years") {
    const plan = prompt.data?.type === "years" ? prompt.data : null;
    client.send({ t: "years", prompt: prompt.id, activities: plan?.suggested.activities ?? [], offer: plan?.suggested.offer ?? false });
  } else {
    const enabled = prompt.options.filter((candidate) => !candidate.disabled);
    const choice = enabled.find((candidate) => candidate.id === option) ?? enabled[0] ?? prompt.options[0];
    if (choice) client.send({ t: "choose", prompt: prompt.id, option: choice.id });
  }
}

/** Answers prompts (first enabled option or the suggested years plan) and demo-skips otherwise. */
function autoplay(client: ScriptedClient, advance: (ms: number) => void, maxRounds: number): void {
  playUntil(client, advance, () => client.ending, maxRounds);
}

/** autoplay until `done()` holds; returns whether it did. */
function playUntil(client: ScriptedClient, advance: (ms: number) => void, done: () => boolean, maxRounds: number): boolean {
  for (let round = 0; round < maxRounds; round++) {
    if (done()) return true;
    if (client.prompt) answer(client);
    else client.send({ t: "action", action: { kind: "demoSkip" } });
    advance(200);
  }
  return done();
}

/** Closes the connection and opens a new one with the same token (a tab refresh or reconnect). */
function reload(client: ScriptedClient, connect: () => ScriptedClient, advance: (ms: number) => void): ScriptedClient {
  client.connection?.close("reload");
  const next = connect();
  hello(next, { token: client.token });
  advance(300);
  return next;
}

test("rejects malformed messages and requires hello first", () => {
  const { connect, advance } = setup();
  const client = connect();
  client.connection?.receive({ t: "teleport", x: 1, y: 1 });
  client.connection?.receive({ t: "choose", prompt: 5, option: null });
  client.connection?.receive("not an object");
  // Lenient numbers are clamped rather than rejected; still needs hello.
  client.connection?.receive({ t: "input", mx: "fast" });
  client.connection?.receive({ t: "chat", text: "안녕" });
  advance(100);
  assert.ok(client.errors.some((error) => error.startsWith("bad_message")));
  assert.ok(client.errors.some((error) => error.startsWith("hello_required")));
  hello(client, { name: "!" });
  assert.ok(client.errors.some((error) => error.startsWith("name")));
});

test("a new character enters chapter 1 with companions and a self view", () => {
  const { connect, advance, host } = setup();
  const client = connect();
  hello(client);
  advance(1000);
  assert.ok(client.token.match(/^[0-9a-f]{32}$/));
  assert.deepEqual(client.chapters, ["ch01"]);
  assert.ok(client.self, "self view sent");
  assert.equal(client.self?.chapter.id, "ch01");
  assert.ok(client.messages.some((message) => message.t === "snap" && message.ents.length > 0));
  assert.ok(host.stats().bots > 0, "companions joined");
  assert.ok(client.messages.some((message) => message.t === "roster"));
});

test("resuming a token restores the character and kicks the old connection", () => {
  const { connect, advance, store } = setup();
  const first = connect();
  hello(first);
  advance(500);
  const second = connect();
  hello(second, { token: first.token });
  advance(500);
  assert.ok(first.errors.some((error) => error.startsWith("replaced")));
  assert.ok(second.messages.some((message) => message.t === "welcome" && message.resumed));
  assert.ok(store.profiles.has(first.token));
});

for (const chapter of CHAPTER_IDS) {
  test(`demo mode completes ${chapter} and moves on`, () => {
    const { connect, advance } = setup();
    const client = connect();
    hello(client, { demo: chapter });
    advance(500);
    assert.equal(client.chapters[0], chapter);
    autoplay(client, advance, 400);
    const next = CHAPTER_IDS[CHAPTER_IDS.indexOf(chapter) + 1];
    if (next) assert.ok(client.chapters.includes(next), `${chapter} → ${next} (saw ${client.chapters.join(",")})`);
    else assert.ok(client.ending, "ending after the last chapter");
    assert.deepEqual(client.errors, []);
  });
}

test("the full 500-year arc reaches an ending", () => {
  const { connect, advance, store } = setup();
  const client = connect();
  hello(client, { demo: "ch01" });
  advance(500);
  autoplay(client, advance, 6000);
  assert.ok(client.ending, `ending reached (chapters: ${client.chapters.join(",")})`);
  assert.deepEqual(client.chapters, [...CHAPTER_IDS]);
  const save = store.profiles.get(client.token);
  assert.ok(save?.ending);
  assert.ok(save.year >= 1896, `final year ${save.year}`);
});

test("a choice's result card keeps the year the choice was made", () => {
  const { connect, advance } = setup();
  const client = connect();
  hello(client, { demo: "ch15" });
  advance(500);
  autoplay(client, advance, 400);
  // Results follow the card they resolve, even when the choice moved the story on.
  const prompts = client.messages.flatMap((message) => (message.t === "prompt" && message.prompt ? [message.prompt] : []));
  let checked = 0;
  prompts.forEach((prompt, index) => {
    const before = prompts[index - 1];
    if (prompt.kind !== "result" || !before || before.title !== prompt.title) return;
    assert.equal(prompt.year, before.year, `${prompt.title}: result year`);
    checked++;
  });
  assert.ok(checked > 5, `checked ${checked} result cards`);
});

test("the demo path decides where CH16 can lead", () => {
  const endings: Record<string, string> = {};
  for (const demoPath of ["history", "reform"] as const) {
    const { connect, advance } = setup();
    const client = connect();
    let nation = "";
    const receive = client.receive.bind(client);
    client.receive = (message) => {
      if (message.t === "ending") nation = message.ending.nation.id;
      receive(message);
    };
    hello(client, { demo: "ch16", demoPath });
    advance(500);
    autoplay(client, advance, 400);
    endings[demoPath] = nation;
  }
  assert.deepEqual(endings, { history: "N3", reform: "N1" });
});

// ── Card queue, reloads and settlement ────────────────────────────────────

/** The stored save for a token (the store keeps what the session last persisted). */
function stored(store: MemoryStore, token: string): PlayerSave {
  const save = store.profiles.get(token);
  assert.ok(save, `profile ${token} stored`);
  return save;
}

test("a battle a choice starts waits until every card in front of it is read", () => {
  const { connect, advance } = setup();
  const client = connect();
  hello(client, { demo: "ch04" });
  advance(500);
  assert.ok(playUntil(client, advance, () => client.prompt?.id === "ch04_side", 400), "the 1398 choice opens");
  answer(client, "bangwon");
  advance(300);
  let cards = 0;
  for (; client.prompt && cards < 20; cards++) {
    advance(1500); // the presenter reads the card
    assert.equal(client.self?.battle, undefined, `no battle runs behind 「${client.prompt?.title}」`);
    answer(client);
    advance(300);
  }
  assert.ok(cards >= 1, "the choice showed its result card");
  advance(500);
  assert.equal(client.self?.battle?.id, "ch04_night", "the battle starts once the cards are read");
  assert.ok((client.self?.battle?.timeLeft ?? 0) >= 55, `the full timer is left (${client.self?.battle?.timeLeft})`);
});

test("a 사사 escape card survives a reload", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch04" });
  advance(300);
  let seed = 1;
  while (hashRoll(seed, "ch04_mooin") >= 5) seed++;
  client.connection?.close("reseed");
  stored(store, client.token).seed = seed;
  client = reload(client, connect, advance);
  assert.ok(playUntil(client, advance, () => client.prompt?.id === "ch04_side", 400), "the 1398 choice opens");
  answer(client, "dojeon");
  advance(300);
  assert.ok(playUntil(client, advance, () => client.prompt?.kind === "death", 10), "the death sentence raises the escape card");
  client = reload(client, connect, advance);
  assert.equal(client.prompt?.kind, "death", "the escape card is shown again after the reload");
  answer(client);
  advance(300);
  assert.equal(client.prompt?.title, "사사의 밤", "and resolves as before");
  assert.ok(!stored(store, client.token).pending.some((entry) => entry.kind === "escape"), "the save owes it no more");
});

test("the 사헌부 card stands while flag inquiry does, also after a reload", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch03" });
  advance(300);
  client.connection?.close("flag");
  stored(store, client.token).flags["inquiry"] = true;
  client = reload(client, connect, advance);
  assert.ok(client.prompts().some((prompt) => prompt.title === "사헌부의 조사"), "the inquiry card is raised on resume");
});

test("an in-chapter year jump into the 조사 band raises the 사헌부 card in that chapter", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch12" });
  advance(300);
  const [first, second] = CONTENT.chapters.ch12.steps;
  assert.ok(first && second && second.year > first.year, "ch12 moves years between its first steps");
  client.connection?.close("tune");
  const save = stored(store, client.token);
  // A suspicion that lands in the middle of the 조사 band after the jump.
  let tuned = -1;
  for (let value = 0; value <= 90 && tuned < 0; value += 0.5) {
    const probe = structuredClone(save);
    probe.suspicion = value;
    growSuspicion(probe, first.year, second.year);
    if (probe.suspicion >= 76 && probe.suspicion < 84) tuned = value;
  }
  assert.ok(tuned >= 0, "a starting suspicion exists for the band");
  save.suspicion = tuned;
  client = reload(client, connect, advance);
  playUntil(client, advance, () => client.chapters.includes("ch13") || client.prompt?.title === "사헌부의 조사", 400);
  assert.equal(client.prompt?.title, "사헌부의 조사", "the card comes inside ch12, not a chapter later");
  assert.equal(stored(store, client.token).chapter, "ch12");
});

test("reloading at the years card neither repeats the chronicle nor loses the card", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch02" });
  advance(300);
  assert.ok(playUntil(client, advance, () => client.prompt?.kind === "years", 400), "the years card opens");
  const lived = `「${CONTENT.chapters.ch02.title}」의 시대를 살아냈다.`;
  const count = () => stored(store, client.token).chronicle.filter((entry) => entry.text === lived).length;
  assert.equal(count(), 1);
  for (let round = 1; round <= 3; round++) {
    client = reload(client, connect, advance);
    assert.equal(client.prompt?.kind, "years", `the years card is back after reload ${round}`);
    assert.equal(count(), 1, `still one chronicle line after reload ${round}`);
  }
});

test("the years plan goes to the rules as sent: they own the fallback for an unknown activity", () => {
  const { connect, advance } = setup();
  const client = connect();
  hello(client, { demo: "ch01" });
  advance(300);
  assert.ok(playUntil(client, advance, () => client.prompt?.kind === "years", 400), "the years card opens");
  const prompt = client.prompt;
  assert.ok(prompt);
  client.send({ t: "years", prompt: prompt.id, activities: ["martial"], offer: false });
  advance(300);
  const result = client.prompt?.data?.type === "result" ? client.prompt.data.lines.map((entry) => entry.text) : [];
  assert.ok(result.some((text) => text.includes("알 수 없는 활동") && text.includes("무예 수련")), result.join(" / "));
});

test("the ending is settled once, its numbers agree, and a reload cannot change the run", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch16" });
  advance(500);
  autoplay(client, advance, 400);
  advance(500);
  assert.equal(client.endings.length, 1, "one ending message");
  const view = client.endings[0] as EndingView;
  const charged = /침투도 (\d+)/.exec(view.breakdown.find((row) => row.label.startsWith("침투도"))?.label ?? "");
  assert.equal(view.nationValues.infiltration, Number(charged?.[1]), "the bar shows the infiltration the score charged");
  assert.ok(view.branches.every((branch) => typeof branch.ok === "boolean"), "every branch is settled for 1910");
  const total = view.breakdown.reduce((sum, row) => sum + row.value, 0);
  assert.ok(Math.abs(total - view.score) < 0.011, `rows ${total} add up to the score ${view.score}`);
  const lived = `「${CONTENT.chapters.ch16.title}」의 시대를 살아냈다.`;
  assert.equal(stored(store, client.token).chronicle.filter((entry) => entry.text === lived).length, 1);

  client.connection?.close("points");
  stored(store, client.token).freePoints = 3;
  client = reload(client, connect, advance);
  assert.equal(client.endings.length, 1, "the resumed run shows its ending");
  const before = structuredClone(stored(store, client.token));
  client.send({ t: "action", action: { kind: "allocate", stat: "power" } });
  client.send({ t: "action", action: { kind: "demoSkip" } });
  advance(300);
  const after = stored(store, client.token);
  assert.equal(after.freePoints, before.freePoints);
  assert.deepEqual(after.stats, before.stats);
  assert.deepEqual(after.ending, before.ending);
});

test("the HUD shows infiltration through the rules' own value", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch14" });
  advance(300);
  client.connection?.close("branch");
  // Decided without its effect: the weight is not inside save.infiltration yet.
  stored(store, client.token).branches.B4 = false;
  client = reload(client, connect, advance);
  advance(500);
  assert.equal(client.self?.nation.infiltration, nationValue(stored(store, client.token), "infiltration"));
  assert.ok((client.self?.nation.infiltration ?? 0) >= 15, "the failed B4 counts");
});

test("bond names have one owner", () => {
  const { connect, advance } = setup();
  const client = connect();
  hello(client, { demo: "ch05" });
  advance(800);
  const house = client.self?.bonds.find((bond) => bond.id === "han_house");
  assert.ok(house, "the preset has the han house bond");
  assert.equal(house.name, bondName(CONTENT, "han_house"));
});

test("노인성 일섬 refuses a mortal successor", () => {
  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch09" });
  advance(300);
  client.connection?.close("successor");
  const save = stored(store, client.token);
  save.identity = { ...save.identity, kind: "successor" };
  client = reload(client, connect, advance);
  assert.ok(playUntil(client, advance, () => client.prompt === null, 20), "no card is open");
  const press = (skill: number, seq: number) =>
    client.send({ t: "input", seq, mx: 0, my: 0, attack: false, shoot: false, dodge: false, skill, interact: false });
  press(5, 1);
  advance(300);
  press(0, 2);
  advance(300);
  const strike = client.self?.skills.find((skill) => skill.id === CONTENT.longevity.id);
  assert.equal(strike?.ready, 0, "the strike never fired");
  assert.equal(stored(store, client.token).longevityUses, 0);
  assert.ok(client.toasts.some((text) => text.includes("계승자")), client.toasts.join(" / "));
});

// ── Channels: who shares a world, and what a demo skip may touch ──────────

test("online: a channel-mate further on does not take the NPC a trailing player still needs", () => {
  const { connect, advance, store } = setup(new MemoryStore(), "online", 0);
  const chapter = CONTENT.chapters.ch01;
  const talk = chapter.steps[0]?.objectives.find((objective) => objective.kind === "talk");
  const npc = chapter.npcs.find((candidate) => candidate.id === talk?.target);
  assert.ok(npc?.untilStep, "ch01's first talk NPC leaves after its step");
  const later = chapter.steps.findIndex((step) => step.id === npc.untilStep) + 1;
  assert.ok(later > 0 && later < chapter.steps.length);
  const slow = connect();
  hello(slow, { name: "느린사람" });
  advance(300);
  /** Entity ids the trailing player currently sees, by name. */
  const seen = () => {
    const present = new Map<number, string>();
    for (const message of slow.messages) {
      if (message.t !== "snap") continue;
      for (const entity of message.ents) if (entity.n) present.set(entity.id, entity.n);
      for (const id of message.gone) present.delete(id);
    }
    return present;
  };
  const target = [...seen()].find(([, name]) => name === npc.name)?.[0];
  assert.ok(target !== undefined, `${npc.name} stands in the trailing player's world`);
  let fast = connect();
  hello(fast, { name: "빠른사람" });
  advance(300);
  fast.connection?.close("ahead");
  const ahead = stored(store, fast.token);
  ahead.step = later;
  ahead.objectives = {};
  fast = reload(fast, connect, advance);
  advance(1000);
  assert.equal(fast.channels.at(-1), slow.channels.at(-1), "both stand in the same channel");
  assert.equal(stored(store, fast.token).step, later);
  assert.ok(seen().has(target), `the first step's ${npc.name} is still there for the trailing player`);
});

test("demo characters never share a channel with real saves", () => {
  const { connect, advance } = setup();
  const real = connect();
  hello(real, { name: "실제인물" });
  advance(300);
  const demo = connect();
  hello(demo, { name: "시연인물", demo: "ch01" });
  advance(300);
  assert.notEqual(demo.channels.at(-1), real.channels.at(-1));
  assert.match(demo.channels.at(-1) ?? "", /시연/);
});

test("a demo skip wins a battle only for the player who pressed it", () => {
  const { connect, advance, store } = setup();
  const presenter = connect();
  hello(presenter, { name: "시연자", demo: "ch01" });
  advance(300);
  const bystander = connect();
  hello(bystander, { name: "구경꾼", demo: "ch01" });
  advance(300);
  assert.equal(bystander.channels.at(-1), presenter.channels.at(-1), "both demos share the demo shard");
  const won = () => stored(store, presenter.token).battlesWon.length > 0;
  assert.ok(playUntil(presenter, advance, won, 600), "the presenter wins a battle");
  assert.deepEqual(stored(store, bystander.token).battlesWon, [], "the bystander won nothing");
});

test("demo skip carries the presenter into each battle, which starts in view before it is won", () => {
  const { connect, advance, store } = setup();
  const client = connect();
  hello(client, { demo: "ch10" });
  advance(500);
  playUntil(client, advance, () => client.chapters.includes("ch11"), 600);
  const save = stored(store, client.token);
  const won = CONTENT.chapters.ch10.battles.filter((battle) => save.battlesWon.includes(battle.id));
  assert.ok(won.length > 0, "ch10 battles were won");
  for (const battle of won) {
    const started = client.toasts.includes(battle.subtitle ? `${battle.title} — ${battle.subtitle}` : battle.title);
    assert.ok(started, `${battle.title} started before it was won`);
  }
});

// ── Sessions wired by hand: the channel's hooks, called directly ──────────

let sharedMap: GameMap | null = null;
const testMap = (): GameMap => (sharedMap ??= generateMap("jangsaeng"));
let handIds = 5_000;

interface Hand {
  session: Session;
  messages: ServerMsg[];
  /** The save as the session last persisted it. */
  stored: () => PlayerSave;
}

/** A channel for `chapter` of `content`, without companions unless asked. */
function handChannel(content: ContentIndex, chapter: ChapterId, demo = false, botsPerChannel = 0): Channel {
  return new Channel(
    { content, map: testMap(), seed: "jangsaeng", mode: "offline", botsPerChannel, nextId: () => handIds++, log: () => {} },
    content.chapters[chapter],
    1,
    demo,
  );
}

/** A session for `save` in `channel`; it begins at once. */
function handSession(channel: Channel, content: ContentIndex, save: PlayerSave): Hand {
  const messages: ServerMsg[] = [];
  let last = structuredClone(save);
  const session = new Session(handIds++, save.token, save, (message) => messages.push(message), {
    content,
    map: testMap(),
    mode: "offline",
    save: (_token, data) => {
      last = structuredClone(data);
    },
    relocate: () => {},
    log: () => {},
  });
  channel.add(session);
  return { session, messages, stored: () => last };
}

const handPrompts = (hand: Hand): PromptView[] =>
  hand.messages.flatMap((message) => (message.t === "prompt" && message.prompt ? [message.prompt] : []));

/** The card the client has open: the last prompt message (null once the queue drained). */
function openCard(hand: Hand): PromptView | null {
  for (let index = hand.messages.length - 1; index >= 0; index--) {
    const message = hand.messages[index];
    if (message?.t === "prompt") return message.prompt;
  }
  return null;
}

const press = (hand: Hand): void => hand.session.receive({ t: "action", action: { kind: "demoSkip" } });

/** Answers the open card with its first enabled option, as a player would. */
function answerOpen(hand: Hand): void {
  const card = openCard(hand);
  const option = card?.options.find((candidate) => !candidate.disabled);
  if (card && option) hand.session.receive({ t: "choose", prompt: card.id, option: option.id });
}

function demoSave(content: ContentIndex, chapter: ChapterId, seed: number, demoPath: "history" | "reform" = "history", token = "a".repeat(32)): PlayerSave {
  return createSave(content, { token, name: "한결", variant: "m", origin: "northeast", seed, demoChapter: chapter, demoPath });
}

/** CONTENT with `chapter`'s demo entry set to `step`, or removed. */
function withDemoStart(chapter: ChapterId, step: string | undefined): ContentIndex {
  const def = { ...CONTENT.chapters[chapter] };
  if (step === undefined) delete def.demoStart;
  else def.demoStart = step;
  return { ...CONTENT, chapters: { ...CONTENT.chapters, [chapter]: def } };
}

test("ChapterDef.demoStart: the demo opens at that step, the steps before it played by the session's own 건너뛰기", () => {
  let sentenced = 1;
  while (hashRoll(sentenced, "ch07_gapja") >= 3) sentenced++;
  const cases: [ChapterId, string, "history" | "reform", number][] = [
    ["ch16", "s8", "history", 5],
    ["ch16", "s8", "reform", 5],
    ["ch07", "s4", "history", 2],
    ["ch07", "s4", "history", sentenced],
  ];
  for (const [chapter, step, demoPath, seed] of cases) {
    const where = `${chapter}/${step} ${demoPath} seed ${seed}`;
    const steps = CONTENT.chapters[chapter].steps;
    const entry = steps.findIndex((candidate) => candidate.id === step);
    assert.ok(entry > 0, where);
    const skippedCards = new Set(
      steps.slice(0, entry).flatMap((def) => def.objectives.flatMap((objective) => [objective.prompt, objective.kind === "prompt" ? objective.target : undefined])),
    );

    const opened = withDemoStart(chapter, step);
    const cold = handSession(handChannel(opened, chapter, true), opened, demoSave(opened, chapter, seed, demoPath));
    assert.equal(cold.session.save.step, entry, `${where}: the demo stands at its entry step`);
    assert.equal(cold.session.save.demoEntry, undefined, `${where}: the entry is played once`);
    assert.ok(cold.session.save.promptsDone.length > 0, `${where}: the earlier cards were answered`);
    const shown = handPrompts(cold);
    assert.ok(shown.every((card) => !skippedCards.has(card.id)), `${where}: no card of a skipped step reaches the presenter (${shown.map((card) => card.id)})`);
    assert.ok(shown.every((card) => (card.year ?? 0) >= (steps[entry]?.year ?? 0)), `${where}: nothing older than the entry step is shown (${shown.map((card) => `${card.title} ${card.year}`)})`);

    // The same presenter pressing 건너뛰기 from the first step.
    const plain = withDemoStart(chapter, undefined);
    const live = handSession(handChannel(plain, chapter, true), plain, demoSave(plain, chapter, seed, demoPath));
    assert.equal(live.session.save.step, 0);
    const over = (hand: Hand) => hand.session.save.ending !== undefined || openCard(hand)?.kind === "years";
    for (let round = 0; round < 3000 && !over(cold); round++) press(cold);
    for (let round = 0; round < 3000 && !over(live); round++) press(live);
    assert.ok(over(cold) && over(live), `${where}: both reach the end of the chapter`);
    const comparable = (save: PlayerSave) => {
      const copy = structuredClone(save);
      delete copy.position;
      copy.chronicle = copy.chronicle.filter((line) => !line.text.includes("시연 모드"));
      return copy;
    };
    assert.deepEqual(comparable(cold.session.save), comparable(live.session.save), `${where}: the cold open leaves exactly what skipping from the first step does`);
  }
});

/** CONTENT whose ch01 opens with a card that both raises another card and passes a death sentence. */
function withDoubleCard(): ContentIndex {
  const ch01 = CONTENT.chapters.ch01;
  const double: PromptDef = {
    id: "t_double",
    title: "두 갈래 소식",
    body: ["역참에서 서신 두 통이 한꺼번에 닿았다."],
    options: [{
      id: "ok",
      text: "둘 다 받는다",
      effects: [
        { k: "prompt", prompt: "t_after" },
        { k: "purge", spec: { id: "t_doom", intensity: 200, winner: null, loser: null } },
      ],
    }],
  };
  const after: PromptDef = {
    id: "t_after",
    title: "뒤늦은 서신",
    body: ["먼저 온 소식보다 늦게 읽힌 편지."],
    options: [{ id: "ok", text: "읽는다", effects: [{ k: "chronicle", text: "뒤늦은 서신을 읽었다." }] }],
  };
  const first = ch01.steps[0];
  assert.ok(first);
  const opening = { id: "t0", year: first.year, objectives: [{ id: "t_o", text: "소식을 받는다", kind: "prompt" as const, target: "t_double" }] };
  return { ...CONTENT, chapters: { ...CONTENT.chapters, ch01: { ...ch01, prompts: [...ch01.prompts, double, after], steps: [opening, ...ch01.steps] } } };
}

test("an effect that raises a card and a 사사 sentence: the escape comes first, live and after a reload", () => {
  const content = withDoubleCard();
  let seed = 1;
  while (hashRoll(seed, "t_doom") > 50) seed++;
  const save = createSave(content, { token: "d".repeat(32), name: "한결", variant: "m", origin: "northeast", seed });
  const live = handSession(handChannel(content, "ch01"), content, save);
  assert.equal(openCard(live)?.id, "t_double");
  answerOpen(live);
  assert.equal(openCard(live)?.kind, "death", "the death sentence comes before anything else");
  assert.deepEqual(live.session.save.pending.map((entry) => entry.kind), ["escape", "prompt"], "the save owes both, in that order");

  // A reload at the escape card: the same order.
  const reloaded = handSession(handChannel(content, "ch01"), content, structuredClone(live.stored()));
  assert.equal(openCard(reloaded)?.kind, "death", "the escape card is in front after the reload");
  answerOpen(reloaded);
  assert.equal(openCard(reloaded)?.title, "사사의 밤", "its result");
  answerOpen(reloaded);
  assert.equal(openCard(reloaded)?.id, "t_after", "then the card the same effect raised");
  assert.deepEqual(reloaded.session.save.pending, [{ kind: "prompt", id: "t_after" }]);
  answerOpen(reloaded);
  assert.deepEqual(reloaded.session.save.pending, [], "answered cards are no longer owed");
});

test("a settled run takes nothing more from the world: a battle ending beside it, kills, pickups, revives", () => {
  const def = CONTENT.chapters.ch16.battles.find((battle) => battle.kind === "defend");
  assert.ok(def);
  const channel = handChannel(CONTENT, "ch16", true);
  const save = demoSave(CONTENT, "ch16", 5);
  save.ending = computeEnding(CONTENT, save);
  const settled = handSession(channel, CONTENT, save);
  assert.ok(settled.messages.some((message) => message.t === "ending"));
  const fighter = handSession(channel, CONTENT, demoSave(CONTENT, "ch16", 6, "history", "b".repeat(32)));
  const before = structuredClone(settled.session.save);
  assert.ok(channel.startBattle(def.id, fighter.session, true), "the other player's battle starts");
  const centre = channel.world.arenaOf(def.id);
  assert.ok(centre);
  channel.world.teleport(settled.session.id, centre.x, centre.y);
  channel.world.endBattle("victory");
  for (let tick = 0; tick < 10; tick++) channel.tick(0.05);
  assert.ok(fighter.session.save.battlesWon.includes(def.id), "the battle was won beside the settled player");
  const enemy = Object.values(CONTENT.enemies)[0];
  assert.ok(enemy);
  settled.session.onKill(enemy, 30, true);
  settled.session.onPickup("ginseng");
  settled.session.onRevived(null);
  settled.session.onRevivedOther();
  settled.session.onLongevity();
  settled.session.onWorldEventComplete("늦은 실록");
  settled.session.onBattleEnd(def, "defeat", 1);
  const npc = CONTENT.chapters.ch16.npcs[0];
  if (npc) settled.session.onTalk(npc.id);
  const after = structuredClone(settled.session.save);
  delete before.position;
  delete after.position;
  assert.deepEqual(after, before, "the settled save is unchanged");
});

test("onBattleEnd: battleResult owns first-victory rewards, and a held field's 공덕 +30 is shown", () => {
  const def = CONTENT.chapters.ch16.battles.find((battle) => battle.kind === "defend" || battle.kind === "survive");
  assert.ok(def);
  const hand = handSession(handChannel(CONTENT, "ch16", true), CONTENT, demoSave(CONTENT, "ch16", 5));
  const virtue = hand.session.save.points.virtue;
  hand.session.onBattleEnd(def, "victory", 0);
  const toasts = () => hand.messages.flatMap((message) => (message.t === "toast" ? [message.text] : []));
  assert.ok(toasts().includes("지켜 낸 싸움 — 공덕 +30"), toasts().join(" / "));
  assert.ok(hand.session.save.points.virtue >= virtue + 30);
  const once = structuredClone(hand.session.save);
  hand.session.onBattleEnd(def, "victory", 0);
  assert.equal(toasts().filter((text) => text === "지켜 낸 싸움 — 공덕 +30").length, 1, "a repeat victory pays nothing");
  assert.deepEqual(hand.session.save.points, once.points);
  assert.deepEqual(hand.session.save.battlesWon, once.battlesWon);
});

test("the years card: the plan heads the era and names the wash, the body only the next era, and the last grace waits for the player", () => {
  for (const grace of [false, true]) {
    const save = demoSave(CONTENT, "ch12", 5);
    save.lifeEnd = 1850;
    save.points.virtue = 350;
    const hand = handSession(handChannel(CONTENT, "ch12", true), CONTENT, save);
    for (let round = 0; round < 600 && openCard(hand)?.kind !== "years"; round++) press(hand);
    const card = openCard(hand);
    assert.equal(card?.kind, "years");
    const plan = card?.data?.type === "years" ? card.data : null;
    assert.ok(card && plan);
    assert.equal(plan.graceYears, 10, "CH13 starts in 1776: the grace is on offer");
    assert.equal(plan.summary, `${plan.eraFrom}~${plan.eraTo}년, 이 시대를 어떻게 보냈나 · ${plan.tokens}마디`);
    assert.match(plan.suggestedName ?? "", /^[가-힣]{3,4}$/, "the wash's name comes as its own field");
    assert.deepEqual(card.body, [`다음 시대: ${CONTENT.chapters.ch13.title} — ${CONTENT.chapters.ch13.subtitle}`], "the heading states the era; no name rides in the text");
    if (grace) {
      const message = { t: "years" as const, prompt: card.id, activities: plan.suggested.activities, offer: plan.suggested.offer, grace: true };
      hand.session.receive(message);
    } else press(hand); // a plain confirm: the suggested plan
    assert.equal(hand.session.save.chapter, "ch13");
    assert.equal(hand.session.save.graceUsed, grace, grace ? "taken when asked for" : "never spent by the suggested plan");
    assert.equal(hand.session.save.points.virtue === 0, grace, "only the grace takes all 공덕");
  }
});

test("the years plan as a client sends it: the last grace and the suggested name reach the rules", () => {
  const parsedGrace = (grace: unknown) => {
    const message = parseClientMsg({ t: "years", prompt: "y", activities: [], offer: false, grace });
    return message?.t === "years" ? message.grace : undefined;
  };
  assert.deepEqual([parsedGrace(true), parsedGrace("yes"), parsedGrace(undefined)], [true, false, false]);

  const { connect, advance, store } = setup();
  let client = connect();
  hello(client, { demo: "ch12" });
  advance(300);
  client.connection?.close("set up");
  const before = stored(store, client.token);
  before.lifeEnd = 1850;
  before.points.virtue = 350;
  before.points.money = 5000;
  client = reload(client, connect, advance);
  assert.ok(playUntil(client, advance, () => client.prompt?.kind === "years", 600), "the years card opens");
  const card = client.prompt;
  const plan = card?.data?.type === "years" ? card.data : null;
  assert.ok(card && plan);
  assert.equal(plan.graceYears, 10, "the planner offers the grace");
  const wash = plan.washes.find((candidate) => !candidate.disabled);
  assert.ok(wash && plan.suggestedName, "a wash is open and the plan names it");
  // The planner as shipped: the grace switch on, a wash with the name field left as it was.
  client.prompt = null;
  client.send({ t: "years", prompt: card.id, activities: plan.suggested.activities, offer: plan.suggested.offer, grace: true, wash: wash.id as WashMethod });
  advance(300);
  const after = stored(store, client.token);
  assert.equal(after.chapter, "ch13");
  assert.equal(after.graceUsed, true, "the grace the player turned on is taken");
  assert.equal(after.name, plan.suggestedName, "the wash takes the name the planner showed");
});

test("emotes spend the chat budget like chat lines", () => {
  const { connect, advance } = setup();
  const client = connect();
  hello(client);
  advance(300);
  const said = () => client.messages.filter((message) => message.t === "chat" && message.kind === "player" && message.from === "한결").length;
  const emote = () => client.send({ t: "action", action: { kind: "emote", emote: "bow" } });
  for (let burst = 0; burst < 4; burst++) emote();
  client.send({ t: "chat", text: "안녕" });
  assert.equal(said(), 3, "three lines in a burst, chat or emote");
  assert.ok(client.toasts.includes("채팅이 너무 빠르다."), client.toasts.join(" / "));
  advance(1600);
  emote();
  assert.equal(said(), 4, "the budget refills over time");
});

test("공덕 for reviving (+8, 10 per chapter) and for a completed 공동 실록 (+40, twice per chapter)", () => {
  const channel = handChannel(CONTENT, "ch01");
  const save = createSave(CONTENT, { token: "f".repeat(32), name: "한결", variant: "m", origin: "northeast", seed: 7 });
  const hand = handSession(channel, CONTENT, save);
  const toasts = () => hand.messages.flatMap((message) => (message.t === "toast" ? [message.text] : []));
  const start = save.points.virtue;
  for (let revive = 0; revive < 11; revive++) hand.session.onRevivedOther();
  assert.equal(save.record.revivesGiven, 11);
  assert.equal(save.points.virtue, start + 80, "8 each, 10 times this chapter");
  channel.addWorldEvent(Number.MAX_SAFE_INTEGER);
  assert.equal(save.points.virtue, start + 120, "the completed 공동 실록 pays 40");
  assert.equal(save.flags["zeitgeist"], 1);
  assert.ok(toasts().some((text) => text.includes("시대정신 +1 · 공덕 +40")), toasts().join(" / "));
  hand.session.onWorldEventComplete("다시 채운 실록");
  hand.session.onWorldEventComplete("세 번째 실록");
  assert.equal(save.points.virtue, start + 160, "twice per chapter");
  assert.equal(save.flags["zeitgeist"], 1, "시대정신 once per chapter");
  assert.ok(toasts().at(-1)?.endsWith("「세 번째 실록」 달성"), "nothing granted, nothing claimed");
});
