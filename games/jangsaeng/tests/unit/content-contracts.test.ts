// Contracts between content and the rules that read it: the body-variant
// condition, the 유파 flags behind P3, and the 대체역사 tag on 나의 실록.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS, CONTENT } from "../../src/shared/content/index.ts";
import { DISCIPLE_XP_FLAG, SCHOOL_FLAG, type BattleDef, type OptionDef } from "../../src/shared/content/schema.ts";
import {
  advanceYears,
  applyEffects,
  battleResult,
  computeEnding,
  createSave,
  discipleGeneration,
  evalCond,
  migrateSave,
} from "../../src/shared/rules/index.ts";
import type { BodyVariant } from "../../src/shared/sprites.ts";
import type { PlayerSave } from "../../src/shared/types.ts";

function save(variant: BodyVariant = "m", demoChapter: keyof typeof CHAPTERS = "ch02"): PlayerSave {
  return createSave(CONTENT, { token: "t", name: "윤해", variant, origin: "kaesong", seed: 11, demoChapter });
}

function option(promptId: string, optionId: string): OptionDef {
  for (const chapter of Object.values(CHAPTERS)) {
    const found = chapter.prompts.find((prompt) => prompt.id === promptId)?.options.find((candidate) => candidate.id === optionId);
    if (found) return found;
  }
  throw new Error(`${promptId}.${optionId}`);
}

function battle(id: string): BattleDef {
  const found = Object.values(CHAPTERS).flatMap((chapter) => chapter.battles).find((candidate) => candidate.id === id);
  if (!found) throw new Error(id);
  return found;
}

test("the variant condition reads the hero's body variant", () => {
  const offered = (variant: BodyVariant, promptId: string) =>
    CHAPTERS.ch02.prompts.concat(CHAPTERS.ch15.prompts)
      .find((prompt) => prompt.id === promptId)!
      .options.filter((candidate) => evalCond(CONTENT, save(variant), candidate.requires) || candidate.lockedText)
      .map((candidate) => candidate.id);
  assert.ok(evalCond(CONTENT, save("f"), { k: "variant", eq: "f" }));
  assert.ok(!evalCond(CONTENT, save("f"), { k: "variant", eq: "m" }));
  assert.ok(offered("m", "ch02_mirror").includes("hide") && !offered("m", "ch02_mirror").includes("hide_hat"));
  assert.ok(offered("f", "ch02_mirror").includes("hide_hat") && !offered("f", "ch02_mirror").includes("hide"), "no beard for her");
  assert.deepEqual(offered("f", "p_uibyeong_1895"), ["keep_f", "reform_f"], "no topknot to cut");
  assert.deepEqual(offered("m", "p_uibyeong_1895"), ["keep", "cut"]);
});

test("every card keeps an enabled choice for both body variants", () => {
  for (const chapter of Object.values(CHAPTERS))
    for (const prompt of chapter.prompts) {
      const gated = prompt.options.some((candidate) => JSON.stringify(candidate.requires ?? {}).includes('"variant"'));
      if (!gated) continue;
      for (const variant of ["m", "f"] as const) {
        const visible = prompt.options.filter((candidate) => {
          const onlyOther = candidate.requires?.k === "variant" && candidate.requires.eq !== variant;
          return !onlyOther;
        });
        assert.ok(visible.length > 0, `${chapter.id} ${prompt.id} for ${variant}`);
      }
    }
});

test("the 유파 that ch04 founds is the one the rules train and P3 counts", () => {
  const hero = save("m", "ch04");
  delete hero.flags[SCHOOL_FLAG];
  delete hero.flags[DISCIPLE_XP_FLAG];
  assert.equal(discipleGeneration(hero), 0);
  applyEffects(CONTENT, hero, option("ch04_deokbo", "teach").effects);
  assert.equal(hero.flags[SCHOOL_FLAG], true, "덕수에게 활을 — the 유파 exists");
  assert.equal(discipleGeneration(hero), 1);

  // The 학당 founds the 유파 even when ch04 was declined, and trains one disciple.
  const late = save("m", "ch07");
  delete late.flags[SCHOOL_FLAG];
  delete late.flags[DISCIPLE_XP_FLAG];
  const lines = applyEffects(CONTENT, late, option("ch07_school", "teach").effects).lines.map((entry) => entry.text);
  assert.equal(late.flags[SCHOOL_FLAG], true);
  assert.equal(late.flags[DISCIPLE_XP_FLAG], 1);
  assert.ok(lines.some((text) => text.startsWith("제자 경험 +1")), lines.join(" | "));

  // 제자 양성 tokens add to the same counter; with six deep bonds that is P3.
  late.lifeEnd = 1950;
  advanceYears(CONTENT, late, "ch08", { activities: ["disciple", "disciple", "disciple"], offer: false });
  assert.equal(late.flags[DISCIPLE_XP_FLAG], 4);
  assert.equal(discipleGeneration(late), 3);
  late.bonds = { a: 60, b: 60, c: 60, d: 60, e: 60, f: 60 };
  late.year = 1910;
  late.record.turncoat = 0;
  late.rank = Math.min(late.rank, 10);
  assert.equal(computeEnding(CONTENT, late).personal, "P3");
});

test("counterfactual 실록 lines carry the 대체역사 tag through the save", () => {
  const hero = save("m", "ch15");
  hero.nation.finance = 60;
  applyEffects(CONTENT, hero, option("p_b5", "pay").effects);
  const line = hero.chronicle.at(-1);
  assert.match(line?.text ?? "", /군란은 일어나지 않았다/);
  assert.equal(line?.alt, true);
  const restored = migrateSave(CONTENT, JSON.parse(JSON.stringify(hero)));
  assert.equal(restored?.chronicle.at(-1)?.alt, true, "the tag survives a reload");

  const empire = save("m", "ch16");
  const before = empire.chronicle.length;
  battleResult(CONTENT, empire, battle("b_jungmyeong"), true);
  const added = empire.chronicle.slice(before);
  assert.ok(added.length >= 2, "the 대전 line and the battle's own line");
  for (const entry of added) assert.equal(entry.alt, true, entry.text);

  const real = save("m", "ch14");
  const start = real.chronicle.length;
  battleResult(CONTENT, real, battle("b_jeongjok"), true);
  for (const entry of real.chronicle.slice(start)) assert.equal(entry.alt, undefined, `real history: ${entry.text}`);
});
