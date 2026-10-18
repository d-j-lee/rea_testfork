// Lifespan (GDD §5.3): changeLife, offering, 노인성 감응, grace, 노인성 일섬,
// free first self-revive, 산삼 and the successor.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEffects,
  applyResonance,
  changeLife,
  completeWorldEvent,
  graceAvailable,
  LONGEVITY_MAX_PER_CHAPTER,
  longevityBlocker,
  offerVirtue,
  reviveVirtue,
  selfRevive,
  successorTakeover,
  useItem,
  useLongevity,
  virtueEarned,
} from "../../src/shared/rules/index.ts";
import { at, FIXTURE, newSave } from "./rules-fixture.ts";

test("changeLife records gains and losses", () => {
  const save = newSave();
  changeLife(save, -3);
  changeLife(save, 2);
  assert.equal(save.lifeEnd, 1860);
  assert.deepEqual([save.record.lifeGained, save.record.lifeSpent], [2, 3]);
});

test("offering: 100 virtue → +1 year, max 5 per chapter", () => {
  const save = newSave();
  save.points.virtue = 750;
  assert.equal(offerVirtue(save), 5);
  assert.equal(save.points.virtue, 250);
  assert.equal(save.offeredThisChapter, 5);
  assert.equal(save.lifeEnd, 1866);
  assert.equal(offerVirtue(save), 0, "chapter cap reached");
  save.offeredThisChapter = 0;
  assert.equal(offerVirtue(save), 2);
  assert.equal(offerVirtue(save), 0, "less than 100 virtue left");
});

test("virtue earned is cumulative even after offering", () => {
  const save = newSave({ origin: "southcoast" });
  assert.equal(virtueEarned(save), 50, "origin virtue counts");
  applyEffects(FIXTURE, save, [{ k: "point", point: "virtue", add: 300 }, { k: "point", point: "virtue", add: -10 }]);
  offerVirtue(save);
  assert.equal(save.points.virtue, 40);
  assert.equal(virtueEarned(save), 350);
});

test("노인성 감응: +4 when leaving ch03/ch10/ch13, +2 more at 600/2000/2800 virtue earned, once", () => {
  const save = newSave();
  assert.deepEqual(applyResonance(save, "ch02"), []);
  applyResonance(save, "ch03");
  assert.equal(save.lifeEnd, 1865);
  assert.deepEqual(applyResonance(save, "ch03"), [], "once per chapter");
  save.flags["virtueEarned"] = 1999;
  applyResonance(save, "ch10");
  assert.equal(save.lifeEnd, 1869);
  save.flags["virtueEarned"] = 2800;
  applyResonance(save, "ch13");
  assert.equal(save.lifeEnd, 1875);
});

test("grace is offered from a 1776+ chapter when lifeEnd < 1910, once", () => {
  const save = at(newSave(), "ch12", 1775);
  save.lifeEnd = 1880;
  assert.equal(graceAvailable(FIXTURE, save, "ch12"), false, "ch12 starts 1659");
  assert.equal(graceAvailable(FIXTURE, save, "ch13"), true, "ch13 starts 1776");
  save.lifeEnd = 1910;
  assert.equal(graceAvailable(FIXTURE, save, "ch13"), false);
  save.lifeEnd = 1880;
  save.graceUsed = true;
  assert.equal(graceAvailable(FIXTURE, save, "ch14"), false);
});

test("노인성 일섬: 3 per chapter, not with ≤ 1 year left, never for a successor", () => {
  const save = newSave();
  assert.equal(useLongevity(save), true);
  assert.equal(useLongevity(save), true);
  assert.equal(useLongevity(save), true);
  assert.equal(useLongevity(save), false, "three per chapter");
  assert.equal(save.lifeEnd, 1858);
  save.longevityUses = 0;
  save.lifeEnd = save.year + 1;
  assert.equal(useLongevity(save), false, "one year or less left");
  const heir = newSave();
  heir.year = 1500;
  heir.lifeEnd = 1499;
  successorTakeover(FIXTURE, heir);
  assert.equal(useLongevity(heir), false, "a mortal successor cannot");
});

test("longevityBlocker is the one gate and names the reason", () => {
  const save = newSave();
  save.year = 1500;
  assert.equal(longevityBlocker(save), null);
  save.longevityUses = LONGEVITY_MAX_PER_CHAPTER;
  assert.match(longevityBlocker(save) ?? "", /3\/3/);
  save.longevityUses = 0;
  save.lifeEnd = 1501;
  assert.match(longevityBlocker(save) ?? "", /천수/);
  assert.equal(useLongevity(save), false);
  const heir = newSave();
  heir.year = 1500;
  heir.lifeEnd = 1499;
  successorTakeover(FIXTURE, heir);
  assert.match(longevityBlocker(heir) ?? "", /계승자/);
});

test("공덕 for reviving: +8, ten times per chapter", () => {
  const save = at(newSave(), "ch04");
  const gained = Array.from({ length: 11 }, () => reviveVirtue(save));
  assert.deepEqual(gained, [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 0]);
  assert.equal(save.points.virtue, 80);
  assert.equal(virtueEarned(save), 80, "counts toward 노인성 감응 and P2");
  save.chapter = "ch05";
  assert.equal(reviveVirtue(save), 8, "a new chapter, a new allowance");
});

test("a completed 공동 실록: 시대정신 +1 once per chapter (cap 5), 공덕 +40 twice per chapter", () => {
  const save = at(newSave(), "ch04");
  const gains = Array.from({ length: 3 }, () => completeWorldEvent(save));
  assert.deepEqual(gains, [{ zeitgeist: 1, virtue: 40 }, { zeitgeist: 0, virtue: 40 }, { zeitgeist: 0, virtue: 0 }]);
  assert.equal(save.flags["zeitgeist"], 1);
  assert.equal(virtueEarned(save), 80, "counts toward 노인성 감응 and P2");
  save.chapter = "ch05";
  assert.deepEqual(completeWorldEvent(save), { zeitgeist: 1, virtue: 40 }, "a new chapter, a new allowance");
  // At the cap the chapter's completion still counts, but no 시대정신 is reported as gained.
  save.flags["zeitgeist"] = 5;
  save.chapter = "ch06";
  assert.deepEqual(completeWorldEvent(save), { zeitgeist: 0, virtue: 40 });
  assert.equal(save.flags["zeitgeist"], 5);
});

test("the first self-revive each chapter is free", () => {
  const save = newSave();
  selfRevive(save);
  assert.equal(save.lifeEnd, 1861);
  selfRevive(save);
  assert.equal(save.lifeEnd, 1860);
  assert.equal(save.record.selfRevives, 2);
});

test("산삼 grants +2 years; consumables return their heal", () => {
  const save = newSave();
  save.inventory["ginseng"] = 1;
  const used = useItem(FIXTURE, save, "ginseng");
  assert.deepEqual([used.ok, used.life, save.lifeEnd, save.inventory["ginseng"]], [true, 2, 1863, undefined]);
  const heal = useItem(FIXTURE, save, "rice_ball");
  assert.deepEqual([heal.ok, heal.heal, save.inventory["rice_ball"]], [true, 30, 2]);
  assert.equal(useItem(FIXTURE, save, "rusty_hwando").ok, false, "gear is not consumed");
});

test("successor (§5.3.4): stats 70% rounded, rank 50%, bonds 80%, money 70%, +60 years, grace spent", () => {
  const save = at(newSave(), "ch05", 1450);
  save.lifeEnd = 1449;
  save.level = 18;
  save.stats = { power: 20, agility: 6, body: 15, spirit: 5, wit: 11, tact: 9 };
  save.rank = 9;
  save.points.money = 1001;
  save.bonds["han_house"] = 50;
  save.suspicion = 77;
  save.flags["renowned"] = true;
  const lines = successorTakeover(FIXTURE, save);
  assert.equal(save.identity.kind, "successor");
  assert.deepEqual(save.successor, { generation: 1 });
  assert.deepEqual(save.stats, { power: 14, agility: 4, body: 11, spirit: 4, wit: 8, tact: 6 });
  assert.equal(save.level, 18);
  assert.equal(save.rank, 4);
  assert.equal(save.bonds["han_house"], 40);
  assert.equal(save.points.money, 700);
  assert.equal(save.suspicion, 0);
  assert.equal(save.lifeEnd, 1510);
  assert.equal(save.graceUsed, true);
  assert.equal(save.flags["renowned"], undefined);
  assert.notEqual(save.name, "강휘");
  assert.ok(lines[0]?.text.startsWith("천수가 다했다"));
  successorTakeover(FIXTURE, save);
  assert.deepEqual(save.successor, { generation: 2 });
});
