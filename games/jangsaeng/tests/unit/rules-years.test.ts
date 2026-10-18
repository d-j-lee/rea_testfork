// Passage of years: tokens, activities, small events, salary, promotion,
// nation carry-over, chapter reset, washes, offering, grace and successor.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChapterId } from "../../src/shared/content/schema.ts";
import {
  advanceStepYear,
  advanceYears,
  apparentAge,
  carryNation,
  smallEventAt,
  tokensBetween,
  yearsPlan,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { at, FIXTURE, newSave } from "./rules-fixture.ts";

/** A seed whose passage fromYear → next rolls no small events. */
function quietSeed(fromYear: number, next: ChapterId, tokens: number): number {
  for (let seed = 1; ; seed++) {
    let quiet = true;
    for (let index = 0; index < tokens; index++) if (smallEventAt(seed, fromYear, next, index)) quiet = false;
    if (quiet) return seed;
  }
}

/** A save at `chapter`/`year` with a fresh identity, so growth is negligible. */
function saveAt(chapter: ChapterId, year: number, next: ChapterId, tokens: number): PlayerSave {
  const save = at(newSave({ seed: quietSeed(year, next, tokens) }), chapter, year);
  save.identity = { kind: "descendant", startYear: year, startAge: Math.round(apparentAge(year)) };
  return save;
}

const texts = (lines: readonly { text: string }[]) => lines.map((entry) => entry.text);

test("tokens = max(1, ceil(years / 10))", () => {
  assert.equal(tokensBetween(1393, 1419), 3);
  assert.equal(tokensBetween(1418, 1419), 1);
  assert.equal(tokensBetween(1419, 1419), 1);
  assert.equal(tokensBetween(1659, 1776), 12);
  const save = at(newSave(), "ch04", 1393);
  assert.equal(yearsPlan(FIXTURE, save, "ch05").tokens, 3);
  assert.equal(yearsPlan(FIXTURE, save, "ch05").toYear, 1419);
});

test("martial, study and commerce tokens", () => {
  const save = saveAt("ch04", 1393, "ch05", 3);
  save.stats.tact = 10;
  const lines = advanceYears(FIXTURE, save, "ch05", { activities: ["martial", "study", "commerce"], offer: false });
  assert.equal(save.freePoints, 2);
  assert.equal(save.stats.wit, 7);
  assert.equal(save.points.money, 50 + Math.round(400 * (1 + 10 / 50)));
  assert.equal(save.points.fame, 1);
  assert.equal(texts(lines)[0], "1393년 → 1419년 · 세월이 흐른다 (3토큰)");
  assert.ok(texts(lines).some((text) => text.includes("치부") && text.includes("전 +480")));
});

test("mountain retreat: +1 year, −8 suspicion, bonds −5% per token", () => {
  const save = saveAt("ch04", 1393, "ch05", 3);
  save.suspicion = 50;
  save.bonds["monk"] = 40;
  advanceYears(FIXTURE, save, "ch05", { activities: ["mountain", "mountain", "mountain"], offer: false });
  assert.equal(save.lifeEnd, 1864);
  assert.equal(save.record.lifeGained, 3);
  assert.equal(save.bonds["monk"], Math.round(Math.round(Math.round(40 * 0.95) * 0.95) * 0.95));
  // −24 from retreats, then 26 years of (small) growth for a fresh identity.
  assert.ok(save.suspicion >= 26 && save.suspicion < 40, `got ${save.suspicion}`);
});

test("office needs a rank; it pays merit, money and ruling favor", () => {
  const idle = saveAt("ch04", 1393, "ch05", 3);
  const lines = advanceYears(FIXTURE, idle, "ch05", { activities: ["office", "office", "office"], offer: false });
  assert.equal(idle.freePoints, 6, "falls back to 무예 수련");
  assert.ok(texts(lines).some((text) => text.includes("관직 근무 불가")));

  const official = saveAt("ch04", 1393, "ch05", 3);
  official.rank = 2;
  advanceYears(FIXTURE, official, "ch05", { activities: ["office", "office", "office"], offer: false });
  assert.equal(official.points.merit, 60);
  assert.equal(official.favor["bangwon"], 15, "ruling faction of the chapter being left");
  assert.equal(official.rank, 2, "merit 60 < 75 for 정8품");
  assert.equal(official.points.money, 50 + 3 * 80 + 2 * 40, "duty pay plus salary");
});

test("charity, network and disciples tokens", () => {
  const save = saveAt("ch04", 1393, "ch05", 3);
  save.points.money = 200;
  const lines = advanceYears(FIXTURE, save, "ch05", { activities: ["charity", "charity", "network"], offer: false });
  assert.equal(save.points.virtue, 60, "the second charity is unaffordable");
  assert.equal(save.points.money, 50);
  assert.ok(texts(lines).some((text) => text.includes("선행·구휼 불가")));
  const families = Object.entries(save.bonds).filter(([, value]) => value === 10);
  assert.equal(families.length, 1, "network adds +10 to one family");

  const teacher = saveAt("ch04", 1393, "ch05", 3);
  advanceYears(FIXTURE, teacher, "ch05", { activities: ["disciples", "disciples", "disciples"], offer: false });
  assert.equal(teacher.bonds["disciple"], 30);
  assert.equal(teacher.flags["disciples"], 3);
});

test("about 30% of tokens roll a small event resolved by a stat check", () => {
  let events = 0;
  for (let seed = 1; seed <= 400; seed++) if (smallEventAt(seed, 1393, "ch05", 0)) events++;
  assert.ok(events > 90 && events < 150, `≈30% of 400, got ${events}`);
  let seed = 1;
  while (!smallEventAt(seed, 1393, "ch05", 0)) seed++;
  const save = at(newSave({ seed }), "ch04", 1393);
  const event = smallEventAt(seed, 1393, "ch05", 0);
  const lines = texts(advanceYears(FIXTURE, save, "ch05", { activities: ["martial", "martial", "martial"], offer: false }));
  assert.ok(lines.some((text) => text.includes(event!.intro)));
  assert.ok(lines.some((text) => text.startsWith(`${event!.name} 판정`)));
});

test("transition is deterministic for a seed", () => {
  const one = at(newSave({ seed: 77 }), "ch04", 1393);
  const two = JSON.parse(JSON.stringify(one)) as PlayerSave;
  const choice = { activities: ["commerce", "network", "mountain"], offer: true };
  assert.deepEqual(advanceYears(FIXTURE, one, "ch05", choice), advanceYears(FIXTURE, two, "ch05", choice));
  assert.deepEqual(one, two);
});

test("salary, 공신전 and promotion under the outgoing regime", () => {
  const save = saveAt("ch04", 1418, "ch05", 1);
  save.rank = 5;
  save.meritSubject = 2;
  save.points.merit = 150;
  const lines = advanceYears(FIXTURE, save, "ch05", { activities: ["martial"], offer: false });
  assert.equal(save.points.money, 50 + 5 * 40 + 200);
  assert.ok(texts(lines).includes("녹봉 400전 (공신전 200전 포함)"));
  assert.equal(save.rank, 6);

  const senior = saveAt("ch04", 1418, "ch05", 1);
  senior.rank = 13;
  senior.points.merit = 400;
  advanceYears(FIXTURE, senior, "ch05", { activities: ["martial"], offer: false });
  assert.equal(senior.rank, 13, "당상관 needs ruling favor ≥ 30");
  const favored = saveAt("ch04", 1418, "ch05", 1);
  favored.rank = 13;
  favored.points.merit = 350;
  favored.favor["bangwon"] = 30;
  advanceYears(FIXTURE, favored, "ch05", { activities: ["martial"], offer: false });
  assert.equal(favored.rank, 14);

  const dismissed = saveAt("ch04", 1418, "ch05", 1);
  dismissed.rank = 5;
  dismissed.flags["salarySuspended"] = true;
  advanceYears(FIXTURE, dismissed, "ch05", { activities: ["martial"], offer: false });
  assert.equal(dismissed.points.money, 50);
  assert.equal(dismissed.flags["salarySuspended"], undefined);
});

test("nation carry-over: hist[next] + clamp(0.8·(cur − hist[cur]), ±20) + long flags", () => {
  const save = saveAt("ch04", 1418, "ch05", 1);
  save.nation = { defense: 60, finance: 0, people: 40, diplomacy: 100, reform: 30 };
  save.longFlags["hopae"] = { key: "defense", add: 2 };
  save.longFlags["hangul"] = { key: "people", add: 2 };
  assert.deepEqual(carryNation(FIXTURE, save, "ch05"), {
    defense: 55 + 12 + 2,
    finance: 50 - 20,
    people: 50 + 0 + 2,
    diplomacy: 50 + 20,
    reform: 45 + Math.round(-1.6),
  });
  advanceYears(FIXTURE, save, "ch05", { activities: ["martial"], offer: false });
  assert.deepEqual(save.nation, { defense: 69, finance: 30, people: 52, diplomacy: 70, reform: 43 });

  const late = saveAt("ch13", 1862, "ch14", 1);
  late.infiltration = 5;
  advanceYears(FIXTURE, late, "ch14", { activities: ["martial"], offer: false });
  assert.equal(late.infiltration, 5, "infiltration carries from CH14 on");
  const early = saveAt("ch04", 1418, "ch05", 1);
  early.infiltration = 5;
  advanceYears(FIXTURE, early, "ch05", { activities: ["martial"], offer: false });
  assert.equal(early.infiltration, 0, "no infiltration before CH14");
});

test("chapter counters reset and the year jumps to the next chapter", () => {
  const save = saveAt("ch04", 1418, "ch05", 1);
  save.step = 2;
  save.objectives = { o1: 3 };
  save.longevityUses = 2;
  save.offeredThisChapter = 5;
  save.position = { x: 10, y: 20 };
  save.exile = "jeju";
  advanceYears(FIXTURE, save, "ch05", { activities: ["martial"], offer: false });
  assert.equal(save.chapter, "ch05");
  assert.equal(save.year, 1419);
  assert.equal(save.step, 0);
  assert.deepEqual(save.objectives, {});
  assert.equal(save.longevityUses, 0);
  assert.equal(save.offeredThisChapter, 0);
  assert.equal(save.position, undefined);
  assert.equal(save.exile, "jeju", "the session starts the chapter at the exile site");
});

test("successor factions inherit half the favor; a sole heir inherits alignment", () => {
  const save = saveAt("ch02", 1387, "ch03", 1);
  save.favor["yi"] = 40;
  save.aligned = "yi";
  advanceYears(FIXTURE, save, "ch03", { activities: ["martial"], offer: false });
  assert.equal(save.favor["founders"], 20);
  assert.equal(save.aligned, "founders");
  const next = saveAt("ch03", 1392, "ch04", 1);
  next.favor["founders"] = 50;
  next.aligned = "founders";
  advanceYears(FIXTURE, next, "ch04", { activities: ["martial"], offer: false });
  assert.equal(next.favor["jeong"], 25);
  assert.equal(next.favor["bangwon"], 25);
  assert.equal(next.aligned, "founders", "two heirs: the choice is the player's");
});

test("yearsPlan lists activities, washes, advice and offering", () => {
  const quietChapter = at(newSave(), "ch04", 1418);
  const plan = yearsPlan(FIXTURE, quietChapter, "ch05");
  assert.equal(plan.type, "years");
  assert.deepEqual(plan.activities.map((activity) => activity.id), [
    "martial", "mountain", "commerce", "office", "study", "charity", "network", "disciples",
  ]);
  assert.equal(plan.activities.find((activity) => activity.id === "office")?.disabled, "관직이 없다");
  assert.ok(plan.activities.find((activity) => activity.id === "charity")?.disabled);
  assert.deepEqual(plan.washes.map((wash) => wash.id), ["descendant", "monk", "merchant", "exam"], "no 전사 위장 without a war");
  assert.ok(plan.washes.find((wash) => wash.id === "descendant")?.disabled?.includes("300"));
  assert.equal(plan.washes.find((wash) => wash.id === "monk")?.disabled, undefined);
  assert.equal(plan.washAdvised, false);
  assert.equal(plan.canOffer, 0);

  const war = at(newSave(), "ch02", 1387);
  war.points.money = 5000;
  war.points.virtue = 820;
  war.suspicion = 61;
  const warPlan = yearsPlan(FIXTURE, war, "ch03");
  assert.deepEqual(warPlan.washes.map((wash) => wash.id), ["descendant", "fakeDeath", "monk", "merchant", "exam"]);
  assert.equal(warPlan.washes.find((wash) => wash.id === "exam")?.disabled?.includes("1402"), true);
  assert.equal(warPlan.washAdvised, true);
  assert.equal(warPlan.canOffer, 5);
  assert.equal(warPlan.virtue, 820);
});

test("a chosen wash happens after the transition; an unaffordable one is refused", () => {
  const save = saveAt("ch04", 1418, "ch05", 1);
  save.points.money = 1000;
  save.suspicion = 70;
  const lines = advanceYears(FIXTURE, save, "ch05", { activities: ["martial"], wash: "exam", newName: "윤무영", offer: false });
  assert.equal(save.name, "윤무영");
  assert.equal(save.identity.kind, "exam");
  assert.equal(save.identity.startYear, 1419);
  assert.equal(save.rank, 1);
  assert.equal(save.suspicion, 10);
  assert.ok(texts(lines).some((text) => text.includes("윤무영")));

  const poor = saveAt("ch04", 1418, "ch05", 1);
  const refused = advanceYears(FIXTURE, poor, "ch05", { activities: ["martial"], wash: "merchant", offer: false });
  assert.equal(poor.name, "강휘");
  assert.ok(texts(refused).some((text) => text.startsWith("신분 세탁 불가")));
});

test("exposure at a transition forces a wash", () => {
  const save = saveAt("ch04", 1418, "ch05", 1);
  save.suspicion = 95;
  save.points.money = 1000;
  save.bonds["clerk"] = 60;
  const lines = advanceYears(FIXTURE, save, "ch05", { activities: ["martial"], offer: false });
  assert.equal(save.identity.kind, "forced");
  assert.equal(save.points.money, 300);
  assert.equal(save.rank, 0);
  assert.equal(save.lifeEnd, 1859);
  assert.equal(save.bonds["clerk"], 30);
  assert.equal(save.record.washes, 1);
  assert.ok(texts(lines).some((text) => text.includes("정체가 드러났다")));
});

test("offering at the transition and 노인성의 마지막 은혜 from CH14", () => {
  const before = saveAt("ch12", 1775, "ch13", 1);
  before.lifeEnd = 1850;
  before.points.virtue = 300;
  assert.equal(yearsPlan(FIXTURE, before, "ch13").canOffer, 3, "no grace before CH14");

  const save = saveAt("ch13", 1862, "ch14", 1);
  save.lifeEnd = 1855;
  save.points.virtue = 300;
  assert.equal(yearsPlan(FIXTURE, save, "ch14").canOffer, 13);
  const lines = advanceYears(FIXTURE, save, "ch14", { activities: ["martial"], offer: true });
  assert.equal(save.lifeEnd, 1868);
  assert.equal(save.graceUsed, true);
  assert.equal(save.points.virtue, 0);
  assert.equal(save.offeredThisChapter, 3, "the transition offering counts toward the new chapter");
  assert.equal(save.identity.kind, "descendant", "the hero lives on");
  assert.ok(texts(lines).some((text) => text.startsWith("노인성의 마지막 은혜")));
  const again = saveAt("ch14", 1881, "ch15", 1);
  again.graceUsed = true;
  again.lifeEnd = 1870;
  assert.equal(yearsPlan(FIXTURE, again, "ch15").canOffer, 0, "grace is once per character");
});

test("passing lifeEnd hands the run to a successor (stats 70%, rank 50%, bonds 80%)", () => {
  const save = saveAt("ch04", 1418, "ch05", 1);
  save.lifeEnd = 1418;
  save.stats = { power: 20, agility: 6, body: 15, spirit: 5, wit: 11, tact: 9 };
  save.rank = 9;
  save.bonds["disciple"] = 50;
  const lines = advanceYears(FIXTURE, save, "ch05", { activities: ["martial"], offer: false });
  assert.equal(save.identity.kind, "successor");
  assert.deepEqual(save.successor, { generation: 1 });
  assert.deepEqual(save.stats, { power: 14, agility: 5, body: 10, spirit: 5, wit: 7, tact: 6 });
  assert.equal(save.rank, 4);
  assert.equal(save.bonds["disciple"], 40);
  assert.equal(save.lifeEnd, 1419 + 55);
  assert.equal(save.year, 1419);
  assert.notEqual(save.name, "강휘");
  assert.equal(save.identities.at(-1)?.kind, "successor");
  assert.ok(save.chronicle.at(-1)?.text.includes("유지를 잇는다"));
  assert.ok(texts(lines).some((text) => text.startsWith("천수가 다했다")));
  // A successor does not age suspiciously.
  const suspicion = save.suspicion;
  advanceStepYear(FIXTURE, save, 1450);
  assert.equal(save.suspicion, suspicion);
});

test("advanceStepYear grows suspicion inside a chapter", () => {
  const save = at(newSave(), "ch02", 1365);
  save.rank = 3;
  advanceStepYear(FIXTURE, save, 1387);
  assert.equal(save.year, 1387);
  assert.ok(save.suspicion > 10 && save.suspicion < 25, `first rumours by 1387: ${save.suspicion}`);
  assert.deepEqual(advanceStepYear(FIXTURE, save, 1380), [], "never moves backwards");
  assert.equal(save.year, 1387);
});
