// New characters, demo presets for every chapter, and untrusted-save migration.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT } from "../../src/shared/content/index.ts";
import { CHAPTER_IDS, STAT_KEYS } from "../../src/shared/content/schema.ts";
import { createSave, heroSprite, migrateSave, skillsUnlockedBy } from "../../src/shared/rules/index.ts";
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
  assert.ok(newSave({ demoChapter: "ch16" }).record.washes >= 4, "about one wash per 120 years");
  assert.deepEqual(newSave({ demoChapter: "ch16" }).equipment, { weapon: "jangyong_hwando", armor: "jangyong_armor" }, "ERA_GEAR: empire gear from 1897");
  assert.deepEqual(newSave({ demoChapter: "ch09" }).equipment, { weapon: "ssangsudo", armor: "gyeongbeongap" });
});

test("demo presets also work with the shipped content", () => {
  for (const id of CHAPTER_IDS) {
    const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed: 5, demoChapter: id });
    assert.equal(save.chapter, id);
    assert.ok(save.lifeEnd >= save.year + 60);
    assert.notEqual(migrateSave(CONTENT, JSON.parse(JSON.stringify(save))), null);
  }
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
