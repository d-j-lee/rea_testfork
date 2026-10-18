// Every Effect kind, nested check/if, runtime outcome collection and the
// condition algebra.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BattleDef, Effect } from "../../src/shared/content/schema.ts";
import { applyEffects, battleResult, evalCond, hashRoll, HOLD_VICTORY_VIRTUE, nationValue, virtueEarned } from "../../src/shared/rules/index.ts";
import { FIXTURE, HWANGSAN, newSave } from "./rules-fixture.ts";

const texts = (lines: readonly { text: string }[]) => lines.map((entry) => entry.text);

test("hashRoll is deterministic and spans 0..99", () => {
  assert.equal(hashRoll(7, "a"), hashRoll(7, "a"));
  const seen = new Set<number>();
  for (let index = 0; index < 2000; index++) {
    const roll = hashRoll(index, "purge:1398");
    assert.ok(Number.isInteger(roll) && roll >= 0 && roll <= 99);
    seen.add(roll);
  }
  assert.ok(seen.size > 90, "roll covers almost every value");
});

test("stat, point, exp, nation and longFlag effects", () => {
  const save = newSave();
  const out = applyEffects(FIXTURE, save, [
    { k: "stat", stat: "wit", add: 2 },
    { k: "point", point: "money", add: -1000 },
    { k: "point", point: "honor", add: -40 },
    { k: "point", point: "virtue", add: 60 },
    { k: "exp", add: 300 },
    { k: "nation", key: "defense", add: 3 },
    { k: "nation", key: "people", add: 500 },
    { k: "nation", key: "infiltration", add: -30 },
    { k: "longFlag", flag: "hunlyeon", key: "defense", add: 3 },
  ]);
  assert.equal(save.stats.wit, 7);
  assert.equal(save.points.money, 0, "money floors at 0");
  assert.equal(save.points.honor, -40, "honor can go negative");
  assert.equal(save.points.virtue, 60);
  assert.equal(save.flags["virtueEarned"], 60);
  assert.equal(save.level, 3);
  assert.equal(out.levelsGained, 2);
  assert.equal(save.nation.defense, 46, "+3 now and +3 from the long flag, applied immediately");
  assert.equal(save.nation.people, 100);
  assert.equal(save.infiltration, 0, "the meter stays within 0..100");
  assert.equal(nationValue(save, "infiltration"), 0);
  assert.deepEqual(save.longFlags["hunlyeon"], { key: "defense", add: 3 });
  const lines = texts(out.lines);
  assert.ok(lines.includes("지략 +2"));
  assert.ok(lines.includes("전 −50"));
  assert.ok(lines.includes("국방 +3"));
  assert.ok(lines.some((text) => text.startsWith("레벨 3")));
});

test("favor, align, bond, rank, suspicion and life effects clamp and describe", () => {
  const save = newSave();
  const out = applyEffects(FIXTURE, save, [
    { k: "favor", faction: "yi", add: 15 },
    { k: "favor", faction: "choe", add: -500 },
    { k: "align", faction: "yi" },
    { k: "bond", npc: "han_house", add: 150 },
    { k: "rank", add: 2 },
    { k: "rank", set: 40 },
    { k: "suspicion", add: 8 },
    { k: "suspicion", add: -50 },
    { k: "life", add: -2 },
    { k: "life", add: 3 },
  ]);
  assert.equal(save.favor["yi"], 25, "origin +10 then +15");
  assert.equal(save.favor["choe"], -100);
  assert.equal(save.aligned, "yi");
  assert.equal(save.bonds["han_house"], 100);
  assert.equal(save.rank, 18);
  assert.equal(save.suspicion, 0);
  assert.equal(save.lifeEnd, 1862);
  assert.equal(save.record.lifeSpent, 2);
  assert.equal(save.record.lifeGained, 3);
  const lines = texts(out.lines);
  assert.ok(lines.includes("이성계파 총애 +15"));
  assert.ok(lines.includes("최영파 총애 −100"));
  assert.ok(lines.includes("한씨 궁수 가문 인연 +100"));
  assert.ok(lines.includes("의심도 +8"));
  assert.ok(lines.includes("천수 −2년"));
  assert.ok(lines.includes("천수 +3년"));
});

test("flag, branch, title, meritSubject, chronicle and toast effects", () => {
  const save = newSave();
  save.year = 1392;
  const out = applyEffects(FIXTURE, save, [
    { k: "flag", flag: "righteous" },
    { k: "flag", flag: "route", value: "wihwa" },
    { k: "flag", flag: "turncoat" },
    { k: "flag", flag: "turncoat", value: 2 },
    { k: "branch", id: "B4", ok: false },
    { k: "title", title: "회군 공신" },
    { k: "title", title: "회군 공신" },
    { k: "meritSubject", grade: 2 },
    { k: "chronicle", text: "조선이 열리다." },
    { k: "toast", text: "개국!", tone: "epic" },
    { k: "toast", text: "알림" },
  ]);
  assert.equal(save.flags["righteous"], true);
  assert.equal(save.flags["route"], "wihwa");
  assert.equal(save.record.turncoat, 3);
  assert.equal(save.branches.B4, false);
  assert.equal(save.infiltration, 15, "a failed branch adds its weight to the stored meter once");
  assert.equal(nationValue(save, "infiltration"), 15);
  applyEffects(FIXTURE, save, [{ k: "branch", id: "B4", ok: false }]);
  assert.equal(save.infiltration, 15, "no double counting");
  applyEffects(FIXTURE, save, [{ k: "branch", id: "B4", ok: true }]);
  assert.equal(save.infiltration, 0, "a later success takes it back");
  applyEffects(FIXTURE, save, [{ k: "branch", id: "B4", ok: false }]);
  assert.deepEqual(save.titles, ["회군 공신", "개국공신 2등"]);
  applyEffects(FIXTURE, save, [{ k: "title", title: "개국공신 2등" }]);
  assert.equal(save.titles.length, 2, "content's own title for the grade is not duplicated");
  assert.equal(save.meritSubject, 2);
  assert.equal(save.flags["renowned"], true, "공신 책록 makes the identity renowned");
  assert.equal(save.rank, 13, "2등 공신 → 단계 13");
  assert.deepEqual(save.chronicle.at(-1), { year: 1392, text: "조선이 열리다." });
  assert.deepEqual(out.toasts, [{ text: "개국!", tone: "epic" }, { text: "알림", tone: "info" }]);
});

test("item effects add, auto-equip stronger gear, remove and keep a weapon equipped", () => {
  const save = newSave();
  let out = applyEffects(FIXTURE, save, [{ k: "item", item: "wolgdo", add: 1 }, { k: "item", item: "letter", add: 2 }]);
  assert.equal(save.inventory["wolgdo"], 1);
  assert.equal(save.inventory["letter"], 2);
  assert.equal(save.equipment.weapon, "wolgdo");
  assert.ok(texts(out.lines).includes("월도 장착"));
  applyEffects(FIXTURE, save, [{ k: "item", item: "hwando", add: 1 }]);
  assert.equal(save.equipment.weapon, "wolgdo", "weaker gear is not equipped");
  out = applyEffects(FIXTURE, save, [{ k: "item", item: "wolgdo", add: -1 }, { k: "item", item: "letter", add: -5 }]);
  assert.equal(save.inventory["wolgdo"], undefined);
  assert.equal(save.inventory["letter"], undefined);
  assert.equal(save.equipment.weapon, "hwando", "best remaining weapon is equipped");
  applyEffects(FIXTURE, save, [{ k: "item", item: "hwando", add: -1 }, { k: "item", item: "rusty_hwando", add: -1 }]);
  assert.equal(save.equipment.weapon, "rusty_hwando", "default weapon when none is left");
  assert.equal(save.inventory["rusty_hwando"], 1);
  applyEffects(FIXTURE, save, [{ k: "item", item: "no_such_item", add: 1 }]);
  assert.equal(save.inventory["no_such_item"], undefined);
});

test("skill effects add and auto-slot while a slot is free", () => {
  const save = newSave();
  applyEffects(FIXTURE, save, [{ k: "skill", skill: "pyeonjeon" }, { k: "skill", skill: "juhwa" }, { k: "skill", skill: "pyeonjeon" }]);
  assert.deepEqual(save.skills, ["dash_slash", "whirlwind", "war_cry", "pyeonjeon", "juhwa"]);
  assert.deepEqual(save.skillSlots, ["dash_slash", "whirlwind", "war_cry", "pyeonjeon"]);
});

test("wash and exile effects", () => {
  const save = newSave();
  save.year = 1418;
  save.points.money = 1000;
  save.rank = 9;
  save.bonds["merchant"] = 50;
  const out = applyEffects(FIXTURE, save, [{ k: "wash", method: "descendant" }, { k: "exile", site: "jeju" }]);
  assert.equal(out.washed, true);
  assert.notEqual(save.name, "강휘");
  assert.equal(save.identity.kind, "descendant");
  assert.equal(save.points.money, Math.floor(700 * 0.8));
  assert.equal(save.rank, 4);
  assert.equal(save.bonds["merchant"], 35);
  assert.equal(save.suspicion, 10);
  assert.equal(save.exile, "jeju");
  assert.ok(texts(out.lines).some((text) => text.includes("제주")));
});

test("runtime effects are collected, not performed", () => {
  const save = newSave();
  const out = applyEffects(FIXTURE, save, [
    { k: "prompt", prompt: "p_council" },
    { k: "battle", battle: "b_gate" },
    { k: "objective", objective: "o_reach" },
    { k: "goto", site: "hanyang", offset: [2, -1] },
    { k: "worldEvent", add: 5 },
    { k: "worldEvent", add: 7 },
  ]);
  assert.deepEqual(out.prompts, ["p_council"]);
  assert.deepEqual(out.battles, ["b_gate"]);
  assert.deepEqual(out.objectives, ["o_reach"]);
  assert.deepEqual(out.goto, { site: "hanyang", offset: [2, -1] });
  assert.equal(out.worldEvent, 12);
  assert.equal(out.escape, false);
  assert.equal(out.washed, false);
});

test("check uses clamp(base + per·stat, 5, 95) against hashRoll(seed, id)", () => {
  const save = newSave();
  save.stats.wit = 20;
  const roll = hashRoll(save.seed, "chk_wit");
  const base = roll - 40 + 1; // chance = roll + 1 → success
  const out = applyEffects(FIXTURE, save, [{
    k: "check", id: "chk_wit", label: "지략", stat: "wit", base, per: 2,
    success: [{ k: "point", point: "merit", add: 10 }],
    failure: [{ k: "point", point: "merit", add: -10 }],
  }]);
  const chance = Math.max(5, Math.min(95, roll + 1));
  const success = roll < chance;
  assert.equal(save.points.merit, success ? 10 : 0);
  assert.equal(out.lines[0]?.text, `지략 판정 ${success ? "성공" : "실패"} (${chance}%)`);
  assert.equal(save.flags["check:chk_wit"], success);

  // Same id on a clone of the starting state gives the same verdict.
  const again = newSave();
  again.stats.wit = 20;
  applyEffects(FIXTURE, again, [{
    k: "check", id: "chk_wit", label: "지략", stat: "wit", base, per: 2,
    success: [{ k: "point", point: "merit", add: 10 }], failure: [],
  }]);
  assert.equal(again.points.merit, save.points.merit);

  // Clamp: hopeless and certain checks still roll within 5..95.
  const hopeless = applyEffects(FIXTURE, newSave(), [{ k: "check", id: "x", label: "무모", base: -500, success: [], failure: [] }]);
  assert.match(hopeless.lines[0]?.text ?? "", /\(5%\)$/);
  const certain = applyEffects(FIXTURE, newSave(), [{ k: "check", id: "x", label: "확실", base: 500, success: [], failure: [] }]);
  assert.match(certain.lines[0]?.text ?? "", /\(95%\)$/);
});

test("nested if/check effects apply in order and merge their outcomes", () => {
  const save = newSave();
  let id = "nested";
  for (let index = 0; hashRoll(save.seed, id) >= 95; index++) id = `nested_${index}`;
  const inner: Effect = {
    k: "check", id, label: "처세", stat: "tact", base: 500,
    success: [{ k: "battle", battle: "escape_1" }, { k: "if", cond: { k: "flag", flag: "deep" }, then: [{ k: "prompt", prompt: "deep_ok" }] }],
    failure: [],
  };
  const out = applyEffects(FIXTURE, save, [
    { k: "flag", flag: "deep" },
    { k: "if", cond: { k: "origin", origin: "northeast" }, then: [inner], else: [{ k: "prompt", prompt: "never" }] },
    { k: "if", cond: { k: "origin", origin: "kaesong" }, then: [{ k: "prompt", prompt: "never" }], else: [{ k: "objective", objective: "else_branch" }] },
  ]);
  assert.deepEqual(out.battles, ["escape_1"]);
  assert.deepEqual(out.prompts, ["deep_ok"]);
  assert.deepEqual(out.objectives, ["else_branch"]);
});

test("battleResult grants victory rewards once per battle; a 대전 adds +2 years", () => {
  const save = newSave();
  const first = battleResult(FIXTURE, save, HWANGSAN, true);
  assert.equal(save.lifeEnd, 1863);
  assert.deepEqual(save.battlesWon, ["hwangsan"]);
  assert.equal(save.points.merit, 50);
  assert.ok(texts(first.lines).includes("천수 +2년"));
  assert.equal(save.flags["renowned"], true, "a 대전 victory makes the identity renowned");
  const again = battleResult(FIXTURE, save, HWANGSAN, true);
  assert.equal(save.lifeEnd, 1863, "only the first victory extends life");
  assert.equal(save.points.merit, 50, "victory effects are a first-victory reward too");
  assert.deepEqual(again.lines, []);
  assert.deepEqual(save.battlesWon, ["hwangsan"]);
  battleResult(FIXTURE, save, HWANGSAN, false);
  assert.equal(save.lifeEnd, 1862, "a defeat applies every time");
  battleResult(FIXTURE, save, HWANGSAN, false);
  assert.equal(save.lifeEnd, 1861);
});

test("winning a 방어·생존형 battle the first time grants 공덕 +30 (§5.3.2)", () => {
  const battle = (kind: BattleDef["kind"]): BattleDef => ({
    id: `hold_${kind}`, title: "진포 포대", site: "jinpo", radius: 10, kind, waves: [],
    victory: [{ k: "point", point: "merit", add: 40 }], defeat: [],
  });
  assert.equal(HOLD_VICTORY_VIRTUE, 30);
  for (const kind of ["defend", "survive"] as const) {
    const save = newSave();
    const virtue = save.points.virtue;
    const earned = virtueEarned(save);
    const out = battleResult(FIXTURE, save, battle(kind), true);
    assert.equal(save.points.virtue, virtue + 30, kind);
    assert.equal(virtueEarned(save), earned + 30, `${kind}: counts toward cumulative virtue`);
    assert.ok(texts(out.lines).includes("지켜 낸 싸움 — 공덕 +30"), kind);
    battleResult(FIXTURE, save, battle(kind), true);
    assert.equal(save.points.virtue, virtue + 30, `${kind}: once per battle`);
    battleResult(FIXTURE, save, battle(kind), false);
    assert.equal(save.points.virtue, virtue + 30, `${kind}: never for a defeat`);
  }
  for (const kind of ["waves", "boss", "escape", "deck", "duel"] as const) {
    const save = newSave();
    const virtue = save.points.virtue;
    battleResult(FIXTURE, save, battle(kind), true);
    assert.equal(save.points.virtue, virtue, kind);
  }
});

test("conditions: ranges, logic, flags, branches, items and battles", () => {
  const save = newSave();
  save.stats.wit = 25;
  save.flags["route"] = "wihwa";
  save.flags["zero"] = 0;
  save.branches.B3 = true;
  save.branches.B4 = false;
  save.battlesWon.push("hwangsan");
  const ok = (cond: Parameters<typeof evalCond>[2]) => evalCond(FIXTURE, save, cond);
  assert.equal(ok(undefined), true);
  assert.equal(ok({ k: "stat", stat: "wit", min: 25 }), true);
  assert.equal(ok({ k: "stat", stat: "wit", min: 26 }), false);
  assert.equal(ok({ k: "stat", stat: "wit", max: 24 }), false);
  assert.equal(ok({ k: "favor", faction: "yi", min: 10, max: 10 }), true);
  assert.equal(ok({ k: "favor", faction: "nobody", max: 0 }), true, "missing favor is 0");
  assert.equal(ok({ k: "bond", npc: "han_house", min: 1 }), false);
  assert.equal(ok({ k: "year", min: 1361, max: 1364 }), true);
  assert.equal(ok({ k: "lifeEnd", min: 1910 }), false);
  assert.equal(ok({ k: "nation", key: "infiltration", min: 15 }), true, "failed B4 adds 15");
  assert.equal(ok({ k: "flag", flag: "route" }), true);
  assert.equal(ok({ k: "flag", flag: "route", eq: "wihwa" }), true);
  assert.equal(ok({ k: "flag", flag: "route", eq: "other" }), false);
  assert.equal(ok({ k: "flag", flag: "zero" }), false);
  assert.equal(ok({ k: "flag", flag: "missing", eq: false }), true);
  assert.equal(ok({ k: "branch", id: "B3" }), true);
  assert.equal(ok({ k: "branch", id: "B4", ok: false }), true);
  assert.equal(ok({ k: "branch", id: "B5", ok: false }), true, "unattempted counts as not succeeded");
  assert.equal(ok({ k: "branch", id: "B5", ok: true }), false);
  assert.equal(ok({ k: "aligned", faction: null }), true);
  assert.equal(ok({ k: "identity", kind: "birth" }), true);
  assert.equal(ok({ k: "origin", origin: "kaesong" }), false);
  assert.equal(ok({ k: "item", item: "rice_ball", count: 3 }), true);
  assert.equal(ok({ k: "item", item: "rice_ball", count: 4 }), false);
  assert.equal(ok({ k: "battleWon", battle: "hwangsan" }), true);
  assert.equal(ok({ k: "all", of: [{ k: "rank", max: 0 }, { k: "level", min: 1 }] }), true);
  assert.equal(ok({ k: "any", of: [{ k: "rank", min: 5 }, { k: "suspicion", min: 50 }] }), false);
  assert.equal(ok({ k: "not", of: { k: "rank", min: 5 } }), true);
});
