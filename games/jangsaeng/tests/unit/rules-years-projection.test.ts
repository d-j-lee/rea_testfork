// The years planner's lifespan projection (rules projectYears over the plan's
// own numbers) against what advanceYears then does to the save.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTER_IDS, type ChapterId, type WashMethod } from "../../src/shared/content/schema.ts";
import {
  advanceYears,
  apparentAge,
  projectYears,
  smallEventAt,
  yearsPlan,
  type YearsProjectionChoice,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { at, FIXTURE, newSave } from "./rules-fixture.ts";

/** A seed whose tokens leaving `chapter` roll no small events (chance is not projected). */
function quietSeed(chapter: ChapterId): number {
  for (let seed = 1; ; seed++) {
    let quiet = true;
    for (let index = 0; index < 5; index++) if (smallEventAt(seed, chapter, index)) quiet = false;
    if (quiet) return seed;
  }
}

/** A save at the end of `chapter`: a fresh identity (no flight at 발각) and a lifeEnd past the next start (no successor). */
function closing(chapter: ChapterId, setup: (save: PlayerSave) => void = () => {}): PlayerSave {
  const save = at(newSave({ seed: quietSeed(chapter) }), chapter, FIXTURE.chapters[chapter].years[1]);
  save.identity = { kind: "descendant", startYear: save.year, startAge: Math.round(apparentAge(save.year)) };
  save.lifeEnd = 1880;
  setup(save);
  return save;
}

const next = (chapter: ChapterId): ChapterId => CHAPTER_IDS[CHAPTER_IDS.indexOf(chapter) + 1] as ChapterId;

/** The projected lifeEnd and the one the passage leaves, for one plan. */
function both(save: PlayerSave, choice: YearsProjectionChoice): { projected: number; actual: number } {
  const to = next(save.chapter);
  const plan = yearsPlan(FIXTURE, save, to);
  const projected = projectYears(plan, choice).lifeEnd;
  const passed = structuredClone(save);
  const plain = { activities: [...choice.activities], offer: choice.offer, grace: choice.grace };
  advanceYears(FIXTURE, passed, to, choice.wash ? { ...plain, wash: choice.wash as WashMethod } : plain);
  return { projected, actual: passed.lifeEnd };
}

test("산중 수행: the planner's 천수 is the one the passage leaves (M9: 1901 shown, 1902 after)", () => {
  // CH11 → CH12 as reviewed: four tokens, one of them 산중 수행, a wash, the offering off.
  const save = closing("ch11", (s) => {
    s.lifeEnd = 1901;
    s.points.money = 315;
    s.points.virtue = 800;
  });
  const plan = yearsPlan(FIXTURE, save, "ch12");
  assert.equal(plan.tokens, 4);
  assert.equal(plan.activities.find((activity) => activity.id === "seclusion")?.life, 1, "the plan carries 산중 수행's +1 as data");
  const choice = { activities: ["train", "seclusion", "train", "train"], wash: "descendant", offer: false, grace: false };
  const projection = projectYears(plan, choice);
  assert.deepEqual([projection.lifeEnd, projection.activities, projection.offer], [1902, 1, 0]);
  assert.deepEqual(both(save, choice), { projected: 1902, actual: 1902 });
  // Five tokens of it and the offering: +5 and +5.
  const all = closing("ch11", (s) => { s.points.virtue = 800; });
  const five = { activities: ["seclusion", "seclusion", "seclusion", "seclusion"], offer: true, grace: false };
  assert.deepEqual(both(all, five), { projected: 1880 + 4 + 5, actual: 1880 + 4 + 5 });
});

test("the projection equals the passage for every activity, wash, offering and grace on the plan's own numbers", () => {
  const setups: readonly { name: string; apply: (save: PlayerSave) => void }[] = [
    { name: "poor", apply: (save) => { save.points.money = 40; save.points.virtue = 120; } },
    // One 구휼 affordable after the salary only; 200 공덕 short of the cap.
    { name: "salary pays", apply: (save) => { save.rank = 3; save.points.money = 60; save.points.virtue = 290; } },
    // Promotion at step 1 raises 관직 근무's pay; 출가 turns the purse into 공덕.
    { name: "rich", apply: (save) => { save.rank = 3; save.points.merit = 210; save.points.money = 1260; save.points.virtue = 430; } },
    // 감응 bonus within reach of the passage's 공덕 (600 at CH03, 2000 at CH10, 2800 at CH13).
    { name: "near the 감응 bonus", apply: (save) => { save.points.money = 900; save.points.virtue = 380; save.flags["virtueEarned"] = save.chapter === "ch03" ? 560 : save.chapter === "ch10" ? 1960 : 2760; } },
  ];
  const leaving: readonly ChapterId[] = ["ch02", "ch03", "ch07", "ch10", "ch12", "ch13"];
  const mixes: readonly string[][] = [
    ["commerce", "charity", "seclusion", "charity", "charity"],
    ["charity", "charity", "charity", "charity", "charity"],
    ["office", "charity", "network", "seclusion", "study"],
    ["unknown", "disciple", "charity", "seclusion", "commerce"],
  ];
  let checked = 0;
  for (const chapter of leaving) {
    for (const setup of setups) {
      const base = closing(chapter, setup.apply);
      const plan = yearsPlan(FIXTURE, base, next(chapter));
      // What the planner lets a player pick: open activities (an unknown id falls back in both).
      const closed = new Set(plan.activities.filter((activity) => activity.disabled).map((activity) => activity.id));
      const plans = [...plan.activities.map((activity) => Array.from({ length: plan.tokens }, () => activity.id)), ...mixes]
        .map((activities) => activities.slice(0, plan.tokens))
        .filter((activities) => !activities.some((id) => closed.has(id)));
      const washes = [null, ...plan.washes.filter((wash) => !wash.disabled).map((wash) => wash.id)];
      for (const activities of plans) {
        for (const wash of washes) {
          for (const offer of [false, true]) {
            for (const grace of [false, true]) {
              const choice = { activities: activities.slice(0, plan.tokens), wash, offer, grace };
              const { projected, actual } = both(base, choice);
              assert.equal(projected, actual, `${chapter} ${setup.name}: ${JSON.stringify(choice)}`);
              checked++;
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 1500, `${checked} plans`);
});

test("the plan's numbers: 감응, the purse after the salary, 출가's alms and 전사 위장's year", () => {
  const save = closing("ch03", (s) => {
    s.rank = 2;
    s.points.money = 100;
    s.points.virtue = 180;
    s.flags["virtueEarned"] = 560;
  });
  const plan = yearsPlan(FIXTURE, save, "ch04");
  assert.deepEqual(plan.resonance, { years: 4, bonus: 2, bonusAt: 40 }, "leaving CH03: +4, +2 once 40 more 공덕 is earned");
  assert.equal(plan.purse, 180, "100 + the salary of rank 2");
  assert.equal(plan.activities.find((activity) => activity.id === "charity")?.disabled, undefined, "the salary makes 구휼 affordable");
  assert.deepEqual(plan.activities.find((activity) => activity.id === "charity"), {
    ...plan.activities.find((activity) => activity.id === "charity"), money: -150, virtue: 60,
  });
  assert.equal(plan.washes.find((wash) => wash.id === "monk")?.alms, 10);
  assert.equal(plan.washes.find((wash) => wash.id === "monk")?.cost, undefined, "출가 gives the whole purse");
  assert.equal(plan.washes.find((wash) => wash.id === "fakeDeath")?.life, -1);
  // One 구휼 earns the 감응 bonus and a third offered year: 4 + 2 + 2 (240 공덕).
  const projection = projectYears(plan, { activities: ["charity"], offer: true, grace: false });
  assert.deepEqual([projection.resonance, projection.offerable], [6, 2]);
  const plain = projectYears(plan, { activities: ["train"], offer: true, grace: false });
  assert.deepEqual([plain.resonance, plain.offerable], [4, 1]);
  // Already earned: no 감응 left when the flag is set.
  const done = closing("ch03", (s) => { s.flags["resonance:ch03"] = true; });
  assert.equal(yearsPlan(FIXTURE, done, "ch04").resonance, undefined);
});
