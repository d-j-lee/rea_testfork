// Levels, stats, derived numbers, sprite choice, ranks and promotion.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocatePoint,
  checkPromotion,
  derived,
  equipItem,
  expToNext,
  grantExp,
  heroSprite,
  rankName,
  slotSkill,
} from "../../src/shared/rules/index.ts";
import { approx, FIXTURE, newSave } from "./rules-fixture.ts";

test("exp curve follows round(50 + 25·L^1.5)", () => {
  assert.equal(expToNext(1), 75);
  assert.equal(expToNext(4), 250);
  assert.equal(expToNext(10), 841);
  assert.equal(expToNext(39), Math.round(50 + 25 * 39 ** 1.5));
  let total = 0;
  for (let level = 1; level < 40; level++) total += expToNext(level);
  assert.ok(total > 90_000 && total < 110_000, `1→40 total ≈ 100k, got ${total}`);
});

test("grantExp levels up, grants 2 free points per level and caps at 40", () => {
  const save = newSave();
  assert.deepEqual(grantExp(save, 74), { levels: 0 });
  assert.equal(save.level, 1);
  assert.deepEqual(grantExp(save, 1), { levels: 1 });
  assert.equal(save.level, 2);
  assert.equal(save.exp, 0);
  assert.equal(save.freePoints, 2);
  assert.equal(expToNext(2), 121);
  assert.deepEqual(grantExp(save, 121 + 75), { levels: 1 }, "leftover exp stays below the next threshold");
  assert.equal(save.level, 3);
  assert.equal(save.exp, 75);
  assert.deepEqual(grantExp(save, -500), { levels: 0 });
  assert.deepEqual(grantExp(save, Number.NaN), { levels: 0 });
  const { levels } = grantExp(save, 10_000_000);
  assert.equal(save.level, 40);
  assert.equal(levels, 37);
  assert.equal(save.freePoints, 2 * 39);
  assert.ok(save.exp <= expToNext(40));
});

test("allocatePoint spends free points only", () => {
  const save = newSave();
  assert.equal(allocatePoint(save, "wit"), false);
  save.freePoints = 1;
  assert.equal(allocatePoint(save, "wit"), true);
  assert.equal(save.stats.wit, 6);
  assert.equal(save.freePoints, 0);
  assert.equal(allocatePoint(save, "wit"), false);
});

test("derived numbers for a known northeast level-1 save", () => {
  const save = newSave();
  // northeast: power +3, body +3.
  const d = derived(FIXTURE, save);
  assert.equal(d.maxHp, 60 + 10 * 8 + 5);
  assert.equal(d.maxEnergy, 100);
  assert.ok(approx(d.energyRegen, 3.5));
  assert.ok(approx(d.moveSpeed, 4.08));
  assert.ok(approx(d.critChance, 0.065));
  assert.ok(approx(d.melee, 1.2));
  assert.ok(approx(d.bow, 1.125));
  assert.ok(approx(d.skill, 1.1));
  assert.equal(d.weaponAtk, 10);
  assert.equal(d.armorDef, 2);
  assert.ok(approx(d.downSeconds, 10.8));

  save.stats.agility = 80;
  save.level = 40;
  save.stats.body = 30;
  save.equipment = { weapon: "empire_sabre", armor: "empire_uniform" };
  const late = derived(FIXTURE, save);
  assert.ok(approx(late.moveSpeed, 4.8), "move speed bonus caps at +20%");
  assert.equal(late.maxHp, 560, "GDD: 40레벨 근골 30 → 560");
  assert.equal(late.weaponAtk, 48);
  assert.equal(late.armorDef, 20);
});

test("heroSprite follows era, rank, identity and disguise", () => {
  const save = newSave();
  assert.equal(heroSprite(save), "hero_youth");
  save.level = 8;
  assert.equal(heroSprite(save), "hero_goryeo_officer");
  save.year = 1400;
  save.rank = 5;
  assert.equal(heroSprite(save), "hero_joseon_general");
  save.rank = 14;
  assert.equal(heroSprite(save), "hero_official");
  save.rank = 0;
  assert.equal(heroSprite(save), "hero_disguise");
  save.rank = 5;
  save.identity.kind = "merchant";
  assert.equal(heroSprite(save), "hero_disguise");
  save.identity.kind = "monk";
  assert.equal(heroSprite(save), "hero_hermit");
  save.flags["righteous"] = true;
  assert.equal(heroSprite(save), "hero_righteous");
  save.year = 1900;
  assert.equal(heroSprite(save), "hero_modern");
});

test("rankName gives grade and era office", () => {
  assert.deepEqual(rankName(0, 1400), { grade: "무품", office: "무관직" });
  assert.deepEqual(rankName(14, 1380), { grade: "정3품 당상", office: "장군" });
  assert.deepEqual(rankName(14, 1400), { grade: "정3품 당상", office: "상호군" });
  assert.deepEqual(rankName(18, 1900), { grade: "정1품", office: "대장" });
  assert.deepEqual(rankName(99, 1400), rankName(18, 1400));
});

test("promotion needs merit 25×(next step); 당상관 also needs ruling favor ≥ 30", () => {
  const save = newSave();
  save.points.merit = 100;
  assert.equal(checkPromotion(FIXTURE, save, "choe"), 4);
  assert.equal(save.rank, 4);
  assert.equal(checkPromotion(FIXTURE, save, "choe"), 0, "merit is a threshold, not spent");

  save.rank = 13;
  save.points.merit = 1000;
  save.favor["choe"] = 29;
  assert.equal(checkPromotion(FIXTURE, save, "choe"), 0);
  assert.equal(checkPromotion(FIXTURE, save, undefined), 0, "no ruling faction blocks senior posts");
  save.favor["choe"] = 30;
  assert.equal(checkPromotion(FIXTURE, save, "choe"), 5);
  assert.equal(save.rank, 18);
  assert.ok(save.chronicle.some((entry) => entry.text.includes("정1품")));
});

test("equip and slot actions validate ownership", () => {
  const save = newSave();
  assert.equal(equipItem(FIXTURE, save, "hwando"), false, "not owned");
  save.inventory["hwando"] = 1;
  assert.equal(equipItem(FIXTURE, save, "hwando"), true);
  assert.equal(save.equipment.weapon, "hwando");
  assert.equal(equipItem(FIXTURE, save, "rice_ball"), false);

  assert.deepEqual(save.skillSlots, ["dash_slash", "whirlwind", "war_cry"]);
  assert.equal(slotSkill(save, "pyeonjeon", 1), false, "unknown skill");
  save.skills.push("pyeonjeon");
  assert.equal(slotSkill(save, "pyeonjeon", 4), true);
  assert.deepEqual(save.skillSlots, ["dash_slash", "whirlwind", "war_cry", "pyeonjeon"]);
  assert.equal(slotSkill(save, "pyeonjeon", 1), true);
  assert.deepEqual(save.skillSlots, ["pyeonjeon", "whirlwind", "war_cry", "dash_slash"]);
  assert.equal(slotSkill(save, "war_cry", 5), false);
});
