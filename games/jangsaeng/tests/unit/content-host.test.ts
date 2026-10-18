// How the host presents content-declared tone: solemn objectives (history
// cards, tragedies, the 1910 finale) are no achievements, and a history
// card's result is a record rather than a second card under the event's name.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS } from "../../src/shared/content/index.ts";
import type { ChapterId } from "../../src/shared/content/schema.ts";
import { createGameHost } from "../../src/shared/host/host.ts";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../../src/shared/protocol.ts";
import type { PlayerSave, PromptView } from "../../src/shared/types.ts";

interface Run {
  toasts: string[];
  sfx: string[];
  prompts: PromptView[];
}

/** Plays a demo chapter with first choices and demo skips until the next chapter or the ending. */
function playDemo(chapter: ChapterId): Run {
  let now = 0;
  const saves = new Map<string, PlayerSave>();
  const host = createGameHost({
    seed: "jangsaeng",
    mode: "offline",
    store: { load: (token) => saves.get(token) ?? null, save: (token, save) => void saves.set(token, structuredClone(save)) },
    clock: { now: () => now },
    botsPerChannel: 2,
  });
  const run: Run = { toasts: [], sfx: [], prompts: [] };
  const inbox: { prompt: PromptView | null; entered: number; ended: boolean } = { prompt: null, entered: 0, ended: false };
  const connection = host.connect((message: ServerMsg) => {
    if (message.t === "prompt") {
      inbox.prompt = message.prompt;
      if (message.prompt) run.prompts.push(message.prompt);
    }
    if (message.t === "toast") run.toasts.push(message.text);
    if (message.t === "fx") for (const fx of message.fx) if (fx.k === "sfx" && fx.sfx) run.sfx.push(fx.sfx);
    if (message.t === "enter") inbox.entered++;
    if (message.t === "ending") inbox.ended = true;
  });
  const send = (message: ClientMsg) => connection.receive(JSON.parse(JSON.stringify(message)));
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) host.tick((now += 50));
  };
  send({ t: "hello", v: PROTOCOL_VERSION, name: "한결", variant: "m", origin: "northeast", demo: chapter, demoPath: "history" });
  advance(500);
  for (let round = 0; round < 600 && inbox.entered < 2 && !inbox.ended; round++) {
    const open = inbox.prompt;
    inbox.prompt = null;
    if (open === null) send({ t: "action", action: { kind: "demoSkip" } });
    else if (open.kind === "years") {
      const plan = open.data?.type === "years" ? open.data : null;
      send({ t: "years", prompt: open.id, activities: plan?.suggested.activities ?? [], offer: plan?.suggested.offer ?? false });
    } else {
      const choice = open.options.find((candidate) => !candidate.disabled) ?? open.options[0];
      if (choice) send({ t: "choose", prompt: open.id, option: choice.id });
    }
    advance(200);
  }
  assert.ok(inbox.entered >= 2 || inbox.ended, `${chapter} demo finished`);
  return run;
}

for (const chapter of ["ch11", "ch15", "ch16"] as const) {
  test(`${chapter}: solemn objectives end without the '목표 달성' toast, history results are titled 기록`, () => {
    const def = CHAPTERS[chapter];
    const run = playDemo(chapter);
    const solemn = def.steps.flatMap((step) => step.objectives).filter((objective) => objective.solemn);
    assert.ok(solemn.length > 0);
    for (const objective of solemn)
      assert.ok(!run.toasts.includes(`목표 달성 — ${objective.text}`), `${objective.id}: '${objective.text}' was announced`);
    const announced = run.toasts.filter((toast) => toast.startsWith("목표 달성 — ")).length;
    assert.ok(announced > 0, "ordinary objectives are still announced");
    assert.equal(run.sfx.filter((sfx) => sfx === "quest").length, announced, "the quest sound plays only with the toast");

    const historyTitles = new Set(def.prompts.filter((prompt) => prompt.style === "history").map((prompt) => prompt.title));
    const results = run.prompts.filter((prompt) => prompt.kind === "result");
    for (const result of results) assert.ok(!historyTitles.has(result.title), `result card reuses '${result.title}'`);
  });
}

test("a two-choice history card's result is a 기록 card (ch11 소현세자)", () => {
  const run = playDemo("ch11");
  const sohyeon = CHAPTERS.ch11.prompts.find((prompt) => prompt.id === "p_sohyeon");
  assert.equal(sohyeon?.style, "history");
  const index = run.prompts.findIndex((prompt) => prompt.id === "p_sohyeon");
  assert.ok(index >= 0, "the card was shown");
  const next = run.prompts.slice(index + 1).find((prompt) => prompt.kind === "result");
  assert.equal(next?.title, "기록");
});
