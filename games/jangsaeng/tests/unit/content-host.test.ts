// How the host and HUD present content-declared tone: solemn objectives
// (history cards, tragedies, the 1910 finale) are no achievements, a history
// card's result is a record rather than a second card under the event's name,
// and counterfactual battles carry the 대체역사 tag from BattleDef.alt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectiveCues } from "../../src/client/ui/objective-cues.ts";
import { CHAPTERS } from "../../src/shared/content/index.ts";
import type { ChapterId } from "../../src/shared/content/schema.ts";
import { createGameHost } from "../../src/shared/host/host.ts";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../../src/shared/protocol.ts";
import type { DemoPath, PlayerSave, PromptView, SelfView } from "../../src/shared/types.ts";

interface Run {
  toasts: string[];
  sfx: string[];
  prompts: PromptView[];
  /** Every SelfView the host sent, in order: what the HUD saw. */
  selves: SelfView[];
}

const runs = new Map<string, Run>();

/** One demo run per chapter and path, shared by the tests that read it. */
function playDemo(chapter: ChapterId, demoPath: DemoPath = "history"): Run {
  const key = `${chapter}:${demoPath}`;
  const known = runs.get(key);
  if (known) return known;
  const run = runDemo(chapter, demoPath);
  runs.set(key, run);
  return run;
}

/** Plays a demo chapter with first choices and demo skips until the next chapter or the ending. */
function runDemo(chapter: ChapterId, demoPath: DemoPath): Run {
  let now = 0;
  const saves = new Map<string, PlayerSave>();
  const host = createGameHost({
    seed: "jangsaeng",
    mode: "offline",
    store: { load: (token) => saves.get(token) ?? null, save: (token, save) => void saves.set(token, structuredClone(save)) },
    clock: { now: () => now },
    botsPerChannel: 2,
  });
  const run: Run = { toasts: [], sfx: [], prompts: [], selves: [] };
  const inbox: { prompt: PromptView | null; entered: number; ended: boolean } = { prompt: null, entered: 0, ended: false };
  const connection = host.connect((message: ServerMsg) => {
    if (message.t === "prompt") {
      inbox.prompt = message.prompt;
      if (message.prompt) run.prompts.push(message.prompt);
    }
    if (message.t === "toast") run.toasts.push(message.text);
    if (message.t === "self") run.selves.push(message.self);
    if (message.t === "fx") for (const fx of message.fx) if (fx.k === "sfx" && fx.sfx) run.sfx.push(fx.sfx);
    if (message.t === "enter") inbox.entered++;
    if (message.t === "ending") inbox.ended = true;
  });
  const send = (message: ClientMsg) => connection.receive(JSON.parse(JSON.stringify(message)));
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) host.tick((now += 50));
  };
  send({ t: "hello", v: PROTOCOL_VERSION, name: "한결", variant: "m", origin: "northeast", demo: chapter, demoPath });
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

test("the HUD plays its completion sound for achievements only, not for solemn objectives", () => {
  let solemnOnly = 0;
  let achieved = 0;
  for (const chapter of ["ch11", "ch15", "ch16"] as const) {
    const solemn = new Set(CHAPTERS[chapter].steps.flatMap((step) => step.objectives).filter((objective) => objective.solemn).map((objective) => objective.id));
    const cues = new ObjectiveCues();
    let done = new Map<string, boolean>();
    for (const self of playDemo(chapter).selves) {
      const finished = self.objectives.filter((objective) => done.get(objective.id) === false && objective.done);
      const cue = cues.next(self.objectives);
      done = new Map(self.objectives.map((objective) => [objective.id, objective.done]));
      if (finished.length === 0) continue;
      const names = finished.map((objective) => objective.id).join(", ");
      if (finished.every((objective) => solemn.has(objective.id))) {
        solemnOnly++;
        assert.notEqual(cue, "quest_done", `${chapter}: ${names} is no achievement`);
      } else {
        achieved++;
        assert.equal(cue, "quest_done", `${chapter}: ${names}`);
      }
    }
  }
  // e.g. ch15 s7: the 갑신정변 card ends while 톈진조약 is still to do.
  assert.ok(solemnOnly > 0, "a solemn objective finished beside one still open");
  assert.ok(achieved > 0, "ordinary objectives still sound");
});

test("counterfactual battles are tagged 대체역사 from BattleDef.alt, on the banner and the objective (ch16 reform path)", () => {
  const def = CHAPTERS.ch16;
  const alt = new Set(def.battles.filter((battle) => battle.alt).map((battle) => battle.id));
  const battleOf = new Map(def.steps.flatMap((step) => step.objectives).flatMap((objective) => (objective.kind === "battle" && objective.target ? [[objective.id, objective.target] as const] : [])));
  const seen = { objectives: new Set<string>(), battles: new Set<string>() };
  for (const self of playDemo("ch16", "reform").selves) {
    for (const objective of self.objectives) {
      const battle = battleOf.get(objective.id);
      assert.equal(objective.alt === true, battle !== undefined && alt.has(battle), `objective ${objective.id}`);
      if (objective.alt) seen.objectives.add(objective.id);
    }
    if (self.battle) {
      assert.equal(self.battle.alt === true, alt.has(self.battle.id), `battle ${self.battle.id}`);
      if (self.battle.alt) seen.battles.add(self.battle.id);
    }
  }
  assert.ok(seen.objectives.size > 0, "an alt battle objective was shown");
  assert.ok(seen.battles.size > 0, `an alt battle was fought (objectives: ${[...seen.objectives].join(", ")})`);
});
