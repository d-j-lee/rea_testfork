// Lifespan, apparent age, suspicion growth, identity washes and names.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WashMethod } from "../../src/shared/content/schema.ts";
import {
  apparentAge,
  changeLife,
  exposure,
  growSuspicion,
  offerVirtue,
  realAge,
  selfRevive,
  suggestName,
  suspicionBand,
  useItem,
  useLongevity,
  washBlocker,
  washIdentity,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { FIXTURE, newSave } from "./rules-fixture.ts";

test("apparent age is 16 + years/12; real age counts from 1345", () => {
  assert.equal(apparentAge(1361), 16);
  assert.equal(apparentAge(1387), 18.2);
  assert.equal(apparentAge(1910), 61.8);
  assert.equal(realAge(1387), 42, "GDD: 1387년 신분 나이 42세");
  assert.equal(realAge(1910), 565);
});

test("suspicion bands", () => {
  assert.equal(suspicionBand(0), "calm");
  assert.equal(suspicionBand(39.9), "calm");
  assert.equal(suspicionBand(40), "rumour");
  assert.equal(suspicionBand(69.9), "rumour");
  assert.equal(suspicionBand(70), "inquiry");
  assert.equal(suspicionBand(89.9), "inquiry");
  assert.equal(suspicionBand(90), "exposed");
});

test("changeLife and virtue offering (100 → +1 year, max 5 per chapter)", () => {
  const save = newSave();
  changeLife(save, -3);
  changeLife(save, 2);
  assert.equal(save.lifeEnd, 1860);
  assert.deepEqual([save.record.lifeGained, save.record.lifeSpent], [2, 3]);
  save.points.virtue = 750;
  assert.equal(offerVirtue(save), 5);
  assert.equal(save.points.virtue, 250);
  assert.equal(save.offeredThisChapter, 5);
  assert.equal(save.lifeEnd, 1865);
  assert.equal(offerVirtue(save), 0, "chapter cap reached");
  save.offeredThisChapter = 0;
  assert.equal(offerVirtue(save), 2);
  assert.equal(save.points.virtue, 50);
  assert.equal(offerVirtue(save), 0, "less than 100 virtue left");
});

test("노인성 일섬, self-revive and 산삼 spend or grant lifespan", () => {
  const save = newSave();
  assert.equal(useLongevity(save), true);
  assert.equal(useLongevity(save), true);
  assert.equal(useLongevity(save), true);
  assert.equal(useLongevity(save), false, "three per chapter");
  assert.equal(save.lifeEnd, 1858);
  selfRevive(save);
  assert.equal(save.lifeEnd, 1857);
  assert.equal(save.record.selfRevives, 1);
  save.inventory["ginseng"] = 1;
  const used = useItem(FIXTURE, save, "ginseng");
  assert.equal(used.ok, true);
  assert.equal(used.life, 2);
  assert.equal(save.lifeEnd, 1859);
  assert.equal(save.inventory["ginseng"], undefined);
  const heal = useItem(FIXTURE, save, "rice_ball");
  assert.deepEqual([heal.ok, heal.heal, save.inventory["rice_ball"]], [true, 30, 2]);
  assert.equal(useItem(FIXTURE, save, "rusty_hwando").ok, false, "gear is not consumed");
});

/** Independent reimplementation of the GDD formula for cross-checking. */
function expectedGrowth(save: PlayerSave, from: number, to: number, exposureFactor: number): number {
  let value = save.suspicion;
  for (let year = from + 1; year <= to; year++) {
    const identityAge = save.identity.startAge + (year - save.identity.startYear);
    const mismatch = identityAge - (16 + (year - 1361) / 12);
    value += 0.15 * Math.max(0, mismatch - 10) * exposureFactor;
    if (year >= 1413 && (year - 1413) % 3 === 0) value += 1;
    value = Math.min(100, Math.max(0, value));
  }
  return value;
}

test("suspicion over 50 years grows with exposure (commoner < 당하관 < 당상관 < 공신)", () => {
  const results: number[] = [];
  const cases: { label: string; setup: (save: PlayerSave) => void; factor: number }[] = [
    { label: "commoner", setup: (save) => { save.rank = 0; }, factor: 0.6 },
    { label: "junior", setup: (save) => { save.rank = 6; }, factor: 1.0 },
    { label: "senior", setup: (save) => { save.rank = 15; }, factor: 1.4 },
    { label: "merit", setup: (save) => { save.rank = 6; save.meritSubject = 3; }, factor: 1.8 },
    { label: "famous", setup: (save) => { save.points.fame = 50; }, factor: 1.8 },
  ];
  const thirty: number[] = [];
  for (const entry of cases) {
    for (const span of [30, 50]) {
      const save = newSave();
      save.year = 1420;
      save.identity = { kind: "descendant", startYear: 1420, startAge: Math.round(apparentAge(1420)) };
      entry.setup(save);
      assert.equal(exposure(save), entry.factor, entry.label);
      const expected = expectedGrowth(save, 1420, 1420 + span, entry.factor);
      growSuspicion(save, 1420, 1420 + span);
      assert.ok(Math.abs(save.suspicion - expected) < 0.06, `${entry.label}/${span}: ${save.suspicion} vs ${expected}`);
      (span === 30 ? thirty : results).push(save.suspicion);
    }
  }
  const [commoner, junior, senior, merit, famous] = thirty as [number, number, number, number, number];
  assert.ok(commoner < junior && junior < senior && senior < merit, `30 years: ${thirty.join(", ")}`);
  assert.equal(famous, merit, "fame ≥ 50 exposes like a 공신");
  assert.ok(junior >= 25 && junior <= 40, `a 당하관 is whispered about after 30 years: ${junior}`);
  // After 50 years every official is exposed; a commoner is not yet.
  assert.ok(results[0]! < 90, `commoner after 50 years: ${results[0]}`);
  for (const value of results.slice(1)) assert.equal(value, 100);
  // The first decade is quiet: the face still matches the papers.
  const quiet = newSave();
  quiet.identity = { kind: "exam", startYear: 1500, startAge: Math.round(apparentAge(1500)) };
  quiet.rank = 6;
  growSuspicion(quiet, 1500, 1510);
  assert.ok(quiet.suspicion <= 5, `only 호적 ticks in the first decade, got ${quiet.suspicion}`);
});

test("GDD verification: a 1392 공신 identity reaches 35~45 around 1418", () => {
  const save = newSave();
  save.year = 1392;
  save.identity = { kind: "birth", startYear: 1392, startAge: Math.round(apparentAge(1392)) };
  save.meritSubject = 1;
  growSuspicion(save, 1392, 1419);
  assert.ok(save.suspicion >= 35 && save.suspicion <= 45, `got ${save.suspicion}`);
  // The birth identity of 1361 is already whispered about by 1392.
  const birth = newSave();
  birth.rank = 3;
  growSuspicion(birth, 1361, 1392);
  assert.ok(birth.suspicion > 20 && birth.suspicion < 40, `got ${birth.suspicion}`);
});

interface WashCase {
  method: WashMethod | "forced";
  money: number;
  rank: number;
  bonds: number;
  suspicion: number;
  life: number;
}

test("wash methods: costs, carry-over and the new identity", () => {
  const cases: WashCase[] = [
    { method: "descendant", money: Math.floor((1000 - 300) * 0.8), rank: 5, bonds: 35, suspicion: 10, life: 1861 },
    { method: "fakeDeath", money: Math.floor((1000 - 100) * 0.5), rank: 0, bonds: 25, suspicion: 0, life: 1860 },
    { method: "monk", money: 0, rank: 0, bonds: 30, suspicion: 5, life: 1861 },
    { method: "merchant", money: 500, rank: 0, bonds: 50, suspicion: 15, life: 1861 },
    { method: "exam", money: Math.floor((1000 - 200) * 0.7), rank: 1, bonds: 50, suspicion: 10, life: 1861 },
    { method: "forced", money: 300, rank: 0, bonds: 25, suspicion: 15, life: 1859 },
  ];
  for (const entry of cases) {
    const save = newSave();
    save.year = 1430;
    save.points.money = 1000;
    save.rank = 11;
    save.bonds["clerk"] = 50;
    save.suspicion = 80;
    save.meritSubject = 2;
    const lines = washIdentity(FIXTURE, save, entry.method, "  박무명  ");
    assert.equal(save.points.money, entry.money, `${entry.method} money`);
    assert.equal(save.rank, entry.rank, `${entry.method} rank`);
    assert.equal(save.bonds["clerk"], entry.bonds, `${entry.method} bonds`);
    assert.equal(save.suspicion, entry.suspicion, `${entry.method} suspicion`);
    assert.equal(save.lifeEnd, entry.life, `${entry.method} life`);
    assert.equal(save.name, "박무명");
    assert.deepEqual(save.identity, { kind: entry.method, startYear: 1430, startAge: Math.round(apparentAge(1430)) });
    assert.deepEqual(save.identities, [
      { name: "강휘", kind: "birth", from: 1361, to: 1430 },
      { name: "박무명", kind: entry.method, from: 1430 },
    ]);
    assert.equal(save.record.washes, 1);
    assert.equal(save.meritSubject, entry.method === "descendant" ? 2 : undefined);
    assert.ok(save.chronicle.at(-1)?.text.includes("박무명"));
    assert.ok(lines[0]?.text.includes("강휘 → 박무명"));
    if (entry.method === "monk") assert.equal(save.flags["monk"], true);
  }
});

test("wash availability: cost, era and battle requirements", () => {
  const save = newSave();
  save.year = 1400;
  save.points.money = 250;
  assert.equal(washBlocker(save, "monk", false), undefined, "monk gives everything, always possible");
  assert.match(washBlocker(save, "descendant", false) ?? "", /300/);
  assert.match(washBlocker(save, "exam", false) ?? "", /1402/);
  assert.match(washBlocker(save, "fakeDeath", false) ?? "", /전쟁/);
  assert.equal(washBlocker(save, "fakeDeath", true), undefined);
  save.year = 1402;
  assert.equal(washBlocker(save, "exam", false), undefined);
});

test("suggestName is a deterministic Korean name that avoids past identities", () => {
  const save = newSave();
  const name = suggestName(save, "wash:1");
  assert.equal(name, suggestName(save, "wash:1"));
  assert.match(name, /^[가-힣]{3,4}$/);
  const names = new Set(Array.from({ length: 20 }, (_, index) => suggestName(save, `salt${index}`)));
  assert.ok(names.size >= 18, "different salts give different names");
  save.identities.push({ name, kind: "exam", from: 1500 });
  assert.notEqual(suggestName(save, "wash:1"), name, "a used name is skipped");
  const other = newSave({ seed: 4242 });
  assert.notEqual(suggestName(other, "wash:1"), name);
  const female = newSave({ variant: "f" });
  assert.match(suggestName(female, "x"), /^[가-힣]{3,4}$/);
});
