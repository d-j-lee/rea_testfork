// Apparent age, suspicion growth (GDD §5.4.1–5.4.3), identity washes
// (§5.4.4) and names.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WashMethod } from "../../src/shared/content/schema.ts";
import {
  apparentAge,
  applyEffects,
  eraFactor,
  exposure,
  growSuspicion,
  realAge,
  suggestName,
  suspicionBand,
  washBlocker,
  washCost,
  washIdentity,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { at, FIXTURE, newSave } from "./rules-fixture.ts";

test("apparent age is 16 + years/12; real age counts from 1345", () => {
  assert.equal(apparentAge(1361), 16);
  assert.equal(apparentAge(1387), 18.2);
  assert.equal(apparentAge(1910), 61.8);
  assert.equal(realAge(1387), 42);
  assert.equal(realAge(1910), 565);
});

test("suspicion bands", () => {
  assert.deepEqual([0, 39.9, 40, 69.9, 70, 89.9, 90, 100].map(suspicionBand), [
    "calm", "calm", "rumour", "rumour", "inquiry", "inquiry", "exposed", "exposed",
  ]);
});

test("exposure X and era factor", () => {
  const save = newSave();
  assert.equal(exposure(save), 0.6);
  save.rank = 1;
  assert.equal(exposure(save), 1.0);
  save.rank = 14;
  assert.equal(exposure(save), 1.4);
  save.flags["renowned"] = true;
  assert.ok(Math.abs(exposure(save) - 1.8) < 1e-9);
  assert.deepEqual([1412, 1413, 1484, 1485, 1895, 1896].map(eraFactor), [1.0, 1.15, 1.15, 1.25, 1.25, 1.35]);
});

/** §5.4.2: identity washed in 1413 at suspicion 10, no event additions. */
function afterYears(rank: number, renowned: boolean, years: number): number {
  const save = newSave();
  save.year = 1413;
  save.rank = rank;
  if (renowned) save.flags["renowned"] = true;
  save.identity = { kind: "descendant", startYear: 1413, startAge: Math.round(apparentAge(1413)) };
  save.suspicion = 10;
  growSuspicion(save, 1413, 1413 + years);
  return Math.round(save.suspicion);
}

test("suspicion growth matches the §5.4.2 table", () => {
  const spans = [20, 30, 40, 50, 60];
  assert.deepEqual(spans.map((years) => afterYears(0, false, years)), [12, 17, 26, 37, 52], "무직 0.6");
  assert.deepEqual(spans.map((years) => afterYears(5, false, years)), [13, 22, 36, 55, 80], "품계 1~13");
  assert.deepEqual(spans.map((years) => afterYears(15, false, years)), [15, 27, 46, 73, 100], "당상관");
  assert.deepEqual(spans.map((years) => afterYears(15, true, years)), [16, 32, 57, 91, 100], "당상관 + renowned");
});

test("§5.4.2 birth identity: 22 in 1392 → 40 → 53 → 69 → 80 by the 1413 호패법", () => {
  const save = newSave();
  save.rank = 5;
  growSuspicion(save, 1361, 1380);
  applyEffects(FIXTURE, save, [{ k: "suspicion", add: 5 }]); // 황산 공훈
  growSuspicion(save, 1380, 1392);
  applyEffects(FIXTURE, save, [{ k: "suspicion", add: 5 }, { k: "meritSubject", grade: 1 }]); // 책록
  assert.equal(Math.round(save.suspicion), 22);
  assert.equal(save.flags["renowned"], true, "공신 책록 makes this identity renowned");
  const checkpoints: number[] = [];
  let year = 1392;
  for (const next of [1400, 1405, 1410, 1413]) {
    growSuspicion(save, year, next);
    year = next;
    checkpoints.push(Math.round(save.suspicion));
  }
  assert.deepEqual(checkpoints, [40, 53, 69, 80]);
});

interface WashCase {
  method: WashMethod | "forced";
  money: number;
  rank: number;
  bonds: number;
  merit: number;
  suspicion: number;
  life: number;
}

test("wash table (§5.4.4): costs, suspicion after, carry of money/rank/bonds/merit", () => {
  const cases: WashCase[] = [
    { method: "descendant", money: Math.floor(700 * 0.8), rank: 5, bonds: 35, merit: 100, suspicion: 10, life: 1861 },
    { method: "fakeDeath", money: Math.floor(900 * 0.5), rank: 0, bonds: 25, merit: 0, suspicion: 0, life: 1860 },
    { method: "monk", money: 0, rank: 0, bonds: 30, merit: 0, suspicion: 5, life: 1861 },
    { method: "merchant", money: 500, rank: 0, bonds: 40, merit: 0, suspicion: 15, life: 1861 },
    { method: "exam", money: Math.floor(800 * 0.7), rank: 2, bonds: 30, merit: 0, suspicion: 10, life: 1861 },
    { method: "forced", money: 300, rank: 0, bonds: 25, merit: 0, suspicion: 0, life: 1859 },
  ];
  for (const entry of cases) {
    const save = at(newSave(), "ch05", 1430);
    save.points.money = 1000;
    save.points.merit = 200;
    save.rank = 11;
    save.stats.agility = 20; // exam: min(4, 1 + floor(20 / 15)) = 2
    save.bonds["yi_sunsin"] = 50;
    save.suspicion = 80;
    save.flags["renowned"] = true;
    save.meritSubject = 2;
    const lines = washIdentity(FIXTURE, save, entry.method, "  박무명  ");
    const where = entry.method;
    assert.equal(save.points.money, entry.money, `${where} money`);
    assert.equal(save.rank, entry.rank, `${where} rank`);
    assert.equal(save.bonds["yi_sunsin"], entry.bonds, `${where} bonds`);
    assert.equal(save.points.merit, entry.merit, `${where} merit`);
    assert.equal(save.suspicion, entry.suspicion, `${where} suspicion`);
    assert.equal(save.lifeEnd, entry.life, `${where} life`);
    assert.equal(save.flags["renowned"], undefined, `${where}: renown belongs to the old name`);
    assert.equal(save.meritSubject, 2, `${where}: the 공신 record is kept`);
    assert.equal(save.name, "박무명");
    assert.deepEqual(save.identity, { kind: entry.method, startYear: 1430, startAge: Math.round(apparentAge(1430)) });
    assert.deepEqual(save.identities, [
      { name: "강휘", kind: "birth", from: 1361, to: 1430 },
      { name: "박무명", kind: entry.method, from: 1430 },
    ]);
    assert.equal(save.record.washes, 1);
    assert.ok(lines[0]?.text.includes("강휘 → 박무명"));
    if (entry.method === "monk") {
      assert.equal(save.flags["monk"], true);
      assert.equal(save.points.virtue, 100, "100전당 공덕 +10");
    }
  }
});

test("exam rank is 1 + floor(agility / 15), at most 4", () => {
  const rankFor = (agility: number) => {
    const save = at(newSave(), "ch05", 1430);
    save.points.money = 500;
    save.stats.agility = agility;
    washIdentity(FIXTURE, save, "exam", "윤무영");
    return save.rank;
  };
  assert.deepEqual([5, 14, 15, 44, 45, 99].map(rankFor), [1, 1, 2, 3, 4, 4]);
});

test("wash availability: cost, era, war chapters, 백가 discount and the free ch04 tutorial", () => {
  const save = at(newSave(), "ch01", 1364);
  save.points.money = 250;
  assert.equal(washBlocker(save, "monk"), undefined, "monk gives everything, always possible");
  assert.match(washBlocker(save, "descendant") ?? "", /300/);
  assert.match(washBlocker(save, "exam") ?? "", /1402/);
  assert.match(washBlocker(save, "fakeDeath") ?? "", /전쟁/, "ch01 is not a war chapter");
  save.flags["escaped"] = true;
  assert.equal(washBlocker(save, "fakeDeath"), undefined, "an escape from a death sentence also allows it");
  delete save.flags["escaped"];
  at(save, "ch02", 1387);
  assert.equal(washBlocker(save, "fakeDeath"), undefined, "ch02 is a war chapter");

  assert.equal(washCost(save, "merchant"), 500);
  save.bonds["baek_house"] = 60;
  assert.equal(washCost(save, "merchant"), 250);
  assert.equal(washBlocker(save, "merchant"), undefined);

  const tutorial = at(newSave(), "ch04", 1413);
  tutorial.points.money = 0;
  assert.equal(washCost(tutorial, "descendant"), 0);
  assert.equal(washBlocker(tutorial, "descendant"), undefined);
  washIdentity(FIXTURE, tutorial, "descendant", "이덕수");
  assert.equal(tutorial.flags["tutorialWashUsed"], true);
  assert.equal(washCost(tutorial, "descendant"), 300, "only the first ch04 wash is free");
});

test("suggestName is a deterministic Korean name that avoids past identities", () => {
  const save: PlayerSave = newSave();
  const name = suggestName(save, "wash:1");
  assert.equal(name, suggestName(save, "wash:1"));
  assert.match(name, /^[가-힣]{3,4}$/);
  const names = new Set(Array.from({ length: 20 }, (_, index) => suggestName(save, `salt${index}`)));
  assert.ok(names.size >= 18, "different salts give different names");
  save.identities.push({ name, kind: "exam", from: 1500 });
  assert.notEqual(suggestName(save, "wash:1"), name, "a used name is skipped");
  assert.notEqual(suggestName(newSave({ seed: 4242 }), "wash:1"), name);
  assert.match(suggestName(newSave({ variant: "f" }), "x"), /^[가-힣]{3,4}$/);
});
