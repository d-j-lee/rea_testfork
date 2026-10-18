// Player-facing text conventions: one narrative voice, one dialogue format,
// labelled history notes, and markers that come from data rather than copy.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS, CONTENT } from "../../src/shared/content/index.ts";
import { HISTORY_NOTE_KINDS, type Cond, type Effect, type HistoryNote } from "../../src/shared/content/schema.ts";

const chapters = Object.values(CHAPTERS);

/** Every table the player reads text from. */
const PLAYER_TABLES = {
  chapters: CHAPTERS,
  endings: CONTENT.endings,
  companions: CONTENT.companions,
  enemies: CONTENT.enemies,
  items: CONTENT.items,
  skills: { ...CONTENT.skills, longevity: CONTENT.longevity },
  origins: CONTENT.origins,
  offices: CONTENT.offices,
};

/** Every string value under `value` with a path, for whole-table scans. */
function* strings(value: unknown, path: string): Generator<[string, string]> {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) yield* strings(item, `${path}[${index}]`);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) yield* strings(item, `${path}.${key}`);
}

function* walk(effects: readonly Effect[] | undefined): Generator<Effect> {
  for (const effect of effects ?? []) {
    yield effect;
    if (effect.k === "check") yield* walk([...effect.success, ...effect.failure]);
    if (effect.k === "if") yield* walk([...effect.then, ...(effect.else ?? [])]);
  }
}

/**
 * Lines the narrator speaks: briefings, step narration, cards without a
 * speaker, parenthesised narration inside a speaker's card, objectives,
 * toasts and 실록 lines.
 */
function* narration(): Generator<[string, string]> {
  for (const chapter of chapters) {
    for (const line of chapter.briefing) yield [`${chapter.id} briefing`, line];
    for (const prompt of chapter.prompts) {
      for (const line of prompt.body) {
        // In a speaker's card only the parenthesised part is narration.
        const told = prompt.speaker ? (line.match(/\([^)]*\)/g) ?? []).join(" ") : line;
        if (told) yield [`${chapter.id} ${prompt.id}`, told];
      }
      for (const option of prompt.options)
        for (const effect of walk(option.effects))
          if (effect.k === "toast" || effect.k === "chronicle") yield [`${chapter.id} ${prompt.id}.${option.id}`, effect.text];
    }
    for (const step of chapter.steps) {
      for (const line of step.narration ?? []) yield [`${chapter.id} ${step.id}`, line];
      for (const objective of step.objectives) yield [`${chapter.id} ${objective.id}`, objective.text];
    }
  }
  for (const ending of [...Object.values(CONTENT.endings.nation), ...Object.values(CONTENT.endings.personal)])
    for (const line of ending.body) yield [`ending ${ending.id}`, line];
}

/** 너/네가 addressing the player; '네 가지', '네 번' are numerals and stay. */
const INFORMAL_YOU = /(^|[^가-힣])(너(는|를|의|에게|도|와|만)?|네가)(?=[^가-힣]|$)/;

test("the narrator calls the player 당신 in every chapter", () => {
  // Quoted speech ('…') inside narration may use any register.
  const offenders = [...narration()].filter(([, line]) => INFORMAL_YOU.test(line.replace(/'[^']*'/g, "")));
  assert.deepEqual(offenders, []);
});

test("dialogue carries no double quotes: speech is marked by the speaker, embedded speech by '…'", () => {
  const offenders = [...strings(PLAYER_TABLES, "content")].filter(([, text]) => text.includes('"'));
  assert.deepEqual(offenders, []);
});

/** A particle or ending that only continues a sentence: a '(' before one split a sentence in two. */
const PAREN_MID_SENTENCE = /\((는|을|를|라는|이라는|라고|이라고|라며|하고|하며|며)(?=[\s,.!?…']|$)/;

test("parenthesised narration starts a sentence, never mid-sentence", () => {
  // ch05_policy once read '…장사하게 해 달라 (는 청이다. …)': the request turned into the speaker's own words.
  const offenders = [...strings(PLAYER_TABLES, "content")].filter(([, text]) => PAREN_MID_SENTENCE.test(text));
  assert.deepEqual(offenders, []);
});

/** A kind written into copy: history-note kinds and the 대체역사 marker. */
const LABEL = /\[(게임 속 )?(대체역사|사실|해석|불확실|창작|원칙)\]/;

test("no player-facing string carries a bracket label: kinds and the 대체역사 tag are data", () => {
  // Note kinds are HistoryNote.kind; the 대체역사 tag comes from BattleDef.alt (banner and
  // objective tracker) and ChronicleEntry.alt; a counterfactual card says '실제 역사에서' in words.
  const offenders = [...strings(PLAYER_TABLES, "content")].filter(([, text]) => /^\s*\[/.test(text) || LABEL.test(text));
  assert.deepEqual(offenders, []);
});

/** A won branch is required (directly or inside `all`); `not` turns it into the historical path. */
function needsWonBranch(cond: Cond | undefined): boolean {
  if (!cond) return false;
  if (cond.k === "branch") return cond.ok !== false;
  if (cond.k === "all") return cond.of.some(needsWonBranch);
  return false;
}

test("a counterfactual history card sets the record beside the scene ('실제 역사에서 …')", () => {
  let cards = 0;
  for (const chapter of chapters) {
    const counterfactual = new Set<string>();
    for (const step of chapter.steps)
      for (const objective of step.objectives)
        if (objective.kind === "prompt" && objective.target && needsWonBranch(objective.requires)) counterfactual.add(objective.target);
    for (const battle of chapter.battles)
      if (battle.alt) for (const effect of walk(battle.victory)) if (effect.k === "prompt") counterfactual.add(effect.prompt);
    for (const prompt of chapter.prompts) {
      if (!counterfactual.has(prompt.id) || prompt.style !== "history") continue;
      cards++;
      assert.ok(prompt.body.some((line) => /^\(?실제 역사에서/.test(line)), `${chapter.id} ${prompt.id} '${prompt.title}' states what really happened`);
    }
  }
  assert.ok(cards >= 10, `found ${cards} counterfactual cards`);
});

test("history notes carry their kind as data, one statement kind per line", () => {
  const notes: [string, HistoryNote][] = [
    ...chapters.flatMap((chapter) => chapter.history.map((note): [string, HistoryNote] => [chapter.id, note])),
    ...CONTENT.endings.historyNote.map((note): [string, HistoryNote] => ["ending", note]),
  ];
  // Labels written into the text are caught with every other string below.
  for (const [where, note] of notes)
    assert.ok((HISTORY_NOTE_KINDS as readonly string[]).includes(note.kind), `${where}: kind ${note.kind}`);
  for (const chapter of chapters) assert.ok(chapter.history.some((note) => note.kind === "fact"), `${chapter.id} has facts`);
  // The fixed disclaimer has one owner (client/ui/title.ts DISCLAIMER); the ending note does not repeat it.
  assert.ok(!CONTENT.endings.historyNote.some((note) => note.text.includes("대체역사 픽션입니다")));
});

test("a chapter's year range has one owner: subtitles carry no years", () => {
  for (const chapter of chapters) assert.doesNotMatch(chapter.subtitle, /\d{4}/, chapter.id);
});

test("fiction markers come from data, not from names", () => {
  for (const chapter of chapters) {
    for (const npc of chapter.npcs) assert.doesNotMatch(npc.name, /\((가상|기록상)\)/, `${chapter.id} ${npc.id}`);
    for (const prompt of chapter.prompts)
      if (prompt.speaker) assert.doesNotMatch(prompt.speaker.name, /\((가상|기록상)\)/, `${chapter.id} ${prompt.id}`);
    for (const battle of chapter.battles)
      if (battle.boss) assert.doesNotMatch(`${battle.boss.title ?? ""} ${battle.boss.name}`, /가상|기록상/, `${chapter.id} ${battle.id}`);
  }
});

test("objective text is device-neutral; controls and the optional marker are fields", () => {
  for (const chapter of chapters)
    for (const step of chapter.steps)
      for (const objective of step.objectives) {
        const where = `${chapter.id} ${objective.id}`;
        assert.doesNotMatch(objective.text, /【|WASD|Shift|Space|우클릭|패드/, `${where}: key names belong in hint`);
        assert.ok(!objective.text.startsWith("(선택)"), `${where}: optional is ObjectiveDef.optional`);
      }
  const taught = new Set(chapters.flatMap((chapter) => chapter.steps.flatMap((step) => step.objectives.flatMap((objective) => objective.hint ?? []))));
  assert.deepEqual([...taught].sort(), ["attack", "bow", "interact", "move", "roll", "skill"], "the tutorial teaches every control");
});
