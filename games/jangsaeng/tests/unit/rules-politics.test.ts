// Purge risk (GDD §5.5.3): side multiplier, protection, worked examples,
// 풍향계 blur, determinism and outcome margins.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PurgeSpec } from "../../src/shared/content/schema.ts";
import {
  applyEffects,
  hashRoll,
  purgeProtection,
  purgeRisk,
  purgeRiskShown,
  purgeSide,
  purgeTerms,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { FIXTURE, newSave } from "./rules-fixture.ts";

const P1398: PurgeSpec = { id: "purge_1398", intensity: 45, winner: "bangwon", loser: "jeongdojeon", exileSite: "jeju" };
const P1453: PurgeSpec = { id: "purge_1453", intensity: 60, winner: "suyang", loser: "kimjongseo", exileSite: "hoeryeong" };

function riskWith(setup: (save: PlayerSave) => void, spec: PurgeSpec): number {
  const save = newSave();
  save.favor = {};
  setup(save);
  return purgeRisk(FIXTURE, save, spec);
}

test("side multiplier: 0.3 with the winner, 1.0 with the loser, 0.6 otherwise", () => {
  const save = newSave();
  assert.equal(purgeSide(save, P1398), 0.6);
  save.aligned = "bangwon";
  assert.equal(purgeSide(save, P1398), 0.3);
  save.aligned = "jeongdojeon";
  assert.equal(purgeSide(save, P1398), 1.0);
  save.aligned = "someone_else";
  assert.equal(purgeSide(save, P1398), 0.6);
  assert.equal(purgeSide(save, { ...P1398, neutral: true }), 0.6, "the old neutral −15 rule is gone");
});

test("protection: 5 per 열전 bond ≥ 60 (max 15) + 5 for 동료 보증; family houses don't count", () => {
  const save = newSave();
  save.bonds = { yi_sunsin: 60, kim_jongseo: 70, jeongjo: 90, park_gyusu: 99, han_house: 100 };
  assert.equal(purgeProtection(save), 15);
  save.flags["vouch"] = true;
  assert.equal(purgeProtection(save), 20);
  save.bonds = { han_house: 100, baek_house: 100 };
  assert.equal(purgeProtection(save), 5);
});

test("§5.5.3 worked example 1398 (E45, 의심도 35, renowned, 처세 14): 6% · 33% · 66%", () => {
  // The GDD leaves favor implicit; these are the favor states that reproduce it.
  const base = (save: PlayerSave) => {
    save.suspicion = 35;
    save.flags["renowned"] = true;
    save.stats.tact = 14;
  };
  const bangwon = riskWith((save) => { base(save); save.aligned = "bangwon"; save.favor["bangwon"] = 40; }, P1398);
  const neutral = riskWith((save) => { base(save); save.favor["jeongdojeon"] = 4; }, P1398);
  const jeong = riskWith((save) => { base(save); save.aligned = "jeongdojeon"; save.favor["jeongdojeon"] = 40; }, P1398);
  assert.deepEqual([bangwon, neutral, jeong], [6, 33, 66]);
  // Without any favor the neutral stance is 0.6·45 + 8.75 + 10 − 14 = 31.75 → 32.
  assert.equal(riskWith(base, P1398), 32);
});

test("§5.5.3 worked example 1453 (E60, 의심도 30, 당상관, 처세 18, 보호 5): 5% · 38% · 72%", () => {
  const base = (save: PlayerSave) => {
    save.suspicion = 30;
    save.rank = 14;
    save.stats.tact = 18;
    save.bonds["yi_sunsin"] = 60;
  };
  const suyang = riskWith((save) => { base(save); save.aligned = "suyang"; save.favor["suyang"] = 25; }, P1453);
  const hermit = riskWith((save) => { base(save); save.favor["kimjongseo"] = 19; }, P1453);
  const kim = riskWith((save) => { base(save); save.aligned = "kimjongseo"; save.favor["kimjongseo"] = 44; }, P1453);
  assert.deepEqual([suyang, hermit, kim], [5, 38, 72]);
});

test("terms list every part of the formula; R clamps to 5..95", () => {
  const save = newSave();
  save.favor = { jeongdojeon: 50, bangwon: 10 };
  save.aligned = "jeongdojeon";
  save.suspicion = 20;
  save.rank = 14;
  save.flags["renowned"] = true;
  save.flags["vouch"] = true;
  save.stats.tact = 5;
  // 45 + 20 − 3 + 5 + 10 + 10 − 5 − 5 = 77
  assert.equal(purgeRisk(FIXTURE, save, P1398), 77);
  assert.deepEqual(purgeTerms(save, P1398).map((term) => term.label), [
    "사건 강도 45 × 1", "패배측 총애", "승리측 총애", "의심도", "당상관", "공훈의 이름", "처세", "보호",
  ]);
  assert.equal(purgeRisk(FIXTURE, save, { ...P1398, intensity: 200 }), 95);
  assert.equal(purgeRisk(FIXTURE, save, { ...P1398, intensity: -200 }), 5);
});

test("preview applies the option's effects to a clone only", () => {
  const save = newSave();
  save.favor = {};
  save.stats.tact = 5;
  const before = JSON.stringify(save);
  assert.equal(purgeRisk(FIXTURE, save, P1453), 31, "0.6·60 − 5");
  assert.equal(purgeRisk(FIXTURE, save, P1453, [{ k: "align", faction: "suyang" }, { k: "favor", faction: "suyang", add: 25 }]), 6, "0.3·60 − 7.5 − 5 = 5.5");
  assert.equal(purgeRisk(FIXTURE, save, P1453, [{ k: "align", faction: "kimjongseo" }, { k: "suspicion", add: 15 }]), 59);
  assert.equal(JSON.stringify(save), before, "the real save is untouched");
});

test("풍향계: exact with 지략 ≥ 30, else a stable ±10 blur", () => {
  const save = newSave();
  save.favor = {};
  save.stats.tact = 5;
  const risk = purgeRisk(FIXTURE, save, P1453);
  const blur = (hashRoll(save.seed, "purge_1453:blur") % 21) - 10;
  assert.deepEqual(purgeRiskShown(FIXTURE, save, P1453), { value: Math.max(0, Math.min(100, risk + blur)), exact: false });
  assert.deepEqual(purgeRiskShown(FIXTURE, save, P1453), purgeRiskShown(FIXTURE, save, P1453), "same value on every look");
  save.stats.wit = 30;
  assert.deepEqual(purgeRiskShown(FIXTURE, save, P1453), { value: risk, exact: true });
  let spread = new Set<number>();
  for (let seed = 1; seed < 300; seed++) {
    const other = newSave({ seed });
    spread.add(purgeRiskShown(FIXTURE, other, P1453).value - purgeRisk(FIXTURE, other, P1453));
  }
  spread = new Set([...spread].map((value) => Math.abs(value)));
  assert.ok(Math.max(...spread) <= 10 && spread.size >= 10, "blur spans −10..+10");
});

/** A save whose risk is exactly 0.6·E − 1 (neutral, tact 1, nothing else). */
function plainSave(): PlayerSave {
  const save = newSave({ origin: "kaesong" });
  save.stats.tact = 1;
  save.favor = {};
  return save;
}

/** First id whose roll falls inside [min, max]. */
function idWithRoll(save: PlayerSave, min: number, max: number): { id: string; roll: number } {
  for (let index = 0; ; index++) {
    const id = `purge_case_${index}`;
    const roll = hashRoll(save.seed, id);
    if (roll >= min && roll <= max) return { id, roll };
  }
}

/** Intensity giving a neutral plain save risk exactly R (E·0.6 − 1 = R). */
const intensityFor = (risk: number) => (risk + 1) / 0.6;

test("same purge id gives the same verdict across clones and reloads", () => {
  const verdicts = new Set<string>();
  for (let copy = 0; copy < 5; copy++) {
    const save = JSON.parse(JSON.stringify(newSave())) as PlayerSave;
    applyEffects(FIXTURE, save, [{ k: "purge", spec: P1398 }]);
    verdicts.add(String(save.flags["purge:purge_1398"]));
  }
  assert.equal(verdicts.size, 1);
});

test("roll ≥ R survives and counts", () => {
  const save = plainSave();
  const { id, roll } = idWithRoll(save, 20, 50);
  const out = applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll), winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "survived");
  assert.equal(save.record.purgesSurvived, 1);
  assert.equal(out.escape, false);
  assert.equal(out.lines[0]?.text, `숙청 판정 — 위험 ${roll} · 판정값 ${roll}`);
});

test("margin 0–14 dismisses (rank −3, salary suspended)", () => {
  const save = plainSave();
  save.rank = 10;
  const { id, roll } = idWithRoll(save, 10, 40);
  applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll + 14), winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "dismissed");
  assert.equal(save.rank, 7);
  assert.equal(save.flags["salarySuspended"], true);
});

test("margin 15–34 exiles (rank −5, life −1, exile site)", () => {
  const save = plainSave();
  save.rank = 4;
  const { id, roll } = idWithRoll(save, 10, 40);
  applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll + 15), winner: null, loser: null, exileSite: "geoje" } }]);
  assert.equal(save.flags[`purge:${id}`], "exiled");
  assert.equal(save.rank, 0);
  assert.equal(save.lifeEnd, 1860);
  assert.equal(save.exile, "geoje");
  const fallback = plainSave();
  const pick = idWithRoll(fallback, 10, 40);
  applyEffects(FIXTURE, fallback, [{ k: "purge", spec: { id: pick.id, intensity: intensityFor(pick.roll + 34), winner: null, loser: null } }]);
  assert.equal(fallback.exile, "jeju");
});

test("margin ≥ 35 is a death-sentence crisis handled by an escape battle", () => {
  const save = plainSave();
  const { id, roll } = idWithRoll(save, 10, 50);
  const out = applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll + 35), winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "sentenced");
  assert.equal(out.escape, true);
});
