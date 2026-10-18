// Passage of years (GDD §5.7): tokens, the fixed processing order,
// activities, small events, carry-over, counters, inquiry, forced wash, gear.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTER_IDS, type ChapterId } from "../../src/shared/content/schema.ts";
import {
  advanceStepYear,
  advanceYears,
  apparentAge,
  carryNation,
  smallEventAt,
  tokensBetween,
  yearsPlan,
  type YearsChoice,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { at, FIXTURE, newSave } from "./rules-fixture.ts";

const texts = (lines: readonly { text: string }[]) => lines.map((entry) => entry.text);

/** A seed whose tokens leaving `chapter` roll no small events. */
function quietSeed(chapter: ChapterId, tokens = 5): number {
  for (let seed = 1; ; seed++) {
    let quiet = true;
    for (let index = 0; index < tokens; index++) if (smallEventAt(seed, chapter, index)) quiet = false;
    if (quiet) return seed;
  }
}

/** A save at the end of `chapter` with a fresh identity (negligible growth) and quiet events. */
function ending(chapter: ChapterId, year?: number): PlayerSave {
  const save = at(newSave({ seed: quietSeed(chapter) }), chapter, year ?? FIXTURE.chapters[chapter].years[1]);
  save.identity = { kind: "descendant", startYear: save.year, startAge: Math.round(apparentAge(save.year)) };
  return save;
}

const go = (save: PlayerSave, next: ChapterId, choice: Partial<YearsChoice> = {}) =>
  texts(advanceYears(FIXTURE, save, next, { activities: [], offer: false, ...choice }));

test("tokens = clamp(ceil((next start − current start) / 15), 1, 5), 37 in a full run", () => {
  assert.equal(tokensBetween(1361, 1365), 1);
  assert.equal(tokensBetween(1469, 1575), 5);
  const counts = CHAPTER_IDS.slice(0, -1).map((id, index) => {
    const next = CHAPTER_IDS[index + 1] as ChapterId;
    return yearsPlan(FIXTURE, at(newSave(), id), next).tokens;
  });
  assert.deepEqual(counts, [1, 2, 1, 2, 3, 2, 5, 2, 1, 1, 4, 5, 5, 2, 1]);
  assert.equal(counts.reduce((sum, value) => sum + value, 0), 37);
});

test("train, study and commerce (백가 ≥ 60 ×1.2)", () => {
  const save = ending("ch04");
  save.stats.tact = 10;
  const lines = go(save, "ch05", { activities: ["train", "commerce"] });
  assert.equal(save.freePoints, 2);
  assert.equal(save.points.money, 50 + 480);
  assert.equal(save.points.fame, 1);
  assert.equal(lines[0], "1418년 → 1419년 · 세월이 흐른다 (2토큰)");
  const rich = ending("ch04");
  rich.bonds["baek_house"] = 60;
  go(rich, "ch05", { activities: ["study", "commerce"] });
  assert.equal(rich.stats.wit, 7);
  assert.equal(rich.points.money, 50 + Math.round(400 * 1.1 * 1.2));
});

test("seclusion: +1 year, −12 suspicion, bonds ×0.95 per token", () => {
  const save = ending("ch05");
  save.suspicion = 50;
  save.bonds["kim_jongseo"] = 40;
  go(save, "ch06", { activities: ["seclusion", "seclusion", "seclusion"] });
  assert.equal(save.lifeEnd, 1864);
  assert.equal(save.bonds["kim_jongseo"], 34);
  assert.ok(save.suspicion >= 14 && save.suspicion < 16, `50 − 36 + a little growth, got ${save.suspicion}`);
});

test("office needs a rank; it pays merit 40, money 20×rank and ruling favor", () => {
  const idle = ending("ch04");
  const lines = go(idle, "ch05", { activities: ["office", "office"] });
  assert.equal(idle.freePoints, 4, "falls back to 무예 수련");
  assert.ok(lines.some((text) => text.includes("관직 근무 불가")));
  const official = ending("ch04");
  official.rank = 2;
  go(official, "ch05", { activities: ["office", "office"] });
  assert.equal(official.points.merit, 80);
  assert.equal(official.favor["court_ch04"], 10, "favor goes to the court being left");
  assert.equal(official.favor["court_ch05"], 5, "then half of it carries to the successor court");
  assert.equal(official.points.money, 50 + 2 * 40 + 2 * 40, "salary first, then duty pay");
});

test("charity, network and disciple tokens", () => {
  const save = ending("ch04");
  save.points.money = 200;
  go(save, "ch05", { activities: ["charity", "charity"] });
  assert.equal(save.points.virtue, 60, "the second charity is unaffordable");
  assert.equal(save.points.money, 50);

  const social = ending("ch05");
  social.bonds = { kim_jongseo: 30, jang_yeongsil: 10, han_house: 5 };
  go(social, "ch06", { activities: ["network"] });
  assert.deepEqual(social.bonds, { kim_jongseo: 35, jang_yeongsil: 10, han_house: 13, baek_house: 8, hong_house: 8 });

  const teacher = ending("ch05");
  const blocked = go(teacher, "ch06", { activities: ["disciple"] });
  assert.ok(blocked.some((text) => text.includes("유파를 세운 뒤에")));
  const school = ending("ch05");
  school.flags["school"] = true;
  go(school, "ch06", { activities: ["disciple", "disciple", "disciple"] });
  assert.equal(school.flags["discipleXp"], 3);
});

test("small events: ~30% of tokens, ids yrs:<chapter>:<i>, kind = roll mod 10", () => {
  let events = 0;
  const kinds = new Set<number>();
  for (let seed = 1; seed <= 600; seed++) {
    const event = smallEventAt(seed, "ch07", 0);
    if (event) {
      events++;
      kinds.add(event.kind);
    }
  }
  assert.ok(events > 140 && events < 220, `≈30% of 600, got ${events}`);
  assert.equal(kinds.size, 10);
});

/** A seed whose first token leaving `chapter` rolls event `kind` and later tokens are quiet. */
function seedFor(chapter: ChapterId, kind: number, tokens: number): number {
  for (let seed = 1; ; seed++) {
    if (smallEventAt(seed, chapter, 0)?.kind !== kind) continue;
    let quiet = true;
    for (let index = 1; index < tokens; index++) if (smallEventAt(seed, chapter, index)) quiet = false;
    if (quiet) return seed;
  }
}

test("small event effects: plague, portrait, old friend, ginseng, procession", () => {
  const run = (kind: number, activity: string, setup?: (save: PlayerSave) => void) => {
    const save = at(newSave({ seed: seedFor("ch04", kind, 2) }), "ch04", 1418);
    save.identity = { kind: "descendant", startYear: 1418, startAge: Math.round(apparentAge(1418)) };
    setup?.(save);
    const lines = go(save, "ch05", { activities: [activity, "train"] });
    return { save, lines };
  };
  assert.equal(run(0, "train").save.lifeEnd, 1860, "역병: 천수 −1");
  const nursed = run(0, "charity", (save) => { save.points.money = 500; });
  assert.equal(nursed.save.lifeEnd, 1861);
  assert.equal(nursed.save.points.virtue, 90, "구휼 중의 역병: 공덕 +30 instead");
  assert.ok(run(5, "train").save.suspicion >= 10, "화원의 초상화: 의심도 +10");
  assert.equal(run(6, "train").save.bonds["han_house"], 10);
  assert.equal(run(8, "seclusion").save.inventory["ginseng"], 1, "산삼 while in the mountains");
  assert.equal(run(8, "study").save.points.money, 100, "elsewhere: 전 +50");
  const escort = run(9, "train");
  assert.equal(escort.save.points.merit, 20);
  assert.equal(escort.save.favor["court_ch04"], 3);
  assert.ok(escort.lines.some((text) => text.startsWith("왕실 행차 호위")));
});

test("processing order: salary before activities, wash before the years, vouch and offering", () => {
  const save = ending("ch04", 1413);
  save.rank = 2;
  save.points.money = 100;
  save.flags["vouch"] = true;
  save.points.virtue = 300;
  save.suspicion = 50;
  const lines = go(save, "ch05", { activities: ["charity", "train"], wash: "descendant", newName: "이덕수", offer: true });
  assert.equal(save.points.virtue, 60, "salary 80 made the charity affordable; 300 + 60 − 300 offered");
  assert.equal(save.identity.startYear, 1413, "the wash happens before the years pass");
  assert.equal(save.flags["tutorialWashUsed"], true, "the ch04 tutorial wash was free");
  assert.equal(save.suspicion, 0, "10 after the wash − 10 for the vouch; a fresh face does not grow for years");
  assert.equal(save.offeredThisChapter, 0, "counters reset after the offering");
  assert.equal(save.lifeEnd, 1864);
  const order = ["녹봉", "1번째 세월", "신분 세탁", "동료 보증", "노인성 제단", "의심도", "국운 이월"].map((prefix) =>
    lines.findIndex((text) => text.startsWith(prefix)));
  assert.ok(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1]!)), `order ${order.join(",")}`);
});

test("노인성 감응 when leaving ch03", () => {
  const save = ending("ch03");
  save.flags["virtueEarned"] = 600;
  const lines = go(save, "ch04", { activities: ["train"] });
  assert.equal(save.lifeEnd, 1867);
  assert.ok(lines.some((text) => text.startsWith("노인성 감응 — 천수 +6년")));
});

test("salary: 40×rank, none in exile or after a dismissal; promotion under the outgoing court", () => {
  const save = ending("ch04");
  save.rank = 5;
  save.points.merit = 150;
  go(save, "ch05", { activities: ["train", "train"] });
  assert.equal(save.points.money, 50 + 200);
  assert.equal(save.rank, 6);

  const exiled = ending("ch04");
  exiled.rank = 5;
  exiled.exile = "jeju";
  go(exiled, "ch05", { activities: ["train", "train"] });
  assert.equal(exiled.points.money, 50);

  const dismissed = ending("ch04");
  dismissed.rank = 5;
  dismissed.flags["salarySuspended"] = true;
  go(dismissed, "ch05", { activities: ["train", "train"] });
  assert.equal(dismissed.points.money, 50);
  assert.equal(dismissed.flags["salarySuspended"], undefined);

  const senior = ending("ch04");
  senior.rank = 13;
  senior.points.merit = 350;
  go(senior, "ch05", { activities: ["train", "train"] });
  assert.equal(senior.rank, 13, "당상관 needs court favor ≥ 30");
  const favored = ending("ch04");
  favored.rank = 13;
  favored.points.merit = 350;
  favored.favor["court_ch04"] = 30;
  go(favored, "ch05", { activities: ["train", "train"] });
  assert.equal(favored.rank, 14);
});

test("carry-over §5.6.2: hist[next] + clamp(0.8·(end − hist − F), ±20) + F", () => {
  const save = ending("ch04");
  save.nation = { defense: 60, finance: 0, people: 42, diplomacy: 100, reform: 44 };
  save.longFlags["sabyeong_reform"] = { key: "defense", add: 2 };
  save.longFlags["hangul_teach"] = { key: "people", add: 2 };
  assert.deepEqual(carryNation(FIXTURE, save, "ch05"), {
    defense: 55 + Math.round(0.8 * (60 - 50 - 2)) + 2,
    finance: 50 - 20,
    people: 50 + 0 + 2,
    diplomacy: 50 + 20,
    reform: Math.round(55 - 0.8),
  });
  // A long flag is a fixed bonus: carried twice it never compounds.
  const flagged = ending("ch04");
  flagged.nation = { ...FIXTURE.chapters.ch04.hist };
  flagged.longFlags["sabyeong_reform"] = { key: "defense", add: 2 };
  flagged.nation.defense += 2;
  go(flagged, "ch05", { activities: ["train", "train"] });
  assert.equal(flagged.nation.defense, 57);
  flagged.identity = { kind: "descendant", startYear: flagged.year, startAge: Math.round(apparentAge(flagged.year)) };
  flagged.seed = quietSeed("ch05");
  go(flagged, "ch06", { activities: ["train", "train", "train"] });
  assert.equal(flagged.nation.defense, 52, "hist 50 + 2, not more");

  const late = ending("ch13");
  late.infiltration = 5;
  go(late, "ch14", { activities: ["train"] });
  assert.equal(late.infiltration, 5, "infiltration carries from CH14 on");
  const early = ending("ch04");
  early.infiltration = 5;
  go(early, "ch05", { activities: ["train"] });
  assert.equal(early.infiltration, 0, "no infiltration before CH14");
});

test("chapter counters reset (incl. aligned = null and per-chapter flags)", () => {
  const save = ending("ch04");
  save.step = 2;
  save.objectives = { o1: 3 };
  save.longevityUses = 2;
  save.offeredThisChapter = 5;
  save.position = { x: 10, y: 20 };
  save.aligned = "bangwon";
  save.flags["freeReviveUsed"] = true;
  save.flags["escaped"] = true;
  save.exile = "jeju";
  go(save, "ch05", { activities: ["train"] });
  assert.equal(save.chapter, "ch05");
  assert.equal(save.year, 1419);
  assert.equal(save.step, 0);
  assert.deepEqual(save.objectives, {});
  assert.equal(save.longevityUses, 0);
  assert.equal(save.offeredThisChapter, 0);
  assert.equal(save.position, undefined);
  assert.equal(save.aligned, null);
  assert.equal(save.flags["freeReviveUsed"], undefined);
  assert.equal(save.flags["escaped"], undefined);
  assert.equal(save.exile, "jeju", "the session starts the chapter at the exile site");
});

test("successor factions inherit half the favor", () => {
  const save = ending("ch03");
  save.favor = { yi: 40, radical: 30, court_goryeo: 20 };
  go(save, "ch04", { activities: ["train"] });
  assert.equal(save.favor["bangwon"], 20);
  assert.equal(save.favor["jeongdojeon"], 15);
  assert.equal(save.favor["court_ch04"], 10);
});

test("suspicion 70–89 at a transition flags an inquiry; ≥ 90 forces a wash", () => {
  const watched = ending("ch05");
  watched.suspicion = 75;
  const lines = go(watched, "ch06", { activities: ["train"] });
  assert.equal(watched.flags["inquiry"], true);
  assert.ok(lines.some((text) => text.startsWith("사헌부")));

  const exposed = ending("ch05");
  exposed.suspicion = 95;
  exposed.points.money = 1000;
  exposed.bonds["kim_jongseo"] = 60;
  go(exposed, "ch06", { activities: ["train", "train", "train"] });
  assert.equal(exposed.identity.kind, "forced");
  assert.equal(exposed.points.money, 300);
  assert.equal(exposed.rank, 0);
  assert.equal(exposed.lifeEnd, 1859);
  assert.equal(exposed.bonds["kim_jongseo"], 30);
  assert.equal(exposed.suspicion, 0);
  assert.equal(exposed.flags["inquiry"], undefined);
});

test("offering and the last grace (next chapter from 1776)", () => {
  const save = ending("ch12");
  save.lifeEnd = 1850;
  save.points.virtue = 350;
  save.points.fame = 30;
  assert.equal(yearsPlan(FIXTURE, save, "ch13").canOffer, 13);
  const lines = go(save, "ch13", { activities: ["train"], offer: true });
  assert.equal(save.lifeEnd, 1863);
  assert.equal(save.graceUsed, true);
  assert.equal(save.points.virtue, 0, "grace consumes all remaining virtue");
  assert.equal(save.points.fame, 20);
  assert.ok(lines.some((text) => text.startsWith("노인성의 마지막 은혜")));

  const before = ending("ch11");
  before.lifeEnd = 1850;
  before.points.virtue = 300;
  assert.equal(yearsPlan(FIXTURE, before, "ch12").canOffer, 3, "ch12 starts 1659: no grace yet");
});

test("passing lifeEnd hands the run to a successor", () => {
  const save = ending("ch04");
  save.lifeEnd = 1418;
  save.rank = 9;
  const lines = go(save, "ch05", { activities: ["train"] });
  assert.equal(save.identity.kind, "successor");
  assert.equal(save.lifeEnd, 1479);
  assert.equal(save.rank, 4);
  assert.ok(lines.some((text) => text.startsWith("천수가 다했다")));
  const suspicion = save.suspicion;
  advanceStepYear(FIXTURE, save, 1450);
  assert.equal(save.suspicion, suspicion, "a successor ages honestly");
});

test("era gear (§5.9) is granted when better than what is equipped", () => {
  const save = ending("ch08");
  const lines = go(save, "ch09", { activities: ["train"] });
  assert.deepEqual(save.equipment, { weapon: "ssangsudo", armor: "gyeongbeongap" });
  assert.equal(save.inventory["ssangsudo"], 1);
  assert.ok(lines.some((text) => text.startsWith("시대 지급품")));
  const strong = ending("ch01");
  strong.inventory["empire_sabre"] = 1;
  strong.equipment.weapon = "empire_sabre";
  go(strong, "ch02", { activities: ["train"] });
  assert.equal(strong.equipment.weapon, "empire_sabre", "never downgrades");
});

test("yearsPlan lists activities, washes, advice and offering", () => {
  const save = at(newSave(), "ch04", 1418);
  const plan = yearsPlan(FIXTURE, save, "ch05");
  assert.equal(plan.type, "years");
  assert.deepEqual(plan.activities.map((activity) => activity.id), [
    "train", "seclusion", "commerce", "office", "study", "charity", "network", "disciple",
  ]);
  assert.equal(plan.activities.find((activity) => activity.id === "office")?.disabled, "관직이 없다");
  assert.ok(plan.activities.find((activity) => activity.id === "charity")?.disabled);
  assert.ok(plan.activities.find((activity) => activity.id === "disciple")?.disabled);
  assert.deepEqual(plan.washes.map((wash) => wash.id), ["descendant", "monk", "merchant", "exam"], "ch04 is not a war chapter");
  assert.equal(plan.washes.find((wash) => wash.id === "descendant")?.disabled, undefined, "the tutorial wash is free");
  assert.ok(plan.washes.find((wash) => wash.id === "descendant")?.desc.startsWith("비용 면제"));
  assert.equal(plan.washAdvised, false);
  assert.equal(plan.canOffer, 0);

  const war = at(newSave(), "ch02", 1387);
  war.points.virtue = 820;
  war.suspicion = 61;
  const warPlan = yearsPlan(FIXTURE, war, "ch03");
  assert.deepEqual(warPlan.washes.map((wash) => wash.id), ["descendant", "fakeDeath", "monk", "merchant", "exam"]);
  assert.ok(warPlan.washes.find((wash) => wash.id === "exam")?.disabled?.includes("1402"));
  assert.ok(warPlan.washes.find((wash) => wash.id === "descendant")?.disabled?.includes("300"));
  assert.equal(warPlan.washAdvised, true);
  assert.equal(warPlan.canOffer, 5);
});

test("transition is deterministic for a seed", () => {
  const one = at(newSave({ seed: 77 }), "ch07", 1574);
  const two = JSON.parse(JSON.stringify(one)) as PlayerSave;
  const choice = { activities: ["commerce", "network", "seclusion", "train", "study"], offer: true };
  assert.deepEqual(advanceYears(FIXTURE, one, "ch08", choice), advanceYears(FIXTURE, two, "ch08", choice));
  assert.deepEqual(one, two);
});

test("advanceStepYear grows suspicion inside a chapter", () => {
  const save = at(newSave(), "ch02", 1365);
  save.rank = 3;
  advanceStepYear(FIXTURE, save, 1387);
  assert.equal(save.year, 1387);
  assert.ok(save.suspicion > 3 && save.suspicion < 15, `first whispers by 1387: ${save.suspicion}`);
  assert.deepEqual(advanceStepYear(FIXTURE, save, 1380), [], "never moves backwards");
  assert.equal(save.year, 1387);
});
