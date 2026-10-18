// Player-facing text conventions: one narrative voice, one dialogue format,
// labelled history notes, and markers that come from data rather than copy.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS, CONTENT } from "../../src/shared/content/index.ts";
import { HISTORY_NOTE_KINDS, type Effect, type HistoryNote } from "../../src/shared/content/schema.ts";

const chapters = Object.values(CHAPTERS);

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
  const tables = { chapters: CHAPTERS, endings: CONTENT.endings, companions: CONTENT.companions, items: CONTENT.items, skills: CONTENT.skills };
  const offenders = [...strings(tables, "content")].filter(([, text]) => text.includes('"'));
  assert.deepEqual(offenders, []);
});

test("history notes carry their kind as data, one statement kind per line", () => {
  const notes: [string, HistoryNote][] = [
    ...chapters.flatMap((chapter) => chapter.history.map((note): [string, HistoryNote] => [chapter.id, note])),
    ...CONTENT.endings.historyNote.map((note): [string, HistoryNote] => ["ending", note]),
  ];
  for (const [where, note] of notes) {
    assert.ok((HISTORY_NOTE_KINDS as readonly string[]).includes(note.kind), `${where}: kind ${note.kind}`);
    assert.ok(!note.text.startsWith("["), `${where}: label prefix in '${note.text}'`);
    assert.doesNotMatch(note.text, /\[(사실|해석|불확실|창작|원칙)\]/, `${where}: inline label in '${note.text}'`);
  }
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
