// End-to-end host tests: a scripted client drives the authoritative host
// through character creation, chapters, the passage of years and the ending.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTER_IDS, type ChapterId } from "../../src/shared/content/schema.ts";
import type { HostConnection, ProfileStore } from "../../src/shared/host/api.ts";
import { createGameHost } from "../../src/shared/host/host.ts";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../../src/shared/protocol.ts";
import type { PlayerSave, PromptView, SelfView } from "../../src/shared/types.ts";

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
  token = "";
  errors: string[] = [];
  ending = false;
  connection: HostConnection | null = null;

  receive(message: ServerMsg): void {
    this.messages.push(message);
    if (message.t === "prompt") this.prompt = message.prompt;
    if (message.t === "self") this.self = message.self;
    if (message.t === "enter") this.chapters.push(message.chapter.id);
    if (message.t === "welcome") this.token = message.token;
    if (message.t === "error") this.errors.push(`${message.code}: ${message.message}`);
    if (message.t === "ending") this.ending = true;
  }

  send(message: ClientMsg): void {
    // Round-trip through JSON like a real socket.
    this.connection?.receive(JSON.parse(JSON.stringify(message)));
  }
}

function setup(store = new MemoryStore()) {
  let now = 0;
  const host = createGameHost({
    seed: "jangsaeng",
    mode: "offline",
    store,
    clock: { now: () => now },
    botsPerChannel: 4,
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

/** Answers prompts (first enabled option or the default years plan) and demo-skips otherwise. */
function autoplay(client: ScriptedClient, advance: (ms: number) => void, maxRounds: number): void {
  for (let round = 0; round < maxRounds && !client.ending; round++) {
    const prompt = client.prompt;
    if (prompt) {
      if (prompt.kind === "years") {
        const plan = prompt.data?.type === "years" ? prompt.data : null;
        const activity = plan?.activities.find((candidate) => !candidate.disabled)?.id ?? "martial";
        client.send({ t: "years", prompt: prompt.id, activities: Array(plan?.tokens ?? 1).fill(activity), offer: true });
      } else {
        const option = prompt.options.find((candidate) => !candidate.disabled) ?? prompt.options[0];
        if (option) client.send({ t: "choose", prompt: prompt.id, option: option.id });
      }
      client.prompt = null;
    } else client.send({ t: "action", action: { kind: "demoSkip" } });
    advance(200);
  }
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
