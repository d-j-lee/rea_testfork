// New characters, demo presets for every chapter, and untrusted-save migration.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT, type ContentIndex } from "../../src/shared/content/index.ts";
import { BRANCH_IDS, CHAPTER_IDS, NATION_KEYS, STAT_KEYS, type BranchId, type ChapterId, type Cond, type Effect } from "../../src/shared/content/schema.ts";
import {
  BRANCH_CHAPTER,
  BRANCH_LABELS,
  closeChapterBranches,
  createSave,
  evalCond,
  finalInfiltration,
  heroSprite,
  longFlagSum,
  migrateSave,
  nationValue,
  REFORM_DRIFT,
  skillsUnlockedBy,
} from "../../src/shared/rules/index.ts";
import { SAVE_VERSION, type PlayerSave } from "../../src/shared/types.ts";
import { FIXTURE, newSave } from "./rules-fixture.ts";

const statTotal = (save: PlayerSave) => STAT_KEYS.reduce((sum, stat) => sum + save.stats[stat], 0);
const roundTrip = (save: PlayerSave) => migrateSave(FIXTURE, JSON.parse(JSON.stringify(save)));

test("createSave builds a fresh 1361 hero", () => {
  const save = newSave({ origin: "southcoast", variant: "f", name: "  윤소  " });
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.name, "윤소");
  assert.equal(save.birthName, "윤소");
  assert.equal(save.variant, "f");
  assert.equal(save.level, 1);
  assert.deepEqual(save.stats, { power: 5, agility: 8, body: 5, spirit: 5, wit: 5, tact: 8 });
  assert.deepEqual(save.points, { money: 50, merit: 0, virtue: 50, fame: 0, honor: 0 });
  assert.equal(save.chapter, "ch01");
  assert.equal(save.step, 0);
  assert.equal(save.year, 1361);
  assert.equal(save.lifeEnd, 1861);
  assert.equal(save.suspicion, 0);
  assert.deepEqual(save.identity, { kind: "birth", startYear: 1361, startAge: 16 });
  assert.deepEqual(save.identities, [{ name: "윤소", kind: "birth", from: 1361 }]);
  assert.deepEqual(save.equipment, { weapon: "rusty_hwando", armor: "cotton_clothes" });
  assert.deepEqual(save.skills, ["dash_slash", "whirlwind", "war_cry"]);
  assert.deepEqual(save.skillSlots, ["dash_slash", "whirlwind", "war_cry"]);
  assert.deepEqual(save.nation, FIXTURE.chapters.ch01.hist);
  assert.equal(save.demo, false);
  assert.equal(save.chronicle.length, 1);
  assert.equal(save.chronicle[0]?.year, 1361);
  assert.equal(save.record.washes, 0);
  assert.deepEqual(newSave({ origin: "northeast" }).favor, { yi: 10 });
  assert.deepEqual(newSave({ origin: "kaesong" }).favor, { choe: 10 });
});

const EARLIER_THAN_CH16: readonly BranchId[] = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];

test("the history demo path records earlier branches as failed, so the HUD shows what the ending charges", () => {
  const history = newSave({ demoChapter: "ch16" });
  assert.deepEqual(Object.keys(history.branches).sort(), [...EARLIER_THAN_CH16].sort());
  assert.ok(Object.values(history.branches).every((ok) => ok === false));
  assert.deepEqual(history.nation, FIXTURE.chapters.ch16.hist);
  assert.equal(history.infiltration, 15 + 10 + 8 + 20, "B4 + B5 + B6 + B8 weights");
  assert.equal(nationValue(history, "infiltration"), history.infiltration, "the stored meter is the whole story");
  // Once CH16's own branches are decided (here: all failed), the stored meter is the ending's.
  closeChapterBranches(history, "ch16");
  assert.equal(history.infiltration, 100);
  assert.equal(finalInfiltration(history), history.infiltration);

  assert.deepEqual(newSave({ demoChapter: "ch14" }).branches, { B1: false, B2: false });
  assert.equal(newSave({ demoChapter: "ch14" }).infiltration, 0, "B1 and B2 carry no infiltration");
  assert.deepEqual(newSave({ demoChapter: "ch13" }).branches, {}, "nothing is decided before CH13");
});

test("closeChapterBranches fails only the chapter's undecided branches", () => {
  const save = newSave();
  save.branches.B9 = true;
  closeChapterBranches(save, "ch16");
  assert.deepEqual(save.branches, { B9: true, B10: false, B11: false, B12a: false, B12b: false, B12c: false });
  assert.equal(save.infiltration, 7 + 15 + 7 + 10, "B10 + B11 + B12a + B12b");
  closeChapterBranches(save, "ch16");
  assert.equal(save.infiltration, 39, "closing twice adds nothing");
  closeChapterBranches(save, "ch01");
  assert.equal(Object.keys(save.branches).length, 6, "a chapter without branches changes nothing");
});

const reformSave = (chapter: ChapterId) =>
  createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: chapter, demoPath: "reform" });

test("the reform demo path starts from a well-played history", () => {
  const reform = reformSave("ch16");
  assert.deepEqual(Object.keys(reform.branches).sort(), [...EARLIER_THAN_CH16].sort());
  assert.ok(Object.values(reform.branches).every(Boolean));
  assert.equal(reform.infiltration, 0, "won branches add no infiltration");
  assert.equal(reform.flags["ch15_geojung"], true);
  assert.equal(reform.flags["ch12_jeonggye_record"], true, "CH16's 1909 간도 option reads the 정계비 record");
  assert.equal(reform.flags["ch12_vow_seson"], true, "CH13's oath reads the 세손 vow");
  assert.equal(reform.flags["ch14_pay_gap_noted"], true, "CH15's B5 audit reads the 체불 장부");
  for (const key of NATION_KEYS)
    assert.equal(reform.nation[key], CONTENT.chapters.ch16.hist[key] + REFORM_DRIFT + longFlagSum(reform, key), key);
  assert.equal(reform.longFlags["jangyongyeong"]?.add, 8, "the 연판장's +8, not the 외영's +5");
  assert.match(reform.chronicle.at(-1)?.text ?? "", /개혁 누적/);

  // Only what earlier chapters could have won.
  const ch14 = reformSave("ch14");
  assert.deepEqual(Object.keys(ch14.branches).sort(), ["B1", "B2"]);
  assert.equal(ch14.flags["ch14_pay_gap_noted"], undefined, "CH14's own story is still ahead");
  assert.equal(reformSave("ch12").flags["ch12_jeonggye_record"], undefined);
});

/** Every node of a content value (chapters are plain data), depth first. */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* nodes(item);
  else if (value && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const inner of Object.values(value)) yield* nodes(inner);
  }
}

test("reform path: every long flag the earlier chapters offer, at its best value — read from content, never copied", () => {
  for (const chapter of ["ch03", "ch09", "ch14", "ch16"] as const) {
    const expected: Record<string, { key: string; add: number }> = {};
    for (const earlier of CHAPTER_IDS.slice(0, CHAPTER_IDS.indexOf(chapter))) {
      for (const node of nodes(CONTENT.chapters[earlier])) {
        if (node.k !== "longFlag" || typeof node.flag !== "string" || typeof node.add !== "number") continue;
        const known = expected[node.flag];
        if (!known || node.add > known.add) expected[node.flag] = { key: String(node.key), add: node.add };
      }
    }
    assert.deepEqual(reformSave(chapter).longFlags, expected, chapter);
  }
  assert.ok(Object.keys(reformSave("ch16").longFlags).length >= 12, "the shipped long flags reach CH16");
});

test("reform path: every story flag a later chapter reads from an earlier one holds the value the read rewards", () => {
  /** Flags each chapter's effects write, and the flag conditions it reads. */
  const writes = new Map<ChapterId, Set<string>>();
  const reads: { chapter: ChapterId; flag: string; cond: Cond }[] = [];
  for (const id of CHAPTER_IDS) {
    const written = new Set<string>();
    const visit = (value: unknown, inCond: boolean): void => {
      if (Array.isArray(value)) for (const item of value) visit(item, inCond);
      else if (value && typeof value === "object") {
        const node = value as Record<string, unknown>;
        if (node.k === "flag" && typeof node.flag === "string") {
          if (inCond) reads.push({ chapter: id, flag: node.flag, cond: node as unknown as Cond });
          else written.add(node.flag);
        }
        for (const [key, inner] of Object.entries(node)) visit(inner, inCond || key === "requires" || key === "cond");
      }
    };
    visit(CONTENT.chapters[id], false);
    writes.set(id, written);
  }
  let checked = 0;
  for (const read of reads) {
    if (writes.get(read.chapter)?.has(read.flag)) continue;
    const from = CHAPTER_IDS.filter((id) => CHAPTER_IDS.indexOf(id) < CHAPTER_IDS.indexOf(read.chapter) && writes.get(id)?.has(read.flag));
    if (from.length === 0) continue;
    assert.ok(evalCond(CONTENT, reformSave(read.chapter), read.cond), `${read.chapter} reads ${read.flag} (${from.join(", ")})`);
    assert.ok(!evalCond(CONTENT, reformSave(from[0] as ChapterId), read.cond), `${read.flag} is not set before ${from[0]} is played`);
    checked++;
  }
  assert.ok(checked >= 7, `checked ${checked} cross-chapter reads`);
});

/** Every branch (or opened prompt) effect reachable from an effect list. */
function reachable(effects: readonly Effect[], into: { branches: BranchId[]; prompts: string[] }) {
  for (const effect of effects) {
    if (effect.k === "branch") into.branches.push(effect.id);
    if (effect.k === "prompt") into.prompts.push(effect.prompt);
    if (effect.k === "check") reachable([...effect.success, ...effect.failure], into);
    if (effect.k === "if") reachable([...effect.then, ...(effect.else ?? [])], into);
  }
  return into;
}
const branchesIn = (effects: readonly Effect[]) => reachable(effects, { branches: [], prompts: [] }).branches;

test("BRANCH_CHAPTER and BRANCH_LABELS match the steps that decide each branch", () => {
  const decidedIn = new Map<BranchId, Set<ChapterId>>();
  const decidedYears = new Map<BranchId, Set<number>>();
  for (const id of CHAPTER_IDS) {
    const chapter = CONTENT.chapters[id];
    // Cards that decide a branch, directly or through the cards they open.
    const deciding = new Map<string, Set<BranchId>>();
    for (const prompt of chapter.prompts)
      deciding.set(prompt.id, new Set(prompt.options.flatMap((option) => branchesIn(option.effects))));
    for (let changed = true; changed; ) {
      changed = false;
      for (const prompt of chapter.prompts) {
        const own = deciding.get(prompt.id) as Set<BranchId>;
        const opened = prompt.options.flatMap((option) => reachable(option.effects, { branches: [], prompts: [] }).prompts);
        for (const branch of opened.flatMap((other) => [...(deciding.get(other) ?? [])]))
          if (!own.has(branch)) changed = Boolean(own.add(branch));
      }
    }
    const byBattle = new Map(chapter.battles.map((battle) => [battle.id, branchesIn([...battle.victory, ...battle.defeat])]));
    for (const branch of [...deciding.values()].flatMap((set) => [...set]).concat([...byBattle.values()].flat()))
      decidedIn.set(branch, (decidedIn.get(branch) ?? new Set<ChapterId>()).add(id));
    for (const step of chapter.steps) {
      const branches = [
        ...branchesIn(step.onEnter ?? []),
        ...step.objectives.flatMap((objective) => [
          ...branchesIn(objective.onComplete ?? []),
          ...(objective.prompt ? [...(deciding.get(objective.prompt) ?? [])] : []),
          ...(objective.target ? [...(deciding.get(objective.target) ?? []), ...(byBattle.get(objective.target) ?? [])] : []),
        ]),
      ];
      for (const branch of branches) decidedYears.set(branch, (decidedYears.get(branch) ?? new Set<number>()).add(step.year));
    }
  }
  for (const branch of BRANCH_IDS) {
    assert.deepEqual([...(decidedIn.get(branch) ?? [])], [BRANCH_CHAPTER[branch]], branch);
    // The label's year (or range) covers the year of the step that decides it.
    const match = /\((\d{4})(?:~(\d{2,4}))?\)/.exec(BRANCH_LABELS[branch]);
    assert.ok(match?.[1], `${branch}: ${BRANCH_LABELS[branch]}`);
    const [, start, end] = match;
    const from = Number(start);
    const to = end ? Number(end.length === 2 ? start.slice(0, 2) + end : end) : from;
    const years = [...(decidedYears.get(branch) ?? [])];
    assert.ok(years.length > 0 && years.some((year) => year >= from && year <= to), `${branch} ${BRANCH_LABELS[branch]} vs steps ${years}`);
  }
});

/** Shipped content with a demo entry step for one chapter (the real value is the content's call). */
function withDemoStart(chapter: ChapterId, step: string): ContentIndex {
  return { ...CONTENT, chapters: { ...CONTENT.chapters, [chapter]: { ...CONTENT.chapters[chapter], demoStart: step } } };
}

test("ChapterDef.demoStart: the preset starts the chapter like any entry and names the step for the session", () => {
  const content = withDemoStart("ch16", "s8");
  for (const demoPath of ["history", "reform"] as const) {
    const save = createSave(content, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch16", demoPath });
    assert.equal(save.demoEntry, "s8", demoPath);
    assert.deepEqual([save.step, save.year, save.suspicion], [0, 1896, 15], `${demoPath}: nothing of the chapter is played yet`);
    assert.deepEqual(save.promptsDone, [], demoPath);
    assert.equal(save.branches.B9, undefined, `${demoPath}: the session's 건너뛰기 decides B9`);
    assert.match(save.chronicle.at(-1)?.text ?? "", /1896년, 1904년 장면부터/, demoPath);
    assert.deepEqual(migrateSave(content, JSON.parse(JSON.stringify(save))), save, `${demoPath}: migrate round-trip`);
  }
  const first = CONTENT.chapters.ch05.steps[0]?.id ?? "";
  const presetOf = (step: string) =>
    createSave(withDemoStart("ch05", step), { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch05" });
  assert.equal(presetOf(first).demoEntry, undefined, "the first step needs no skipping");
  assert.equal(presetOf("nope").demoEntry, undefined, "an unknown step is not an entry");
  const raw = JSON.parse(JSON.stringify(createSave(content, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch16" })));
  assert.equal(migrateSave(content, { ...raw, demoEntry: "s99" })?.demoEntry, undefined, "a step the chapter lacks is dropped");
  assert.equal(migrateSave(content, { ...raw, demo: false })?.demoEntry, undefined, "only a demo has an entry");
});

test("migrateSave keeps the pending story in order and drops what the chapter does not hold", () => {
  const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch04" });
  const prompt = CONTENT.chapters.ch04.prompts[1]?.id ?? "";
  const battle = CONTENT.chapters.ch04.battles[0]?.id ?? "";
  save.pending = [{ kind: "escape", id: "ch04:1398" }, { kind: "prompt", id: prompt }, { kind: "battle", id: battle }];
  assert.deepEqual(migrateSave(CONTENT, JSON.parse(JSON.stringify(save)))?.pending, save.pending);
  const raw = JSON.parse(JSON.stringify(save));
  raw.pending = [
    { kind: "prompt", id: prompt },
    { kind: "prompt", id: prompt },
    { kind: "prompt", id: "ch09_elsewhere" },
    { kind: "battle", id: "b_nowhere" },
    { kind: "escape", id: "ch05:1420" },
    { kind: "card", id: prompt },
    "pending:def:x",
    { kind: "escape", id: "ch04:1398" },
  ];
  assert.deepEqual(migrateSave(CONTENT, raw)?.pending, [{ kind: "prompt", id: prompt }, { kind: "escape", id: "ch04:1398" }]);
  delete raw.pending;
  assert.deepEqual(migrateSave(CONTENT, raw)?.pending, [], "an older save owes nothing");
});

test("a v0.1/v0.2 save: its pending:* flags become save.pending, escapes first, and are removed", () => {
  const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch04" });
  const [first, second] = CONTENT.chapters.ch04.prompts.map((prompt) => prompt.id);
  const battle = CONTENT.chapters.ch04.battles[0]?.id;
  assert.ok(first && second && battle);
  const raw = JSON.parse(JSON.stringify(save));
  delete raw.pending;
  // As those builds wrote them: one flag per owed card, in the order raised.
  raw.flags = {
    ...raw.flags,
    [`pending:def:${first}`]: true,
    [`pending:battle:${battle}`]: true,
    "pending:escape:ch04:1398": true,
    [`pending:def:${second}`]: true,
    "pending:def:ch09_elsewhere": true,
    "pending:def:answered": false,
    "pending:card:x": true,
    "pending:": true,
    keep: 3,
  };
  const migrated = migrateSave(CONTENT, raw);
  assert.ok(migrated);
  assert.deepEqual(migrated.pending, [
    { kind: "escape", id: "ch04:1398" },
    { kind: "prompt", id: first },
    { kind: "battle", id: battle },
    { kind: "prompt", id: second },
  ]);
  assert.deepEqual(Object.keys(migrated.flags).filter((flag) => flag.startsWith("pending:")), [], "no legacy flag is left behind");
  assert.equal(migrated.flags["keep"], 3, "other flags stay");
  assert.deepEqual(migrateSave(CONTENT, JSON.parse(JSON.stringify(migrated))), migrated, "converted once: the result round-trips");
});

test("a v0.1/v0.2 save: the old item id 'letter' is 송상현's fan (song_fan)", () => {
  const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch09" });
  const raw = JSON.parse(JSON.stringify(save));
  raw.inventory = { ...raw.inventory, letter: 1 };
  const migrated = migrateSave(CONTENT, raw);
  assert.equal(migrated?.inventory["song_fan"], 1);
  assert.equal(migrated?.inventory["letter"], undefined);
  assert.ok(evalCond(CONTENT, migrated as PlayerSave, { k: "item", item: "song_fan" }), "o_fan can be reached again");
});

test("demo presets give a sane save for every chapter", () => {
  let previousSkills = 0;
  for (const id of CHAPTER_IDS) {
    const chapter = FIXTURE.chapters[id];
    const save = newSave({ demoChapter: id, origin: "kaesong", name: "백운" });
    const where = `demo ${id}`;
    assert.equal(save.demo, true, where);
    assert.equal(save.chapter, id, where);
    assert.equal(save.year, chapter.years[0], where);
    assert.equal(save.step, 0, where);
    assert.equal(save.level, chapter.level[0], where);
    assert.equal(statTotal(save), 30 + 6 + 2 * (save.level - 1), `${where}: base + origin + 2/level`);
    assert.equal(save.freePoints, 0, where);
    assert.ok(save.lifeEnd >= save.year + 60, `${where}: lifeEnd ${save.lifeEnd}`);
    assert.equal(save.lifeEnd, Math.max(1861 + 4 * (chapter.order - 1), chapter.years[0] + 60), where);
    assert.equal(save.flags["school"] === true, chapter.order > 4, `${where}: school founded in ch04`);
    assert.equal(save.points.money, 150 * chapter.order, where);
    assert.equal(save.points.merit, 25 * save.rank, `${where}: merit matches rank, no instant promotion`);
    assert.equal(save.points.virtue, 60 * chapter.order, where);
    assert.ok(save.rank >= 0 && save.rank <= 18, where);
    assert.equal(save.suspicion, 15, where);
    assert.deepEqual(save.nation, chapter.hist, where);
    assert.ok(FIXTURE.items[save.equipment.weapon]?.kind === "weapon", where);
    assert.ok(FIXTURE.items[save.equipment.armor]?.kind === "armor", where);
    assert.equal(save.inventory[save.equipment.weapon], 1, where);
    assert.deepEqual(save.skills, skillsUnlockedBy(FIXTURE, id), where);
    assert.ok(save.skills.length >= previousSkills, `${where}: skills accumulate`);
    previousSkills = save.skills.length;
    assert.ok(save.skillSlots.length === Math.min(4, save.skills.length), where);
    assert.deepEqual(save.skillSlots, save.skills.slice(-4), `${where}: latest skills slotted`);
    // Identity history: closed past records, an open current one named as the player.
    const last = save.identities.at(-1)!;
    assert.equal(last.name, "백운", where);
    assert.equal(last.to, undefined, where);
    assert.equal(last.kind, save.identity.kind, where);
    assert.equal(save.identity.startYear, last.from, where);
    assert.equal(save.record.washes, save.identities.length - 1, where);
    for (const [index, record] of save.identities.slice(0, -1).entries()) {
      assert.equal(record.to, save.identities[index + 1]?.from, `${where}: contiguous identities`);
    }
    assert.ok(save.identity.startYear <= save.year && save.year - save.identity.startYear <= 40 || save.identity.kind === "birth", where);
    assert.ok(save.chronicle.at(-1)?.text.includes("시연 모드"), where);
    assert.ok(heroSprite(save).startsWith("hero_"), where);
    assert.deepEqual(roundTrip(save), save, `${where}: migrate round-trip`);
  }
  assert.equal(newSave({ demoChapter: "ch04" }).meritSubject, 2);
  assert.equal(newSave({ demoChapter: "ch04" }).rank, 14);
  assert.equal(newSave({ demoChapter: "ch04" }).flags["renowned"], true);
  assert.equal(newSave({ demoChapter: "ch01" }).rank, 0);
  assert.equal(newSave({ demoChapter: "ch16" }).record.washes, 15, "about one wash per 35 years");
  assert.deepEqual(newSave({ demoChapter: "ch16" }).equipment, { weapon: "jangyong_hwando", armor: "jangyong_armor" }, "ERA_GEAR: empire gear from 1897");
  assert.deepEqual(newSave({ demoChapter: "ch09" }).equipment, { weapon: "ssangsudo", armor: "gyeongbeongap" });
});

test("demo presets also work with the shipped content", () => {
  for (const id of CHAPTER_IDS) {
    const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: id });
    assert.equal(save.chapter, id);
    // §6: 60 years past the chapter's start, also when demoStart opens it later.
    assert.ok(save.lifeEnd >= CONTENT.chapters[id].years[0] + 60);
    assert.notEqual(migrateSave(CONTENT, JSON.parse(JSON.stringify(save))), null);
  }
});

test("demo presets carry the record and the names of the chapters already lived (endings never read empty)", () => {
  let previous: PlayerSave["record"] | null = null;
  for (const id of CHAPTER_IDS) {
    const chapter = CONTENT.chapters[id];
    const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: id });
    const lived = chapter.order - 1;
    const { record } = save;
    const where = `demo ${id}`;
    // Content gives the battles, bosses and purges; the rest is per chapter lived.
    const bosses = CHAPTER_IDS.slice(0, lived).reduce((sum, earlier) =>
      sum + CONTENT.chapters[earlier].battles.filter((battle) => battle.boss && !battle.alt).length, 0);
    assert.equal(record.bossKills, bosses, where);
    assert.deepEqual([record.revivesGiven, record.selfRevives, record.lifeSpent], [4 * lived, lived, 2 * lived], where);
    assert.equal(record.lifeGained - record.lifeSpent, save.lifeEnd - 1861, `${where}: the 천수 graph adds up`);
    assert.equal(record.turncoat, 0, where);
    if (lived > 0) assert.ok(record.kills >= 10 * lived && record.kills <= 100 * lived, `${where}: ${record.kills} kills`);
    else assert.deepEqual(record, { kills: 0, bossKills: 0, selfRevives: 0, revivesGiven: 0, washes: 0, purgesSurvived: 0, turncoat: 0, lifeGained: 0, lifeSpent: 0 });
    if (previous) {
      for (const key of ["kills", "bossKills", "purgesSurvived", "revivesGiven", "lifeSpent"] as const)
        assert.ok(record[key] >= previous[key], `${where}: ${key} grows with the chapters lived`);
    }
    previous = record;
    // A wash about every 35 years (30~40년마다 신분 세탁), none before CH04's own.
    const spans = save.identities.slice(0, -1).map((identity) => (identity.to ?? 0) - identity.from);
    if (chapter.order <= 4) assert.equal(save.record.washes, 0, where);
    else assert.ok(spans.every((years) => years >= 28 && years <= 50), `${where}: ${spans.join(",")}`);
    assert.equal(save.year - save.identity.startYear, chapter.order > 4 ? 15 : save.year - 1361, where);
  }
  const ch16 = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: "ch16" });
  const spans = ch16.identities.slice(0, -1).map((identity) => (identity.to ?? 0) - identity.from);
  assert.ok(spans.every((years) => years >= 28 && years <= 42), spans.join(","));
  assert.deepEqual(new Set(ch16.identities.slice(1).map((identity) => identity.kind)), new Set(["descendant", "exam", "merchant"]));
  assert.equal(ch16.chronicle.filter((entry) => entry.text.includes("의 이름을 버리고")).length, ch16.record.washes, "one chronicle line per wash");
});

test("migrateSave rejects garbage", () => {
  const valid = JSON.parse(JSON.stringify(newSave())) as Record<string, unknown>;
  const broken: unknown[] = [
    null, undefined, 42, "save", [], {}, [valid],
    { ...valid, version: SAVE_VERSION + 1 },
    { ...valid, version: "1" },
    { ...valid, token: "" },
    { ...valid, token: 7 },
    { ...valid, seed: "12" },
    { ...valid, seed: Number.NaN },
    { ...valid, name: "" },
    { ...valid, origin: "atlantis" },
    { ...valid, chapter: "ch99" },
  ];
  for (const raw of broken) assert.equal(migrateSave(FIXTURE, raw), null, JSON.stringify(raw)?.slice(0, 60));
  const hostile = {};
  Object.defineProperty(hostile, "version", { get: () => { throw new Error("boom"); }, enumerable: true });
  assert.equal(migrateSave(FIXTURE, hostile), null, "never throws");
});

test("migrateSave round-trips a played save", () => {
  const save = newSave();
  save.year = 1420;
  save.chapter = "ch05";
  save.level = 17;
  save.exp = 120;
  save.meritSubject = 3;
  save.titles.push("개국 3등 공신");
  save.favor["bangwon"] = -40;
  save.aligned = "bangwon";
  save.branches.B1 = false;
  save.flags = { route: "wihwa", disciples: 2, righteous: true };
  save.longFlags["hangul"] = { key: "people", add: 2 };
  save.bonds["merchant"] = 70;
  save.inventory["ginseng"] = 2;
  save.exile = "jeju";
  save.position = { x: 12.5, y: -3 };
  save.successor = { generation: 2 };
  save.points.honor = -20;
  save.infiltration = 12;
  save.ending = { nation: "N2", personal: "P4", score: 51.2, breakdown: [{ label: "국방", value: 10 }] };
  assert.deepEqual(roundTrip(save), save);
});

test("migrateSave clamps, drops unknowns and defaults missing optional fields", () => {
  const raw = JSON.parse(JSON.stringify(newSave())) as Record<string, unknown>;
  raw.stats = { power: 9999, agility: -4, body: "x" };
  raw.suspicion = -5;
  raw.rank = 77;
  raw.level = 0;
  raw.inventory = { rice_ball: 2, ghost_item: 3, hwando: 1 };
  raw.equipment = { weapon: "ghost_weapon", armor: "rice_ball" };
  raw.skills = ["dash_slash", "dash_slash", "no_skill", 5];
  raw.skillSlots = ["no_skill", "dash_slash"];
  raw.flags = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1, "bad": {"x": 1}}');
  raw.longFlags = JSON.parse('{"__proto__": {"key": "defense", "add": 5}, "fine": {"key": "reform", "add": 3}, "wrong": {"key": "magic", "add": 1}}');
  raw.branches = { B1: true, B99: true, B2: "yes" };
  raw.meritSubject = 9;
  raw.chronicle = [{ year: 1361, text: "ok" }, { year: "x", text: "bad" }, "nope"];
  delete raw.identities;
  delete raw.bonds;
  delete raw.record;
  const save = migrateSave(FIXTURE, raw);
  assert.ok(save);
  assert.equal(save.stats.power, 99);
  assert.equal(save.stats.agility, 1);
  assert.equal(save.stats.body, 8, "malformed stat falls back to the origin default");
  assert.equal(save.suspicion, 0);
  assert.equal(save.rank, 18);
  assert.equal(save.level, 1);
  assert.deepEqual(save.equipment, { weapon: "hwando", armor: "cotton_clothes" });
  assert.deepEqual(save.inventory, { rice_ball: 2, hwando: 1, cotton_clothes: 1 }, "unknown items dropped; fallback armor is owned");
  assert.deepEqual(save.skills, ["dash_slash"]);
  assert.deepEqual(save.skillSlots, ["dash_slash"]);
  assert.deepEqual(save.flags, { ok: 1 });
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined, "no prototype pollution");
  assert.deepEqual(save.longFlags, { fine: { key: "reform", add: 3 } });
  assert.deepEqual(save.branches, { B1: true });
  assert.equal(save.meritSubject, undefined);
  assert.deepEqual(save.chronicle, [{ year: 1361, text: "ok" }]);
  assert.deepEqual(save.identities, [{ name: "강휘", kind: "birth", from: 1361 }]);
  assert.deepEqual(save.bonds, {});
  assert.equal(save.record.washes, 0);
});
